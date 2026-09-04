"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, ExternalLink, Info, Loader2 } from "lucide-react"

import { tf, useI18n } from "@/components/account/i18n"
import { MarkdownView } from "@/components/markdown/markdown-view"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { HelpTopicId } from "@/lib/help/topics"

type FullArticle = {
  id: string
  title: string
  updated: string
  tags: string[]
  body: string
  fallback: boolean
  seeAlso: { id: string; title: string }[]
}

/**
 * Статья справки поверх страницы.
 *
 * Модалка, а не переход на `/help/<id>`: на рабочей странице живое состояние —
 * слежение запущено, задачи раскрыты, идут тики опроса, — и уводить с неё ради
 * абзаца текста значит терять контекст, который человек только что собрал.
 * Читать справку подряд по-прежнему можно на `/help`, ссылка есть в шапке окна.
 *
 * Ссылки на соседние статьи меняют текст **на месте**: «пойти по ссылкам в
 * любое другое описание» должно работать, не закрывая окна. Перехват — на
 * контейнере, а не подменой рендерера: второго `MarkdownView` в проекте нет и
 * заводить его нельзя, иначе разъедутся типографика и санитайз.
 */
export function HelpModal({
  id,
  onClose,
}: {
  id: HelpTopicId
  onClose: () => void
}) {
  const { t, lang } = useI18n()
  // Не один id, а стек пройденного: переходы внутри окна идут мимо истории
  // браузера, и без него из статьи, открытой по ссылке, нельзя вернуться —
  // только закрыть окно и начать заново.
  const [trail, setTrail] = useState<string[]>([id])
  const [article, setArticle] = useState<FullArticle | null>(null)
  const [failed, setFailed] = useState(false)

  const current = trail[trail.length - 1]!
  const goTo = useCallback((next: string) => setTrail((prev) => [...prev, next]), [])
  const goBack = useCallback(() => setTrail((prev) => prev.slice(0, -1)), [])

  useEffect(() => {
    let cancelled = false
    setArticle(null)
    setFailed(false)

    void (async () => {
      try {
        const res = await fetch(`/api/help/${current}?lang=${lang}&full=1`)
        if (cancelled) return
        if (!res.ok) {
          setFailed(true)
          return
        }
        setArticle((await res.json()) as FullArticle)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [current, lang])

  /** Клик по внутренней ссылке — смена статьи, а не уход со страницы. */
  const onBodyClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // Клик с модификатором — осознанное «открыть в новой вкладке», не мешаем.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return
    }

    const link = (event.target as HTMLElement).closest("a")
    const href = link?.getAttribute("href")
    if (!href?.startsWith("/help/")) return

    event.preventDefault()
    goTo(href.slice("/help/".length))
  }, [goTo])

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[85vh] w-full max-w-[760px] flex-col gap-0 overflow-hidden border-white/10 bg-ws-panel p-0"
      >
        <DialogHeader className="shrink-0 space-y-0 border-b border-white/[0.07] px-6 py-4 pr-14 text-left">
          <div className="flex items-center gap-2.5">
            {/* Возврат по пройденному пути. Появляется только когда есть куда
                возвращаться: кнопка, которая иногда ничего не делает, хуже её
                отсутствия. */}
            {trail.length > 1 ? (
              <button
                type="button"
                onClick={goBack}
                aria-label={t.helpBackPrev}
                title={t.helpBackPrev}
                className="-ml-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-ws-3 hover:bg-white/5 hover:text-ws-1"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : null}
            <DialogTitle className="text-[17px] font-semibold text-ws-1">
              {article?.title ?? t.helpTitle}
            </DialogTitle>
          </div>
          {article ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ws-5">
              {article.updated ? (
                <span>{tf(t.helpUpdated, { date: article.updated })}</span>
              ) : null}
              <a
                href={`/help/${article.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-ws-action hover:underline"
              >
                {t.helpOpenFull}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ) : null}
        </DialogHeader>

        {/* Скролл живёт здесь: шапка и её ссылки должны оставаться на месте,
            пока читают длинную статью (контракт §8.2). */}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-elegant px-6 py-5">
          {failed ? (
            <p className="text-[13px] text-ws-4">{t.helpUnavailable}</p>
          ) : !article ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-ws-4" />
            </div>
          ) : (
            <>
              {article.fallback ? (
                <p className="mb-4 flex items-start gap-2 rounded-[11px] border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-[12.5px] text-ws-4">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  {t.helpFallbackNote}
                </p>
              ) : null}

              <div onClick={onBodyClick}>
                <MarkdownView ownContent className="text-[14px]">
                  {article.body}
                </MarkdownView>
              </div>

              {article.seeAlso.length > 0 ? (
                <section className="mt-8 border-t border-white/[0.07] pt-4">
                  <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ws-5">
                    {t.helpSeeAlso}
                  </h2>
                  <ul className="flex flex-col gap-1.5">
                    {article.seeAlso.map((link) => (
                      <li key={link.id}>
                        <button
                          type="button"
                          onClick={() => goTo(link.id)}
                          className="text-[13.5px] text-ws-action hover:underline"
                        >
                          {link.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
