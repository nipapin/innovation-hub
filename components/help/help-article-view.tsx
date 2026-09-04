"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Info } from "lucide-react"

import { tf, useI18n } from "@/components/account/i18n"
import { MarkdownView } from "@/components/markdown/markdown-view"
import type { HelpArticle } from "@/lib/help/articles"

export type HelpArticleLink = {
  id: string
  ru: string
  /** null — перевода заголовка нет, показываем русский. */
  en: string | null
}

/**
 * Страница статьи.
 *
 * Обе языковые версии приходят с сервера, выбор делает браузер: язык лежит в
 * `localStorage`, серверу он не виден (см. `loadBundle`).
 *
 * Текст рисуется тем же `MarkdownView`, что и описания проектов, — второго
 * рендерера в проекте нет и заводить его не нужно: разъедутся типографика,
 * таблицы и санитайз. Разница — флаг `ownContent`: текст наш, поэтому ссылки
 * между статьями остаются в этой же вкладке, а картинке разрешён путь от корня
 * сайта.
 */
export function HelpArticleView({
  ru,
  en,
  seeAlso,
}: {
  ru: HelpArticle
  en: HelpArticle | null
  seeAlso: HelpArticleLink[]
}) {
  const { t, lang } = useI18n()
  const router = useRouter()
  const article = lang === "en" && en ? en : ru
  const untranslated = lang === "en" && !en

  // Возврат к предыдущей статье. Считается на клиенте и после монтирования:
  // на сервере истории нет, а `history.length === 1` значит, что вкладку
  // открыли прямо здесь — из поповера «?» или по прямой ссылке, и возвращаться
  // некуда. Кнопка, которая иногда ничего не делает, хуже её отсутствия.
  const [canGoBack, setCanGoBack] = useState(false)
  useEffect(() => setCanGoBack(window.history.length > 1), [])

  return (
    <article>
      {canGoBack ? (
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ws-4 transition-colors hover:text-ws-2"
        >
          <ArrowLeft className="h-4 w-4" />
          {t.helpBackPrev}
        </button>
      ) : null}

      <h1 className="text-[26px] font-semibold leading-tight text-ws-1">
        {article.title}
      </h1>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-ws-5">
        {article.updated ? (
          <span>{tf(t.helpUpdated, { date: article.updated })}</span>
        ) : null}
        {article.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-white/[0.05] px-2 py-0.5">
            {tag}
          </span>
        ))}
      </div>

      {untranslated ? (
        <p className="mt-5 flex items-start gap-2 rounded-[11px] border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-[12.5px] text-ws-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {t.helpFallbackNote}
        </p>
      ) : null}

      <MarkdownView ownContent className="mt-6 text-[14.5px]">
        {article.body}
      </MarkdownView>

      {seeAlso.length > 0 ? (
        <section className="mt-10 border-t border-white/[0.07] pt-5">
          <h2 className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ws-5">
            {t.helpSeeAlso}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {seeAlso.map((link) => (
              <li key={link.id}>
                <Link
                  href={`/help/${link.id}`}
                  className="text-[13.5px] text-ws-action hover:underline"
                >
                  {lang === "en" && link.en ? link.en : link.ru}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  )
}
