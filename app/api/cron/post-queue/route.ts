import { NextResponse, type NextRequest } from "next/server"

import { requireUserApi } from "@/lib/admin-auth"
import { isElevated } from "@/lib/admin-roles"
import { drainPostQueue } from "@/lib/posting/publish"
import { isScanDue, runPostScan } from "@/lib/posting/scan"

export const runtime = "nodejs"

/**
 * Тик автопостинга: обойти папки-источники и продвинуть очередь.
 *
 * Отдельный роут, а не довесок к `storage-jobs`: там уборка мусора, здесь
 * публикация от чужого имени, и смешивать их расписания нельзя — вычистить
 * корзину можно раз в час, а темп публикаций задают сами маршруты.
 *
 * Долгая заливка не должна жить в обычном HTTP-хендлере, но короткого пути тут
 * нет: воркера у сайта нет, и cron — это и есть его рабочий цикл (тот же приём,
 * что у `storage-jobs`). Поэтому за тик берётся ОДНА задача.
 *
 * Авторизация: `Bearer $CRON_SECRET` для расписания либо сессия админа — чтобы
 * тик можно было дать руками с пульта, не заводя секрет в браузере.
 */
async function authorize(request: NextRequest): Promise<NextResponse | null> {
  const secret = process.env.CRON_SECRET?.trim()
  const bearer = request.headers.get("authorization")
  if (secret && bearer === `Bearer ${secret}`) return null

  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  if (!isElevated(auth.role)) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 })
  }
  return null
}

export async function POST(request: NextRequest) {
  const denied = await authorize(request)
  if (denied) return denied

  // Сначала обход, потом дренаж: задача, поставленная этим же тиком, уедет
  // сразу, а не будет ждать следующего. Для интервала в пять минут это разница
  // между «опубликовалось вовремя» и «опубликовалось с опозданием на такт».
  const scan = (await isScanDue()) ? await runPostScan() : null
  const drain = await drainPostQueue(1)

  return NextResponse.json({
    ok: true,
    scanned: scan !== null,
    created: scan?.created ?? 0,
    ...drain,
  })
}
