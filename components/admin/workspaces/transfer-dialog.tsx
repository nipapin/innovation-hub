"use client"

import { useMemo, useState } from "react"
import { ArrowLeftRight, Loader2, Search } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { cn } from "@/lib/utils"
import type { PipelineUserDto } from "./users-column"

/**
 * Окно передачи проекта.
 *
 * Живёт в админской зоне, а не рядом с остальными диалогами рабочей области:
 * выбирать нового владельца не из чего, пока нет списка людей, а он есть только
 * здесь. Общий компонент пришлось бы кормить этим списком из кабинета, где
 * передачи не существует вовсе.
 *
 * Заблокированные аккаунты в списке не показываются: сервер такой перенос
 * отклонит (lib/project-transfer.ts), и предлагать выбор, который заведомо
 * вернёт отказ, — это ловушка, а не свобода.
 */
export function TransferDialog({
  users,
  /** Чей проект сейчас — выбранный в первой колонке. Ему передавать нечего. */
  currentOwnerId,
  /** Перечитать колонку людей: у обоих участников изменилось число проектов. */
  onDone,
}: {
  users: PipelineUserDto[]
  currentOwnerId: string | null
  onDone: () => void
}) {
  const { t } = useI18n()
  const { transferTarget, closeTransferDialog, afterTransfer, source } =
    useWorkspace()
  const [query, setQuery] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  const project = transferTarget

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users
      .filter((u) => u.isActive)
      .filter(
        (u) =>
          !q ||
          u.email.toLowerCase().includes(q) ||
          u.fullName.toLowerCase().includes(q),
      )
  }, [users, query])

  if (!project) return null

  const transferUrl = source.transferUrl
  if (!transferUrl) return null

  const submit = async (toUserId: string) => {
    setBusyId(toUserId)
    try {
      const res = await fetch(transferUrl(project.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        // Сервер объясняет отказ по существу (занят подарком, аккаунт
        // заблокирован, тот же владелец) — показываем именно его текст.
        toast.error(
          typeof data?.message === "string" ? data.message : t.transferFailed,
        )
        return
      }
      toast.success(t.transferDone)
      await afterTransfer()
      onDone()
    } catch {
      toast.error(t.transferFailed)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeTransferDialog()
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-[520px] flex-col overflow-hidden rounded-[14px] border border-foreground/10 bg-ws-panel">
        <div className="shrink-0 border-b border-foreground/[0.08] px-5 py-4">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-ws-1">
            <ArrowLeftRight className="h-4 w-4 text-ws-accent" aria-hidden />
            {t.transferTitle}
          </p>
          <p className="mt-1 truncate text-[13px] text-ws-3">{project.name}</p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ws-4">
            {t.transferDesc}
          </p>
          <p className="mt-2 text-[12.5px] text-ws-4">{t.transferPaused}</p>
          {project.memberCount > 0 ? (
            <p className="mt-2 text-[12.5px] text-ws-out">
              {t.transferMembersWarn}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 px-5 pt-4">
          <p className="text-[12px] font-semibold uppercase tracking-[1.2px] text-ws-accent">
            {t.transferPickPerson}
          </p>
          <div className="relative mt-2">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ws-4"
              aria-hidden
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.transferSearch}
              className="h-[38px] w-full rounded-[9px] border border-foreground/10 bg-ws-control pl-[34px] pr-3 text-[13px] text-ws-1 outline-none placeholder:text-ws-4 focus:border-ws-select"
            />
          </div>
        </div>

        <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {candidates.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-ws-4">
              {t.transferNobody}
            </p>
          ) : (
            <ul>
              {candidates.map((user) => {
                const busy = busyId === user.id
                const isOwner = user.id === currentOwnerId
                return (
                  <li key={user.id}>
                    <button
                      type="button"
                      disabled={busyId !== null || isOwner}
                      onClick={() => void submit(user.id)}
                      className={cn(
                        "mb-1 flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left",
                        "hover:bg-foreground/[0.05] disabled:opacity-45",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] text-ws-2">
                          {user.fullName || user.email}
                        </span>
                        {user.fullName ? (
                          <span className="mt-0.5 block truncate text-[11.5px] text-ws-4">
                            {user.email}
                          </span>
                        ) : null}
                      </span>
                      {isOwner ? (
                        <span className="shrink-0 text-[11.5px] text-ws-4">
                          {t.transferCurrentOwner}
                        </span>
                      ) : null}
                      {busy ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ws-3" />
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-foreground/[0.08] px-5 py-3">
          <button
            type="button"
            onClick={closeTransferDialog}
            className="h-9 rounded-[9px] border border-foreground/[0.14] px-4 text-[13px] text-ws-2 hover:bg-foreground/5"
          >
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}
