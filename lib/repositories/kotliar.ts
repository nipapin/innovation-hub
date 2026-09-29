import { randomUUID } from "node:crypto"
import { query, withTransaction } from "@/lib/db"

export type KotliarPage = {
  id: string
  slug: string
  title: string
  body: string
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export type KotliarFile = {
  id: string
  pageId: string
  originalName: string
  contentType: string
  sizeBytes: number
  s3Key: string
  createdAt: Date
}

const PAGE_FIELDS = `
  id,
  slug,
  title,
  body,
  sort_order AS "sortOrder",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`

const FILE_FIELDS = `
  id,
  page_id AS "pageId",
  original_name AS "originalName",
  content_type AS "contentType",
  size_bytes AS "sizeBytes",
  s3_key AS "s3Key",
  created_at AS "createdAt"
`

export async function listKotliarPages(): Promise<KotliarPage[]> {
  const result = await query<KotliarPage>(
    `SELECT ${PAGE_FIELDS}
       FROM kotliar_pages
      ORDER BY sort_order ASC, created_at ASC`,
  )
  return result.rows
}

export async function findKotliarPageById(
  id: string,
): Promise<KotliarPage | null> {
  const result = await query<KotliarPage>(
    `SELECT ${PAGE_FIELDS} FROM kotliar_pages WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function findKotliarPageBySlug(
  slug: string,
): Promise<KotliarPage | null> {
  const result = await query<KotliarPage>(
    `SELECT ${PAGE_FIELDS} FROM kotliar_pages WHERE slug = $1`,
    [slug],
  )
  return result.rows[0] ?? null
}

export async function createKotliarPage(input: {
  title: string
  slug: string
  body?: string
}): Promise<KotliarPage> {
  const id = randomUUID()
  const result = await query<KotliarPage>(
    `INSERT INTO kotliar_pages (id, slug, title, body, sort_order)
     VALUES (
       $1, $2, $3, $4,
       COALESCE((SELECT MAX(sort_order) + 1 FROM kotliar_pages), 0)
     )
     RETURNING ${PAGE_FIELDS}`,
    [id, input.slug, input.title, input.body ?? ""],
  )
  return result.rows[0]
}

export async function updateKotliarPage(
  id: string,
  patch: {
    title?: string
    slug?: string
    body?: string
    sortOrder?: number
  },
): Promise<KotliarPage | null> {
  const result = await query<KotliarPage>(
    `UPDATE kotliar_pages
        SET title = COALESCE($2, title),
            slug = COALESCE($3, slug),
            body = COALESCE($4, body),
            sort_order = COALESCE($5, sort_order),
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${PAGE_FIELDS}`,
    [
      id,
      patch.title ?? null,
      patch.slug ?? null,
      patch.body ?? null,
      patch.sortOrder ?? null,
    ],
  )
  return result.rows[0] ?? null
}

export async function deleteKotliarPage(
  id: string,
): Promise<KotliarFile[] | null> {
  return withTransaction(async (client) => {
    const files = await client.query<KotliarFile>(
      `SELECT ${FILE_FIELDS} FROM kotliar_files WHERE page_id = $1`,
      [id],
    )
    const deleted = await client.query(
      `DELETE FROM kotliar_pages WHERE id = $1 RETURNING id`,
      [id],
    )
    if (deleted.rowCount === 0) return null
    return files.rows
  })
}

export async function listKotliarFilesByPage(
  pageId: string,
): Promise<KotliarFile[]> {
  const result = await query<KotliarFile>(
    `SELECT ${FILE_FIELDS}
       FROM kotliar_files
      WHERE page_id = $1
      ORDER BY created_at ASC`,
    [pageId],
  )
  return result.rows
}

export async function findKotliarFileById(
  id: string,
): Promise<KotliarFile | null> {
  const result = await query<KotliarFile>(
    `SELECT ${FILE_FIELDS} FROM kotliar_files WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function insertKotliarFile(input: {
  id: string
  pageId: string
  originalName: string
  contentType: string
  sizeBytes: number
  s3Key: string
}): Promise<KotliarFile> {
  const result = await query<KotliarFile>(
    `INSERT INTO kotliar_files (
       id, page_id, original_name, content_type, size_bytes, s3_key
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${FILE_FIELDS}`,
    [
      input.id,
      input.pageId,
      input.originalName,
      input.contentType,
      input.sizeBytes,
      input.s3Key,
    ],
  )
  return result.rows[0]
}

export async function deleteKotliarFile(
  id: string,
): Promise<KotliarFile | null> {
  const result = await query<KotliarFile>(
    `DELETE FROM kotliar_files WHERE id = $1 RETURNING ${FILE_FIELDS}`,
    [id],
  )
  return result.rows[0] ?? null
}
