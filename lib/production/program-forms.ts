import { query } from "@/lib/db"
import { getObjectTextWithMeta, projectSiteFormKey } from "@/lib/project-storage"
import { findFileByName } from "@/lib/repositories/project-files"
import { OPTIONS_FOLDER_NAME, SITE_FORM_FILE_NAME } from "@/lib/storage/keys"
import { parseSiteFormBody, type SiteFormError } from "@/lib/tools/element/site-form"
import { shortId, type FormRow } from "./graph"
import type { ElementRow } from "@/lib/tools/element/site-form"

/**
 * Формы из программы — для ноды «Форма» (docs/PRODUCTION_PLAN.md §3.0).
 *
 * Программа при сохранении графа с нодой `checkFolder` кладёт в проект
 * `options/onSiteFolderCheckForm.json` (lib/tools/element/site-form.ts). Здесь
 * такую форму можно взять в ноду целиком — чтобы строки, типы и количество
 * совпадали с тем, что проверит программа, а не набирались второй раз руками.
 * Берётся копия: дальше форма ноды живёт своей жизнью, и правка в программе её
 * не меняет.
 *
 * Только свои проекты — как и папки этапов.
 */

export type ProgramFormRef = { projectId: string; projectName: string }

export async function listProgramForms(userId: string): Promise<ProgramFormRef[]> {
  const result = await query<ProgramFormRef>(
    `SELECT p.id AS "projectId", p.name AS "projectName"
       FROM projects p
      WHERE p.user_id = $1
        AND p.deleted_at IS NULL
        AND COALESCE(p.is_archived, FALSE) = FALSE
        AND EXISTS (
          SELECT 1 FROM project_files f
           WHERE f.project_id = p.id
             AND lower(f.folder_path) = lower($2)
             AND lower(f.name) = lower($3)
             AND f.is_folder = FALSE
             AND f.deleted_at IS NULL
        )
      ORDER BY p.name`,
    [userId, OPTIONS_FOLDER_NAME, SITE_FORM_FILE_NAME],
  )
  return result.rows
}

export type ProgramFormResult =
  | { ok: true; rows: FormRow[] }
  | { ok: false; reason: "not-found" } | { ok: false; reason: "invalid"; error: SiteFormError }

/** Строки программы → строки ноды. Id новые: форму можно вставить не один раз. */
function toFormRows(rows: readonly ElementRow[]): FormRow[] {
  return rows.map((row) => ({
    id: shortId("row"),
    label: row.label,
    types: [...row.types],
    op: row.op,
    count: row.count,
    children: toFormRows(row.children),
  }))
}

export async function readProgramForm(userId: string, projectId: string): Promise<ProgramFormResult> {
  const owned = await query<{ storageOwnerId: string }>(
    `SELECT COALESCE(storage_owner_id, user_id) AS "storageOwnerId"
       FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [projectId, userId],
  )
  const project = owned.rows[0]
  if (!project) return { ok: false, reason: "not-found" }

  // Канонический ключ, а если форма доехала обычной синхронизацией папки —
  // ключ из каталога (как читает сайдкары storage API).
  let object = await getObjectTextWithMeta(projectSiteFormKey(project.storageOwnerId, projectId))
  if (!object) {
    const row = await findFileByName({ projectId, folderPath: OPTIONS_FOLDER_NAME, name: SITE_FORM_FILE_NAME })
    if (row?.s3Key) object = await getObjectTextWithMeta(row.s3Key)
  }
  if (!object) return { ok: false, reason: "not-found" }

  const parsed = parseSiteFormBody(object.body)
  if (!parsed.ok) return { ok: false, reason: "invalid", error: parsed.error }
  return { ok: true, rows: toFormRows(parsed.form.rows) }
}

/**
 * Имена строк, которые ждёт обработка в автоматике: форма программы в проекте
 * каждой ноды «Автоматика» — подсказки названий строк в редакторе, чтобы
 * формы пайплайна называли файлы так, как их ищет машина. Проекты — владельца
 * пайплайна: редактор правит его пайплайн. Нет формы — у ноды просто нет имён.
 */
export async function automationLabels(
  ownerUserId: string,
  nodes: readonly { id: string; kind: string; data: unknown }[],
): Promise<{ nodeId: string; label: string }[]> {
  const autos = nodes.flatMap((n) => {
    const projectId = n.kind === "auto" ? (n.data as { project?: { id?: string | null } }).project?.id : null
    return projectId ? [{ nodeId: n.id, projectId }] : []
  })
  const flat = (rows: readonly FormRow[]): string[] => rows.flatMap((r) => [r.label, ...flat(r.children)])
  const found = await Promise.all(
    autos.map(async ({ nodeId, projectId }) => {
      const form = await readProgramForm(ownerUserId, projectId).catch(() => null)
      return form?.ok ? flat(form.rows).filter(Boolean).map((label) => ({ nodeId, label })) : []
    }),
  )
  return found.flat()
}
