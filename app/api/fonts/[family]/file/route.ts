import { NextResponse, type NextRequest } from "next/server"

import { requireUserApi } from "@/lib/admin-auth"
import { facesOf, type FontFaceId } from "@/lib/fonts/catalog"
import {
  assertFamilyName,
  ensureFamilyInLibrary,
  faceKey,
  readFaceBytes,
} from "@/lib/fonts/library"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ family: string }> }

/**
 * Байты начертания для превью — docs/FONTS_PLAN.md §6.
 *
 * Отдаём тот САМЫЙ файл, который поедет в проект, а не похожий: превью,
 * нарисованное другим файлом, обещает картинку, которой не будет.
 *
 * Стрим через Next, а не редирект на подписанную ссылку: шрифт грузится через
 * `FontFace`, а это запрос с проверкой источника — редирект в R2 потребовал бы
 * CORS на бакете. Файл неизменяемый (у Google в ссылке версия), поэтому кеш
 * годовой: второй раз это же начертание не поедет.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { family: raw } = await context.params
  const family = decodeURIComponent(raw)

  let entry
  try {
    entry = assertFamilyName(family)
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unknown font." },
      { status: 404 },
    )
  }

  const requested = request.nextUrl.searchParams.get("face") as FontFaceId | null
  const faces = facesOf(entry)
  const face = faces.find((item) => item.id === (requested ?? "regular")) ?? faces[0]!

  try {
    await ensureFamilyInLibrary(family)
    const bytes = await readFaceBytes(faceKey(family, face.stem))
    if (!bytes) {
      return NextResponse.json({ message: "Font face is missing." }, { status: 404 })
    }
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "font/ttf",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    })
  } catch (error) {
    console.error(`[fonts] face "${family}" could not be served`, error)
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Could not load the font.",
      },
      { status: 503 },
    )
  }
}
