import { readCompanyFeatures } from "@/lib/company-features"
import { findCompanyFeaturesForUser } from "@/lib/repositories/companies"

/**
 * Гейт зеркала чата по ВЛАДЕЛЬЦУ проекта — docs/COMPANY_SETUP_PANEL_PLAN.md §2.6.
 *
 * Отдельный модуль, а не пара функций в lib/company-features.ts: тот чистый и
 * базы не касается намеренно — его читает и браузер. Здесь же нужен запрос.
 *
 * Компания берётся через владельца, а не из колонки в `projects`: во всей
 * остальной изоляции компании она тоже выводится из `users.company_id`
 * (см. findCompanyProject), и второй источник правды однажды разошёлся бы с
 * первым при переводе человека между компаниями.
 *
 * Человек вне компании получает `true`: `findCompanyFeaturesForUser` вернёт ему
 * `null`, а `readCompanyFeatures(null)` — умолчания, то есть «включено». Это и
 * требуется: приватный пользователь ничьим набором не ограничен.
 *
 * Гейта на сам чат здесь нет намеренно — чат проекта есть у всех, см.
 * CHAT_YOUGILE_SYNC_KEY.
 */
export async function isProjectChatSyncEnabled(ownerUserId: string): Promise<boolean> {
  const features = readCompanyFeatures(await findCompanyFeaturesForUser(ownerUserId))
  return features.chatYouGileSync
}
