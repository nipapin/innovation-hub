import type { Metadata } from "next"
import { headers } from "next/headers"
import { KotliarArticle, KotliarSiteChrome } from "@/components/kotliar/site-view"
import { isKotliarRequest } from "@/lib/kotliar/host"
import {
  findKotliarPageBySlug,
  listKotliarPages,
} from "@/lib/repositories/kotliar"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const headerStore = await headers()
  if (!isKotliarRequest(headerStore)) return { title: "Not found" }
  const page = await findKotliarPageBySlug("")
  return {
    title: page?.title.trim() || "Kotliar",
    robots: { index: true, follow: true },
  }
}

export default async function KotliarHomePage() {
  const pages = await listKotliarPages()
  const page = pages.find((item) => item.slug === "") ?? null

  return (
    <KotliarSiteChrome pages={pages} currentSlug="">
      {page ? (
        <KotliarArticle title={page.title} body={page.body} />
      ) : (
        <p className="text-[#6b6860]">Страница ещё не создана.</p>
      )}
    </KotliarSiteChrome>
  )
}
