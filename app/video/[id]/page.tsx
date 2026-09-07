import { SITE_NAME } from "@/lib/site"
import { unstable_cache } from "next/cache"
import { isEnvFeatureEnabled } from "@/lib/features-env"
import { notFound } from "next/navigation"
import {
  findPublishedVideoById,
  listRelatedPublishedVideos,
} from "@/lib/repositories/videos"
import { VideoDetailClient } from "./video-detail-client"

export const dynamic = "force-dynamic"

// Cached to keep TTFB off the (remote) database: generateMetadata + the page
// share one cached lookup instead of hitting Postgres twice per request.
// Note: the cache JSON-serializes results, so Date fields come back as
// strings — the detail view only consumes the string fields.
const getVideo = unstable_cache(
  async (id: string) => findPublishedVideoById(id),
  ["video-by-id"],
  { revalidate: 60, tags: ["published-videos"] },
)

const getRelatedVideos = unstable_cache(
  async (id: string) => listRelatedPublishedVideos(id, 3),
  ["related-videos"],
  { revalidate: 60, tags: ["published-videos"] },
)

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const video = await getVideo(id)
  if (!video) return { title: "Not Found" }
  return {
    title: `${video.title} - ${SITE_NAME}`,
    description: video.description,
  }
}

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  // Публичной части на этой установке нет — раздела не существует, а не «нет
  // доступа». Проверка сверх правила в proxy.ts: тот закрывает только корень,
  // а сюда ведут и прямые ссылки. Флаг `env`, поэтому база здесь не нужна.
  if (!isEnvFeatureEnabled("public.catalog")) notFound()

  const { id } = await params
  // listRelatedPublishedVideos already excludes `id`, so kicking it off in
  // parallel with the lookup is safe and saves a DB round-trip.
  const [video, relatedVideos] = await Promise.all([
    getVideo(id),
    getRelatedVideos(id),
  ])

  if (!video) {
    notFound()
  }

  return <VideoDetailClient video={video} relatedVideos={relatedVideos} />
}
