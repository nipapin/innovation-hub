import { NextResponse } from "next/server"
import { isEnvFeatureEnabled } from "@/lib/features-env"
import { listPublishedVideoTagCounts } from "@/lib/repositories/videos"

export const runtime = "nodejs"

export async function GET() {
  // Страницы этого раздела на установке нет — не должно быть и данных: живой
  // роут отдавал бы содержимое того, чего на сайте не существует.
  if (!isEnvFeatureEnabled("public.catalog")) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  try {
    const tags = await listPublishedVideoTagCounts()
    return NextResponse.json({ tags })
  } catch (error) {
    console.error("[api/videos/tags] GET", error)
    return NextResponse.json(
      { message: "Could not load tags." },
      { status: 500 },
    )
  }
}
