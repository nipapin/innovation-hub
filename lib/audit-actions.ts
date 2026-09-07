/**
 * Список действий журнала — без обращений к базе.
 *
 * Отдельным файлом по той же причине, что и lib/settings-types.ts: этот список
 * нужен и серверному репозиторию, и странице журнала. Лежи он в
 * repositories/admin-audit.ts, импорт значения (не типа) из клиента утянул бы в
 * браузерный бандл `pg`.
 *
 * Список закрытый: свободные строки в `action` означали бы, что фильтр в
 * интерфейсе нечем заполнить, а опечатка навсегда прячет событие от того, кто
 * будет разбираться. Добавлять новое действие — сюда.
 */
export const AUDIT_ACTIONS = [
  "user.created",
  "user.updated",
  "user.role_changed",
  "user.password_reset",
  "user.suspended",
  "user.reactivated",
  "user.deleted",
  "capability.granted",
  "capability.revoked",
  "computer.created",
  "computer.token_rotated",
  "computer.revoked",
  "machine_token.revoked",
  "settings.updated",
  // Выключатель части сайта. Пишется по той же причине, что и гейт обработки:
  // погасший раздел выглядит как поломка, и первый вопрос — «кто и когда».
  "feature.toggled",
  // Гейт обработки у пользователя. Пишется, потому что это первое, о чём
  // спросит второй администратор: «кто выключил». До этого запись меняли молча.
  "user.automation_enabled",
  "user.automation_disabled",
  "project.created",
  "project.deleted",
  // Смена владельца. Самое тяжёлое из действий над проектом: у одного человека
  // папка исчезла, у другого появилась, и счёт за обработку теперь приходит
  // ему. Разбор — docs/ADMIN_WORKSPACE_PLAN.md §5.
  "project.transferred",
  "project.shared",
  "project.unshared",
  "service.created",
  "service.updated",
  "service.secret_rotated",
  "service.secrets_revoked",
  // Кто, когда и на какую машину получил живой ключ. Пишется только на
  // настоящую выдачу: подтверждение «версия у тебя актуальная» секрета не
  // раскрывает, и засорять им журнал значило бы утопить в нём саму выдачу.
  "service.keys_issued",
  // Учётки под сервисом: заведение и правка. Отдельно от `service.updated`,
  // потому что «завели клиенту его учётку» и «поправили прайс» — разные по
  // весу события, и искать первое среди вторых пришлось бы глазами.
  "service.account_created",
  "service.account_updated",
  // Инцидент с машины: ключ протух, вендор отказал, у клиента кончились деньги.
  // Пишется в общий журнал, а не в логи, потому что половина картины иначе
  // осталась бы там, где её никто не сопоставит с проектом.
  "service.incident",
  // Отзыв и сброс тестового периода (П9.1). Пишутся оба и порознь: без них на
  // вопрос «почему у человека второй период» ответить будет некому, а разница
  // между «забрали деньги» и «разрешили заново» видна только по действию.
  "trial.revoked",
  "trial.reset",
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export function isAuditAction(value: unknown): value is AuditAction {
  return (
    typeof value === "string" &&
    (AUDIT_ACTIONS as readonly string[]).includes(value)
  )
}
