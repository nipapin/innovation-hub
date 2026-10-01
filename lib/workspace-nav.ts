/**
 * Пункты рабочего места в боковом меню, которые человек может убрать
 * (миграция 2026-10-01-workspace-visibility.sql). Консоли компании здесь нет:
 * это разделы распоряжения, их видимость решают права, а не вкус.
 */
export const WORKSPACE_NAV_KEYS = [
  "dashboard",
  "projects",
  "production",
  "tools",
  "archive",
  "trash",
  "keys",
] as const
export type WorkspaceNavKey = (typeof WORKSPACE_NAV_KEYS)[number]

export function isWorkspaceNavKey(value: string): value is WorkspaceNavKey {
  return (WORKSPACE_NAV_KEYS as readonly string[]).includes(value)
}

/**
 * Показывать ли «Личное». Скрыто, но активных компаний нет — показываем:
 * иначе человеку некуда войти.
 */
export function isPersonalVisible(personalHidden: boolean, hasActiveCompany: boolean): boolean {
  return !personalHidden || !hasActiveCompany
}
