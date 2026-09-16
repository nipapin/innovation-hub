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
] as const

export type CompanyCapability = (typeof COMPANY_CAPABILITIES)[number]

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
  if (role !== "admin") return false
  return granted?.includes(needed) ?? false
}
