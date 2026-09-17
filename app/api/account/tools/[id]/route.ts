import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  deleteUserTool,
  updateUserTool,
} from "@/lib/repositories/user-tools"
import { updateToolSchema } from "@/lib/tool-schemas"
import { findLiveUserTool } from "@/lib/tool-instance-gate"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/** Правка экземпляра: имя, настройки, подключённый источник, порядок, отметка открытия. */
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

  const parsed = updateToolSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  // Отдельной проверкой ПЕРЕД правкой: правка идёт одним запросом в базу и сама
  // экземпляр не читает, поэтому подменить здесь было нечего — гвард пришлось
  // ставить явно (§2.5).
  if (!(await findLiveUserTool(id, auth.userId))) {
    return NextResponse.json({ message: "Tool not found." }, { status: 404 })
  }

  const tool = await updateUserTool(id, auth.userId, parsed.data)
  if (!tool) return NextResponse.json({ message: "Tool not found." }, { status: 404 })
  return NextResponse.json({ tool })
}

/** Убрать инструмент у пользователя. Мягкое удаление: настройки не теряются. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  // Удаление тоже под гвардом, хотя оно ничего не открывает: экземпляр
  // непроданного инструмента и так не виден в списке, убирать его человеку
  // неоткуда, а исключение «здесь можно» — первая трещина в правиле, ради
  // которого гвард и заводился.
  const existing = await findLiveUserTool(id, auth.userId)
  if (!existing) return NextResponse.json({ message: "Tool not found." }, { status: 404 })

  await deleteUserTool(id, auth.userId)
  return NextResponse.json({ ok: true })
}
