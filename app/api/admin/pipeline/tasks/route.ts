import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { restoreTaskSource } from "@/lib/pipeline/quarantine"
import {
  cancelPipelineTask,
  countPipelineTasksByStatus,
  deletePipelineTask,
  listPipelineTaskZones,
} from "@/lib/pipeline/tasks"

export const runtime = "nodejs"

/**
 * Снимок для окна очереди: две зоны и счётчики по состояниям.
 *
 * Один и тот же снимок отдают все три метода — окно после снятия или удаления
 * задачи получает готовый список и не перезапрашивает его вторым кругом.
 */
async function queueSnapshot() {
  const [zones, counts] = await Promise.all([
    listPipelineTaskZones(),
    countPipelineTasksByStatus(),
  ])
  return { ...zones, counts }
}

/** Очередь задач: что нашлось, кто взял, в каком состоянии. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  return NextResponse.json(await queueSnapshot())
}

const taskIdSchema = z.object({ taskId: z.string().min(1) })

/**
 * Снять задачу — пометить `failed` с причиной «снята администратором».
 *
 * Именно снять, а не удалить: удаление строки вернуло бы элемент в поле зрения
 * страховочного обхода, и задача по тому же файлу появилась бы снова. Для этого
 * есть отдельный DELETE ниже — там это осознанный выбор.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  const body = await request.json().catch(() => null)
  const parsed = taskIdSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid input." }, { status: 400 })
  }

  const cancelled = await cancelPipelineTask({
    taskId: parsed.data.taskId,
    reason: `Снята администратором (${auth.email ?? auth.userId}).`,
  })
  if (!cancelled) {
    return NextResponse.json(
      { message: "Task not found or already failed." },
      { status: 404 },
    )
  }

  return NextResponse.json(await queueSnapshot())
}

/**
 * Вернуть исходник упавшей задачи из папки ошибок обратно в IN.
 *
 * Строку задачи не трогаем — она остаётся упавшей, это история. Новую заведёт
 * событийная линия: перенос в IN журналируется как `move` с ключом внутри IN, и
 * сканер подберёт его на ближайшем тике. Обход бы не помог, для него этот ключ
 * «известен».
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  const body = await request.json().catch(() => null)
  const parsed = taskIdSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid input." }, { status: 400 })
  }

  const restored = await restoreTaskSource(parsed.data.taskId)
  if (!restored.ok) {
    const message =
      restored.reason === "no-source"
        ? "Source file is gone — nothing to restore."
        : restored.reason === "not-quarantined"
          ? "Source is not marked — nothing to restore."
          : "Task not found."
    return NextResponse.json(
      { message },
      { status: restored.reason === "no-task" ? 404 : 409 },
    )
  }

  return NextResponse.json(await queueSnapshot())
}

/**
 * Удалить строку задачи насовсем.
 *
 * Последствие называем прямо, потому что оно неочевидно: если элемент всё ещё
 * лежит в папке IN, обход перестанет считать его известным и заведёт задачу
 * заново. Это и есть смысл удаления — «забудь и найди с нуля».
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  const taskId = request.nextUrl.searchParams.get("taskId")
  if (!taskId) {
    return NextResponse.json({ message: "taskId is required." }, { status: 400 })
  }

  const deleted = await deletePipelineTask(taskId)
  if (!deleted) {
    return NextResponse.json({ message: "Task not found." }, { status: 404 })
  }

  return NextResponse.json(await queueSnapshot())
}
