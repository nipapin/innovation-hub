import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { reprocessItem } from "@/lib/pipeline/reprocess"
import { readPipelineState } from "@/lib/pipeline/state"
import { requireProjectAccess } from "@/lib/project-access"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string; fileId: string }> }

/**
 * «Обработать заново» — поставить в очередь элемент, который уже обрабатывался.
 *
 * Право правки, а не чтения: обработка стоит денег владельца проекта, и
 * читатель, приглашённый посмотреть результат, распоряжаться его кошельком не
 * должен.
 *
 * Тумблеру слежения подчинён так же, как обход: пока стоит «Стоп», задачи не
 * появляются вообще — ни по событию, ни обходом, ни отсюда. Иначе кнопка в
 * кабинете обходила бы решение, принятое на странице конвейера.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id, fileId } = await context.params
  const access = await requireProjectAccess(id, auth.userId, "editor")
  if (access instanceof NextResponse) return access

  const state = await readPipelineState()
  if (!state.isRunning) {
    return NextResponse.json({ reason: "stopped" }, { status: 409 })
  }

  const result = await reprocessItem({
    projectId: id,
    fileId,
    actorUserId: auth.userId,
  })
  if (!result.ok) {
    // Причину отдаём кодом, а не текстом: подпись человеку выбирает интерфейс,
    // и разбирать строку ради неё — гарантированное расхождение языков.
    return NextResponse.json(
      { reason: result.reason },
      { status: result.reason === "no-source" ? 404 : 409 },
    )
  }

  return NextResponse.json({ ok: true })
}
