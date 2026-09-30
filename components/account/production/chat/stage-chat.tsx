"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  Check,
  CheckCheck,
  CornerUpLeft,
  Download,
  FileIcon,
  Loader2,
  LogOut,
  MoreHorizontal,
  Paperclip,
  SendHorizontal,
  SmilePlus,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { useI18n, type Dictionary } from "@/components/account/i18n"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ChatAttachment, ChatMember, ChatMessage } from "@/lib/production/chat-types"
import type { PersonOption } from "@/lib/production/people-types"
import { cn } from "@/lib/utils"
import { isImage, isVideo, mediaUrl, uploadChatFile, type UploadedFile } from "./upload"
import { useChat, type ChatMe } from "./use-chat"

/**
 * Чат этапа ролика — docs/PRODUCTION_PLAN.md §7, этап 2.
 *
 * Вся работа над этапом идёт здесь: исполнитель присылает вариант вложением,
 * файл ложится в рабочую папку этапа; проверяющий смотрит его в ленте или в
 * окне просмотра и принимает из меню «⋯». Живые изменения приходят сигналом
 * (`tick`) из общего потока раздела.
 */
export function StageChat({
  stepId,
  tick,
  canApprove,
  onApproveFile,
}: {
  stepId: string
  tick: number
  canApprove: boolean
  onApproveFile: (file: { id: string; name: string }) => void
}) {
  const { t } = useI18n()
  const chat = useChat(stepId, tick)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [preview, setPreview] = useState<ChatAttachment | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // Новые сообщения — вниз, если человек и так был внизу.
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [chat.messages])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (el.scrollTop < 40 && chat.hasOlder && chat.messages.length > 0) {
      const before = el.scrollHeight
      void chat.loadOlder().then(() => {
        requestAnimationFrame(() => {
          if (listRef.current) listRef.current.scrollTop += listRef.current.scrollHeight - before
        })
      })
    }
  }

  const act = async (url: string, init: RequestInit, failText: string) => {
    const res = await fetch(url, init)
    if (!res.ok) toast.error(failText)
    await chat.refresh()
    return res.ok
  }
  const base = `/api/production/steps/${encodeURIComponent(stepId)}`

  return (
    <section className="flex min-h-[260px] flex-1 flex-col">
      <ChatHeader
        stepId={stepId}
        members={chat.members}
        me={chat.me}
        onChanged={() => void chat.refresh()}
      />

      <div ref={listRef} onScroll={onScroll} className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-6">
        {chat.loading ? (
          <Loader2 className="mx-auto mt-6 h-5 w-5 animate-spin text-ws-4" />
        ) : chat.messages.length === 0 ? (
          <p className="mt-6 text-center text-[12.5px] text-ws-4">{t.productionChatEmpty}</p>
        ) : (
          <div className="space-y-2.5">
            {chat.messages.map((message, index) => (
              <MessageItem
                key={message.id}
                message={message}
                prev={chat.messages[index - 1]}
                me={chat.me}
                members={chat.members}
                reactions={chat.reactions}
                canApprove={canApprove}
                onReply={() => setReplyTo(message)}
                onReact={(emoji) =>
                  void act(
                    `${base}/messages/${message.id}/reactions`,
                    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }) },
                    t.productionChatFailed,
                  )
                }
                onDelete={() => {
                  if (!window.confirm(t.productionChatDeleteConfirm)) return
                  void act(`${base}/messages/${message.id}`, { method: "DELETE" }, t.productionChatFailed)
                }}
                onPreview={setPreview}
                onApprove={(a) => onApproveFile({ id: a.fileId, name: a.name })}
              />
            ))}
          </div>
        )}
      </div>

      <Composer
        stepId={stepId}
        members={chat.members}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSent={() => {
          setReplyTo(null)
          stickToBottom.current = true
          void chat.refresh()
        }}
      />

      <PreviewDialog
        attachment={preview}
        canApprove={canApprove}
        onClose={() => setPreview(null)}
        onApprove={(a) => {
          setPreview(null)
          onApproveFile({ id: a.fileId, name: a.name })
        }}
      />
    </section>
  )
}

// ─── Шапка: участники, настройки, выход ───────────────────────────────────

function ChatHeader({
  stepId,
  members,
  me,
  onChanged,
}: {
  stepId: string
  members: ChatMember[]
  me: ChatMe | null
  onChanged: () => void
}) {
  const { t } = useI18n()
  const [people, setPeople] = useState<PersonOption[] | null>(null)
  const [query, setQuery] = useState("")
  const base = `/api/production/steps/${encodeURIComponent(stepId)}`
  const self = me?.member

  const loadPeople = () => {
    if (people) return
    void fetch("/api/production/people", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { people: [] }))
      .then((body: { people: PersonOption[] }) => setPeople(body.people))
  }

  const call = async (init: RequestInit, errorFor: (code?: string) => string) => {
    const res = await fetch(`${base}/members`, init)
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { code?: string }
      toast.error(errorFor(body.code))
    }
    onChanged()
    return res.ok
  }

  const memberIds = new Set(members.map((m) => m.userId))
  const q = query.trim().toLowerCase()
  const candidates = (people ?? []).filter(
    (p) => !memberIds.has(p.id) && (!q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)),
  )

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-y border-foreground/[0.07] px-3 md:px-6">
      <span className="text-[12px] font-semibold uppercase tracking-[1.2px] text-ws-3">{t.productionChat}</span>
      <Popover onOpenChange={(open) => open && loadPeople()}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="ml-auto flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
          >
            <Users className="h-4 w-4" />
            {members.length}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3">
          <p className="mb-2 text-[12px] font-semibold text-ws-2">{t.productionChatMembers}</p>
          <ul className="mb-3 max-h-44 space-y-1 overflow-y-auto">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-2 text-[12.5px] text-ws-1">
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                {m.via !== "production" ? (
                  <span className="rounded bg-ws-select/35 px-1.5 text-[10.5px] text-ws-3">{t.productionChatGuest}</span>
                ) : null}
              </li>
            ))}
          </ul>

          <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ws-2">
            <UserPlus className="h-3.5 w-3.5" />
            {t.productionChatInvite}
          </p>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.productionEdSearchPeople}
            className="mb-1 h-8 w-full rounded-md border border-foreground/10 bg-ws-control px-2 text-[12.5px] text-ws-1 outline-none placeholder:text-ws-5"
          />
          <div className="mb-3 max-h-32 overflow-y-auto">
            {people === null ? (
              <Loader2 className="mx-auto my-2 h-4 w-4 animate-spin text-ws-4" />
            ) : candidates.length === 0 ? (
              <p className="px-1 py-1 text-[11.5px] text-ws-4">{t.productionEdNoPeople}</p>
            ) : (
              candidates.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    void call(
                      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: p.id }) },
                      () => t.productionChatInviteFailed,
                    )
                  }
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12.5px] text-ws-1 hover:bg-ws-hover"
                >
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="truncate text-[11px] text-ws-4">{p.email}</span>
                </button>
              ))
            )}
          </div>

          {self ? (
            <div className="space-y-2 border-t border-foreground/10 pt-2">
              <label className="flex items-center justify-between gap-2 text-[12.5px] text-ws-2">
                {t.productionChatNotify}
                <select
                  value={self.notify}
                  onChange={(e) =>
                    void call(
                      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notify: e.target.value }) },
                      () => t.productionChatFailed,
                    )
                  }
                  className="h-7 rounded border border-foreground/10 bg-ws-control px-1 text-[12px] text-ws-1 outline-none"
                >
                  <option value="all">{t.productionChatNotifyAll}</option>
                  <option value="mentions">{t.productionChatNotifyMentions}</option>
                  <option value="none">{t.productionChatNotifyNone}</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-2 text-[12.5px] text-ws-2">
                {t.productionChatFollowing}
                <input
                  type="checkbox"
                  checked={self.following}
                  onChange={(e) =>
                    void call(
                      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ following: e.target.checked }) },
                      () => t.productionChatFailed,
                    )
                  }
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(t.productionChatLeaveConfirm)) return
                  void call({ method: "DELETE" }, (code) =>
                    code === "executor-marked"
                      ? t.productionChatLeaveMarked
                      : code === "last-reviewer"
                        ? t.productionChatLeaveLastReviewer
                        : t.productionChatFailed,
                  )
                }}
                className="flex items-center gap-1.5 text-[12.5px] text-destructive hover:underline"
              >
                <LogOut className="h-3.5 w-3.5" />
                {t.productionChatLeave}
              </button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}

// ─── Сообщение ────────────────────────────────────────────────────────────

function systemText(message: ChatMessage, t: Dictionary): string {
  const e = message.event
  const who = e?.actorName ?? ""
  switch (e?.type) {
    case "step_ready":
      return t.productionSysStepReady
    case "approved":
      return t.productionSysApproved.replace("{who}", who).replace("{name}", e.name ?? "")
    case "executor_marked":
      return t.productionSysMarked.replace("{who}", who)
    case "executor_unmarked":
      return t.productionSysUnmarked.replace("{who}", who)
    case "member_joined":
      return t.productionSysJoined.replace("{who}", who).replace("{target}", e.targetName ?? "")
    case "member_left":
      return t.productionSysLeft.replace("{who}", who)
    case "machine_done":
      return t.productionSysMachineDone.replace("{name}", e.name ?? "")
    case "machine_failed":
      return t.productionSysMachineFailed.replace("{name}", e.name ?? "")
    case "machine_results":
      return t.productionSysMachineResults.replace("{n}", e.name ?? "")
    case "auto_approved":
      return t.productionSysAutoApproved
    case "rerun":
      return t.productionSysRerun.replace("{who}", who)
    default:
      return ""
  }
}

function MessageItem({
  message,
  prev,
  me,
  members,
  reactions,
  canApprove,
  onReply,
  onReact,
  onDelete,
  onPreview,
  onApprove,
}: {
  message: ChatMessage
  prev?: ChatMessage
  me: ChatMe | null
  members: ChatMember[]
  reactions: string[]
  canApprove: boolean
  onReply: () => void
  onReact: (emoji: string) => void
  onDelete: () => void
  onPreview: (a: ChatAttachment) => void
  onApprove: (a: ChatAttachment) => void
}) {
  const { t } = useI18n()
  const time = new Date(message.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })

  if (message.kind === "system") {
    return (
      <p className="text-center text-[11.5px] text-ws-4">
        {systemText(message, t)} · {time}
      </p>
    )
  }

  const mine = message.authorId === me?.userId
  // Подряд от одного автора в пределах пяти минут — без повтора имени.
  const grouped =
    prev &&
    prev.kind !== "system" &&
    prev.authorId === message.authorId &&
    new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000
  // Кто прочитал: участники (кроме автора), чья отметка не меньше id сообщения.
  const readers = members.filter((m) => m.userId !== message.authorId && m.lastReadId >= message.id)

  return (
    <div className={cn("group relative flex flex-col", mine ? "items-end" : "items-start")}>
      {!grouped ? (
        <p className="mb-0.5 px-1 text-[11.5px] font-medium text-ws-3">{message.authorName ?? "—"}</p>
      ) : null}
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3 py-2 text-[13.5px] leading-relaxed",
          mine ? "bg-ws-accent/15 text-ws-1" : "bg-ws-control text-ws-1",
        )}
      >
        {message.replyTo ? (
          <div className="mb-1.5 border-l-2 border-ws-accent/60 pl-2 text-[12px] text-ws-3">
            <span className="font-medium">{message.replyTo.authorName}</span>
            <span className="line-clamp-2">{message.replyTo.body || t.productionChatDeleted}</span>
          </div>
        ) : null}
        {message.deleted ? (
          <span className="italic text-ws-4">{t.productionChatDeleted}</span>
        ) : (
          <>
            {message.body ? <p className="whitespace-pre-wrap break-words">{message.body}</p> : null}
            {message.attachments.length > 0 ? (
              <div className={cn("grid gap-1.5", message.body && "mt-1.5")}>
                {message.attachments.map((a) => (
                  <AttachmentView
                    key={a.fileId}
                    attachment={a}
                    canApprove={canApprove}
                    onPreview={() => onPreview(a)}
                    onApprove={() => onApprove(a)}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] text-ws-4">
          {time}
          {mine ? (
            <span title={readers.length ? `${t.productionChatReadBy} ${readers.map((r) => r.name).join(", ")}` : t.productionChatSent}>
              {readers.length ? <CheckCheck className="h-3.5 w-3.5 text-info" /> : <Check className="h-3.5 w-3.5" />}
            </span>
          ) : null}
        </div>
      </div>

      {message.reactions.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {message.reactions.map((r) => {
            const byMe = me ? r.userIds.includes(me.userId) : false
            const names = r.userIds.map((id) => members.find((m) => m.userId === id)?.name ?? "?").join(", ")
            return (
              <button
                key={r.emoji}
                type="button"
                title={names}
                onClick={() => onReact(r.emoji)}
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[12px]",
                  byMe ? "border-info/40 bg-info/15" : "border-foreground/10 bg-ws-control",
                )}
              >
                {r.emoji} <span className="text-ws-3">{r.userIds.length}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {!message.deleted ? (
        <div
          className={cn(
            "absolute -top-3 hidden items-center gap-0.5 rounded-md border border-foreground/10 bg-ws-panel p-0.5 shadow-ws-panel group-hover:flex",
            mine ? "right-2" : "left-2",
          )}
        >
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" title={t.productionChatReact} aria-label={t.productionChatReact} className="flex h-6 w-6 items-center justify-center rounded text-ws-4 hover:bg-ws-hover hover:text-ws-1">
                <SmilePlus className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="center" className="flex w-auto gap-0.5 p-1">
              {reactions.map((emoji) => (
                <button key={emoji} type="button" onClick={() => onReact(emoji)} className="rounded px-1.5 py-0.5 text-[16px] hover:bg-ws-hover">
                  {emoji}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <button type="button" onClick={onReply} title={t.productionChatReply} aria-label={t.productionChatReply} className="flex h-6 w-6 items-center justify-center rounded text-ws-4 hover:bg-ws-hover hover:text-ws-1">
            <CornerUpLeft className="h-3.5 w-3.5" />
          </button>
          {mine ? (
            <button type="button" onClick={onDelete} title={t.productionChatDelete} aria-label={t.productionChatDelete} className="flex h-6 w-6 items-center justify-center rounded text-ws-4 hover:bg-ws-hover hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Вложение: картинка и видео — превью прямо в ленте, остальное — файл. */
function AttachmentView({
  attachment,
  canApprove,
  onPreview,
  onApprove,
}: {
  attachment: ChatAttachment
  canApprove: boolean
  onPreview: () => void
  onApprove: () => void
}) {
  const { t } = useI18n()
  const url = mediaUrl(attachment.s3Key)
  const image = isImage(attachment.contentType, attachment.name)
  const video = isVideo(attachment.contentType, attachment.name)

  return (
    <div className="relative">
      {image ? (
        <button type="button" onClick={onPreview} className="block overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={attachment.name} className="max-h-60 max-w-full object-contain" />
        </button>
      ) : video ? (
        <video src={url} controls preload="metadata" className="max-h-64 max-w-full rounded-lg bg-black" />
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-foreground/10 px-2.5 py-2 text-[12.5px] hover:bg-ws-hover">
          <FileIcon className="h-4 w-4 shrink-0 text-ws-4" />
          <span className="min-w-0 truncate">{attachment.name}</span>
        </a>
      )}
      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ws-4">
        <span className="min-w-0 flex-1 truncate">{image || video ? attachment.name : ""}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" title={t.productionFileMenu} aria-label={t.productionFileMenu} className="flex h-5 w-5 items-center justify-center rounded hover:bg-ws-hover hover:text-ws-1">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            {image || video ? (
              <DropdownMenuItem onSelect={onPreview}>{t.productionChatOpen}</DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild>
              <a href={url} download={attachment.name}>
                <Download className="mr-2 h-4 w-4" />
                {t.productionChatDownload}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canApprove} onSelect={onApprove}>
              <Check className="mr-2 h-4 w-4" />
              {t.productionApproveThis}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/** Отдельное окно просмотра — крупно, с приёмкой. Пометки на кадре — этап 3. */
function PreviewDialog({
  attachment,
  canApprove,
  onClose,
  onApprove,
}: {
  attachment: ChatAttachment | null
  canApprove: boolean
  onClose: () => void
  onApprove: (a: ChatAttachment) => void
}) {
  const { t } = useI18n()
  if (!attachment) return null
  const url = mediaUrl(attachment.s3Key)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogTitle className="truncate pr-8">{attachment.name}</DialogTitle>
        <DialogDescription className="sr-only">{t.productionChatOpen}</DialogDescription>
        <div className="flex max-h-[75vh] items-center justify-center overflow-hidden rounded-lg bg-black">
          {isVideo(attachment.contentType, attachment.name) ? (
            <video src={url} controls autoPlay className="max-h-[75vh] max-w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={attachment.name} className="max-h-[75vh] max-w-full object-contain" />
          )}
        </div>
        <div className="flex justify-end gap-2">
          <a href={url} download={attachment.name} className="flex h-8 items-center gap-1.5 rounded-[9px] border border-foreground/10 bg-ws-control px-3 text-[13px] text-ws-2 hover:bg-ws-hover">
            <Download className="h-4 w-4" />
            {t.productionChatDownload}
          </a>
          {canApprove ? (
            <button type="button" onClick={() => onApprove(attachment)} className="h-8 rounded-[9px] bg-success px-3 text-[13px] font-medium text-background hover:bg-success/90">
              {t.productionApproveThis}
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Поле ввода ───────────────────────────────────────────────────────────

type Pending = { key: string; file: File; progress: number; done?: UploadedFile; error?: boolean; abort: AbortController }

/**
 * Поле ввода: Enter — отправить, Shift+Enter — новая строка. Вложения —
 * скрепкой или перетаскиванием; заливаются сразу, отправка ждёт окончания.
 * `@` — упоминание: участнику — уведомление, человеку из круга — приглашение.
 */
function Composer({
  stepId,
  members,
  replyTo,
  onCancelReply,
  onSent,
}: {
  stepId: string
  members: ChatMember[]
  replyTo: ChatMessage | null
  onCancelReply: () => void
  onSent: () => void
}) {
  const { t } = useI18n()
  const [text, setText] = useState("")
  const [pending, setPending] = useState<Pending[]>([])
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([])
  const [circle, setCircle] = useState<PersonOption[]>([])
  const [sending, setSending] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void fetch("/api/production/people", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { people: [] }))
      .then((body: { people: PersonOption[] }) => setCircle(body.people))
  }, [])

  // Кого можно упомянуть: участники чата и круг (§6.1).
  const mentionable = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of members) map.set(m.userId, m.name)
    for (const p of circle) if (!map.has(p.id)) map.set(p.id, p.name)
    return [...map].map(([id, name]) => ({ id, name }))
  }, [members, circle])

  const word = text.match(/@([^\s@]*)$/)?.[1]
  const options =
    word !== undefined
      ? mentionable.filter((p) => p.name.toLowerCase().includes(word.toLowerCase())).slice(0, 6)
      : []

  const addFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random()}`
      const abort = new AbortController()
      setPending((list) => [...list, { key, file, progress: 0, abort }])
      void uploadChatFile(
        stepId,
        file,
        (progress) => setPending((list) => list.map((p) => (p.key === key ? { ...p, progress } : p))),
        abort.signal,
      )
        .then((done) => setPending((list) => list.map((p) => (p.key === key ? { ...p, done, progress: 100 } : p))))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return
          toast.error(`${t.productionChatUploadFailed}: ${file.name}`)
          setPending((list) => list.map((p) => (p.key === key ? { ...p, error: true } : p)))
        })
    }
  }

  const uploading = pending.some((p) => !p.done && !p.error)

  const send = async () => {
    const body = text.trim()
    const ready = pending.filter((p) => p.done)
    if ((!body && ready.length === 0) || uploading || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/production/steps/${encodeURIComponent(stepId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          attachmentIds: ready.map((p) => p.done!.id),
          replyTo: replyTo?.id,
          // Только те упоминания, чьё имя осталось в тексте.
          mentions: mentions.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id),
        }),
      })
      if (!res.ok) {
        toast.error(t.productionChatFailed)
        return
      }
      setText("")
      setPending([])
      setMentions([])
      onSent()
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className={cn("shrink-0 px-3 pb-3 md:px-6", dragOver && "bg-ws-select/20")}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
      }}
    >
      {replyTo ? (
        <div className="mb-1.5 flex items-center gap-2 rounded-md border-l-2 border-ws-accent/60 bg-ws-control px-2 py-1 text-[12px] text-ws-3">
          <CornerUpLeft className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{replyTo.authorName}</span>: {replyTo.body || replyTo.attachments.map((a) => a.name).join(", ")}
          </span>
          <button type="button" onClick={onCancelReply} aria-label={t.productionChatCancel} className="text-ws-4 hover:text-ws-1">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {pending.map((p) => (
            <span
              key={p.key}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px]",
                p.error ? "border-destructive/40 text-destructive" : "border-foreground/10 text-ws-2",
              )}
            >
              <span className="max-w-[180px] truncate">{p.file.name}</span>
              {!p.done && !p.error ? <span className="tabular-nums text-ws-4">{p.progress}%</span> : null}
              <button
                type="button"
                aria-label={t.productionChatCancel}
                onClick={() => {
                  p.abort.abort()
                  setPending((list) => list.filter((x) => x.key !== p.key))
                }}
                className="text-ws-4 hover:text-ws-1"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative flex items-end gap-2 rounded-[10px] border border-foreground/10 bg-ws-control px-2 py-1.5">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          title={t.productionAttach}
          aria-label={t.productionAttach}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ws-4 hover:bg-ws-hover hover:text-ws-1"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ""
          }}
        />
        <textarea
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              if (options.length > 0) {
                const pick = options[0]
                setText(text.replace(/@([^\s@]*)$/, `@${pick.name} `))
                setMentions((list) => [...list.filter((m) => m.id !== pick.id), pick])
              } else {
                void send()
              }
            }
          }}
          placeholder={t.productionChatInput}
          className="max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13.5px] text-ws-1 outline-none placeholder:text-ws-5"
          style={{ height: Math.min(160, 32 + (text.split("\n").length - 1) * 20) }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || uploading || (!text.trim() && !pending.some((p) => p.done))}
          aria-label={t.productionChatSend}
          title={uploading ? t.productionChatUploading : t.productionChatSend}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ws-accent hover:bg-ws-hover disabled:text-ws-5"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
        </button>

        {options.length > 0 ? (
          <div className="absolute bottom-full left-10 z-20 mb-1 w-64 rounded-md border border-foreground/10 bg-popover p-1 shadow-ws-menu">
            {options.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  setText(text.replace(/@([^\s@]*)$/, `@${p.name} `))
                  setMentions((list) => [...list.filter((m) => m.id !== p.id), p])
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] text-ws-1 hover:bg-ws-hover"
              >
                {p.name}
                {!members.some((m) => m.userId === p.id) ? (
                  <span className="text-[11px] text-ws-4">{t.productionChatWillInvite}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
