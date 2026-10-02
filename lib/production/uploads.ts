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
import { StorageWriteError } from "@/lib/storage/errors"
import { copySingleFile, loadCopySource } from "@/lib/storage/copy"
import { readFileTypeDictionary } from "@/lib/repositories/automation-settings"
import { writeEnsureFolderPath, writeFileDelete, writeNotifyUpload, writeRenameBatch } from "@/lib/storage/write-path"
import type { ChatAccess } from "./chat"
import { isReviewPath } from "./review-folder"
import { hasStepRole } from "./step-people"
import { renumber, slotFileName } from "@/lib/tools/element/names"
import { extensionFits } from "@/lib/tools/element/site-form"
import { findRow, formPlaces, formStatus, freeFileName, graphFormLabels, stripSlotPrefix, type FormPlace } from "./form"
import { listTree } from "./flow"
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
    // Приставка прежнего места снимается: `02 Б - 01 А - a.txt` не копится.
    fileName: slotFileName(input.slot.index, row.label, stripSlotPrefix(plainName(input.fileName), graphFormLabels(step.graph.nodes))),
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
  | { ok: false; reason: "storage" | "no-folder" | "too-big" | "bad-type" | "forbidden" }

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
  userId: string,
  input: { fileName: string; contentType?: string; sizeBytes: number; slot?: SlotTarget; editCopy?: boolean },
): Promise<PresignResult> {
  if (!isS3Configured()) return { ok: false, reason: "storage" }
  const { step } = access
  if (!step.projectId) return { ok: false, reason: "no-folder" }
  if (input.sizeBytes > getMaxUploadBytes()) return { ok: false, reason: "too-big" }
  // Правка вложения новым файлом — право как на правку рабочей, не как на чат.
  if (input.editCopy && (input.slot || !(await formEditPlace(access, userId, false)).ok)) {
    return { ok: false, reason: "forbidden" }
  }
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
  | { ok: false; reason: "bad-key" | "no-folder" | "forbidden" }

export async function completeChatUpload(
  access: ChatAccess,
  userId: string,
  input: { s3Key: string; fileName: string; sizeBytes: number; contentType: string; slot?: SlotTarget; editCopy?: boolean },
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
  // Файл из чата у формы сам встаёт в первое свободное подходящее место (§3.0):
  // место считается здесь, при записи в каталог, — одним событием, без
  // промежуточного «лёг в корень, потом переехал».
  if (input.editCopy && (input.slot || !(await formEditPlace(access, userId, false)).ok)) {
    return { ok: false, reason: "forbidden" }
  }
  // Правка вложения — новым файлом в корне под исходным свободным именем;
  // в форму сама не встаёт: поставить её — решение исполнителя.
  const auto = input.slot || input.editCopy ? null : await autoPlace(access, userId, input.fileName)
  const write = (folderPath: string, fileName: string, keepObjectOnConflict = false) =>
    writeNotifyUpload({
      storageOwnerId: project.storageOwnerId,
      projectId: project.id,
      s3Key: input.s3Key,
      folderPath,
      fileName,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
      actor: { userId, isUploader: true },
      keepObjectOnConflict,
    })
  const rootNames = async () =>
    (await listTree(project.id, place.folder)).filter((f) => f.folderPath === place.folder).map((f) => f.name)
  let file: Awaited<ReturnType<typeof writeNotifyUpload>>
  if (input.editCopy) {
    const original = stripSlotPrefix(plainName(input.fileName), graphFormLabels(step.graph.nodes))
    try {
      file = await write(place.folder, freeFileName(await rootNames(), original), true)
    } catch (error) {
      // Имя успели занять между списком и записью — ещё раз по свежему списку.
      if (!(error instanceof StorageWriteError && error.status === 409)) throw error
      file = await write(place.folder, freeFileName(await rootNames(), original))
    }
  } else if (auto) {
    try {
      file = await write(auto.folder, auto.fileName, true)
    } catch (error) {
      // Две заливки с одним именем одновременно получили одно свободное место:
      // вторая не теряется, а ложится в корень под свободным исходным именем.
      if (!(error instanceof StorageWriteError && error.status === 409)) throw error
      file = await write(place.folder, freeFileName(await rootNames(), safeBaseFileName(input.fileName)))
    }
  } else {
    // Имя слота формы — как есть, без замены пробелов.
    file = await write(place.folder, input.slot ? place.fileName : safeBaseFileName(input.fileName))
  }
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

/**
 * Первое свободное место формы, которому файл подходит по типу: порядок формы,
 * вглубь, с пустым местом внизу строки «≥». Только для того, кто правит форму
 * (исполнитель этапа или автор, этап открыт): комментарий проверяющего с
 * картинкой форму не заполняет. Не подошло никуда — null, файл ляжет в корень.
 */
async function autoPlace(access: ChatAccess, userId: string, fileName: string): Promise<{ folder: string; fileName: string } | null> {
  const node = access.step.graph.nodes.find((n) => n.id === access.step.nodeId)
  if (node?.kind !== "form") return null
  const place = await formEditPlace(access, userId)
  if (!place.ok) return null
  const tree = await listTree(place.projectId, place.work)
  const fileTypes = await fileTypeDictionary()
  const free = currentPlaces(place, tree).find(
    (p) => p.fileName === null && extensionFits({ fileTypes }, p.types, fileName),
  )
  if (!free) return null
  const original = stripSlotPrefix(plainName(fileName), graphFormLabels(access.step.graph.nodes))
  return { folder: [place.work, free.dir].filter(Boolean).join("/"), fileName: slotFileName(free.index, free.label, original) }
}

function currentPlaces(place: FormEditPlace, tree: readonly { name: string; folderPath: string }[]): FormPlace[] {
  return formPlaces(formStatus(place.rows, place.work, tree).state.groups)
}

export type FormEditResult = { ok: true } | { ok: false; reason: "not-found" | "closed" | "forbidden" }

type FormEditPlace = { ok: true; work: string; rows: FormRow[]; labels: string[]; storageOwnerId: string; projectId: string }

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
  return {
    ok: true,
    work,
    rows: node.kind === "form" ? node.data.rows : [],
    labels: graphFormLabels(step.graph.nodes),
    storageOwnerId: project.storageOwnerId, projectId: project.id }
}

/** Файлы рабочей папки по id — чужие отбрасываются. */
async function workFiles(place: FormEditPlace, ids: string[]) {
  const { rows } = await query<{ id: string; name: string; folderPath: string }>(
    `SELECT id, name, folder_path AS "folderPath" FROM project_files
      WHERE id = ANY($1::text[]) AND project_id = $2 AND deleted_at IS NULL AND NOT is_folder
        AND (folder_path = $3 OR folder_path LIKE $4)`,
    [ids, place.projectId, place.work, `${place.work.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`],
  )
  // Служебные json пометок (.review) — не файлы этапа: не двигаем и не правим.
  return rows.filter((r) => !isReviewPath(r.folderPath))
}

/**
 * Убрать файл из слота формы — то же, что «Загрузить», только наоборот. Файл —
 * строго из рабочей папки этого этапа; уходит в корзину проекта штатным путём.
 */
export async function removeFormFile(access: ChatAccess, userId: string, fileId: string): Promise<FormEditResult> {
  const place = await formEditPlace(access, userId)
  if (!place.ok) return place
  const [file] = await workFiles(place, [fileId])
  if (!file) return { ok: false, reason: "not-found" }
  const before = currentPlaces(place, await listTree(place.projectId, place.work))
  const was = before.find((p) => p.fileName === file.name && joinWork(place.work, p.dir) === file.folderPath)
  await writeFileDelete({
    storageOwnerId: place.storageOwnerId,
    projectId: place.projectId,
    fileId,
    deletedBy: userId,
    actor: { userId },
  })
  if (was) await closeGap(place, userId, was)
  return { ok: true }
}

function joinWork(work: string, dir: string): string {
  return dir ? `${work}/${dir}` : work
}

/**
 * Место строки «≥» освободилось — сверх минимума место исчезает, остальные
 * сдвигаются (номер — позиция, дыр нет). На минимуме пустое место остаётся.
 */
async function closeGap(place: FormEditPlace, userId: string, was: Pick<FormPlace, "rowId" | "dir">) {
  const row = findRow(place.rows, was.rowId)
  if (!row || row.op !== ">=") return
  const folder = joinWork(place.work, was.dir)
  const places = currentPlaces(place, await listTree(place.projectId, place.work)).filter(
    (p) => p.rowId === was.rowId && p.dir === was.dir && !p.trailing,
  )
  if (places.length <= row.count) return
  const filled = places.filter((p) => p.fileName !== null).map((p) => p.fileName!)
  const moves = renumber(filled, place.labels)
  if (moves.length === 0) return
  const { rows: files } = await query<{ id: string; name: string }>(
    `SELECT id, name FROM project_files
      WHERE project_id = $1 AND folder_path = $2 AND deleted_at IS NULL AND NOT is_folder AND name = ANY($3::text[])`,
    [place.projectId, folder, moves.map((m) => m.from)],
  )
  const idByName = new Map(files.map((f) => [f.name, f.id]))
  const items = moves.filter((m) => idByName.has(m.from)).map((m) => ({ fileId: idByName.get(m.from)!, name: m.to }))
  if (items.length === 0) return
  await writeRenameBatch({
    storageOwnerId: place.storageOwnerId,
    projectId: place.projectId,
    items,
    actor: { userId, isUploader: false },
  })
}

export type PlaceResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "closed" | "forbidden" | "no-slot" | "bad-type" }

/**
 * «Поставить в →» и перетаскивание файла в место формы (§3.0): файл рабочей
 * папки встаёт в место под именем места, прежняя приставка снимается. Место
 * занято — прежний файл уходит в корень рабочей папки с исходным именем.
 * `slot: null` — «Убрать из формы»: в корень с исходным именем.
 * Право то же, что у правки формы: исполнитель этапа или автор, этап открыт.
 */
export async function placeFormFile(
  access: ChatAccess,
  userId: string,
  input: { fileId: string; slot: SlotTarget | null },
): Promise<PlaceResult> {
  const place = await formEditPlace(access, userId)
  if (!place.ok) return place
  const [file] = await workFiles(place, [input.fileId])
  if (!file) return { ok: false, reason: "not-found" }
  const tree = await listTree(place.projectId, place.work)
  const places = currentPlaces(place, tree)
  const from = places.find((p) => p.fileName === file.name && joinWork(place.work, p.dir) === file.folderPath) ?? null
  const original = stripSlotPrefix(file.name, place.labels, from?.label)
  const rootNames = tree.filter((f) => f.folderPath === place.work && f.id !== file.id).map((f) => f.name)

  const items: { fileId: string; name: string; folderPath: string }[] = []
  if (!input.slot) {
    // Без места, но с приставкой или в папке слота (двойник номера, «лишний»)
    // — тоже в корень: иначе «Убрать из формы» молча ничего не делает.
    if (!from && file.folderPath === place.work && original === file.name) return { ok: true }
    items.push({ fileId: file.id, name: freeFileName(rootNames, original), folderPath: place.work })
  } else {
    const slot = input.slot
    const to = places.find((p) => p.rowId === slot.rowId && p.index === slot.index && p.dir === slot.dir)
    if (!to) return { ok: false, reason: "no-slot" }
    if (to.fileName === file.name && joinWork(place.work, to.dir) === file.folderPath) return { ok: true }
    if (!extensionFits({ fileTypes: await fileTypeDictionary() }, to.types, original)) return { ok: false, reason: "bad-type" }
    const folder = joinWork(place.work, to.dir)
    if (to.fileName) {
      const occupant = tree.find((f) => f.folderPath === folder && f.name === to.fileName)
      if (occupant) {
        items.push({
          fileId: occupant.id,
          name: freeFileName(rootNames, stripSlotPrefix(occupant.name, place.labels, to.label)),
          folderPath: place.work,
        })
      }
    }
    if (folder !== place.work) {
      await writeEnsureFolderPath({
        storageOwnerId: place.storageOwnerId,
        projectId: place.projectId,
        folderPath: folder,
        actor: { userId, isUploader: false },
      })
    }
    items.push({ fileId: file.id, name: slotFileName(to.index, to.label, original), folderPath: folder })
  }
  await writeRenameBatch({
    storageOwnerId: place.storageOwnerId,
    projectId: place.projectId,
    items,
    actor: { userId, isUploader: false },
  })
  // Файл ушёл с места строки «≥» — место сверх минимума закрывается.
  if (from && !(input.slot && from.rowId === input.slot.rowId && from.dir === input.slot.dir && from.index === input.slot.index)) {
    await closeGap(place, userId, from)
  }
  return { ok: true }
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
  const moves = renumber(ordered.map((f) => f.name), place.labels)
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
    // ContentLength входит в подпись: залить больше заявленного по этой ссылке нельзя.
    new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: file.s3Key,
      ContentType: file.contentType,
      ContentLength: input.sizeBytes,
    }),
    { expiresIn: 600 },
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
  const row = rows[0]
  return row && !isReviewPath(row.folderPath) ? row : null
}

// ─── «Редактировать копию» входного файла ─────────────────────────────────

export type CopyInputResult =
  | { ok: true; file: { id: string; name: string; s3Key: string; contentType: string; sizeBytes: number } }
  | { ok: false; reason: "not-found" | "closed" | "forbidden" }

/**
 * Файл — вход этого этапа: лежит в FINAL непосредственного предшественника
 * того же ролика (или в подпапке выхода «Разделить»), либо в своей папке
 * скопированного входа этапа (`paths.inputs`). Проверка по папке — с
 * подпапками, как и показ входа (listFolderFiles).
 */
export async function inputFile(access: ChatAccess, fileId: string): Promise<{ projectId: string } | null> {
  const { step } = access
  const prevIds = step.graph.edges.filter((e) => e.target === step.nodeId).map((e) => e.source)
  const places: { projectId: string; folder: string }[] = []
  if (prevIds.length > 0) {
    const { rows } = await query<{ projectId: string | null; final: string | null }>(
      `SELECT COALESCE(rs.paths->>'projectId', ps.project_id) AS "projectId", rs.paths->>'final' AS final
         FROM production_run_steps rs
         JOIN production_runs r ON r.id = rs.run_id
         LEFT JOIN production_pipeline_steps ps ON ps.pipeline_id = r.pipeline_id AND ps.node_id = rs.node_id
        WHERE rs.run_id = $1 AND rs.node_id = ANY($2::text[])`,
      [step.runId, prevIds],
    )
    for (const r of rows) if (r.projectId && r.final) places.push({ projectId: r.projectId, folder: r.final })
  }
  if (step.projectId) {
    for (const dir of new Set(Object.values(step.paths?.inputs ?? {}))) places.push({ projectId: step.projectId, folder: dir })
  }
  for (const place of places) {
    const { rowCount } = await query(
      `SELECT 1 FROM project_files
        WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL AND NOT is_folder
          AND (folder_path = $3 OR folder_path LIKE $4)`,
      [fileId, place.projectId, place.folder, `${place.folder.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`],
    )
    if (rowCount) return { projectId: place.projectId }
  }
  return null
}

/**
 * Копия входного файла в корень рабочей папки («Из чата») под исходным именем
 * — без приставки слота, свободным. У формы копия сама встаёт на место, как
 * файл из чата. Право — как на правку рабочей: этап открыт, исполнитель или
 * автор пайплайна. Оригинал не трогается.
 */
export async function copyInputToWork(access: ChatAccess, userId: string, fileId: string): Promise<CopyInputResult> {
  const place = await formEditPlace(access, userId, false)
  if (!place.ok) return place
  const from = await inputFile(access, fileId)
  if (!from) return { ok: false, reason: "not-found" }
  const source = await loadCopySource(from.projectId, fileId)
  if (!source || source.isFolder) return { ok: false, reason: "not-found" }
  const original = stripSlotPrefix(plainName(source.name), graphFormLabels(access.step.graph.nodes))
  const copy = (folder: string, name: string) =>
    copySingleFile({
      sourceProjectId: from.projectId,
      destProjectId: place.projectId,
      destStorageOwnerId: place.storageOwnerId,
      destFolderPath: folder,
      source: { ...source, name },
      actor: { userId, isUploader: true },
    })
  const toRoot = async () => {
    const rootNames = (await listTree(place.projectId, place.work))
      .filter((f) => f.folderPath === place.work)
      .map((f) => f.name)
    return copy(place.work, freeFileName(rootNames, original))
  }
  const auto = await autoPlace(access, userId, original)
  let file: Awaited<ReturnType<typeof copySingleFile>>
  if (auto) {
    try {
      file = await copy(auto.folder, auto.fileName)
    } catch (error) {
      // Место успели занять — копия ложится в корень, как файл из чата.
      if (!(error instanceof StorageWriteError && error.status === 409)) throw error
      file = await toRoot()
    }
  } else {
    file = await toRoot()
  }
  return {
    ok: true,
    file: {
      id: file.id,
      name: file.name,
      s3Key: file.s3Key ?? "",
      contentType: file.contentType,
      sizeBytes: Number(file.sizeBytes),
    },
  }
}
