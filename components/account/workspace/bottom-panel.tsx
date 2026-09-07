"use client"

import { useEffect, useLayoutEffect, useRef } from "react"
import {
  Archive,
  ArchiveRestore,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  Send,
  Settings2,
  Trash2,
} from "lucide-react"

import { ExposedOptionsList } from "@/components/account/options/exposed-options"
import { cn } from "@/lib/utils"
import { DescriptionMdPanel } from "./description-md-panel"
import { PreviewTab } from "./file-preview"
import { fmtTime } from "./format"
import type { BottomTab } from "./types"
import { useWorkspace } from "./workspace-context"

/**
 * Насколько близко к низу нужно стоять, чтобы новое сообщение подтянуло ленту
 * за собой. Не ноль: у списка бывает дробная высота строки, и точное равенство
 * не достигается никогда.
 */
const CHAT_STICK_THRESHOLD_PX = 64

const TABS: {
  id: BottomTab
  icon: typeof FileText
  labelKey: "tabPreview" | "tabDesc" | "tabSettings" | "tabChat"
}[] = [
  { id: "preview", icon: ImageIcon, labelKey: "tabPreview" },
  { id: "desc", icon: FileText, labelKey: "tabDesc" },
  { id: "settings", icon: Settings2, labelKey: "tabSettings" },
  { id: "chat", icon: MessageCircle, labelKey: "tabChat" },
]

/**
 * Закладка «Описание» — только развёрнутое описание из `options/description.md`.
 *
 * Короткой подписи из БД здесь больше нет: два поля с одним названием на одном
 * экране путали, а бриф проекта живёт в файле — его видят и сайт, и программа.
 */
export function DescriptionTab() {
  const { selected } = useWorkspace()
  if (!selected) return null
  return (
    <DescriptionMdPanel projectId={selected.id} projectName={selected.name} />
  )
}

export function SettingsTab() {
  const {
    t,
    can,
    selected,
    patchProject,
    setArchived,
    deleteProject,
    exposedOptions,
    saveExposedOptions,
  } = useWorkspace()
  if (!selected) return null
  // Настройки — это правка: читателю расшаренного проекта тумблер и параметры
  // обработки показываются выключенными, а не активными «до первого 403».
  const canEditSettings = can.writeSettings
  return (
    <div className="max-w-[640px]">
      <div className="flex items-center justify-between gap-4 py-3.5">
        <div>
          <p className="text-[14px] text-ws-1">{t.settingPauseTitle}</p>
          <p className="mt-1 text-[12px] text-ws-4">{t.settingPauseDesc}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={selected.isPaused}
          aria-label={t.settingPauseTitle}
          disabled={!canEditSettings}
          onClick={() =>
            void patchProject(selected.id, { isPaused: !selected.isPaused })
          }
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            selected.isPaused ? "bg-ws-action" : "bg-white/10",
          )}
        >
          <span
            className={cn(
              "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-all",
              selected.isPaused ? "left-[23px]" : "left-[3px]",
            )}
          />
        </button>
      </div>
      {/* Параметры обработки: их открыл клиенту автор графа в программе.
          Ниже — действия над самим проектом, они к обработке не относятся. */}
      <ExposedOptionsList
        options={exposedOptions}
        onSave={canEditSettings ? saveExposedOptions : null}
        className="mt-4 border-t border-white/[0.07] pt-4"
      />
      {canEditSettings ? null : (
        <p className="mt-3 text-[12px] text-ws-4">{t.shareReadOnlyNote}</p>
      )}

      {can.archiveProject || can.deleteProject ? (
        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-white/[0.07] pt-4">
          {can.archiveProject ? (
            <button
              type="button"
              onClick={() => setArchived(selected, !selected.isArchived)}
              className="flex items-center gap-2 rounded-[9px] border border-white/10 px-4 py-2 text-[13px] text-ws-2 hover:bg-white/5"
            >
              {selected.isArchived ? (
                <ArchiveRestore className="h-4 w-4" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
              {selected.isArchived ? t.mUnarchive : t.archiveProject}
            </button>
          ) : null}
          {can.deleteProject ? (
            <button
              type="button"
              onClick={() => deleteProject(selected.id)}
              className="flex items-center gap-2 rounded-[9px] border border-destructive/40 px-4 py-2 text-[13px] text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              {t.deleteProject}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function ChatTab() {
  const { t, can, source, messages, draft, setDraft, sendMessage, selectedId } =
    useWorkspace()

  const scrollRef = useRef<HTMLDivElement>(null)
  /**
   * Держать ленту у низа — но только пока человек сам оттуда не ушёл.
   *
   * Просто «прокручивать вниз на каждое сообщение» нельзя: чат опрашивается
   * раз в несколько секунд, и того, кто отлистал наверх читать прежнюю
   * переписку, каждое новое сообщение выдёргивало бы обратно. Поэтому
   * запоминаем, стоял ли он внизу до прихода сообщения, и подтягиваем только
   * в этом случае.
   */
  const stick = useRef(true)

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stick.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < CHAT_STICK_THRESHOLD_PX
  }

  // useLayoutEffect, а не useEffect: прокрутка должна встать до кадра, иначе
  // видно, как лента прыгает уже после отрисовки нового сообщения.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !stick.current) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  // Сменили проект — это другая переписка, и открывается она снизу, на самом
  // свежем, независимо от того, где человек стоял в предыдущей.
  useEffect(() => {
    stick.current = true
  }, [selectedId])

  const send = () => {
    // Своё сообщение показываем всегда: отправить и не увидеть отправленного —
    // ровно та беда, из-за которой прокрутку и заводили.
    stick.current = true
    sendMessage()
  }

  return (
    <div className="flex h-full min-h-[160px] flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1"
      >
        {messages.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-center text-[14px] text-ws-4">
            {t.chatEmpty}
          </p>
        ) : (
          messages.map((m) => {
            // Один и тот же чат смотрят с двух сторон: в кабинете «свои» —
            // сообщения клиента, в админке — сообщения команды.
            const mine = m.senderType === source.chatPerspective
            const system = m.senderType === "system"
            return (
              <div
                key={m.id}
                className={cn("flex", mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[72%] px-3.5 py-2.5 text-[13.5px] leading-snug",
                    mine
                      ? "rounded-[12px_12px_4px_12px] bg-ws-action text-white"
                      : system
                        ? "rounded-[12px] bg-white/[0.04] text-ws-3"
                        : "rounded-[12px_12px_12px_4px] bg-ws-hover text-ws-1",
                  )}
                >
                  {m.body}
                  <div
                    className={cn(
                      "mt-1 text-right text-[10.5px]",
                      mine ? "text-white/60" : "text-ws-4",
                    )}
                  >
                    {fmtTime(m.createdAt)}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
      {can.writeChat ? (
        <div className="mt-3 flex shrink-0 items-center gap-2.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={t.chatPlaceholder}
            className="h-[42px] flex-1 rounded-[9px] border border-white/10 bg-ws-control px-3.5 text-[14px] text-ws-1 outline-none focus:border-ws-select"
          />
          <button
            type="button"
            onClick={send}
            aria-label={t.tabChat}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[9px] bg-ws-action text-white hover:bg-ws-action-hover"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <p className="mt-3 shrink-0 text-[12px] text-ws-4">
          {t.shareReadOnlyChat}
        </p>
      )}
    </div>
  )
}

/** Нижняя панель: описание, настройки и чат проекта. */
export function BottomPanel({ onResize }: { onResize?: React.ReactNode }) {
  const { t, bottomTab, setBottomTab, openChat, selected } = useWorkspace()
  if (!selected) return null

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-ws-panel">
      {onResize}
      <div className="flex shrink-0 flex-wrap gap-1.5 px-6 pt-3">
        {TABS.map((tab) => {
          const active = bottomTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() =>
                tab.id === "chat" ? openChat(selected.id) : setBottomTab(tab.id)
              }
              className={cn(
                "flex items-center gap-2 rounded-t-[9px] px-4 py-[9px] text-[13.5px]",
                active
                  ? "bg-ws-control text-ws-1"
                  : "bg-white/[0.03] text-ws-3 hover:text-ws-1",
              )}
            >
              <tab.icon className="h-[18px] w-[18px]" />
              {t[tab.labelKey]}
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/[0.07] px-6 py-5">
        {bottomTab === "preview" ? (
          <PreviewTab />
        ) : bottomTab === "desc" ? (
          <DescriptionTab />
        ) : bottomTab === "settings" ? (
          <SettingsTab />
        ) : (
          <ChatTab />
        )}
      </div>
    </section>
  )
}
