import { NextResponse, type NextRequest } from "next/server"

import { requireUserApi } from "@/lib/admin-auth"
import { FONT_CATALOG, isHeavyFamily } from "@/lib/fonts/catalog"
import { listLibraryFamilies } from "@/lib/fonts/library"

export const runtime = "nodejs"

/**
 * Витрина шрифтов — docs/FONTS_PLAN.md §3.
 *
 * Список семейств отдаётся целиком: он отобран вручную и короткий. `inLibrary`
 * — не право выбора, а скорость: семейство без байтов в бакете выбрать можно,
 * просто первое превью придёт на секунду позже, пока файл едет с Google.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  let library = new Set<string>()
  try {
    library = await listLibraryFamilies()
  } catch (error) {
    // Бакет недоступен — витрину всё равно показываем: выбор шрифта не должен
    // пропадать из-за того, что мы не смогли перечислить уже скачанное.
    console.warn("[fonts] library listing failed", error)
  }

  return NextResponse.json({
    fonts: FONT_CATALOG.map((entry) => ({
      family: entry.family,
      group: entry.group,
      scripts: entry.scripts,
      bold: entry.bold,
      italic: entry.italic,
      replaces: entry.replaces ?? null,
      heavy: isHeavyFamily(entry),
      inLibrary: library.has(entry.family),
    })),
  })
}
