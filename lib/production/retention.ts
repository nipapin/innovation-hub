import { query } from "@/lib/db"
import { findProjectById } from "@/lib/repositories/projects"
import { writeFileDelete } from "@/lib/storage/write-path"
import { listTree, type StepPaths } from "./flow"
import { isWorkNode, lastStages, startOf, upgradeGraph } from "./graph"

/**
 * Срок хранения — docs/PRODUCTION_PLAN.md §4.5, решение 2026-09-30.
 *
 * Точка отсчёта одна — сдача ролика: пока ролик не сдан, не удаляется ничего.
 * Через N дней после сдачи удаляются варианты (рабочие папки всех этапов), через
 * M дней — финалы промежуточных этапов. Финал этапов, ведущих в «Финал», не
 * удаляется никогда. 0 — не удалять.
 *
 * Сроки — настройка на месте: берутся из ноды «Старт» текущего черновика, а не
 * из версии, по которой шёл ролик. Удаление — штатное, в корзину: оттуда файл
 * ещё можно достать, пока не истёк срок корзины.
 */

const TICK_MS = 60 * 60 * 1000
const FIRST_TICK_MS = 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

let started = false

export function startProductionRetentionLoop() {
  if (started) return
  started = true
  const tick = async () => {
    try {
      const { runs, files } = await purgeExpired()
      if (files > 0) console.log(`[production] срок хранения: ${files} файлов в ${runs} роликах`)
    } catch (error) {
      // Миграция может быть ещё не применена — следующий тик попробует снова.
      console.error("[production] чистка по сроку хранения не удалась", error)
    }
  }
  setTimeout(() => {
    void tick()
    setInterval(() => void tick(), TICK_MS)
  }, FIRST_TICK_MS)
}

export async function purgeExpired(now = new Date()): Promise<{ runs: number; files: number }> {
  const { rows } = await query<{
    id: string
    finishedAt: Date
    variantsPurgedAt: Date | null
    finalsPurgedAt: Date | null
    draft: unknown
    version: unknown
  }>(
    `SELECT r.id, r.finished_at AS "finishedAt", r.variants_purged_at AS "variantsPurgedAt",
            r.finals_purged_at AS "finalsPurgedAt", p.graph AS draft, v.graph AS version
       FROM production_runs r
       JOIN production_pipelines p ON p.id = r.pipeline_id
       JOIN production_pipeline_versions v ON v.pipeline_id = r.pipeline_id AND v.version = r.pipeline_version
      WHERE r.status = 'done' AND r.finished_at IS NOT NULL
        AND (r.variants_purged_at IS NULL OR r.finals_purged_at IS NULL)
      ORDER BY r.finished_at
      LIMIT 200`,
  )

  let runs = 0
  let files = 0
  for (const run of rows) {
    const retention = startOf(upgradeGraph(run.draft))?.data.retention
    if (!retention) continue
    const graph = upgradeGraph(run.version)
    const age = now.getTime() - new Date(run.finishedAt).getTime()
    const purgeVariants = !run.variantsPurgedAt && retention.variantsDays > 0 && age >= retention.variantsDays * DAY_MS
    const purgeFinals = !run.finalsPurgedAt && retention.finalsDays > 0 && age >= retention.finalsDays * DAY_MS
    if (!purgeVariants && !purgeFinals) continue

    const steps = await query<{ nodeId: string; paths: StepPaths | null }>(
      `SELECT node_id AS "nodeId", paths FROM production_run_steps WHERE run_id = $1`,
      [run.id],
    )
    const keep = lastStages(graph)
    const kinds = new Map(graph.nodes.map((n) => [n.id, n]))
    let deleted = 0
    for (const step of steps.rows) {
      const node = kinds.get(step.nodeId)
      const projectId = step.paths?.projectId
      if (!isWorkNode(node) || !projectId) continue
      const folders: string[] = []
      if (purgeVariants && step.paths?.work) folders.push(step.paths.work)
      if (purgeFinals && step.paths?.final && !keep.has(step.nodeId)) folders.push(step.paths.final)
      if (folders.length === 0) continue
      const project = await findProjectById(projectId)
      if (!project) continue
      for (const folder of folders) {
        for (const file of await listTree(projectId, folder)) {
          await writeFileDelete({ storageOwnerId: project.storageOwnerId, projectId, fileId: file.id, deletedBy: null })
          deleted += 1
        }
      }
    }
    await query(
      `UPDATE production_runs
          SET variants_purged_at = CASE WHEN $2 THEN NOW() ELSE variants_purged_at END,
              finals_purged_at = CASE WHEN $3 THEN NOW() ELSE finals_purged_at END
        WHERE id = $1`,
      [run.id, purgeVariants, purgeFinals],
    )
    await query(
      `INSERT INTO production_events (run_id, kind, payload) VALUES ($1, 'purged', $2::jsonb)`,
      [run.id, JSON.stringify({ variants: purgeVariants, finals: purgeFinals, files: deleted })],
    )
    runs += 1
    files += deleted
  }
  return { runs, files }
}
