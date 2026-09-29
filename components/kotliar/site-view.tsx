import Link from "next/link"
import { kotliarMarkdownToHtml } from "@/lib/kotliar/markdown"
import { kotliarPagePublicPath } from "@/lib/kotliar/owner"
import type { KotliarPage } from "@/lib/repositories/kotliar"
import { cn } from "@/lib/utils"

export function KotliarSiteChrome({
  pages,
  currentSlug,
  children,
}: {
  pages: Pick<KotliarPage, "id" | "slug" | "title">[]
  currentSlug: string
  children: React.ReactNode
}) {
  const showNav = pages.length > 1

  return (
    <div
      data-theme="light"
      className="kotliar-site min-h-screen bg-[#f7f5f0] text-[#1c1b18]"
    >
      {showNav ? (
        <header className="border-b border-black/8">
          <nav className="mx-auto flex max-w-[42rem] flex-wrap gap-x-5 gap-y-2 px-5 py-4 text-[15px]">
            {pages.map((page) => {
              const href = kotliarPagePublicPath(page.slug)
              const active = page.slug === currentSlug
              const label = page.title.trim() || (page.slug ? page.slug : "Home")
              return (
                <Link
                  key={page.id}
                  href={href}
                  className={cn(
                    "underline-offset-4 hover:underline",
                    active ? "font-semibold text-[#1c1b18]" : "text-[#4a4843]",
                  )}
                >
                  {label}
                </Link>
              )
            })}
          </nav>
        </header>
      ) : null}
      <main className="mx-auto max-w-[42rem] px-5 py-10 sm:py-14">{children}</main>
    </div>
  )
}

export function KotliarArticle({
  title,
  body,
}: {
  title: string
  body: string
}) {
  const html = kotliarMarkdownToHtml(body)
  return (
    <article>
      {title.trim() ? (
        <h1 className="mb-8 text-[1.85rem] font-semibold tracking-tight text-[#1c1b18] sm:text-[2.15rem]">
          {title.trim()}
        </h1>
      ) : null}
      {body.trim() ? (
        <div
          className="md-body"
          style={{ "--md-measure": "100%" } as React.CSSProperties}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : null}
    </article>
  )
}
