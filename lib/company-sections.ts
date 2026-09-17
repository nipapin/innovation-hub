/**
 * Разделы консоли компании как КЛЮЧИ — docs/COMPANY_SETUP_PANEL_PLAN.md §2.
 *
 * Отдельно от `components/company/nav-config.ts`, хотя список там тот же и
 * собирается из этого: навигация несёт иконки и словарные ключи, то есть тянет
 * за собой `lucide-react`, а спрашивают «продан ли компании этот раздел» гейт
 * (lib/company-auth.ts) и роут админки. Держать ответ в модуле с иконками
 * значило бы возить их по серверу ради одной строки.
 *
 * Здесь же живёт связь «раздел ↔ тег права». Она нужна потому, что гварды
 * консоли принимают ТЕГ, а набор задан разделами: без сопоставления гейт не смог
 * бы отказать по набору, и раздел, убранный из меню, открывался бы по прямому
 * адресу.
 */
import type { CompanyCapability } from "@/lib/company-capabilities"

export type CompanySectionKey =
  | "people"
  | "roles"
  | "wallet"
  | "statistics"
  | "machines"
  | "keys"
  | "audit"

/**
 * Ключ раздела → тег, который его открывает. `null` — журнал: он виден всем
 * админам компании и тегом не закрыт (COMPANY_ACCOUNTS_PLAN §6.4).
 *
 * Порядок здесь и в `COMPANY_TOOLS` совпадать не обязан: там он про то, как
 * разделы стоят в колонке, здесь — только про принадлежность.
 */
export const COMPANY_SECTIONS: {
  key: CompanySectionKey
  capability: CompanyCapability | null
}[] = [
  { key: "people", capability: "people.manage" },
  { key: "roles", capability: "roles.manage" },
  { key: "wallet", capability: "wallet.manage" },
  { key: "statistics", capability: "statistics.view" },
  { key: "machines", capability: "machines.manage" },
  { key: "keys", capability: "keys.manage" },
  { key: "audit", capability: null },
]

export const COMPANY_SECTION_KEYS: CompanySectionKey[] = COMPANY_SECTIONS.map(
  (section) => section.key,
)

export function isCompanySectionKey(value: unknown): value is CompanySectionKey {
  return (
    typeof value === "string" &&
    (COMPANY_SECTION_KEYS as string[]).includes(value)
  )
}

/**
 * Разделы, которые открывает этот тег.
 *
 * Их может быть несколько, и это не теоретическая оговорка: тег — про право,
 * ключ — про проданный раздел, и однажды один тег откроет два раздела. Гейт
 * поэтому спрашивает «есть ли ХОТЬ ОДИН проданный раздел под этим тегом», а не
 * «продан ли единственный».
 */
export function sectionsForCapability(
  capability: CompanyCapability,
): CompanySectionKey[] {
  return COMPANY_SECTIONS.filter((section) => section.capability === capability).map(
    (section) => section.key,
  )
}
