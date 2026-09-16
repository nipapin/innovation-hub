import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  requireProjectAccess,
  type ProjectAccessRole,
} from "@/lib/project-access"
import { canResume, setPausedReason } from "@/lib/billing/admission"
import { setProjectPaused } from "@/lib/project-automation"
import { ProjectStorageError, siteUpdatedBy } from "@/lib/project-storage"
import { updateProjectSchema } from "@/lib/project-schemas"
import { updateProject } from "@/lib/repositories/projects"
import { syncProjectMeta } from "@/lib/storage/project-catalog"
import {
  isMutationError,
  softDeleteOwnedProject,
} from "@/lib/storage/project-mutations"
import type { StorageApiAuth } from "@/lib/storage/auth"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const access = await requireProjectAccess(id, auth.userId)
  if (access instanceof NextResponse) return access
  return NextResponse.json({ project: access.project })
}

/**
 * Какой доступ нужен для этих правок.
 *
 * Пауза — настройка обработки, её ставит редактор. Имя, короткое описание и
 * архив видит вся команда проекта, включая владельца, поэтому это полный
 * доступ. Группа (раздел бокового меню) — только владелец: она вообще не про
 * работу в проекте, а про то, как владелец разложил свои папки у себя, и у
 * приглашённого проект всё равно лежит в «Расшаренных».
 */
function requiredRoleFor(
  patch: Omit<ReturnType<typeof updateProjectSchema.parse>, "isPaused">,
): ProjectAccessRole {
  if (patch.groupName !== undefined) return "owner"
  if (
    patch.name !== undefined ||
    patch.description !== undefined ||
    patch.isArchived !== undefined
  ) {
    return "full"
  }
  return "editor"
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = updateProjectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const { isPaused, ...rest } = parsed.data

  const access = await requireProjectAccess(id, auth.userId, requiredRoleFor(rest))
  if (access instanceof NextResponse) return access
  // Папка проекта лежит в префиксе владельца, а не того, кто правит: и ключи в
  // хранилище, и UPDATE по projects считаются от него.
  const ownerId = access.project.userId

  // Пауза — не обычное поле: тумблер слежения живёт и в Postgres, и в
  // options/folderState.json на R2, иначе локальная машина не узнает, что
  // пользователь поставил проект на паузу. Записью владеет setProjectPaused.
  if (isPaused !== undefined) {
    // Проект, остановленный биллингом, обратно не включается, пока платить
    // нечем. Правило живёт здесь, а не в кнопке: интерфейс — не место для
    // ограничения, которое обходится одним запросом.
    if (isPaused === false) {
      const resume = await canResume({ projectId: access.project.id, ownerId })
      if (!resume.allowed) {
        return NextResponse.json(
          {
            message:
              resume.reason === "trial-over"
                ? "Trial period is over. Top up the balance to continue."
                : resume.reason === "payer-no-funds"
                  ? "The payer is out of funds. Ask whoever pays for your work to top up."
                  : "Not enough funds to resume processing.",
            code: resume.reason,
          },
          { status: 409 },
        )
      }
      // Деньги появились — причину снимаем сами. Заставлять человека нажимать
      // что-то ещё после пополнения незачем.
      if (resume.reason) await setPausedReason(access.project.id, null)
    }

    try {
      await setProjectPaused({
        projectId: access.project.id,
        ownerId,
        storageOwnerId: access.project.storageOwnerId,
        paused: isPaused,
        updatedBy: siteUpdatedBy(auth.email),
        actorUserId: auth.userId,
      })
    } catch (error) {
      if (error instanceof ProjectStorageError) {
        return NextResponse.json({ message: error.message }, { status: 409 })
      }
      console.error("[projects] pause update failed", error)
      return NextResponse.json(
        { message: "Failed to update project pause state." },
        { status: 503 },
      )
    }
  }

  const hasOtherChanges = Object.values(rest).some((v) => v !== undefined)
  const project = hasOtherChanges
    ? await updateProject(id, ownerId, rest)
    : access.project

  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  if (
    parsed.data.name !== undefined ||
    parsed.data.description !== undefined ||
    parsed.data.isArchived !== undefined
  ) {
    await syncProjectMeta(project)
  }
  return NextResponse.json({ project })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const storageAuth: StorageApiAuth = {
    userId: auth.userId,
    email: auth.email,
    role: auth.role,
    machineTokenId: null,
    computerId: null,
    machineCompanyId: null,
    scopedProjectId: null,
    capabilities: auth.capabilities,
  }
  const result = await softDeleteOwnedProject(storageAuth, { projectId: id })
  if (result instanceof NextResponse) return result
  if (isMutationError(result)) {
    return NextResponse.json({ message: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
