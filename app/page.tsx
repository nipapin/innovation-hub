import { notFound } from "next/navigation"
import { isEnvFeatureEnabled } from "@/lib/features-env"
import { unstable_cache } from "next/cache"
import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { AboutShowreel } from "@/components/about-showreel"
import { VideoGridInfinite } from "@/components/videos/video-grid-infinite"
import type { VideoCardItem } from "@/lib/content-types"
import { listPublishedVideosPaginated } from "@/lib/repositories/videos"
import { PUBLISHED_VIDEOS_PAGE_SIZE } from "@/lib/videos-pagination"

export const dynamic = "force-dynamic"

// The first catalog page is identical for every visitor, so serve it from
// the data cache instead of hitting the (remote) database on each request —
// that DB round-trip used to dominate the home page TTFB. Admin mutations
// call revalidateTag("published-videos") for instant invalidation; the
// 60s revalidate is just a safety net.
const getCachedFirstPage = unstable_cache(
  async (tags: string[] | undefined, q: string | undefined) =>
    listPublishedVideosPaginated({
      limit: PUBLISHED_VIDEOS_PAGE_SIZE,
      tags,
      q,
    }),
  ["published-videos-first-page"],
  { revalidate: 60, tags: ["published-videos"] },
)

type HomePageProps = {
  searchParams?: Promise<{
    tags?: string | string[]
    tag?: string | string[]
    q?: string | string[]
  }>
}

function mapToCard(video: {
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

export default async function Home({ searchParams }: HomePageProps) {
  // Публичной части на этой установке нет — раздела не существует, а не «нет
  // доступа». Проверка сверх правила в proxy.ts: тот закрывает только корень,
  // а сюда ведут и прямые ссылки. Флаг `env`, поэтому база здесь не нужна.
  if (!isEnvFeatureEnabled("public.catalog")) notFound()

  const params = searchParams ? await searchParams : {}
  const rawTags = params?.tags
  const rawTag = params?.tag
  const selectedTagsParam = Array.isArray(rawTags) ? rawTags[0] : rawTags
  const selectedTag = Array.isArray(rawTag) ? rawTag[0] : rawTag
  const selectedTags = selectedTagsParam
    ? selectedTagsParam
        .split(",")
        .map((tag) => decodeURIComponent(tag.trim()))
        .filter(Boolean)
    : selectedTag
      ? [decodeURIComponent(selectedTag.trim())].filter(Boolean)
      : []
  const rawQuery = params?.q
  const selectedQuery = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery ?? ""

  const { items, nextCursor } = await getCachedFirstPage(
    selectedTags.length > 0 ? selectedTags : undefined,
    selectedQuery || undefined,
  )

  const initialVideos = items.map(mapToCard)

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <div className="section-shell section-space pb-0">
          <AboutShowreel />
          {/* TODO(Vanya): add intro copy here */}
        </div>
        <VideoGridInfinite
          initialVideos={initialVideos}
          initialNextCursor={nextCursor}
          initialTags={selectedTags}
          initialQuery={selectedQuery}
        />
      </main>
      <FooterSection />
    </div>
  )
}
