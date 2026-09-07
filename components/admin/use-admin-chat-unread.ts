"use client"

import { useCallback, useEffect, useState } from "react"

import { CHAT_READ_EVENT } from "@/components/account/workspace/workspace-context"
import { hasCapability, type AdminCapability } from "@/lib/admin-capabilities"
import type { UserRole } from "@/lib/domain-types"

const POLL_INTERVAL_MS = 30_000

/**
 * Сколько сообщений клиентов ждут команду — число на значке раздела «Чаты».
 *
 * Значок живёт в боковом меню, то есть виден с любой страницы, и в этом весь
 * смысл: до него узнать, что кто-то написал, на сайте было неоткуда — о новом
 * сообщении узнавали в YouGile.
 *
 * Свой запрос, а не поле в списке чатов: список — это страница с последними
 * сообщениями по каждому проекту, и тянуть её ради одного числа на каждой
 * странице админки было бы несоразмерно.
 *
 * Опрашиваем только пока на вкладку смотрят. Возврат на вкладку и событие
 * «чат прочитан» (его шлёт рабочая область) пересчитывают число сразу —
 * иначе после прочтения оно ещё полминуты показывало бы долг.
 */
export function useAdminChatUnread(
  role: UserRole,
  capabilities: readonly AdminCapability[],
): number {
  const allowed = hasCapability(role, capabilities, "projects.access")
  const [unread, setUnread] = useState(0)

  const load = useCallback(async () => {
    if (!allowed) return
    try {
      const res = await fetch("/api/admin/chats/unread")
      if (!res.ok) return
      const data = await res.json()
      setUnread(Number(data.unread ?? 0))
    } catch {
      // Значок не критичен: молча оставляем прежнее число до следующего такта.
    }
  }, [allowed])

  useEffect(() => {
    if (!allowed) {
      setUnread(0)
      return
    }

    let timer: number | null = null
    const start = () => {
      if (timer) window.clearInterval(timer)
      timer = window.setInterval(() => void load(), POLL_INTERVAL_MS)
    }
    const stop = () => {
      if (timer) window.clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load()
        start()
      } else {
        stop()
      }
    }
    const onRead = () => void load()

    void load()
    if (document.visibilityState === "visible") start()
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener(CHAT_READ_EVENT, onRead)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener(CHAT_READ_EVENT, onRead)
    }
  }, [allowed, load])

  return unread
}
