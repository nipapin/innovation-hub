import { NextResponse } from "next/server"

import {
  hasCapability,
  type AdminCapability,
} from "@/lib/admin-capabilities"
import type { ProjectRecord, UserRole } from "@/lib/domain-types"
import {
  isProjectMemberRole,
  permissionsFor,
  roleAtLeast,
  type ProjectAccessRole,
  type ProjectPermissions,
} from "@/lib/project-roles"
import { findProjectMembership } from "@/lib/repositories/project-members"
import { findProjectById } from "@/lib/repositories/projects"

/**
 * Проверка доступа к проекту на стороне сервера.
 *
 * Сами правила — в lib/project-roles.ts: тот модуль чистый, без обращений к базе
 * и к next/server, и поэтому его же берёт интерфейс
 * (components/account/workspace/access.ts). Матрица прав одна, а не по копии на
 * каждый слой — иначе кнопка и проверка рано или поздно разойдутся.
 */
export * from "@/lib/project-roles"

export type ProjectAccess = {
  project: ProjectRecord
  role: ProjectAccessRole
  permissions: ProjectPermissions
  /**
   * Доступ дан админским тегом, а не владением или участием.
   *
   * Нужно роуту, а не проверке: права от этого не меняются, но действие,
   * совершённое над чужим проектом, положено записать в журнал админских
   * действий, а такое же действие владельца над своим — нет. Иначе журнал
   * зальёт обычная работа пользователей, и админские строки в нём утонут.
   */
  viaCapability?: boolean
  /**
   * Проект лежит в корзине. Роль в этом случае уже зажата до `viewer` — флаг
   * нужен роуту не для решения, а для ответа: отказ «только чтение» и отказ
   * «проект удалён» человек разбирает по-разному.
   */
  inTrash?: boolean
}

/**
 * Роль пользователя сайта в проекте: владелец, участник или никто.
 *
 * Машинные токены сюда не ходят — у них своя авторизация в lib/storage/auth.ts,
 * и расшаривание на них не распространяется.
 *
 * Проект в корзине отсюда возвращается — но всегда читателем, кем бы
 * спрашивающий ни был. Это единственное место, где корзина открывается на
 * чтение, и зажим стоит именно здесь по двум причинам. Во-первых, через эту
 * функцию проходят и роуты кабинета, и человеческая половина
 * `/api/storage/v1/*` (lib/storage/auth.ts зовёт её же), так что одного зажима
 * хватает на обе. Во-вторых, любая запись отказывает сама: роуты требуют
 * `editor` и выше, и `roleAtLeast` их не пустит — не нужно помнить про корзину
 * в каждом из них по отдельности.
 *
 * Машины сюда не попадают, и это тоже намеренно: увидь программа удалённый
 * проект, конвейер снова начал бы собирать по нему задачи.
 */
export async function resolveProjectAccess(
  projectId: string,
  userId: string,
): Promise<ProjectAccess | null> {
  const project = await findProjectById(projectId, { includeDeleted: true })
  if (!project) return null

  const inTrash = project.deletedAt != null
  const clamp = (role: ProjectAccessRole): ProjectAccess => ({
    project,
    role: inTrash ? "viewer" : role,
    permissions: permissionsFor(inTrash ? "viewer" : role),
    ...(inTrash ? { inTrash: true } : {}),
  })

  if (project.userId === userId) return clamp("owner")

  const membership = await findProjectMembership(projectId, userId)
  if (!membership || !isProjectMemberRole(membership.role)) return null
  return clamp(membership.role)
}

/**
 * Проверка доступа для роутов кабинета — тех, что авторизуют сессионной кукой
 * (`requireUserApi`).
 *
 * Одноимённая функция есть и в lib/storage/auth.ts — не путать: та принимает
 * `StorageApiAuth` и умеет машинные токены, эта принимает `userId` и знает
 * только пользователей сайта. Роль обе считают одним и тем же кодом.
 *
 * Разница ответов намеренная: нет доступа вовсе — 404, чтобы чужой проект не
 * подтверждал сам факт своего существования; доступ есть, но роль ниже нужной —
 * 403 с внятным текстом, потому что человек проект видит и должен понять, почему
 * действие не прошло, а не решить, что проект исчез.
 */
export async function requireProjectAccess(
  projectId: string,
  userId: string,
  minimum: ProjectAccessRole = "viewer",
): Promise<ProjectAccess | NextResponse> {
  const access = await resolveProjectAccess(projectId, userId)
  if (!access) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  if (!roleAtLeast(access.role, minimum)) {
    return NextResponse.json(
      {
        // Проект в корзине — тоже «только чтение», но по совсем другой причине,
        // и общий текст отправил бы владельца искать, кто урезал ему права в
        // его же папке.
        message: access.inTrash
          ? "Project is in the trash. Restore it to make changes."
          : forbiddenMessage(minimum),
      },
      { status: 403 },
    )
  }
  return access
}

/**
 * То же самое, но с одной оговоркой: админ с названным тегом проходит как
 * владелец.
 *
 * Отдельная функция, а не флаг внутри `requireProjectAccess`, и тег передаётся
 * явно на каждом вызове — намеренно. Спрячь эту ветку внутрь общей проверки, и
 * она молча расширила бы все роуты кабинета разом; здесь же в коде роута прямо
 * написано, какой тег его открывает, и увидеть это можно грепом по названию
 * тега, а не чтением всей цепочки.
 *
 * Зачем вообще: расшаривание чужого проекта — это тот же самый диалог и тот же
 * самый список участников, что у владельца. Второй роут «для админов» рядом
 * означал бы две реализации приглашения, двух отправителей письма и два места,
 * где чинить. Разбор — docs/ADMIN_WORKSPACE_PLAN.md §7.
 */
export async function requireProjectAccessOrCapability(
  projectId: string,
  auth: {
    userId: string
    role: UserRole
    capabilities: readonly AdminCapability[]
  },
  minimum: ProjectAccessRole,
  capability: AdminCapability,
): Promise<ProjectAccess | NextResponse> {
  if (hasCapability(auth.role, auth.capabilities, capability)) {
    // Без `includeDeleted`: проект в корзине админский тег не открывает —
    // распоряжаться удалённым проектом нечего. Если он там, идём общим путём:
    // тот пустит на чтение того, кто и так имеет к проекту отношение, а
    // постороннему ответит 404, как и раньше.
    const project = await findProjectById(projectId)
    if (project) {
      // Владельцем в базе он не становится: `project.userId` не трогаем,
      // меняется только то, что позволено сделать в этом запросе.
      return {
        project,
        role: "owner",
        permissions: permissionsFor("owner"),
        viaCapability: true,
      }
    }
  }
  return requireProjectAccess(projectId, auth.userId, minimum)
}

function forbiddenMessage(minimum: ProjectAccessRole): string {
  switch (minimum) {
    case "editor":
      return "Read-only access to this project."
    case "full":
      return "Full access to this project is required."
    case "owner":
      return "Only the project owner can do this."
    default:
      return "Not enough access to this project."
  }
}
