/**
 * Права на проект: одна лестница для сайта и для машинного API.
 *
 * `owner` — не роль в project_members, а сам projects.user_id. Роли участников
 * лежат в таблице, владелец — в проекте, и складывать их в одну таблицу нельзя:
 * появились бы два ответа на вопрос «чей это проект».
 *
 * Порядок лестницы важен: почти все проверки — «не ниже чем», поэтому `full`
 * автоматически проходит там, где хватает `editor`, а владелец — везде.
 */
export type ProjectAccessRole =
  | "viewer"
  | "commenter"
  | "editor"
  | "full"
  | "owner"

/** То, что может стоять в project_members.role. Без владельца. */
export type ProjectMemberRole = "viewer" | "commenter" | "editor" | "full"

export const PROJECT_MEMBER_ROLES: readonly ProjectMemberRole[] = [
  "viewer",
  "commenter",
  "editor",
  "full",
]

/**
 * `commenter` — между читателем и редактором: читает всё и пишет в чат, но
 * файлов не трогает. Нужен проверяющим этапов производства
 * (docs/PRODUCTION_PLAN.md §6.2); до него писать в чат и писать файлы
 * открывались одной ступенью.
 */
const RANK: Record<ProjectAccessRole, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  full: 4,
  owner: 5,
}

export function roleAtLeast(
  role: ProjectAccessRole,
  minimum: ProjectAccessRole,
): boolean {
  return RANK[role] >= RANK[minimum]
}

export function isProjectMemberRole(
  value: unknown,
): value is ProjectMemberRole {
  return (
    value === "viewer" ||
    value === "commenter" ||
    value === "editor" ||
    value === "full"
  )
}

/**
 * Что даёт роль. Одно место, куда смотрят и роуты, и интерфейс, чтобы кнопка и
 * проверка на сервере не расходились.
 *
 * Отдельно про удаление проекта: его нет ни у кого, кроме владельца, даже у
 * полного доступа. Полный доступ — это право распоряжаться работой в проекте
 * (звать людей, убрать в архив), а не право убрать саму папку у того, кто её
 * завёл: отменить это владелец сможет только из корзины и только у себя.
 */
export type ProjectPermissions = {
  /** Видеть проект, дерево файлов, описание, читать чат, скачивать файлы. */
  read: boolean
  /** Писать в чат проекта. */
  writeChat: boolean
  /** Заливать, создавать, переименовывать, удалять и перемещать файлы. */
  writeFiles: boolean
  /** Параметры обработки, пауза слежения, состояние папок. */
  writeSettings: boolean
  /** Переименовать проект и править его короткое описание. */
  renameProject: boolean
  /** Расшаривать дальше, менять роли, отзывать доступ. */
  manageMembers: boolean
  /** Отправить в архив и вернуть из архива. */
  archiveProject: boolean
  /** Удалить проект в корзину, восстановить, переносить между клиентами. */
  deleteProject: boolean
}

export function permissionsFor(role: ProjectAccessRole): ProjectPermissions {
  return {
    read: true,
    writeChat: roleAtLeast(role, "commenter"),
    writeFiles: roleAtLeast(role, "editor"),
    writeSettings: roleAtLeast(role, "editor"),
    renameProject: roleAtLeast(role, "full"),
    manageMembers: roleAtLeast(role, "full"),
    archiveProject: roleAtLeast(role, "full"),
    deleteProject: role === "owner",
  }
}

/**
 * Может ли `actor` выдать роль `target` при приглашении или смене.
 *
 * Полный доступ выдаёт любую роль, включая полный доступ: цепочка делегирования
 * не ограничена по решению владельца продукта. Ограничитель другой — снять
 * доступ у такого же «полного» может только владелец (см. canManageMember).
 */
export function canGrantRole(
  actor: ProjectAccessRole,
  target: ProjectMemberRole,
): boolean {
  if (!permissionsFor(actor).manageMembers) return false
  return RANK[target] <= RANK[actor]
}

/**
 * Может ли `actor` менять роль или отзывать доступ у участника с ролью `target`.
 *
 * Владелец — у всех. Полный доступ — только у читателей и редакторов: равного
 * себе он не трогает, иначе двое приглашённых могут вычеркнуть друг друга из
 * проекта, который завёл не они. Разбирает такие случаи владелец.
 */
export function canManageMember(
  actor: ProjectAccessRole,
  target: ProjectMemberRole,
): boolean {
  if (actor === "owner") return true
  if (!permissionsFor(actor).manageMembers) return false
  return RANK[target] < RANK[actor]
}
