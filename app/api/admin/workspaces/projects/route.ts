import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { listGiftsForProjects, type ProjectGift } from "@/lib/billing/grants"
import { listPipelineProjectsByOwner } from "@/lib/pipeline/repository"
import { writeProjectMeta } from "@/lib/project-storage"
import { createProject, deleteProject } from "@/lib/repositories/projects"
import { findUserById } from "@/lib/repositories/users"
import { isS3Configured } from "@/lib/s3-client"

export const runtime = "nodejs"

/**
 * Колонка 2 «Папок пользователей»: проекты выбранного пользователя.
 *
 * Архивные приходят вместе с остальными и помечены isArchived — админ должен их
 * видеть и понимать, что они не обрабатываются. Расшаренность не показываем:
 * проект принадлежит владельцу, а кто ещё с ним работает — не вопрос конвейера.
 *
 * А вот подарок показываем: карточка одна и та же, что в кабинете, и значок на
 * ней отвечает на первый вопрос поддержки — «почему у него тут работает
 * бесплатно и сколько это ещё продлится».
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "projects.access")
  if (auth instanceof NextResponse) return auth

  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) {
    // Пользователь не выбран — пустой список, а не ошибка: страница
    // открывается до того, как в колонке 1 что-то нажали.
    return NextResponse.json({ projects: [] })
  }

  const projects = await listPipelineProjectsByOwner(userId)

  let gifts = new Map<string, ProjectGift>()
  try {
    gifts = await listGiftsForProjects(projects.map((p) => p.id))
  } catch (error) {
    console.error("[workspaces] gift projects failed", error)
    // Не роняем колонку из-за значка: список папок нужнее.
  }

  return NextResponse.json({
    projects: projects.map((p) => ({ ...p, gift: gifts.get(p.id) ?? null })),
  })
}

const createSchema = z.object({
  // Владелец приходит в query — тем же параметром, что и в GET. Тело шлёт общая
  // рабочая область (components/account/workspace/workspace-context.tsx), она
  // одна на кабинет и админку и знает только про `{name}`; адресность у неё
  // живёт в адресе (WorkspaceSource#projectsUrl). Оставляем и поле в теле —
  // на случай прямого вызова роута.
  userId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(2000).optional(),
})

/**
 * Завести проект человеку — ступень 2 (`projects.manage`).
 *
 * Владельцем становится он, а не администратор: заводить папку «на себя» и
 * потом передавать — лишний шаг, который к тому же оставил бы след в журнале
 * переносов там, где переноса не было.
 *
 * Порядок и откат те же, что в кабинете (lib/storage/project-mutations.ts):
 * строка в базе, затем `project-meta.json` в R2, и если второе не удалось —
 * строку убираем. Проект без меты в хранилище выглядит целым в списке и пустым
 * при открытии, а это хуже, чем не создаться вовсе.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "projects.manage")
  if (auth instanceof NextResponse) return auth

  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const userId =
    request.nextUrl.searchParams.get("userId") ?? parsed.data.userId ?? null
  if (!userId) {
    // В отличие от GET здесь пустой ответ не годится: заводить проект
    // непонятно кому нельзя, а промолчать — значит соврать, что завели.
    return NextResponse.json({ message: "User is not selected." }, { status: 400 })
  }

  if (!isS3Configured()) {
    return NextResponse.json(
      { message: "Object storage is not configured." },
      { status: 503 },
    )
  }

  const owner = await findUserById(userId)
  if (!owner) {
    return NextResponse.json({ message: "User not found." }, { status: 404 })
  }

  const project = await createProject({
    ownerId: owner.id,
    name: parsed.data.name,
    description: parsed.data.description ?? "",
    groupName: "personal",
  })

  try {
    await writeProjectMeta({
      storageOwnerId: project.storageOwnerId,
      ownerId: project.ownerId,
      projectId: project.id,
      name: project.name,
      description: project.description,
      ownerEmail: owner.email,
      isArchived: project.isArchived,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    })
  } catch (error) {
    console.error("[workspaces] failed to write project-meta.json", error)
    await deleteProject(project.id, owner.id).catch((cleanupError) => {
      console.error("[workspaces] rollback after R2 failure failed", cleanupError)
    })
    return NextResponse.json(
      { message: "Object storage is temporarily unavailable." },
      { status: 503 },
    )
  }

  await auditFrom(request, auth)({
    action: "project.created",
    targetType: "project",
    targetId: project.id,
    targetLabel: project.name,
    meta: { ownerId: owner.id, ownerEmail: owner.email },
  })

  return NextResponse.json({ project }, { status: 201 })
}
