import { notFound, redirect } from "next/navigation"

import {
  HelpArticleView,
  type HelpArticleLink,
} from "@/components/help/help-article-view"
import { getCurrentUser } from "@/lib/admin-auth"
import { loadBundle } from "@/lib/help/articles"
import { canSeeTopic, findTopic } from "@/lib/help/topics"

export const dynamic = "force-dynamic"

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const { id } = await params
  const topic = findTopic(id)

  // Тема, до которой человеку не открыт интерфейс, для него не существует:
  // 404, а не «недостаточно прав» — по перебору id иначе читается карта чужих
  // разделов. Тот же ответ, что у роута шапки.
  if (!topic || !canSeeTopic(user, topic)) notFound()

  const bundle = loadBundle(topic.id)
  if (!bundle) notFound()

  // «Смотрите также» фильтруется теми же правами: ссылка на статью, которую
  // человек не откроет, — это обещание, которое интерфейс не выполнит.
  const seeAlso: HelpArticleLink[] = (topic.seeAlso ?? []).flatMap((relatedId) => {
    const related = findTopic(relatedId)
    if (!related || !canSeeTopic(user, related)) return []

    const relatedBundle = loadBundle(related.id)
    if (!relatedBundle) return []

    return [
      {
        id: related.id,
        ru: relatedBundle.ru.title,
        en: relatedBundle.en?.title ?? null,
      },
    ]
  })

  return (
    <HelpArticleView
      ru={bundle.ru}
      en={bundle.en}
      seeAlso={seeAlso}
    />
  )
}
