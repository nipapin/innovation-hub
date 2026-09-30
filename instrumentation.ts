/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * Used to kick off background loops so they're running before any request
 * comes in:
 *
 *   — chat push poller (lib/chat-push-poller.ts) — тянет ответы команды из YouGile;
 *   — pipeline runner (lib/pipeline/runner.ts) — следит за папками IN и создаёт
 *     объекты для обработки, пока слежение включено в админке. Цикл поднимается
 *     всегда, а работает или спит — решает флаг в базе, поэтому включённое
 *     слежение переживает перезапуск процесса;
 *   — stats loop (lib/statistics/stats-loop.ts) — суточный срез объёма и файлов
 *     плюс импорт архива обработок из R2. Пропущенный день невосстановим,
 *     поэтому тик живёт в процессе, а не только в cron-роуте.
 *
 * Здесь же одноразовый сид общих словарей (docs/SETTINGS_SYNC.md): он
 * идемпотентен и наливает только пустые домены, поэтому безопасен на каждом
 * старте и не откатывает правки пользователя.
 *
 * Guarded to the Node runtime since this touches Postgres/web-push, neither
 * of which work in the Edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startChatPushPoller } = await import("@/lib/chat-push-poller")
    startChatPushPoller()

    const { startPipelineRunner } = await import("@/lib/pipeline/runner")
    startPipelineRunner()

    const { startStatsLoop } = await import("@/lib/statistics/stats-loop")
    startStatsLoop()

    // Срок хранения файлов производства: варианты и промежуточные финалы
    // сданных роликов (lib/production/retention.ts).
    const { startProductionRetentionLoop } = await import("@/lib/production/retention")
    startProductionRetentionLoop()

    // Автоматика производства следит за задачами конвейера своих элементов
    // в IN (lib/production/machines.ts).
    const { startProductionMachinesLoop } = await import("@/lib/production/machines")
    startProductionMachinesLoop()

    // Не await: сид не должен задерживать старт процесса и тем более ронять его,
    // если база ещё не поднялась.
    void import("@/lib/repositories/automation-settings")
      .then(({ seedDefaultSettings }) => seedDefaultSettings())
      .then(({ seeded }) => {
        if (seeded.length > 0) {
          console.log(`[settings] seeded defaults: ${seeded.join(", ")}`)
        }
      })
      .catch((error) => {
        console.error("[settings] failed to seed defaults", error)
      })
  }
}
