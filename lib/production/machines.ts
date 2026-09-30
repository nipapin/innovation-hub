import { query, withTransaction } from "@/lib/db"
import { approveStep } from "./approval"
import { insertSystem } from "./chat"
import { type AutoEntry, type StepPaths } from "./flow"
import { upgradeGraph } from "./graph"

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
  const { rows } = await query<{ id: string; nodeId: string; paths: StepPaths; graph: unknown }>(
    `SELECT rs.id, rs.node_id AS "nodeId", rs.paths, v.graph
       FROM production_run_steps rs
       JOIN production_runs r ON r.id = rs.run_id
       JOIN production_pipeline_versions v ON v.pipeline_id = r.pipeline_id AND v.version = r.pipeline_version
      WHERE rs.status = 'ready' AND r.status = 'active'
        AND rs.paths ? 'auto' AND NOT (rs.paths->'auto' ? 'results')`,
  )
  for (const step of rows) {
    const auto = step.paths.auto!
    const projectId = step.paths.projectId
    if (!projectId || auto.entries.length === 0) continue
    const node = upgradeGraph(step.graph).nodes.find((n) => n.id === step.nodeId)
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
