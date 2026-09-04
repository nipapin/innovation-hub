import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { loadArticle, type HelpLang } from "@/lib/help/articles"
import { canSeeTopic, findTopic } from "@/lib/help/topics"

export const runtime = "nodejs"

/**
 * Статья справки для клиентских поверхностей: поповера у знака «?»
 * (`<HelpDot>`) и модалки раздела (`<HelpModal>`).
 *
 * Два режима, потому что нужды разные: поповеру хватает заголовка и фразы,
 * модалке нужно тело и соседние темы. `?full=1` — второй режим; без него
 * тело не отдаётся, чтобы открытие поповера не тянуло по килобайту текста на
 * каждый знак «?» в диалоге.
 *
 * Роут вообще нужен потому, что доступ к теме проверяется на сервере. Разложи
 * статьи по клиентским модулям — и «скрытая» часть справки читалась бы из
 * devtools любым вошедшим, а гейт превратился бы в украшение.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const topic = findTopic(id)
  if (!topic) {
    return NextResponse.json({ message: "Unknown help topic." }, { status: 404 })
  }

  // Темы, до которых человеку не открыт интерфейс, для него не существуют:
  // 404, а не 403 — иначе перебором id можно вычитать карту чужих разделов.
  if (!canSeeTopic(auth, topic)) {
    return NextResponse.json({ message: "Unknown help topic." }, { status: 404 })
  }

  const lang: HelpLang =
    request.nextUrl.searchParams.get("lang") === "en" ? "en" : "ru"
  const article = loadArticle(topic.id, lang)
  if (!article) {
    return NextResponse.json({ message: "Article is missing." }, { status: 404 })
  }

  const head = {
    id: article.id,
    title: article.title,
    summary: article.summary,
    fallback: article.fallback,
  }

  if (request.nextUrl.searchParams.get("full") !== "1") {
    return NextResponse.json(head)
  }

  // «Смотрите также» фильтруется теми же правами, что и сама тема: ссылка на
  // статью, которую человек не откроет, — обещание, которое интерфейс не
  // выполнит. Та же логика, что на странице статьи.
  const seeAlso = (topic.seeAlso ?? []).flatMap((relatedId) => {
    const related = findTopic(relatedId)
    if (!related || !canSeeTopic(auth, related)) return []

    const relatedArticle = loadArticle(related.id, lang)
    return relatedArticle
      ? [{ id: related.id, title: relatedArticle.title }]
      : []
  })

  return NextResponse.json({
    ...head,
    updated: article.updated,
    tags: article.tags,
    body: article.body,
    seeAlso,
  })
}
