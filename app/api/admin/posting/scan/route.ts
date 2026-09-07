import { NextResponse, type NextRequest } from "next/server"

import { requireAdminApi } from "@/lib/admin-auth"
import { readPostScanState } from "@/lib/posting/repository"
import { runPostScan } from "@/lib/posting/scan"

export const runtime = "nodejs"
export const maxDuration = 300

/**
 * Разовый обход по кнопке: пройти маршруты и, если попросили, сразу
 * опубликовать созревшее.
 *
 * Обход отдаёт ОТЧЁТ ПО МАРШРУТАМ — почему каждый не дал задачу. Это главная
 * ценность кнопки: вопрос «файл лежит, а публикации нет» задают, глядя на
 * очередь, и ответ на него должен быть здесь, а не в логах сервера.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "posting.operate")
  if (auth instanceof NextResponse) return auth

  // Обход подчинён тумблеру так же, как обход IN у конвейера: пока стоит
  // «Стоп», задачи не появляются — иначе кнопка обходила бы решение, принятое
  // на самой странице.
  const state = await readPostScanState()
  if (!state.isRunning) {
    return NextResponse.json(
      { message: "Posting is stopped — start it first." },
      { status: 409 },
    )
  }

  // Публикацию отсюда не запускаем: обход отвечает на вопрос «что созрело», а
  // заливка — работа тика (`/api/cron/post-queue`). Кнопка, которая делает и то
  // и другое, однажды выложила бы пост, пока человек просто смотрел отчёт.
  return NextResponse.json(await runPostScan())
}
