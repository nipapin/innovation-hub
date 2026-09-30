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
import { writeNotifyUpload } from "@/lib/storage/write-path"
import type { ChatAccess } from "./chat"
import { slotFileName } from "@/lib/tools/element/names"
import { findRow } from "./form"
import { FOLDER_ROW_TYPE } from "./graph"

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

type Target = { folder: string; fileName: string }

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
  if (!row || row.type === FOLDER_ROW_TYPE) return null
  const parts = input.slot.dir.split("/").filter(Boolean)
  if (parts.some((p) => p === "." || p === ".." || p.includes("\\"))) return null
  return {
    folder: [work, ...parts].join("/"),
    // Как сбор элемента (element-io.ts): имя слота без «безопасной» замены
    // пробелов — иначе `01 Титры - a.srt` стал бы `01_Титры_-_a.srt`, и форма
    // файла не узнала бы. Из исходного имени убираются только разделители пути.
    fileName: slotFileName(input.slot.index, row.label, plainName(input.fileName)),
  }
}

/** Имя без пути и управляющих символов — пробелы и буквы как есть. */
function plainName(name: string): string {
  const base = (name.split(/[/\\]/).pop() ?? "").replace(/[\u0000-\u001f]/g, "").trim()
  return base.slice(0, 180) || "file"
}

export type PresignResult =
  | { ok: true; url: string; s3Key: string; contentType: string; fileName: string }
  | { ok: false; reason: "storage" | "no-folder" | "too-big" }

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
