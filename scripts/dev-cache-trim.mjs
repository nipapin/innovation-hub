/**
 * Удаляет кэш Turbopack для разработки (`.next/dev`), если он разросся.
 *
 * Next 16 по умолчанию держит этот кэш на диске и почти ничего из него не
 * удаляет. 2026-10-02 он дорос до 109 ГБ, и dev-сервер начал отдавать 404 на
 * все `/api/*` — вход перестал работать. Ограничить размер настройкой Next
 * нельзя, а чистить на ходу небезопасно: сервер держит файлы открытыми.
 * Поэтому проверяем перед запуском `pnpm run dev`.
 *
 * Порог по умолчанию 10 ГБ; переопределяется `DEV_CACHE_LIMIT_GB`.
 * Боевую сборку (`next build` / `next start`) это не затрагивает — она
 * `.next/dev` не создаёт.
 */
import { execFileSync } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import path from "node:path"

const cacheDir = path.join(process.cwd(), ".next", "dev")
const limitGb = Number(process.env.DEV_CACHE_LIMIT_GB) || 10

if (existsSync(cacheDir)) {
  // du вместо обхода в JS: на сотнях гигабайт мелких файлов обход идёт минутами.
  const sizeKb = Number(execFileSync("du", ["-sk", cacheDir]).toString().split(/\s/)[0])
  const sizeGb = sizeKb / 1024 / 1024
  if (sizeGb > limitGb) {
    console.log(`[dev-cache-trim] .next/dev занимает ${sizeGb.toFixed(1)} ГБ (порог ${limitGb} ГБ) — удаляю`)
    rmSync(cacheDir, { recursive: true, force: true })
  }
}
