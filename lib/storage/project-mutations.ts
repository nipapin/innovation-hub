import type { ProjectGroupName, ProjectRecord } from "@/lib/domain-types"
import { writeProjectMeta } from "@/lib/project-storage"
import { findClientById } from "@/lib/repositories/clients"
import {
  createProject,
  deleteProject,
  findCompanyProject,
  findOwnedProject,
  findProjectById,
  updateProject,
} from "@/lib/repositories/projects"
import { isS3Configured } from "@/lib/s3-client"
import {
  requireOwnedProjectAccess,
  requireProjectAccess,
  type StorageApiAuth,
} from "@/lib/storage/auth"
import { syncProjectMeta } from "@/lib/storage/project-catalog"
import {
  purgeProject,
  restoreDeletedProject,
  softDeleteProject,
} from "@/lib/storage/project-trash"
import { NextResponse } from "next/server"
import { ownerInScope, reachScope } from "@/lib/storage/auth"
import { recordAuditEvent } from "@/lib/repositories/admin-audit"

export type MutationError = { error: string; status: number }
export type MutationOk<T> = { data: T }
export type MutationResult<T> = MutationOk<T> | MutationError

export function isMutationError<T>(
  result: MutationResult<T>,
): result is MutationError {
  return "error" in result
}

async function resolveClientId(
  auth: StorageApiAuth,
  clientId: string | null | undefined,
): Promise<MutationResult<string | null>> {
  if (clientId == null) return { data: null }
  const client = await findClientById(clientId)
  if (!client) return { error: "Client not found.", status: 400 }
  if (!(await ownerInScope(auth, client.userId))) {
    return { error: "Client not found.", status: 400 }
  }
  return { data: client.id }
}

export async function createOwnedProject(
  auth: StorageApiAuth,
  input: {
    name: string
    description?: string
    groupName?: ProjectGroupName
    clientId?: string | null
  },
): Promise<MutationResult<ProjectRecord>> {
  if (auth.scopedProjectId) {
    return {
      error: "Scoped machine tokens cannot create projects.",
      status: 403,
    }
  }
  if (!isS3Configured()) {
    return { error: "Object storage is not configured.", status: 503 }
  }

  const client = await resolveClientId(auth, input.clientId)
  if (isMutationError(client)) return client

  const project = await createProject({
    userId: auth.userId,
    name: input.name,
    description: input.description,
    groupName: input.groupName,
    clientId: client.data,
  })

  try {
    await writeProjectMeta({
      storageOwnerId: project.storageOwnerId,
      ownerId: project.userId,
      projectId: project.id,
      name: project.name,
      description: project.description,
      ownerEmail: auth.email,
      isArchived: project.isArchived,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    })
  } catch (error) {
    console.error("[storage] failed to write project-meta.json", error)
    await deleteProject(project.id, auth.userId).catch((cleanupError) => {
      console.error("[storage] rollback after R2 failure failed", cleanupError)
    })
    return {
      error:
        error instanceof Error
          ? error.message
          : "Object storage is temporarily unavailable.",
      status: 503,
    }
  }

  return { data: project }
}

/**
 * Переименование: владелец или участник с полным доступом.
 *
 * Имя проекта видят все, кому он расшарен, поэтому право на него идёт вместе с
 * правом звать людей, а не с правом править файлы: редактор работает внутри
 * папки и переименовать её не может.
 */
export async function renameOwnedProject(
  auth: StorageApiAuth,
  input: { projectId: string; name: string },
): Promise<MutationResult<ProjectRecord> | NextResponse> {
  const access = await requireProjectAccess(auth, input.projectId, "full")
  if (access instanceof NextResponse) return access

  const project = await updateProject(access.projectId, access.ownerId, {
    name: input.name,
  })
  if (!project) return { error: "Project not found.", status: 404 }
  await syncProjectMeta(project)
  return { data: project }
}

/**
 * Пауза и архив.
 *
 * Порог разный: пауза — обычная настройка обработки, её ставит редактор; архив
 * убирает проект из работы у всех сразу, включая владельца, поэтому требует
 * полного доступа. Когда в одном запросе пришло и то и другое, решает архив.
 */
export async function setOwnedProjectState(
  auth: StorageApiAuth,
  input: { projectId: string; paused?: boolean; archived?: boolean },
): Promise<MutationResult<ProjectRecord> | NextResponse> {
  const access = await requireProjectAccess(
    auth,
    input.projectId,
    input.archived !== undefined ? "full" : "editor",
  )
  if (access instanceof NextResponse) return access

  const project = await updateProject(access.projectId, access.ownerId, {
    isPaused: input.paused,
    isArchived: input.archived,
  })
  if (!project) return { error: "Project not found.", status: 404 }
  if (input.archived !== undefined) {
    await syncProjectMeta(project)
  }
  return { data: project }
}

export async function softDeleteOwnedProject(
  auth: StorageApiAuth,
  input: { projectId: string },
): Promise<MutationResult<{ ok: true }> | NextResponse> {
  if (auth.scopedProjectId) {
    return {
      error: "Scoped machine tokens cannot delete projects.",
      status: 403,
    }
  }
  const access = await requireOwnedProjectAccess(auth, input.projectId)
  if (access instanceof NextResponse) return access

  const project = await softDeleteProject(access.projectId, access.ownerId)
  if (!project) return { error: "Project not found.", status: 404 }

  // Через эту функцию удаляют проект и сайт, и парк машин — обе поверхности
  // сходятся здесь, поэтому запись одна. Машину мы в правах не ограничиваем
  // (docs/ADMIN_ROLES_PLAN.md §7), и удаление ей положено по работе; вопрос к
  // нему всегда «когда и по чьей задаче», а не «кто разрешил». Отсюда `via`.
  await recordAuditEvent({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "project.deleted",
    targetType: "project",
    targetId: project.id,
    targetLabel: project.name,
    meta: {
      ownerId: access.ownerId,
      via: auth.computerId
        ? "computer"
        : auth.machineTokenId
          ? "machine"
          : "session",
    },
  })

  return { data: { ok: true } }
}

export async function restoreOwnedProject(
  auth: StorageApiAuth,
  input: { projectId: string },
): Promise<MutationResult<ProjectRecord> | NextResponse> {
  if (auth.scopedProjectId) {
    return {
      error: "Scoped machine tokens cannot restore projects.",
      status: 403,
    }
  }

  // Корзина — единственное место, где рамка смотрит с `includeDeleted`:
  // восстановить можно только то, что уже было своим.
  const restoreScope = reachScope(auth)
  const existing =
    restoreScope.kind === "all"
      ? await findProjectById(input.projectId, { includeDeleted: true })
      : restoreScope.kind === "company"
        ? await findCompanyProject(input.projectId, restoreScope.companyId, {
            includeDeleted: true,
          })
        : await findOwnedProject(input.projectId, restoreScope.userId, {
            includeDeleted: true,
          })

  if (!existing?.deletedAt) {
    return { error: "Project not found.", status: 404 }
  }

  const restored = await restoreDeletedProject(existing.id, existing.userId)
  if (!restored) return { error: "Project not found.", status: 404 }
  return { data: restored }
}

/**
 * Стереть проект из корзины навсегда. Отменить это нечем.
 *
 * Рамка считается ровно как в `restoreOwnedProject` — с `includeDeleted`, потому
 * что распоряжаются здесь уже удалённым, — и требование то же: проект обязан
 * быть в корзине. Живой проект этим путём не сносится: сначала обычное удаление,
 * и только потом, отдельным осознанным действием, чистка.
 */
export async function purgeOwnedProject(
  auth: StorageApiAuth,
  input: { projectId: string },
): Promise<MutationResult<{ ok: true }> | NextResponse> {
  if (auth.scopedProjectId) {
    return {
      error: "Scoped machine tokens cannot delete projects.",
      status: 403,
    }
  }

  const scope = reachScope(auth)
  const existing =
    scope.kind === "all"
      ? await findProjectById(input.projectId, { includeDeleted: true })
      : scope.kind === "company"
        ? await findCompanyProject(input.projectId, scope.companyId, {
            includeDeleted: true,
          })
        : await findOwnedProject(input.projectId, scope.userId, {
            includeDeleted: true,
          })

  if (!existing?.deletedAt) {
    return { error: "Project not found.", status: 404 }
  }

  // Адрес в хранилище — из самой строки: у переданного проекта он не совпадает
  // с владельцем, и чистка по владельцу прошла бы по пустому префиксу.
  await purgeProject(existing.id, existing.storageOwnerId)

  // Запись обязательна и заметно важнее, чем у мягкого удаления: после неё от
  // проекта не остаётся ни строки, ни байтов, и журнал — единственное, где
  // сохранится, что он вообще существовал.
  await recordAuditEvent({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "project.purged",
    targetType: "project",
    targetId: existing.id,
    targetLabel: existing.name,
    meta: {
      ownerId: existing.userId,
      deletedAt: existing.deletedAt.toISOString(),
      via: auth.computerId
        ? "computer"
        : auth.machineTokenId
          ? "machine"
          : "session",
    },
  })

  return { data: { ok: true } }
}

