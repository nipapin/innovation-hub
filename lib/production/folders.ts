import { query } from "@/lib/db"
import { REVIEW_FOLDER } from "./review-folder"

/**
 * Подпапки уровня `path` в проекте владельца — для подсказок пути в ноде
 * «Действие». Папки бывают явными (`is_folder`) и подразумеваемыми — путь
 * файла; берём и те, и другие.
 */
export async function listSubfolders(ownerId: string, projectId: string, path: string[]): Promise<string[] | null> {
  const owned = await query(`SELECT 1 FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, [projectId, ownerId])
  if (owned.rowCount === 0) return null
  const parent = path.join("/")
  const like = `${parent.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`
  const depth = path.length + 1
  const { rows } = await query<{ name: string }>(
    `SELECT DISTINCT name FROM (
       SELECT name FROM project_files
        WHERE project_id = $1 AND deleted_at IS NULL AND is_folder AND COALESCE(folder_path, '') = $2
       UNION
       SELECT split_part(folder_path, '/', $4) AS name FROM project_files
        WHERE project_id = $1 AND deleted_at IS NULL
          AND ($2 = '' AND COALESCE(folder_path, '') <> '' OR folder_path LIKE $3)
     ) t
     WHERE name <> ''
     ORDER BY name
     LIMIT 200`,
    [projectId, parent, like, depth],
  )
  // Служебная папка пометок ревью — не место, куда копировать.
  return rows.map((r) => r.name).filter((name) => name !== REVIEW_FOLDER)
}
