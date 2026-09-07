import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import {
  countTeamUnreadTotal,
  listAdminChats,
} from "@/lib/repositories/project-chat"

export const runtime = "nodejs"

/** Сколько строк отдаём за раз. Столько же добирает кнопка «Показать ещё». */
const PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

/**
 * Длина куска последнего сообщения в строке списка. Строка — это подпись «чем
 * разговор закончился», а не сам разговор: целиком его читают в проекте.
 */
const PREVIEW_LENGTH = 180

/**
 * Раздел «Чаты»: все переписки сайта одним списком, свежие сверху.
 *
 * Зачем он есть. До него, чтобы открыть чат, надо было ЗАРАНЕЕ знать, кто
 * написал и в каком проекте: рабочая область спрашивает сначала пользователя,
 * потом его проект. Пришедшее сообщение на сайте не было видно вообще ниоткуда
 * — узнавали о нём в YouGile и туда же отвечали.
 *
 * Поиск идёт по базе, а не по загруженной странице: искать в двадцати строках,
 * которые и так на экране, незачем — смысл ровно в том, чтобы найти проект,
 * уехавший вниз за давностью.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "projects.access")
  if (auth instanceof NextResponse) return auth

  const params = request.nextUrl.searchParams
  const search = (params.get("q") ?? "").slice(0, 200)
  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0)
  const requested = Number(params.get("limit") ?? PAGE_SIZE) || PAGE_SIZE
  const limit = Math.min(Math.max(1, requested), MAX_PAGE_SIZE)

  // Берём на строку больше запрошенного: так «есть ли ещё» отвечается тем же
  // запросом, без второго — COUNT(*) по всем проектам ради одной кнопки.
  //
  // Общее число непрочитанных считается отдельно и НЕ по загруженным строкам:
  // ждущий ответа чат может лежать и на третьей странице, и под фильтром
  // поиска, а подпись «ждут ответа» обязана совпадать со значком в меню.
  const [rows, unreadTotal] = await Promise.all([
    listAdminChats({ search, limit: limit + 1, offset }),
    countTeamUnreadTotal(),
  ])
  const hasMore = rows.length > limit

  const chats = rows.slice(0, limit).map((row) => ({
    projectId: row.projectId,
    projectName: row.projectName,
    ownerId: row.ownerId,
    ownerEmail: row.ownerEmail,
    ownerName: row.ownerName,
    isArchived: row.isArchived,
    unreadCount: row.unreadCount,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    lastMessageBody:
      row.lastMessageBody == null
        ? null
        : row.lastMessageBody.slice(0, PREVIEW_LENGTH),
    lastMessageSenderType: row.lastMessageSenderType,
    lastMessageSenderName: row.lastMessageSenderName,
  }))

  return NextResponse.json({ chats, hasMore, unreadTotal })
}
