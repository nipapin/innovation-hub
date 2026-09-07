"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Search } from "lucide-react"
import { toast } from "sonner"

import { useI18n, type Lang } from "@/components/account/i18n"
import { CHAT_READ_EVENT } from "@/components/account/workspace/workspace-context"
import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import { cn } from "@/lib/utils"

/** Сколько строк даёт первая загрузка и каждая «Показать ещё». */
const PAGE_SIZE = 20
const POLL_INTERVAL_MS = 30_000
const SEARCH_DEBOUNCE_MS = 300

export type AdminChatDto = {
  projectId: string
  projectName: string
  ownerId: string
  ownerEmail: string
  ownerName: string
  isArchived: boolean
  unreadCount: number
  lastMessageAt: string | null
  lastMessageBody: string | null
  lastMessageSenderType: "client" | "team" | "system" | null
  lastMessageSenderName: string | null
}

/** Сегодняшнее — временем, прежнее — датой: в списке важно «когда», а не «во сколько». */
function formatWhen(iso: string, lang: Lang) {
  const date = new Date(iso)
  const locale = lang === "ru" ? "ru-RU" : "en-GB"
  const today = new Date()
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()

  return sameDay
    ? date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(locale, { day: "numeric", month: "short" })
}

type Props = {
  selectedProjectId: string | null
  onSelect: (chat: AdminChatDto) => void
  /**
   * Строка, соответствующая выбранному проекту, — родителю она нужна ради
   * владельца в шапке рабочей области. Отдаётся и после перезагрузки страницы,
   * когда выбор пришёл из адреса, а не из клика.
   */
  onSelectedChange: (chat: AdminChatDto | null) => void
}

/**
 * Колонка «Чаты»: все переписки сайта, свежие сверху.
 *
 * Отвечает на вопрос, на который на сайте раньше отвечать было нечем: кто
 * написал и в каком проекте. До неё чат открывался только тем, кто ЗАРАНЕЕ знал
 * оба ответа, — рабочая область спрашивает сначала пользователя, потом его
 * проект.
 *
 * Порядок — по времени последнего сообщения: написали в старый проект, он сам
 * поднялся наверх. Уехавшее вниз возвращают поиском, и ищет он по базе, а не по
 * загруженным строкам, — иначе искать можно было бы только среди того, что и
 * так на экране.
 */
/**
 * `memo` не украшение: рядом живёт рабочая область, которая перечитывает дерево
 * файлов каждые несколько секунд, и каждое такое обновление контекста
 * перерисовывало бы весь список переписок. Пропсы здесь стабильны (строка и два
 * `useCallback`), поэтому проверка их равенства и правда экономит работу.
 */
export const ChatsColumn = memo(function ChatsColumn({
  selectedProjectId,
  onSelect,
  onSelectedChange,
}: Props) {
  const t = useAdminI18n()
  const { lang } = useI18n()

  const [chats, setChats] = useState<AdminChatDto[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")

  const { size, dragging, onPointerDown, onKeyDown } = useDragSize({
    initial: 320,
    min: 260,
    max: 520,
    axis: "x",
    storageKey: "ffworks-admin-chats-width",
  })

  /**
   * Сколько строк держим на экране. Нужно такту обновления: перечитывать он
   * обязан ровно столько же, иначе после «Показать ещё» очередное обновление
   * схлопывало бы список обратно до первой страницы.
   */
  const loadedRef = useRef(PAGE_SIZE)

  const fetchChats = useCallback(
    async (params: { search: string; limit: number; offset: number }) => {
      const qs = new URLSearchParams({
        q: params.search,
        limit: String(params.limit),
        offset: String(params.offset),
      })
      const res = await fetch(`/api/admin/chats?${qs.toString()}`)
      if (!res.ok) throw new Error(String(res.status))
      return (await res.json()) as {
        chats: AdminChatDto[]
        hasMore: boolean
        unreadTotal: number
      }
    },
    [],
  )

  /** Перечитать с начала: и первая загрузка, и поиск, и такт обновления. */
  const reload = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      if (!options.quiet) setLoading(true)
      try {
        const data = await fetchChats({
          search,
          limit: loadedRef.current,
          offset: 0,
        })
        setChats(data.chats)
        setHasMore(data.hasMore)
        setUnreadTotal(data.unreadTotal)
      } catch {
        // Тихий такт молчит: раз в полминуты жаловаться на сеть, которая
        // починится сама, — это шум поверх работы, а не сообщение.
        if (!options.quiet) toast.error(t.chatsLoadError)
      } finally {
        if (!options.quiet) setLoading(false)
      }
    },
    [fetchChats, search, t],
  )

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    try {
      const data = await fetchChats({
        search,
        limit: PAGE_SIZE,
        offset: chats.length,
      })
      setChats((prev) => [...prev, ...data.chats])
      setHasMore(data.hasMore)
      setUnreadTotal(data.unreadTotal)
      loadedRef.current = chats.length + data.chats.length
    } catch {
      toast.error(t.chatsLoadError)
    } finally {
      setLoadingMore(false)
    }
  }, [fetchChats, search, chats.length, t])

  // Поиск с задержкой: печатают по букве, а ходит запрос в базу.
  useEffect(() => {
    const timer = window.setTimeout(
      () => setSearch(query.trim()),
      SEARCH_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [query])

  // Новый запрос — снова с первой страницы: держать «показано 60» от прежнего
  // поиска незачем, у нового набор другой.
  useEffect(() => {
    loadedRef.current = PAGE_SIZE
    void reload()
  }, [reload])

  /**
   * Такт обновления. Только пока на страницу смотрят: её держат открытой весь
   * день. Плюс мгновенный пересчёт, когда чат прочитан в соседней панели, —
   * иначе строка ещё полминуты висела бы с непрочитанным.
   */
  useEffect(() => {
    let timer: number | null = null

    const start = () => {
      if (timer) window.clearInterval(timer)
      timer = window.setInterval(
        () => void reload({ quiet: true }),
        POLL_INTERVAL_MS,
      )
    }
    const stop = () => {
      if (timer) window.clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void reload({ quiet: true })
        start()
      } else {
        stop()
      }
    }
    const onRead = () => void reload({ quiet: true })

    if (document.visibilityState === "visible") start()
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener(CHAT_READ_EVENT, onRead)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener(CHAT_READ_EVENT, onRead)
    }
  }, [reload])

  useEffect(() => {
    onSelectedChange(
      chats.find((chat) => chat.projectId === selectedProjectId) ?? null,
    )
  }, [chats, selectedProjectId, onSelectedChange])

  return (
    <section
      style={{ width: size }}
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-white/[0.08] bg-ws-well"
    >
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-0.5 w-4 shrink-0 rounded bg-ws-accent" />
            <span className="truncate text-[14px] font-semibold uppercase tracking-[1.6px] text-ws-accent">
              {t.chatsColumnTitle}
            </span>
          </div>
          <span className="shrink-0 text-[12px] text-ws-4">
            {unreadTotal > 0 ? tf(t.chatsWaiting, { count: unreadTotal }) : t.chatsAllRead}
          </span>
        </div>

        <div className="relative mt-3">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ws-4"
            aria-hidden
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.chatsSearch}
            aria-label={t.chatsSearch}
            className="h-[38px] w-full rounded-[9px] border border-white/10 bg-ws-control pl-[34px] pr-3 text-[13px] text-ws-1 outline-none placeholder:text-ws-4 focus:border-ws-select"
          />
        </div>
      </div>

      <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-3 pb-2.5">
        {loading ? (
          <div className="flex justify-center py-10 text-ws-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : chats.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] text-ws-4">
            {search ? t.chatsNothingFound : t.chatsEmpty}
          </p>
        ) : (
          <>
            <ul className="pt-1">
              {chats.map((chat) => {
                const active = chat.projectId === selectedProjectId
                const unread = chat.unreadCount > 0
                const sender =
                  chat.lastMessageSenderType === "system"
                    ? t.chatsSystem
                    : (chat.lastMessageSenderName ?? "")

                return (
                  <li key={chat.projectId}>
                    <button
                      type="button"
                      onClick={() => onSelect(chat)}
                      aria-label={tf(t.chatsOpenAria, {
                        project: chat.projectName,
                      })}
                      className={cn(
                        "mb-1 w-full rounded-[10px] px-2.5 py-2.5 text-left",
                        active ? "bg-ws-hover" : "hover:bg-white/[0.04]",
                        // Архивный проект приглушаем, как и в «Папках»: работа по
                        // нему не идёт, но переписка остаётся доступной.
                        chat.isArchived && !active ? "opacity-60" : null,
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-[13.5px]",
                            unread
                              ? "font-semibold text-ws-1"
                              : active
                                ? "text-ws-1"
                                : "text-ws-2",
                          )}
                        >
                          {chat.projectName}
                        </span>
                        {chat.isArchived ? (
                          <span className="shrink-0 rounded border border-white/10 px-1 py-px text-[10px] uppercase tracking-wide text-ws-5">
                            {t.chatsArchived}
                          </span>
                        ) : null}
                        <span className="shrink-0 text-[11px] tabular-nums text-ws-4">
                          {chat.lastMessageAt
                            ? formatWhen(chat.lastMessageAt, lang)
                            : ""}
                        </span>
                      </span>

                      <span className="mt-0.5 flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ws-4">
                          {chat.ownerEmail}
                        </span>
                        {unread ? (
                          <span
                            aria-label={tf(t.chatsUnreadAria, {
                              count: chat.unreadCount,
                            })}
                            className="shrink-0 rounded-full bg-ws-action px-1.5 py-px text-[10px] font-semibold tabular-nums text-white"
                          >
                            {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                          </span>
                        ) : null}
                      </span>

                      <span
                        className={cn(
                          "mt-1 block truncate text-[11.5px]",
                          chat.lastMessageBody ? "text-ws-5" : "text-ws-5/70",
                        )}
                      >
                        {chat.lastMessageBody
                          ? `${sender ? `${sender}: ` : ""}${chat.lastMessageBody}`
                          : t.chatsNoMessages}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {hasMore ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="mb-2 mt-1 flex w-full items-center justify-center gap-2 rounded-[9px] border border-white/10 py-2 text-[12.5px] text-ws-3 hover:bg-white/[0.04] disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t.chatsMore}
              </button>
            ) : null}
          </>
        )}
      </div>

      <ResizeGrip
        orientation="vertical"
        side="right"
        label={t.chatsColumnTitle}
        dragging={dragging}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
    </section>
  )
})
