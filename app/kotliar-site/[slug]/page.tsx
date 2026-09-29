import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { KotliarArticle, KotliarSiteChrome } from "@/components/kotliar/site-view"
import { isKotliarRequest } from "@/lib/kotliar/host"
import {
  findKotliarPageBySlug,
  listKotliarPages,
} from "@/lib/repositories/kotliar"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const headerStore = await headers()
  if (!isKotliarRequest(headerStore)) return { title: "Not found" }
  const { slug } = await params
  const page = await findKotliarPageBySlug(slug)
  if (!page) return { title: "Kotliar" }
  return {
    title: page.title.trim() || slug,
    robots: { index: true, follow: true },
  }
}

export default async function KotliarSlugPage({ params }: Params) {
  const { slug } = await params
  const [page, pages] = await Promise.all([
    findKotliarPageBySlug(slug),
    listKotliarPages(),
  ])
  if (!page) notFound()

  return (
    <KotliarSiteChrome pages={pages} currentSlug={slug}>
      <KotliarArticle title={page.title} body={page.body} />
    </KotliarSiteChrome>
  )
}
