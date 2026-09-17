import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  createUserTool,
  listUserTools,
} from "@/lib/repositories/user-tools"
import { createToolSchema } from "@/lib/tool-schemas"
import { enabledToolKeys } from "@/lib/features-state"
import { readCompanyFeatures } from "@/lib/company-features"
import { findCompanyFeaturesForUser } from "@/lib/repositories/companies"
import { findTool } from "@/lib/tools/registry"

export const runtime = "nodejs"

/** Инструменты, которые пользователь добавил себе. */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  // Каталог сужается набором, проданным компании этого человека
  // (docs/COMPANY_SETUP_PANEL_PLAN.md §2). Вне компании набора нет, и `null`
  // не сужает ничего.
  const features = readCompanyFeatures(
    await findCompanyFeaturesForUser(auth.userId),
  )
  const [tools, catalog] = await Promise.all([
    listUserTools(auth.userId),
    enabledToolKeys(features.companyTools),
  ])
  // Экземпляры погашенного инструмента не отдаются, но и не удаляются: строки
  // в `user_tools` остаются с настройками и привязкой к папке. Включили обратно
  // — человек находит своё рабочее место таким, каким оставил.
  const visible = tools.filter((tool) => catalog.includes(tool.toolKey))
  return NextResponse.json({ tools: visible, catalog })
}

/** Добавить инструмент из каталога. */
export async function POST(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = createToolSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const definition = findTool(parsed.data.toolKey)
  if (!definition) {
    return NextResponse.json({ message: "Unknown tool." }, { status: 404 })
  }
  // Инструмент со статусом `soon` в каталоге видно, но добавить нельзя:
  // страница это уже не даёт, а роут не должен верить странице.
  if (definition.status !== "ready") {
    return NextResponse.json({ message: "Tool is not available yet." }, { status: 409 })
  }

  // На этой установке инструмента нет вовсе — это 404, а не «пока нельзя»:
  // «ещё не готов» и «здесь такого не бывает» — разные ответы. Проверка на
  // сервере обязательна: каталог в браузере его уже не показывает, но роут не
  // должен верить странице.
  const features = readCompanyFeatures(
    await findCompanyFeaturesForUser(auth.userId),
  )
  if (!(await enabledToolKeys(features.companyTools)).includes(definition.key)) {
    return NextResponse.json({ message: "Unknown tool." }, { status: 404 })
  }

  const tool = await createUserTool({
    userId: auth.userId,
    toolKey: definition.key,
    defaults: definition.defaults,
  })
  return NextResponse.json({ tool }, { status: 201 })
}
