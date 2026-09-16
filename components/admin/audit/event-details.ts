"use client"

import { tf, type useAdminI18n } from "@/components/admin/admin-dict"
import type { AuditAction } from "@/lib/audit-actions"

type Dict = ReturnType<typeof useAdminI18n>

/**
 * Строка подробностей события: то, ради чего в журнал вообще заглядывают.
 *
 * «Изменена роль» без «из чего во что» — это уведомление, а не журнал: оно
 * говорит, что кто-то трогал доступ, и не говорит, чем дело кончилось. Для
 * смены роли это «USER → ADMIN», для тегов — какие именно выдали, для удаления
 * проекта — чем его удалили.
 *
 * Общая для ленты `/admin/audit` и для подсказки на строке пользователя: одно и
 * то же событие в двух местах должно читаться одинаково, иначе выяснение
 * «а что там на самом деле» превращается в сверку двух экранов.
 */
export function detailsOf(
  event: { action: AuditAction; meta: Record<string, unknown> | null },
  t: Dict,
): string | null {
  const meta = event.meta ?? {}

  if (event.action === "user.role_changed") {
    const from = typeof meta.from === "string" ? meta.from : "?"
    const to = typeof meta.to === "string" ? meta.to : "?"
    return tf(t.auditRoleFromTo, { from, to })
  }
  if (event.action === "user.password_reset" && meta.isSelf === true) {
    return t.auditSelfNote
  }
  if (event.action === "project.deleted" || event.action === "project.purged") {
    if (meta.via === "computer") return t.auditViaComputer
    if (meta.via === "machine") return t.auditViaMachine
    return t.auditViaSession
  }
  if (event.action === "settings.updated" && Array.isArray(meta.domains)) {
    return meta.domains.join(", ")
  }
  if (
    (event.action === "user.created" || event.action === "user.deleted") &&
    typeof meta.role === "string"
  ) {
    return meta.role
  }
  // Поля профиля пишутся в журнал под своими техническими именами — читает их
  // человек, поэтому переводим здесь, а не в базе: имена полей в meta должны
  // пережить смену формулировок.
  if (event.action === "user.updated" && Array.isArray(meta.profileFields)) {
    const labels: Record<string, string> = {
      fullName: t.auditFieldFullName,
      email: t.auditFieldEmail,
    }
    return meta.profileFields
      .map((field) => (typeof field === "string" ? labels[field] ?? field : ""))
      .filter(Boolean)
      .join(", ")
  }
  // Теги пишутся списком, и список — это и есть ответ на «что изменилось».
  // Выдача и отзыв разведены по отдельным событиям, поэтому знак не нужен:
  // его несёт само действие.
  if (event.action === "capability.granted" && Array.isArray(meta.added)) {
    return meta.added.join(", ")
  }
  if (event.action === "capability.revoked" && Array.isArray(meta.removed)) {
    return meta.removed.join(", ")
  }
  return null
}
