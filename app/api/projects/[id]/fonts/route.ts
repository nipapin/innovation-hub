import { NextResponse, type NextRequest } from "next/server"

import { requireUserApi } from "@/lib/admin-auth"
import { PROJECT_FONTS_FOLDER } from "@/lib/fonts/library"
import { requireProjectAccess } from "@/lib/project-access"
import { listFilesInFolder } from "@/lib/repositories/project-files"
import { appMediaProxyPathForKey } from "@/lib/s3-config"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/** Что считаем шрифтом — тот же список, что `FONT_EXTS` в программе. */
const FONT_EXTS = ["ttf", "otf", "ttc", "woff", "woff2"]

/** Что браузер может зарегистрировать через `FontFace`, то есть показать. */
const LOADABLE_EXTS = ["ttf", "otf", "woff", "woff2"]

/**
 * Шрифты, уже лежащие в проекте (`options/fonts`) — docs/FONTS_PLAN.md §3.
 *
 * Не отдельный источник, а первый уровень витрины: сюда попадает и то, что
 * положил автор в программе (фирменный шрифт клиента, которого в нашей
 * библиотеке нет и быть не может), и то, что сайт установил при прошлом
 * сохранении.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const access = await requireProjectAccess(id, auth.userId, "viewer")
  if (access instanceof NextResponse) return access

  const rows = await listFilesInFolder(access.project.id, PROJECT_FONTS_FOLDER)
  const fonts = rows
    .filter((row) => !row.isFolder && row.s3Key)
    .map((row) => {
      const dot = row.name.lastIndexOf(".")
      const ext = dot > 0 ? row.name.slice(dot + 1).toLowerCase() : ""
      return {
        // Имя = stem файла: по нему шрифт ищет машина (`ensureProjectFont`).
        name: dot > 0 ? row.name.slice(0, dot) : row.name,
        ext,
        sizeBytes: row.sizeBytes ?? 0,
        loadable: LOADABLE_EXTS.includes(ext),
        url: `${appMediaProxyPathForKey(row.s3Key!)}?raw=1`,
      }
    })
    .filter((font) => FONT_EXTS.includes(font.ext))

  return NextResponse.json({ fonts })
}
