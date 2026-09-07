import { NextResponse, type NextRequest } from "next/server"
import { isEnvFeatureEnabled } from "@/lib/features-env"
import {
  decodeVideoCursor,
  listPublishedVideosPaginated,
} from "@/lib/repositories/videos"
import type { VideoCardItem } from "@/lib/content-types"
import { PUBLISHED_VIDEOS_PAGE_SIZE } from "@/lib/videos-pagination"

export const runtime = "nodejs"

function toCardItem(video: {
  id: string
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  tags: string[]
  category: string
}): VideoCardItem {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    thumbnail: video.thumbnail,
    videoUrl: video.videoUrl,
    duration: video.duration,
    tags: video.tags,
    category: video.category,
  }
}

export async function GET(request: NextRequest) {
  // Страницы этого раздела на установке нет — не должно быть и данных: живой
  // роут отдавал бы содержимое того, чего на сайте не существует.
  if (!isEnvFeatureEnabled("public.catalog")) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  const params = request.nextUrl.searchParams
  const limitRaw = params.get("limit")
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : PUBLISHED_VIDEOS_PAGE_SIZE
  const cursor = decodeVideoCursor(params.get("cursor"))
  const tagsParam = params.get("tags")
  const tags = tagsParam
    ? tagsParam
        .split(",")
        .map((tag) => decodeURIComponent(tag.trim()))
        .filter(Boolean)
    : []
  const q = params.get("q") ?? undefined
  const all = params.get("all") === "1"

  try {
    if (all) {
      const { listPublishedVideos } = await import("@/lib/repositories/videos")
      const items = (await listPublishedVideos()).map(toCardItem)
      return NextResponse.json({ items, nextCursor: null })
    }

    const result = await listPublishedVideosPaginated({
      limit: Number.isFinite(limit) ? limit : PUBLISHED_VIDEOS_PAGE_SIZE,
      cursor,
      tags: tags.length > 0 ? tags : undefined,
      q,
    })

    return NextResponse.json({
      items: result.items.map(toCardItem),
      nextCursor: result.nextCursor,
    })
  } catch (error) {
    console.error("[api/videos] GET", error)
    return NextResponse.json(
      { message: "Could not load videos." },
      { status: 500 },
    )
  }
}
