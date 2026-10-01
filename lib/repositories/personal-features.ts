import { query } from "@/lib/db"
import { COMPANY_TOOLS_KEY, PRODUCTION_KEY } from "@/lib/company-features"

/**
 * Набор «Личного» — миграция 2026-10-01-personal-features.sql.
 *
 * Отдаёт сырой JSONB в форме `companies.features`, чтобы читатели прогоняли его
 * через тот же `readCompanyFeatures`. Только ключи, которые у «Личного» есть:
 * лишний ключ в строке не должен тихо включить, например, работу за наш счёт.
 */
const PERSONAL_KEYS = [COMPANY_TOOLS_KEY, PRODUCTION_KEY] as const

/** Таблицы ещё нет — «Производство» закрыто, остальное по умолчаниям. */
const BEFORE_MIGRATION = { [PRODUCTION_KEY]: false }

function isMissingTable(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42P01"
}

function pick(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of PERSONAL_KEYS) if (key in raw) out[key] = raw[key]
  return out
}

export async function readPersonalFeatures(): Promise<Record<string, unknown>> {
  try {
    const result = await query<{ features: Record<string, unknown> }>(
      `SELECT features FROM personal_features WHERE id = 'singleton'`,
    )
    return pick(result.rows[0]?.features ?? BEFORE_MIGRATION)
  } catch (error) {
    if (isMissingTable(error)) return { ...BEFORE_MIGRATION }
    throw error
  }
}

/** `null` — таблицы ещё нет, сохранить некуда. */
export async function patchPersonalFeatures(input: {
  patch: Record<string, unknown>
  updatedBy: string
}): Promise<Record<string, unknown> | null> {
  try {
    const result = await query<{ features: Record<string, unknown> }>(
      `INSERT INTO personal_features (id, features, updated_by)
       VALUES ('singleton', $1::jsonb, $2)
       ON CONFLICT (id) DO UPDATE
         SET features = personal_features.features || EXCLUDED.features,
             updated_at = NOW(),
             updated_by = EXCLUDED.updated_by
       RETURNING features`,
      [JSON.stringify(pick(input.patch)), input.updatedBy],
    )
    return pick(result.rows[0]?.features ?? {})
  } catch (error) {
    if (isMissingTable(error)) return null
    throw error
  }
}
