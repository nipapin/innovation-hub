import { query } from "@/lib/db"
import { isFeatureKey, type FeatureKey } from "@/lib/features"

/**
 * Решения человека о выключателях. Контракт — docs/FEATURE_FLAGS.md.
 *
 * Строки здесь есть только у флагов, которые кто-то трогал. Отсутствие строки —
 * не «выключено», а «решения не было»: значение тогда берётся из умолчания
 * установки. Разница существенна для копии сайта, где умолчание `off`: там
 * новый флаг гаснет сам, и это не требует ни миграции, ни строки в базе.
 */

type Row = { key: string; enabled: boolean }

/**
 * Переопределения списком.
 *
 * Ключи, которых нет в реестре, отбрасываются: флаг могли удалить из кода, а
 * строка от него переживает откат релиза намеренно (см. миграцию). Мусор в
 * состояние установки при этом не попадает.
 */
export async function readFeatureOverrides(): Promise<Map<FeatureKey, boolean>> {
  let result
  try {
    result = await query<Row>(`SELECT key, enabled FROM feature_flags`)
  } catch (error) {
    // 42P01 — таблицы нет. Это незалитая миграция, а не «решений не принимали»:
    // молча вернуть пустой список значило бы поднять сайт на умолчаниях и
    // сделать вид, что так и надо. Сообщение сразу называет лечение — тот же
    // приём, что в readRow() для automation_settings.
    if ((error as { code?: string }).code === "42P01") {
      throw new Error(
        "feature_flags table is missing — run npm run db:migrate.",
      )
    }
    throw error
  }
  const overrides = new Map<FeatureKey, boolean>()
  for (const row of result.rows) {
    if (isFeatureKey(row.key)) overrides.set(row.key, row.enabled)
  }
  return overrides
}

/**
 * Записать решение по одному флагу.
 *
 * Строка не удаляется при возврате к умолчанию: «человек решил, что здесь
 * включено» и «здесь никто ничего не решал» — разные состояния, и второе не
 * должно возникать от того, что первое совпало с умолчанием. Иначе на копии
 * сайта включённый вручную инструмент однажды сам погас бы при смене
 * FEATURE_DEFAULT.
 */
export async function writeFeatureOverride(input: {
  key: FeatureKey
  enabled: boolean
  updatedBy: string | null
}): Promise<void> {
  await query(
    `INSERT INTO feature_flags (key, enabled, updated_by)
          VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE
            SET enabled    = EXCLUDED.enabled,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by`,
    [input.key, input.enabled, input.updatedBy],
  )
}
