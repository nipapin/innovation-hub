import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { listGiftProjects, type ProjectGift } from "@/lib/billing/grants"
import { createProjectSchema } from "@/lib/project-schemas"
import { writeProjectMeta } from "@/lib/project-storage"
import { countUnreadForProjects } from "@/lib/repositories/project-chat"
import { countProjectMembers } from "@/lib/repositories/project-member-counts"
import {
  createProject,
  deleteProject,
  listProjectsByUserId,
} from "@/lib/repositories/projects"
import {
  isProjectMemberRole,
  type ProjectMemberRole,
} from "@/lib/project-access"
import { listSharedProjectsForUser } from "@/lib/repositories/project-members"
import { listDeletedProjects } from "@/lib/storage/project-trash"
import { isS3Configured } from "@/lib/s3-client"

export const runtime = "nodejs"
export const maxDuration = 60

function parseArchivedParam(
  raw: string | null,
): { ok: true; value: boolean | "all" } | { ok: false } {
  if (raw == null || raw === "") return { ok: true, value: false }
  const value = raw.trim().toLowerCase()
  if (value === "all") return { ok: true, value: "all" }
  if (value === "true" || value === "1") return { ok: true, value: true }
  if (value === "false" || value === "0") return { ok: true, value: false }
  return { ok: false }
}

function toIso(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === "string" && value.length > 0) return value
  return null
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error ?? "Unknown error")
}

function isSchemaOutOfDate(error: unknown): boolean {
  return /column .* does not exist|relation .* does not exist|cached plan must not change result type/i.test(
    errorMessage(error),
  )
}

function schemaOutOfDateResponse() {
  return NextResponse.json(
    {
      message:
        "Server database schema changed. Run npm run db:migrate if needed, then pm2 reload all (or restart the Node process) so DB connections pick up the new columns.",
    },
    { status: 503 },
  )
}

function serializeProject(
  p: {
    id: string
    name: string
    description: string
    groupName: string
    isActive: boolean
    isArchived: boolean
    pausedReason?: "no-funds" | "trial-over" | "no-vendor-key" | null
    archivedAt: Date | string | null
    deletedAt?: Date | string | null
    clientId: string | null
    driveFolderId: string | null
    userId: string
    createdAt: Date | string
    updatedAt: Date | string
    yougileChatId: string | null
  },
  extra: {
    unreadCount: number
    memberCount: number
    sharedWithMe: boolean
    memberRole: ProjectMemberRole | null
    deletedAt: string | null
    /** Проект оплачен подарком: тестовым периодом или акцией. */
    gift?: ProjectGift | null
  },
) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    groupName: p.groupName,
    isPaused: !p.isActive,
    isActive: p.isActive,
    // Почему проект стоит. NULL — остановил человек; иначе биллинг, и обратно
    // тумблер не включится, пока платить нечем (lib/billing/admission.ts).
    pausedReason: p.pausedReason ?? null,
    isArchived: p.isArchived,
    archivedAt: toIso(p.archivedAt),
    deletedAt: extra.deletedAt,
    sharedWithMe: extra.sharedWithMe,
    memberRole: extra.memberRole,
    clientId: p.clientId,
    driveFolderId: p.driveFolderId,
    ownerId: p.userId,
    userId: p.userId,
    createdAt: toIso(p.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(p.updatedAt) ?? new Date(0).toISOString(),
    unreadCount: extra.unreadCount,
    // Скольким людям расшарен проект — число в углу карточки.
    memberCount: extra.memberCount,
    // Чем оплачен. Не у каждого проекта есть подарок, и `null` здесь — это
    // «платит владелец», а не «мы не знаем».
    gift: extra.gift ?? null,
    yougileChatId: p.yougileChatId,
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const archived = parseArchivedParam(
    request.nextUrl.searchParams.get("archived"),
  )
  if (!archived.ok) {
    return NextResponse.json(
      { message: "archived must be true, false, or all." },
      { status: 400 },
    )
  }

  try {
    let owned
    try {
      owned = await listProjectsByUserId(auth.userId, {
        archived: archived.value,
      })
    } catch (error) {
      if (isSchemaOutOfDate(error)) return schemaOutOfDateResponse()
      console.error("[projects] owned list failed", error)
      return NextResponse.json(
        { message: `Owned projects query failed: ${errorMessage(error)}` },
        { status: 500 },
      )
    }

    let shared: Awaited<ReturnType<typeof listSharedProjectsForUser>> = []
    try {
      shared = await listSharedProjectsForUser(auth.userId)
    } catch (error) {
      if (isSchemaOutOfDate(error)) return schemaOutOfDateResponse()
      console.error("[projects] shared list failed", error)
      return NextResponse.json(
        { message: `Shared projects query failed: ${errorMessage(error)}` },
        { status: 500 },
      )
    }

    let deleted: Awaited<ReturnType<typeof listDeletedProjects>> = []
    try {
      deleted = await listDeletedProjects(auth.userId)
    } catch (error) {
      if (isSchemaOutOfDate(error)) return schemaOutOfDateResponse()
      console.error("[projects] deleted list failed", error)
      return NextResponse.json(
        { message: `Deleted projects query failed: ${errorMessage(error)}` },
        { status: 500 },
      )
    }

    const allIds = [
      ...owned.map((p) => p.id),
      ...shared.map((p) => p.id),
    ]

    let unread: Record<string, number> = {}
    try {
      unread = await countUnreadForProjects(allIds)
    } catch (error) {
      console.error("[projects] unread counts failed", error)
      // Non-fatal: badges can be zero.
      unread = Object.fromEntries(allIds.map((id) => [id, 0]))
    }

    let memberCounts: Record<string, number> = {}
    try {
      memberCounts = await countProjectMembers(allIds)
    } catch (error) {
      console.error("[projects] member counts failed", error)
      // Non-fatal: badges can be zero.
      memberCounts = {}
    }

    /**
     * Подарочные проекты — свои. У расшаренного платит владелец, и его подарок
     * не наше дело: значок на чужой карточке обещал бы деньги, которых у
     * смотрящего нет.
     */
    let gifts = new Map<string, ProjectGift>()
    try {
      gifts = await listGiftProjects(auth.userId)
    } catch (error) {
      console.error("[projects] gift projects failed", error)
      // Non-fatal: значок пропадёт, список останется.
    }

    const projects = [
      ...owned.map((p) =>
        serializeProject(p, {
          unreadCount: unread[p.id] ?? 0,
          memberCount: memberCounts[p.id] ?? 0,
          sharedWithMe: false,
          memberRole: null,
          deletedAt: toIso(p.deletedAt),
          gift: gifts.get(p.id) ?? null,
        }),
      ),
      ...shared.map((p) =>
        serializeProject(p, {
          unreadCount: unread[p.id] ?? 0,
          memberCount: memberCounts[p.id] ?? 0,
          sharedWithMe: true,
          memberRole: isProjectMemberRole(p.memberRole) ? p.memberRole : null,
          deletedAt: null,
        }),
      ),
      ...deleted.map((p) =>
        serializeProject(p, {
          unreadCount: 0,
          memberCount: 0,
          sharedWithMe: false,
          memberRole: null,
          deletedAt: toIso(p.deletedAt),
        }),
      ),
    ]

    return NextResponse.json({
      projects,
      storageConfigured: isS3Configured(),
      driveConfigured: false,
    })
  } catch (error) {
    if (isSchemaOutOfDate(error)) return schemaOutOfDateResponse()
    console.error("[projects] GET failed", error)
    return NextResponse.json(
      { message: `Failed to load projects: ${errorMessage(error)}` },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const payload = await request.json().catch(() => null)
  const parsed = createProjectSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: parsed.error.issues[0]?.message ?? "Invalid project data.",
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  const { name, description, groupName } = parsed.data

  if (!isS3Configured()) {
    return NextResponse.json(
      {
        message:
          "Cloudflare R2 is not configured. Set AWS_ENDPOINT_URL to your r2.cloudflarestorage.com endpoint plus AWS_S3_BUCKET / S3_KEY_ID / S3_SECRET_KEY.",
      },
      { status: 503 },
    )
  }

  try {
    const project = await createProject({
      userId: auth.userId,
      name,
      description,
      groupName,
    })
    if (!project?.id) {
      return NextResponse.json(
        { message: "Project insert returned no row." },
        { status: 500 },
      )
    }

    try {
      await writeProjectMeta({
        storageOwnerId: project.storageOwnerId,
        ownerId: project.ownerId,
        projectId: project.id,
        name,
        description: description ?? "",
        ownerEmail: auth.email,
        isArchived: project.isArchived,
        createdAt: toIso(project.createdAt) ?? new Date().toISOString(),
        updatedAt: toIso(project.updatedAt) ?? new Date().toISOString(),
      })
    } catch (error) {
      console.error("[projects] failed to write project-meta.json to R2", error)
      await deleteProject(project.id, auth.userId).catch((cleanupError) => {
        console.error("[projects] rollback after R2 failure failed", cleanupError)
      })
      return NextResponse.json(
        {
          message:
            error instanceof Error
              ? error.message
              : "Cloudflare R2 is temporarily unavailable.",
        },
        { status: 503 },
      )
    }

    return NextResponse.json(
      {
        project: serializeProject(project, {
          unreadCount: 0,
          memberCount: 0,
          sharedWithMe: false,
          memberRole: null,
          deletedAt: toIso(project.deletedAt),
        }),
      },
      { status: 201 },
    )
  } catch (error) {
    if (isSchemaOutOfDate(error)) return schemaOutOfDateResponse()
    console.error("[projects] POST failed", error)
    return NextResponse.json(
      { message: `Could not create project: ${errorMessage(error)}` },
      { status: 500 },
    )
  }
}
