/**
 * Интервал между публикациями — ДИАПАЗОН [A, B] секунд, из которого берётся
 * случайная величина. A === B даёт точный интервал.
 *
 * Порт `src/PROCESSING/autoPost/interval.ts` из fs.manager.tauri, вместе с
 * главной граблей, ради которой он там и появился.
 *
 * ГРАБЛЯ: маршрут переоценивается КАЖДЫЙ тик обхода, а не один раз за
 * промежуток. Живой `Math.random()` в гейте означал бы новый бросок на каждом
 * тике — и публикация случалась бы на первом же тике, где бросок оказался
 * меньше прошедшего времени. То есть фактическое ожидание сползло бы к
 * МИНИМУМУ диапазона (минимум из десятков бросков), а обратный отсчёт в
 * интерфейсе прыгал бы туда-сюда каждую минуту.
 *
 * Поэтому бросок ДЕТЕРМИНИРОВАННЫЙ: сеется ключом промежутка (маршрут + время
 * последней публикации). Пока публикации не было — ключ тот же, значит и цель
 * та же: на всех тиках и между перезапусками процесса. Новая публикация
 * двигает `last` → ключ меняется → диапазон разыгрывается заново. Состояние
 * хранить не нужно.
 */

/**
 * Значение свойства `interval` → пара [min, max] неотрицательных секунд.
 * Понимает и число (графы до перехода на `valueRange`), и перевёрнутый диапазон.
 */
export function normalizeIntervalRange(raw: unknown): [number, number] {
  if (Array.isArray(raw)) {
    const a = Number(raw[0])
    const b = Number(raw[1] ?? raw[0])
    const lo = Number.isFinite(a) ? a : 0
    const hi = Number.isFinite(b) ? b : lo
    return [Math.max(0, Math.min(lo, hi)), Math.max(0, Math.max(lo, hi))]
  }
  const one = Number(raw)
  const value = Number.isFinite(one) ? Math.max(0, one) : 0
  return [value, value]
}

/** FNV-1a — короткий детерминированный хеш строки-ключа. */
function hashSeed(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 — один бросок из зерна. */
function mulberry32(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/**
 * Целевой интервал (секунды) для текущего промежутка: равномерно в [min, max],
 * но стабильно при одном и том же `seedKey` (см. шапку файла).
 */
export function pickInterval(
  range: [number, number],
  seedKey: string,
): number {
  const [lo, hi] = range
  if (hi <= lo) return lo
  return lo + Math.floor(mulberry32(hashSeed(seedKey)) * (hi - lo + 1))
}
