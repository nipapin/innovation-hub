import { randomUUID } from "node:crypto"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { z } from "zod"
import { query } from "@/lib/db"
import { getObjectTextWithMeta, projectUploadObjectKey } from "@/lib/project-storage"
import { findProjectById } from "@/lib/repositories/projects"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { StorageWriteError } from "@/lib/storage/errors"
import { writeNotifyUpload } from "@/lib/storage/write-path"
import { deleteReviewRef, postReviewRef, type ChatAccess } from "./chat"
import { REVIEW_FOLDER, isReviewPath } from "./review-folder"
import type { ReviewComment, ReviewDoc, ReviewView } from "./review-types"
import { hasStepRole } from "./step-people"
import { inputFile } from "./uploads"

/**
 * Пометки ревью — docs/PRODUCTION_PLAN.md §8, решение 2026-10-02.
 *
 * Хранятся не в базе, а json-ом рядом с вариантами: один файл на
 * просмотренный файл, `<рабочая папка этапа>/.review/<fileId>.json`. Пометки
 * нужны, пока над роликом работают, и уходят вместе с рабочей папкой по сроку
 * хранения (retention.ts). Запись — штатным путём (объект в хранилище плюс
 * строка каталога и журнал), так что доступ и корзина работают как у всех
 * файлов. В списках производства папка скрыта (review-folder.ts).
 *
 * Каждое действие (добавить, поправить, «исправлено», удалить) — чтение,
 * правка и запись на сервере с проверкой версии объекта: `If-Match` по etag
 * (первая запись — `If-None-Match: *`). Двое проверяющих одновременно не
 * затирают друг друга: проигравший перечитывает и повторяет.
 *
 * Права: читать и добавлять — все, кто видит чат этапа (участники, включая
 * проверяющих и гостей, и автор пайплайна); править и удалять — только своё,
 * автор пайплайна удаляет любые; «исправлено» — исполнитель, проверяющий, автор.
 */

const point = z.tuple([z.number().min(-1).max(2), z.number().min(-1).max(2)])
const style = {
  id: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  size: z.number().int().min(1).max(5),
}
export const reviewShapeSchema = z.discriminatedUnion("kind", [
  z.object({ ...style, kind: z.literal("pen"), points: z.array(point).min(1).max(4000) }),
  z.object({ ...style, kind: z.literal("arrow"), a: point, b: point }),
  z.object({ ...style, kind: z.literal("line"), a: point, b: point }),
  z.object({ ...style, kind: z.literal("rect"), a: point, b: point }),
  z.object({ ...style, kind: z.literal("ellipse"), a: point, b: point }),
  z.object({ ...style, kind: z.literal("text"), at: point, text: z.string().min(1).max(500) }),
])
export const reviewShapesSchema = z.array(reviewShapeSchema).max(200)

const MAX_COMMENTS = 1000
const ATTEMPTS = 5

type ReviewFile = ReviewView["file"]

type Place = {
  file: ReviewFile
  projectId: string
  storageOwnerId: string
  folder: string
  key: string
}

export type ReviewError = { ok: false; reason: "not-found" | "forbidden" | "storage" | "conflict" | "too-many" }

const like = (folder: string) => `${folder.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`

/**
 * Файл, к которому пишут пометки: рабочая или финальная папка этого этапа
 * (вложения чата лежат в рабочей) или вход этапа. Служебные json-ы `.review`
 * сами пометок не получают.
 */
async function reviewPlace(access: ChatAccess, fileId: string): Promise<Place | null> {
  const { step } = access
  const work = step.paths?.work
  if (!work || !step.projectId || !/^[\w-]{1,80}$/.test(fileId)) return null
  const project = await findProjectById(step.projectId)
  if (!project) return null
  const select = `SELECT id, name, s3_key AS "s3Key", content_type AS "contentType", folder_path AS "folderPath"
                    FROM project_files
                   WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL AND NOT is_folder AND s3_key IS NOT NULL`
  type Row = ReviewFile & { folderPath: string }
  const own = [work, step.paths?.final].filter((f): f is string => Boolean(f))
  let row: Row | undefined
  for (const folder of own) {
    row = (
      await query<Row>(`${select} AND (folder_path = $3 OR folder_path LIKE $4)`, [fileId, step.projectId, folder, like(folder)])
    ).rows[0]
    if (row) break
  }
  if (!row) {
    const from = await inputFile(access, fileId)
    if (from) row = (await query<Row>(select, [fileId, from.projectId])).rows[0]
  }
  if (!row || isReviewPath(row.folderPath)) return null
  const folder = `${work}/${REVIEW_FOLDER}`
  return {
    file: { id: row.id, name: row.name, s3Key: row.s3Key, contentType: row.contentType },
    projectId: project.id,
    storageOwnerId: project.storageOwnerId,
    folder,
    // Ключ постоянный — без uuid: его находят без каталога, и проверка версии
    // идёт по одному объекту.
    key: projectUploadObjectKey(project.storageOwnerId, project.id, folder, `${fileId}.json`),
  }
}

function emptyDoc(fileId: string): ReviewDoc {
  return { version: 1, fileId, comments: [] }
}

async function readDoc(place: Place): Promise<{ doc: ReviewDoc; etag: string | null }> {
  const object = await getObjectTextWithMeta(place.key)
  if (!object) return { doc: emptyDoc(place.file.id), etag: null }
  try {
    const parsed = JSON.parse(object.body) as Partial<ReviewDoc>
    const comments = Array.isArray(parsed.comments) ? parsed.comments : []
    return { doc: { version: 1, fileId: place.file.id, comments }, etag: object.etag }
  } catch {
    // Испорченный файл не роняет ревью: пишем поверх, версия та же.
    return { doc: emptyDoc(place.file.id), etag: object.etag }
  }
}

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("$metadata" in error)) return null
  const code = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
  return typeof code === "number" ? code : null
}

/**
 * Чтение — правка — запись с проверкой версии. `change` получает свежий
 * документ и возвращает новый плюс результат, или ошибку (тогда ничего не
 * пишется). Версию успели поменять — перечитать и повторить.
 */
async function mutate<T>(
  place: Place,
  userId: string,
  change: (doc: ReviewDoc) => { doc: ReviewDoc; result: T } | ReviewError,
): Promise<{ ok: true; result: T } | ReviewError> {
  if (!isS3Configured()) return { ok: false, reason: "storage" }
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const { doc, etag } = await readDoc(place)
    const next = change(doc)
    if ("ok" in next) return next
    const body = JSON.stringify(next.doc, null, 1)
    try {
      await getS3Client().send(
        new PutObjectCommand({
          Bucket: getS3Bucket(),
          Key: place.key,
          Body: body,
          ContentType: "application/json",
          ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
        }),
      )
    } catch (error) {
      const status = statusOf(error)
      // 412 — версия устарела; 409 — одновременная условная запись.
      if (status === 412 || status === 409) {
        await new Promise((r) => setTimeout(r, 40 + Math.random() * 120))
        continue
      }
      throw error
    }
    // Строка каталога и журнал: первая запись заводит файл, дальше — `put`.
    // Не «заливщик»: служебный json не задача конвейера.
    // Ключ общий и постоянный, не сирота: при 409 (строку завёл соседний
    // писатель) объект не удаляем, а повторяем — теперь строка найдётся по ключу.
    const notify = () =>
      writeNotifyUpload({
        storageOwnerId: place.storageOwnerId,
        projectId: place.projectId,
        s3Key: place.key,
        folderPath: place.folder,
        fileName: `${place.file.id}.json`,
        contentType: "application/json",
        actor: { userId, isUploader: false },
        keepObjectOnConflict: true,
      })
    try {
      await notify()
    } catch (error) {
      if (!(error instanceof StorageWriteError && error.status === 409)) throw error
      await notify()
    }
    return { ok: true, result: next.result }
  }
  return { ok: false, reason: "conflict" }
}

async function canResolve(access: ChatAccess, userId: string): Promise<boolean> {
  if (access.isOwner) return true
  if (await hasStepRole(access.step, userId, "executor")) return true
  return hasStepRole(access.step, userId, "reviewer")
}

async function nameOf(userId: string): Promise<string> {
  const { rows } = await query<{ name: string }>(
    `SELECT COALESCE(NULLIF(TRIM(contact_name), ''), NULLIF(TRIM(full_name), ''), email) AS name FROM users WHERE id = $1`,
    [userId],
  )
  return rows[0]?.name ?? "?"
}

export async function getReview(access: ChatAccess, userId: string, fileId: string): Promise<ReviewView | null> {
  const place = await reviewPlace(access, fileId)
  if (!place) return null
  const { doc } = await readDoc(place)
  return {
    file: place.file,
    comments: doc.comments,
    me: { userId, canResolve: await canResolve(access, userId), isOwner: access.isOwner },
  }
}

export async function addReviewComment(
  access: ChatAccess,
  userId: string,
  fileId: string,
  input: { body: string; shapes: ReviewComment["shapes"] },
): Promise<{ ok: true; comment: ReviewComment } | ReviewError> {
  const place = await reviewPlace(access, fileId)
  if (!place) return { ok: false, reason: "not-found" }
  const comment: ReviewComment = {
    id: randomUUID(),
    authorId: userId,
    authorName: await nameOf(userId),
    createdAt: new Date().toISOString(),
    body: input.body,
    anchor: { kind: "image" },
    shapes: input.shapes,
  }
  const result = await mutate(place, userId, (doc) =>
    doc.comments.length >= MAX_COMMENTS
      ? { ok: false, reason: "too-many" }
      : { doc: { ...doc, comments: [...doc.comments, comment] }, result: comment },
  )
  if (!result.ok) return result
  // Карточка в чат: текст пометки и ссылка на неё. Не ушла — пометка всё равно есть.
  try {
    await postReviewRef({
      access,
      userId,
      body: comment.body,
      review: { fileId, name: place.file.name, s3Key: place.file.s3Key, contentType: place.file.contentType, commentId: comment.id },
    })
  } catch (error) {
    console.error("[production] карточка пометки в чат не ушла", error)
  }
  return { ok: true, comment }
}

export async function updateReviewComment(
  access: ChatAccess,
  userId: string,
  fileId: string,
  input: { commentId: string; body?: string; shapes?: ReviewComment["shapes"]; resolved?: boolean },
): Promise<{ ok: true; comment: ReviewComment } | ReviewError> {
  const place = await reviewPlace(access, fileId)
  if (!place) return { ok: false, reason: "not-found" }
  const editsContent = input.body !== undefined || input.shapes !== undefined
  const resolver = input.resolved !== undefined ? await canResolve(access, userId) : false
  const resolverName = input.resolved ? await nameOf(userId) : undefined
  const result = await mutate<ReviewComment>(place, userId, (doc) => {
    const current = doc.comments.find((c) => c.id === input.commentId)
    if (!current) return { ok: false, reason: "not-found" }
    if (editsContent && current.authorId !== userId) return { ok: false, reason: "forbidden" }
    if (input.resolved !== undefined && !resolver) return { ok: false, reason: "forbidden" }
    const now = new Date().toISOString()
    let next: ReviewComment = { ...current }
    if (editsContent) {
      next = { ...next, body: input.body ?? next.body, shapes: input.shapes ?? next.shapes, editedAt: now }
    }
    if (input.resolved === true && !next.resolvedAt) {
      next = { ...next, resolvedBy: userId, resolvedByName: resolverName, resolvedAt: now }
    } else if (input.resolved === false) {
      const { resolvedBy: _by, resolvedByName: _name, resolvedAt: _at, ...rest } = next
      next = rest
    }
    return { doc: { ...doc, comments: doc.comments.map((c) => (c.id === next.id ? next : c)) }, result: next }
  })
  return result.ok ? { ok: true, comment: result.result } : result
}

export async function deleteReviewComment(
  access: ChatAccess,
  userId: string,
  fileId: string,
  commentId: string,
): Promise<{ ok: true } | ReviewError> {
  const place = await reviewPlace(access, fileId)
  if (!place) return { ok: false, reason: "not-found" }
  const result = await mutate(place, userId, (doc) => {
    const current = doc.comments.find((c) => c.id === commentId)
    if (!current) return { ok: false, reason: "not-found" }
    if (current.authorId !== userId && !access.isOwner) return { ok: false, reason: "forbidden" }
    return { doc: { ...doc, comments: doc.comments.filter((c) => c.id !== commentId) }, result: true }
  })
  if (!result.ok) return result
  await deleteReviewRef(access.step.id, commentId)
  return { ok: true }
}
