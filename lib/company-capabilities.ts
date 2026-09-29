/**
 * Теги прав внутри компании — вторая ось, независимая от lib/admin-capabilities.ts.
 *
 * Устройство повторяет сайтовые теги этажом ниже (docs/COMPANY_ACCOUNTS_PLAN.md
 * §4): `owner` — корень раздачи, ему теги не проверяются, как суперадмину на
 * сайте; `admin` — по факту выданных тегов; `member` — консоли не видит вовсе.
 *
 * Состав тегов — задел на консоль компании (этап 4): сама консоль на этом этапе
 * не строится, но реестр закрытый и определяется здесь, чтобы новый инструмент
 * компании приносил свой тег без миграции.
 */
import type { CompanyRole } from "@/lib/domain-types"

export const COMPANY_CAPABILITIES = [
  "wallet.manage",
  "statistics.view",
  "people.manage",
  "roles.manage",
  "keys.manage",
  // Машины компании: выдать и отозвать её `rc_`-токены
  // (docs/COMPANY_PIPELINE_PLAN.md §2). Отдельный тег, а не довесок к «ключам»:
  // ключ сервиса — чужой секрет, который мы храним, а токен машины — ключ от
  // проектов самой компании, и утечка у них разной природы.
  "machines.manage",
  /**
   * Звать в проекты компании людей ИЗВНЕ её.
   *
   * Единственный тег, который действует не в консоли, а в рабочем месте — в
   * диалоге «Поделиться». Он там потому, что приглашение постороннего это не
   * работа с проектом, а решение за компанию: незнакомый адрес заводит НОВЫЙ
   * аккаунт на сайте, этот человек получает файлы проекта, а его обработка
   * ложится на кошелёк компании.
   *
   * Делиться с коллегой по своей компании тег не требует — это обычная работа.
   */
  "people.invite",
  /**
   * Заводить пайплайны производства — docs/PRODUCTION_PLAN.md §6.4.
   *
   * РАБОЧИЙ тег (см. COMPANY_WORKSPACE_CAPABILITIES): выдаётся и рядовому
   * сотруднику. Пайплайны заводит продюсер, а не админ компании, и делать его
   * админом ради одного права значило бы открыть ему консоль и журнал.
   */
  "production.manage",
] as const

export type CompanyCapability = (typeof COMPANY_CAPABILITIES)[number]

/**
 * Рабочие теги — те, что действуют в рабочем месте, а не в консоли, и потому
 * выдаются и участнику (`member`), не только админу.
 *
 * Консоль участнику по-прежнему закрыта: гейт (lib/company-auth.ts, `resolve`)
 * отсекает его раньше, чем дело дойдёт до тегов. Рабочий тег открывает только
 * действие в кабинете.
 *
 * `people.invite` сюда не входит, хотя тоже живёт в рабочем месте: он решает за
 * компанию, кого из посторонних пускать к её файлам, и остаётся за админами.
 */
export const COMPANY_WORKSPACE_CAPABILITIES: readonly CompanyCapability[] = [
  "production.manage",
]

export function isWorkspaceCapability(capability: CompanyCapability): boolean {
  return COMPANY_WORKSPACE_CAPABILITIES.includes(capability)
}

export function isCompanyCapability(value: unknown): value is CompanyCapability {
  return (
    typeof value === "string" &&
    (COMPANY_CAPABILITIES as readonly string[]).includes(value)
  )
}

/**
 * Есть ли у человека тег внутри СВОЕЙ компании.
 *
 * `role` — company_role того, кого проверяют, а не его роль на сайте: это
 * разные оси (план §4). У `null` (человек не в компании) прав нет никаких.
 */
export function hasCompanyCapability(
  role: CompanyRole | null | undefined,
  granted: readonly CompanyCapability[] | null | undefined,
  needed: CompanyCapability,
): boolean {
  if (role === "owner") return true
  if (role === "member") {
    // Участнику открывают только рабочие теги; консольный, оставшийся от
    // прошлой жизни админом, ничего не открывает.
    return isWorkspaceCapability(needed) && (granted?.includes(needed) ?? false)
  }
  if (role !== "admin") return false
  return granted?.includes(needed) ?? false
}
