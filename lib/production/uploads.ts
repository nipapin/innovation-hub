import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomUUID } from "node:crypto"
import { projectUploadObjectKey } from "@/lib/project-storage"
import { resolveProjectContentType } from "@/lib/project-upload-policy"
import { findProjectById } from "@/lib/repositories/projects"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { getMaxUploadBytes, safeBaseFileName } from "@/lib/s3-upload-policy"
import { projectPrefix } from "@/lib/storage/keys"
import { query } from "@/lib/db"
import { readFileTypeDictionary } from "@/lib/repositories/automation-settings"
import { writeFileDelete, writeNotifyUpload, writeRenameBatch } from "@/lib/storage/write-path"
import type { ChatAccess } from "./chat"
import { hasStepRole } from "./step-people"
import { renumber, slotFileName } from "@/lib/tools/element/names"
import { extensionFits } from "@/lib/tools/element/site-form"
import { findRow } from "./form"
import { isFolderFormRow, type FormRow } from "./graph"

/**
 * Вложения чата этапа — docs/PRODUCTION_PLAN.md §2.3, §7.1.
 *
 * Своя пара роутов вместо `/api/storage/v1/presign` и `notify`: те требуют
 * права редактора в проекте, а в чат пишут и проверяющий (комментатор), и
 * гость. Файл ложится строго в рабочую папку этапа ролика — путь задаёт сервер,
 * не клиент. Дальше — штатный путь записи: каталог, журнал изменений, автор.
 *
 * Загрузка в слот формы (`slot`) кладёт файл в папку слота и называет его как
 * сбор элемента: `01 Титры - clip.srt` (§3.0).
 */

/** `types` — типы строки формы: по ним проверяется расширение. */
type Target = { folder: string; fileName: string; types?: string[] }

/** Слот формы, куда кладут файл: строка, номер слота и папка слота от корня рабочей. */
export type SlotTarget = { rowId: string; index: number; dir: string }

/** Куда ложится файл и как называется — считает сервер, клиенту не верим. */
async function target(access: ChatAccess, input: { fileName: string; slot?: SlotTarget }): Promise<Target | null> {
  const { step } = access
  const work = step.paths?.work
  if (!work) return null
  const fileName = safeBaseFileName(input.fileName)
  if (!input.slot) return { folder: work, fileName }
  const node = step.graph.nodes.find((n) => n.id === step.nodeId)
  const row = node?.kind === "form" ? findRow(node.data.rows, input.slot.rowId) : null
  if (!row || isFolderFormRow(row)) return null
  const parts = input.slot.dir.split("/").filter(Boolean)
  if (parts.some((p) => p === "." || p === ".." || p.includes("\\"))) return null
  return {
    folder: [work, ...parts].join("/"),
    // Как сбор элемента (element-io.ts): имя слота без «безопасной» замены
    // пробелов — иначе `01 Титры - a.srt` стал бы `01_Титры_-_a.srt`, и форма
    // файла не узнала бы. Из исходного имени убираются только разделители пути.
    fileName: slotFileName(input.slot.index, row.label, plainName(input.fileName)),
    types: row.types,
  }
}

/** Имя без пути и управляющих символов — пробелы и буквы как есть. */
function plainName(name: string): string {
  const base = (name.split(/[/\\]/).pop() ?? "").replace(/[\u0000-\u001f]/g, "").trim()
  return base.slice(0, 180) || "file"
}

export type PresignResult =
  | { ok: true; url: string; s3Key: string; contentType: string; fileName: string }
  | { ok: false; reason: "storage" | "no-folder" | "too-big" | "bad-type" }

/**
 * Словарь типов файлов конвейера (`automation_settings`, домен `fileType`) — тот
 * же, что у проектов и редактора пайплайна. Недоступен — проверять нечем, и
 * загрузка не ломается.
 */
export async function fileTypeDictionary(): Promise<Record<string, string[]>> {
  try {
    return await readFileTypeDictionary()
  } catch (error) {
    console.error("[production] file type dictionary unavailable", error)
    return {}
  }
}

export async function presignChatUpload(
  access: ChatAccess,
  input: { fileName: string; contentType?: string; sizeBytes: number; slot?: SlotTarget },
): Promise<PresignResult> {
  if (!isS3Configured()) return { ok: false, reason: "storage" }
  const { step } = access
  if (!step.projectId) return { ok: false, reason: "no-folder" }
  if (input.sizeBytes > getMaxUploadBytes()) return { ok: false, reason: "too-big" }
  const project = await findProjectById(step.projectId)
  const place = await target(access, input)
  if (!project || !place) return { ok: false, reason: "no-folder" }
  if (place.types && !extensionFits({ fileTypes: await fileTypeDictionary() }, place.types, input.fileName)) {
    return { ok: false, reason: "bad-type" }
  }

  const fileName = place.fileName
  const contentType =
    resolveProjectContentType({ name: fileName, type: input.contentType ?? "" }) ?? "application/octet-stream"
  const s3Key = projectUploadObjectKey(
    project.storageOwnerId,
    project.id,
    place.folder,
    `${randomUUID()}-${fileName}`,
  )
  const url = await getSignedUrl(
    getS3Client(),
    new PutObjectCommand({ Bucket: getS3Bucket(), Key: s3Key, ContentType: contentType }),
    { expiresIn: 3600 },
  )
  return { ok: true, url, s3Key, contentType, fileName }
}

export type CompleteResult =
  | { ok: true; file: { id: string; name: string; s3Key: string; contentType: string; sizeBytes: number } }
  | { ok: false; reason: "bad-key" | "no-folder" }

export async function completeChatUpload(
  access: ChatAccess,
  userId: string,
  input: { s3Key: string; fileName: string; sizeBytes: number; contentType: string; slot?: SlotTarget },
): Promise<CompleteResult> {
  const { step } = access
  if (!step.projectId) return { ok: false, reason: "no-folder" }
  const project = await findProjectById(step.projectId)
  const place = await target(access, { ...input, fileName: input.fileName })
  if (!project || !place) return { ok: false, reason: "no-folder" }
  // Ключ — только из этого проекта: чужой объект в каталог этапа не пропускаем.
  if (!input.s3Key.startsWith(projectPrefix(project.storageOwnerId, project.id))) {
    return { ok: false, reason: "bad-key" }
  }
  const file = await writeNotifyUpload({
    storageOwnerId: project.storageOwnerId,
    projectId: project.id,
    s3Key: input.s3Key,
    folderPath: place.folder,
    // Имя — то, что выдала подпись; у слота формы — как есть, без замены пробелов.
    fileName: input.slot ? plainName(input.fileName) : safeBaseFileName(input.fileName),
    sizeBytes: input.sizeBytes,
    contentType: input.contentType,
    actor: { userId, isUploader: true },
  })
  return {
    ok: true,
    file: {
      id: file.id,
      name: file.name,
      s3Key: file.s3Key ?? input.s3Key,
      contentType: file.contentType,
      sizeBytes: Number(file.sizeBytes),
    },
  }
}

export type FormEditResult = { ok: true } | { ok: false; reason: "not-found" | "closed" | "forbidden" }

type FormEditPlace = { ok: true; work: string; rows: FormRow[]; storageOwnerId: string; projectId: string }

/**
 * Править форму — то же право, что загружать в неё: пока этап открыт,
 * исполнитель этапа или автор пайплайна.
 */
async function formEditPlace(
  access: ChatAccess,
  userId: string,
  /** false — любой этап с рабочей папкой: правка файла в редакторе, не только форма. */
  formOnly = true,
): Promise<FormEditPlace | Exclude<FormEditResult, { ok: true }>> {
  const { step } = access
  const work = step.paths?.work
  const node = step.graph.nodes.find((n) => n.id === step.nodeId)
  if (!work || !step.projectId || !node || (formOnly && node.kind !== "form")) return { ok: false, reason: "not-found" }
  if (step.status !== "ready") return { ok: false, reason: "closed" }
  if (!access.isOwner && !(await hasStepRole(step, userId, "executor"))) return { ok: false, reason: "forbidden" }
  const project = await findProjectById(step.projectId)
  if (!project) return { ok: false, reason: "not-found" }
  return { ok: true, work, rows: node.kind === "form" ? node.data.rows : [], storageOwnerId: project.storageOwnerId, projectId: project.id }
}

/** Файлы рабочей папки по id — чужие отбрасываются. */
async function workFiles(place: FormEditPlace, ids: string[]) {
  const { rows } = await query<{ id: string; name: string; folderPath: string }>(
    `SELECT id, name, folder_path AS "folderPath" FROM project_files
      WHERE id = ANY($1::text[]) AND project_id = $2 AND deleted_at IS NULL AND NOT is_folder
        AND (folder_path = $3 OR folder_path LIKE $4)`,
    [ids, place.projectId, place.work, `${place.work.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`],
  )
  return rows
}

/**
 * Убрать файл из слота формы — то же, что «Загрузить», только наоборот. Файл —
 * строго из рабочей папки этого этапа; уходит в корзину проекта штатным путём.
 */
export async function removeFormFile(access: ChatAccess, userId: string, fileId: string): Promise<FormEditResult> {
  const place = await formEditPlace(access, userId)
  if (!place.ok) return place
  if ((await workFiles(place, [fileId])).length === 0) return { ok: false, reason: "not-found" }
  await writeFileDelete({
    storageOwnerId: place.storageOwnerId,
    projectId: place.projectId,
    fileId,
    deletedBy: userId,
    actor: { userId },
  })
  return { ok: true }
}

function rowLabels(rows: readonly FormRow[]): string[] {
  return rows.flatMap((row) => [row.label, ...rowLabels(row.children)])
}

/**
 * Новый порядок файлов строки формы: номера в именах переписываются пачкой
 * (`01` ↔ `02` поштучно невыполнимо), как перетаскивание в форме проекта.
 */
export async function reorderFormFiles(access: ChatAccess, userId: string, fileIds: string[]): Promise<FormEditResult> {
  const place = await formEditPlace(access, userId)
  if (!place.ok) return place
  const found = await workFiles(place, fileIds)
  const byId = new Map(found.map((f) => [f.id, f]))
  const ordered = fileIds.map((id) => byId.get(id)).filter((f): f is NonNullable<typeof f> => Boolean(f))
  if (ordered.length !== fileIds.length || new Set(ordered.map((f) => f.folderPath)).size > 1) {
    return { ok: false, reason: "not-found" }
  }
  const moves = renumber(ordered.map((f) => f.name), rowLabels(place.rows))
  if (moves.length === 0) return { ok: true }
  const idByName = new Map(ordered.map((f) => [f.name, f.id]))
  await writeRenameBatch({
    storageOwnerId: place.storageOwnerId,
    projectId: place.projectId,
    items: moves.map((move) => ({ fileId: idByName.get(move.from)!, name: move.to })),
    actor: { userId, isUploader: false },
  })
  return { ok: true }
}

// ─── Правка файла в редакторе ─────────────────────────────────────────────

export type ReplaceResult =
  | { ok: true; url: string; contentType: string }
  | { ok: false; reason: "not-found" | "closed" | "forbidden" | "storage" | "too-big" }

/**
 * Сохранить правку файла рабочей папки поверх него: тот же объект в хранилище,
 * та же строка каталога, тот же id и имя — как перезапись в проектах
 * (/api/storage/v1/presign, `overwrite`). Здесь — подпись на PUT в его ключ.
 */
export async function presignFileReplace(
  access: ChatAccess,
  userId: string,
  input: { fileId: string; sizeBytes: number },
): Promise<ReplaceResult> {
  if (!isS3Configured()) return { ok: false, reason: "storage" }
  if (input.sizeBytes > getMaxUploadBytes()) return { ok: false, reason: "too-big" }
  const place = await formEditPlace(access, userId, false)
  if (!place.ok) return place
  const file = await workFileWithKey(place, input.fileId)
  if (!file) return { ok: false, reason: "not-found" }
  const url = await getSignedUrl(
    getS3Client(),
    new PutObjectCommand({ Bucket: getS3Bucket(), Key: file.s3Key, ContentType: file.contentType }),
    { expiresIn: 3600 },
  )
  return { ok: true, url, contentType: file.contentType }
}

/** Байты легли — записать событие: журнал `put`, новый размер, автор правки. */
export async function completeFileReplace(
  access: ChatAccess,
  userId: string,
  fileId: string,
): Promise<FormEditResult> {
  const place = await formEditPlace(access, userId, false)
  if (!place.ok) return place
  const file = await workFileWithKey(place, fileId)
  if (!file) return { ok: false, reason: "not-found" }
  await writeNotifyUpload({
    storageOwnerId: place.storageOwnerId,
    projectId: place.projectId,
    s3Key: file.s3Key,
    folderPath: file.folderPath,
    fileName: file.name,
    contentType: file.contentType,
    actor: { userId, isUploader: true },
  })
  return { ok: true }
}

async function workFileWithKey(place: FormEditPlace, fileId: string) {
  const { rows } = await query<{ id: string; name: string; folderPath: string; s3Key: string; contentType: string }>(
    `SELECT id, name, folder_path AS "folderPath", s3_key AS "s3Key", content_type AS "contentType"
       FROM project_files
      WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL AND NOT is_folder AND s3_key IS NOT NULL
        AND (folder_path = $3 OR folder_path LIKE $4)`,
    [fileId, place.projectId, place.work, `${place.work.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`],
  )
  return rows[0] ?? null
}
