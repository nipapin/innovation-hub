import { query } from "@/lib/db"

/**
 * Производное право читать файл — docs/PRODUCTION_PLAN.md §4.4, §6.1, шаг 1.9.
 *
 * Медиапрокси сначала спрашивает обычный доступ к проекту. Этот ответ —
 * второй, для тех, у кого доступа к папке этапа нет, но файл им нужен:
 *
 *   - исходники: участник чата этапа ролика читает FINAL непосредственно
 *     предыдущих этапов этого же ролика (передача ссылкой, а не копией);
 *   - свой этап: участник чата читает рабочую и финальную папки своего этапа
 *     ролика — так файлы видит и гость, позванный в чат (§6.1).
 *
 * Это не права на папку: ответ «да» только на конкретный файл по его месту.
 * Предшественники берутся из графа той версии, по которой идёт ролик.
 * `starts_with`, а не LIKE: в именах роликов и этапов бывают `_` и `%`.
 */
export async function canReadProductionFile(
  userId: string,
  file: { projectId: string; folderPath: string },
): Promise<boolean> {
  const { rowCount } = await query(
    `SELECT 1
       FROM production_chat_members cm
       JOIN production_run_steps s ON s.id = cm.run_step_id
       JOIN production_runs r ON r.id = s.run_id
       JOIN production_pipeline_versions v
         ON v.pipeline_id = r.pipeline_id AND v.version = r.pipeline_version
       JOIN production_run_steps t ON t.run_id = s.run_id
       JOIN production_pipeline_steps ps
         ON ps.pipeline_id = r.pipeline_id AND ps.node_id = t.node_id
      WHERE cm.user_id = $1 AND cm.left_at IS NULL
        AND ps.project_id = $2
        AND t.paths IS NOT NULL
        AND (
          (
            t.id = s.id
            AND (
              $3 = t.paths->>'work' OR starts_with($3, (t.paths->>'work') || '/')
              OR $3 = t.paths->>'final' OR starts_with($3, (t.paths->>'final') || '/')
            )
          )
          OR (
            EXISTS (
              SELECT 1 FROM jsonb_array_elements(v.graph->'edges') e
               WHERE e->>'source' = t.node_id AND e->>'target' = s.node_id
            )
            AND ($3 = t.paths->>'final' OR starts_with($3, (t.paths->>'final') || '/'))
          )
        )
      LIMIT 1`,
    [userId, file.projectId, file.folderPath],
  )
  return Boolean(rowCount)
}
