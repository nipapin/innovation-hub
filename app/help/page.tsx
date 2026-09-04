import { redirect } from "next/navigation"

import { HelpIndex, type HelpEntry } from "@/components/help/help-index"
import { getCurrentUser } from "@/lib/admin-auth"
import { loadBundle, type HelpArticle } from "@/lib/help/articles"
import { visibleTopics } from "@/lib/help/topics"

export const dynamic = "force-dynamic"

/** Из статьи в карточку едет только шапка — тела статей в индексе не нужны. */
function meta(article: HelpArticle) {
  return {
    title: article.title,
    summary: article.summary,
    tags: article.tags,
  }
}

export default async function HelpIndexPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  // Фильтрация по правам — здесь, до рендера: в браузер не должно уехать даже
  // название статьи из раздела, который человеку не открыт.
  const entries: HelpEntry[] = visibleTopics(user).flatMap((topic) => {
    const bundle = loadBundle(topic.id)
    // Тема без файла — ошибка сборки, её ловит `npm run help:check`. В рантайме
    // лучше не показать одну карточку, чем уронить весь индекс.
    if (!bundle) return []

    return [
      {
        id: topic.id,
        section: topic.section,
        audience: topic.audience,
        ru: meta(bundle.ru),
        en: bundle.en ? meta(bundle.en) : null,
      },
    ]
  })

  return <HelpIndex entries={entries} />
}
