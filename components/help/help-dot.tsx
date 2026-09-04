"use client"

import { useCallback, useState } from "react"
import { HelpCircle, Loader2 } from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { HelpTopicId } from "@/lib/help/topics"
import { cn } from "@/lib/utils"

/**
 * Знак «?» рядом с параметром: короткое объяснение в поповере и ссылка на
 * полную статью.
 *
 * `id` типизирован реестром (`HelpTopicId`), поэтому опечатка в теме не
 * собирается. Проверку «у якоря есть статья, у статьи есть якорь» делает
 * `npm run help:check` — docs/HELP_SYSTEM.md §4.
 *
 * Текст тянется с сервера при первом открытии, а не лежит в бандле: доступ к
 * теме проверяется на сервере, и статьи чужих разделов не должны приезжать в
 * браузер вообще. Заодно поповер ничего не стоит, пока его не открыли.
 */
export function HelpDot({
  id,
  className,
  align = "start",
}: {
  id: HelpTopicId
  className?: string
  align?: "start" | "center" | "end"
}) {
  const { t, lang } = useI18n()
  const [article, setArticle] = useState<{
    title: string
    summary: string
  } | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (open: boolean) => {
      if (!open || article || loading) return
      setLoading(true)
      try {
        const res = await fetch(`/api/help/${id}?lang=${lang}`)
        if (!res.ok) {
          setFailed(true)
          return
        }
        const data = await res.json()
        setArticle({ title: data.title, summary: data.summary })
        setFailed(false)
      } catch {
        setFailed(true)
      } finally {
        setLoading(false)
      }
    },
    [article, id, lang, loading],
  )

  return (
    <Popover onOpenChange={load}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t.helpOpen}
          className={cn(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-ws-4 transition-colors hover:text-ws-2",
            className,
          )}
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align={align}
        className="w-[320px] border-white/[0.09] bg-ws-panel p-3.5 shadow-ws-menu"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-ws-4" />
        ) : failed ? (
          <p className="text-[12.5px] text-ws-4">{t.helpUnavailable}</p>
        ) : article ? (
          <>
            <p className="mb-1.5 text-[13px] font-semibold text-ws-1">
              {article.title}
            </p>
            <p className="text-[12.5px] leading-relaxed text-ws-3">
              {article.summary}
            </p>
            {/* Новая вкладка обязательно: якорь часто стоит в модалке с
                несохранёнными правками (те же словари), и уход по ссылке в
                этой же вкладке стоил бы человеку работы. */}
            <a
              href={`/help/${id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2.5 inline-block text-[12.5px] text-ws-action hover:underline"
            >
              {t.helpMore} →
            </a>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
