import { query, withTransaction } from "@/lib/db"
import { approveStep } from "./approval"
import { insertSystem } from "./chat"
import { type AutoEntry, type StepPaths } from "./flow"
import { nextWorkStages, upgradeGraph } from "./graph"

/**
 * Автоматика и конвейер — docs/PRODUCTION_PLAN.md §3.0.
 *
 * Этап автоматики кладёт вход в `IN` своей папки-проекта; дальше работает
 * обычный конвейер (lib/pipeline): сканер находит элемент верхнего уровня `IN`,
 * заводит задачу в `tasks`, машина её обрабатывает и сообщает `outFiles` —
 * логические пути результатов (`completeTask`, lib/pipeline/queue.ts).
 *
 * Здесь — связь этапа с его задачами. Опросом, как у списания
 * (lib/billing/settle.ts), а не вызовом из конвейера: очередь машин остаётся
 * нетронутой, а пропущенный тик догоняется следующим.
 *
 * - задача элемента нашлась и завершилась (или упала) — сообщение в чат этапа;
 * - все задачи захода завершены и все `outFiles` уже загружены на сайт (машина
 *   может отчитаться раньше, чем догрузит файл) — результаты записываются в
 *   этап, их и примет «Принято»;
 * - проверяющий этапа — «автоматика» — этап принимается сам.
 */

const TICK_MS = 20 * 1000

let started = false

export function startProductionMachinesLoop() {
  if (started) return
  started = true
  const tick = async () => {
    try {
      await syncAutoSteps()
    } catch (error) {
      console.error("[production] сверка автоматики с конвейером не удалась", error)
    }
  }
  setInterval(() => void tick(), TICK_MS)
}

type TaskRow = { id: string; status: string; outFiles: string[] | null; name: string }

/** Последняя задача элемента: файл — по `source_file_id`, папка — по имени в `IN`. */
async function taskFor(projectId: string, entry: AutoEntry, since: string): Promise<TaskRow | null> {
  const { rows } = await query<TaskRow>(
    `SELECT id, status, payload->'outFiles' AS "outFiles",
            COALESCE(payload->'description'->>'curItem', '') AS name
       FROM tasks
      WHERE project_id = $1
        AND ${"fileId" in entry ? "source_file_id = $2" : "payload->'description'->>'curItem' = $2 AND payload->'description'->>'isFolder' = 'true'"}
        AND created_at >= $3::timestamptz - INTERVAL '1 minute'
      ORDER BY created_at DESC
      LIMIT 1`,
    [projectId, "fileId" in entry ? entry.fileId : entry.folder, since],
  )
  return rows[0] ?? null
}

/** `outFiles` — логические пути; файлы на сайте — строки с тем же путём и именем. */
async function resolveOutFiles(projectId: string, paths: string[]): Promise<string[] | null> {
  const ids: string[] = []
  for (const path of paths) {
    const clean = path.replace(/^\/+|\/+$/g, "")
    const cut = clean.lastIndexOf("/")
    const folder = cut < 0 ? "" : clean.slice(0, cut)
    const name = cut < 0 ? clean : clean.slice(cut + 1)
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM project_files
        WHERE project_id = $1 AND folder_path = $2 AND name = $3 AND deleted_at IS NULL AND NOT is_folder
        LIMIT 1`,
      [projectId, folder, name],
    )
    if (!rows[0]) return null
    ids.push(rows[0].id)
  }
  return ids
}

export async function syncAutoSteps(): Promise<void> {
  const { rows } = await query<{
    id: string
    runId: string
    ownerUserId: string
    nodeId: string
    paths: StepPaths
    graph: unknown
  }>(
    `SELECT rs.id, rs.run_id AS "runId", p.owner_user_id AS "ownerUserId", rs.node_id AS "nodeId", rs.paths, v.graph
       FROM production_run_steps rs
       JOIN production_runs r ON r.id = rs.run_id
       JOIN production_pipelines p ON p.id = r.pipeline_id
       JOIN production_pipeline_versions v ON v.pipeline_id = r.pipeline_id AND v.version = r.pipeline_version
      WHERE rs.status = 'ready' AND r.status = 'active'
        AND rs.paths ? 'auto' AND NOT (rs.paths->'auto' ? 'results')`,
  )
  for (const step of rows) {
    const auto = step.paths.auto!
    const projectId = step.paths.projectId
    if (!projectId || auto.entries.length === 0) continue
    const graph = upgradeGraph(step.graph)
    const node = graph.nodes.find((n) => n.id === step.nodeId)
    if (node?.kind !== "auto") continue

    const tasks = await Promise.all(auto.entries.map((entry) => taskFor(projectId, entry, auto.since)))
    const notified = new Set(auto.notified)
    const fresh = tasks.filter(
      (t): t is TaskRow => Boolean(t && (t.status === "done" || t.status === "failed") && !notified.has(`${t.id}:${t.status}`)),
    )

    let results: string[] | null = null
    if (tasks.every((t) => t?.status === "done")) {
      results = await resolveOutFiles(projectId, tasks.flatMap((t) => t!.outFiles ?? []))
    }

    if (fresh.length > 0 || results) {
      await withTransaction(async (client) => {
        for (const task of fresh) {
          notified.add(`${task.id}:${task.status}`)
          await insertSystem(client, step.id, task.status === "done" ? "machine_done" : "machine_failed", {
            name: task.name,
          })
        }
        // Этап без проверяющего-человека: его чат никто не читает — об ошибке
        // узнают в чатах следующих этапов, со списком к кому обратиться.
        const failed = fresh.filter((task) => task.status === "failed")
        if (failed.length > 0 && node.data.reviewers.length === 0) {
          // Действия чата не читают — сквозь них к ближайшим этапам с людьми.
          const next = nextWorkStages(graph, node.id)
          const people = next.length > 0 ? await adminsFor(step.ownerUserId) : []
          const { rows: nextSteps } = await client.query<{ id: string }>(
            `SELECT id FROM production_run_steps WHERE run_id = $1 AND node_id = ANY($2::text[])`,
            [step.runId, next],
          )
          for (const nextStep of nextSteps) {
            await insertSystem(client, nextStep.id, "machine_failed_upstream", { name: node.data.name, people })
          }
          // Последний этап (дальше только действия или ничего) — сообщить автору пайплайна.
          if (next.length === 0) notifyOwnerOfFailure(step, node.data.name, failed.map((task) => task.name))
        }
        const patch: Record<string, unknown> = { ...auto, notified: [...notified] }
        if (results) patch.results = results
        await client.query(
          `UPDATE production_run_steps SET paths = paths || jsonb_build_object('auto', $2::jsonb) WHERE id = $1`,
          [step.id, JSON.stringify(patch)],
        )
        if (results) await insertSystem(client, step.id, "machine_results", { name: String(results.length) })
      })
    }

    if (results && node.data.autoApprove) {
      const approved = await approveStep({ stepId: step.id, userId: null })
      if (!approved.ok) console.error("[production] автоприёмка автоматики не удалась", step.id, approved.reason)
    }
  }
}

/**
 * К кому идти, когда автоматика упала: администраторы и владелец команды
 * автора пайплайна. Команды нет или в ней никого — сам автор.
 */
async function adminsFor(ownerUserId: string): Promise<{ id: string; name: string }[]> {
  const { rows } = await query<{ id: string; name: string }>(
    `SELECT u.id, COALESCE(NULLIF(TRIM(u.contact_name), ''), NULLIF(TRIM(u.full_name), ''), u.email) AS name
       FROM users u
      WHERE u.is_active
        AND (
          (u.company_id IS NOT NULL
            AND u.company_id = (SELECT company_id FROM users WHERE id = $1)
            AND u.company_role IN ('admin', 'owner'))
          OR (u.id = $1 AND NOT EXISTS (
            SELECT 1 FROM users a
             WHERE a.is_active AND a.company_id IS NOT NULL
               AND a.company_id = (SELECT company_id FROM users WHERE id = $1)
               AND a.company_role IN ('admin', 'owner')))
        )
      ORDER BY u.company_role = 'owner' DESC, name`,
    [ownerUserId],
  )
  return rows
}

/**
 * Заглушка: автоматика без проверяющего упала, а после неё нет этапов, кроме
 * действий (nextWorkStages пуст), — сообщить в чатах некуда. Пока только в лог сервера.
 * TODO(чаты команды): писать автору пайплайна или в админский чат — что
 * сломалось, в каком ролике, ссылка (docs/PRODUCTION_PLAN.md §13.2).
 */
function notifyOwnerOfFailure(
  step: { id: string; runId: string; ownerUserId: string },
  stageName: string,
  items: string[],
): void {
  console.warn("[production] автоматика упала на последнем этапе, сообщить некуда", {
    ownerUserId: step.ownerUserId,
    runId: step.runId,
    stepId: step.id,
    stage: stageName,
    items,
  })
}
