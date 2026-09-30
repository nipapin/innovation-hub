"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ChatMember, ChatMessage } from "@/lib/production/chat-types"

export type ChatMe = { userId: string; member: ChatMember | null; isOwner: boolean }

/**
 * Лента чата этапа. Грузит последнюю страницу, догружает старые по прокрутке,
 * по живому сигналу (`tick`) перечитывает последнюю страницу — так приходят и
 * новые сообщения, и реакции, и удаления, и прочтения. Прочтение отмечается,
 * когда вкладка видна.
 */
export function useChat(stepId: string, tick: number) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [members, setMembers] = useState<ChatMember[]>([])
  const [me, setMe] = useState<ChatMe | null>(null)
  const [reactions, setReactions] = useState<string[]>([])
  const [hasOlder, setHasOlder] = useState(true)
  const [loading, setLoading] = useState(true)
  const readSent = useRef(0)
  const base = `/api/production/steps/${encodeURIComponent(stepId)}`

  const fetchPage = useCallback(
    async (query = "") => {
      const res = await fetch(`${base}/messages${query}`, { cache: "no-store" })
      if (!res.ok) return null
      return (await res.json()) as {
        messages: ChatMessage[]
        members: ChatMember[]
        me: ChatMe
        reactions: string[]
      }
    },
    [base],
  )

  // Последняя страница: заменяет перекрывшиеся сообщения, старые догруженные сохраняет.
  const refresh = useCallback(async () => {
    const page = await fetchPage()
    if (!page) return
    setMembers(page.members)
    setMe(page.me)
    setReactions(page.reactions)
    setMessages((prev) => {
      const firstId = page.messages[0]?.id ?? Infinity
      const older = prev.filter((m) => m.id < firstId)
      return [...older, ...page.messages]
    })
    setLoading(false)
  }, [fetchPage])

  useEffect(() => {
    setMessages([])
    setHasOlder(true)
    setLoading(true)
    readSent.current = 0
    void refresh()
  }, [stepId, refresh])

  useEffect(() => {
    if (tick > 0) void refresh()
  }, [tick, refresh])

  const loadOlder = useCallback(async () => {
    const first = messages[0]
    if (!first || !hasOlder) return
    const page = await fetchPage(`?before=${first.id}`)
    if (!page) return
    if (page.messages.length === 0) setHasOlder(false)
    setMessages((prev) => [...page.messages, ...prev])
  }, [fetchPage, hasOlder, messages])

  // Прочтение — последнее сообщение, пока вкладка видна.
  useEffect(() => {
    const last = messages.at(-1)
    if (!last || !me?.member || last.id <= readSent.current) return
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return
    readSent.current = last.id
    void fetch(`${base}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastId: last.id }),
    })
  }, [base, me?.member, messages])

  return { messages, members, me, reactions, hasOlder, loading, refresh, loadOlder }
}
