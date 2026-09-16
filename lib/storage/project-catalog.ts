import type { ProjectRecord, UserRecord } from "@/lib/domain-types"
import { writeProjectMeta } from "@/lib/project-storage"
import {
  listAllClients,
  listClientsByIds,
  listClientsByUserId,
  listClientsByUserIds,
} from "@/lib/repositories/clients"
import {
  findProjectById,
  listAllProjects,
  listProjectsByCompanyId,
  listProjectsByUserId,
} from "@/lib/repositories/projects"
import { findUserById, listUsersByIds } from "@/lib/repositories/users"
import type { StorageApiAuth } from "@/lib/storage/auth"
import { ownerInScope, reachScope } from "@/lib/storage/auth"

export type StorageProjectJson = {
  id: string
  name: string
  clientId: string | null
  userId: string
  ownerEmail: string | null
  groupName: string
  isActive: boolean
  isPaused: boolean
  isArchived: boolean
  archivedAt: string | null
  updatedAt: string
}

export type StorageUserJson = {
  id: string
  email: string
  fullName: string
}

function serializeUser(user: UserRecord): StorageUserJson {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
  }
}

export function serializeStorageProject(
  project: ProjectRecord,
  owner?: Pick<UserRecord, "email"> | null,
): StorageProjectJson {
  return {
    id: project.id,
    name: project.name,
    clientId: project.clientId,
    userId: project.userId,
    ownerEmail: owner?.email ?? null,
    groupName: project.groupName,
    isActive: project.isActive,
    isPaused: project.isPaused,
    isArchived: project.isArchived,
    archivedAt: project.archivedAt ? project.archivedAt.toISOString() : null,
    updatedAt: project.updatedAt.toISOString(),
  }
}

export async function serializeStorageProjectWithOwner(
  project: ProjectRecord,
): Promise<StorageProjectJson> {
  const owner = await findUserById(project.userId)
  return serializeStorageProject(project, owner)
}

/** Best-effort: Postgres is the source of truth if R2 write fails. */
export async function syncProjectMeta(project: ProjectRecord): Promise<void> {
  const owner = await findUserById(project.userId)
  try {
    await writeProjectMeta({
      storageOwnerId: project.storageOwnerId,
      ownerId: project.userId,
      projectId: project.id,
      name: project.name,
      description: project.description,
      ownerEmail: owner?.email ?? "",
      isArchived: project.isArchived,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    })
  } catch (error) {
    console.error("[storage] failed to write project-meta.json", error)
  }
}

export type StorageProjectCatalog = {
  users: StorageUserJson[]
  clients: { id: string; displayName: string }[]
  projects: StorageProjectJson[]
}

type CatalogError = { error: string; status: 404 }

export async function loadStorageProjectCatalog(
  auth: StorageApiAuth,
): Promise<StorageProjectCatalog | CatalogError> {
  if (auth.scopedProjectId) {
    const project = await findProjectById(auth.scopedProjectId)
    if (!project) {
      return { error: "Project not found.", status: 404 as const }
    }
    if (!(await ownerInScope(auth, project.userId))) {
      return { error: "Project not found.", status: 404 as const }
    }
    const [clients, owners] = await Promise.all([
      project.clientId ? listClientsByIds([project.clientId]) : Promise.resolve([]),
      listUsersByIds([project.userId]),
    ])
    const ownerById = new Map(owners.map((u) => [u.id, u]))
    return {
      users: owners.map(serializeUser),
      clients: clients.map((c) => ({ id: c.id, displayName: c.displayName })),
      projects: [serializeStorageProject(project, ownerById.get(project.userId))],
    }
  }

  const scope = reachScope(auth)
  const projects =
    scope.kind === "all"
      ? await listAllProjects()
      : scope.kind === "company"
        ? await listProjectsByCompanyId(scope.companyId)
        : await listProjectsByUserId(scope.userId)

  const ownerIds = [...new Set(projects.map((p) => p.userId))]
  const [clients, owners] = await Promise.all([
    scope.kind === "all"
      ? listAllClients()
      // Клиенты компании — клиенты её людей. Отдельной выборки нет: их
      // владельцы уже посчитаны в `ownerIds` выше, по ним и берём.
      : scope.kind === "company"
        ? listClientsByUserIds(ownerIds)
        : listClientsByUserId(scope.userId),
    listUsersByIds(ownerIds),
  ])
  const ownerById = new Map(owners.map((u) => [u.id, u]))

  return {
    users: owners.map(serializeUser),
    clients: clients.map((c) => ({ id: c.id, displayName: c.displayName })),
    projects: projects.map((p) =>
      serializeStorageProject(p, ownerById.get(p.userId)),
    ),
  }
}
