"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bell, BellOff, BellRing, Loader2, MessageSquare, Send } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export type ProjectChatMessageDto = {
  id: string
  senderType: "client" | "team" | "system"
  senderName: string
  body: string
  delivered: boolean
  createdAt: string
}

type Props = {
  projectId: string
  initialMessages: ProjectChatMessageDto[]
  /** Compact = embedded in the project detail page; false = the full chat page. */
  compact?: boolean
  /**
   * Может ли этот человек писать в чат. Читателю расшаренного проекта нельзя —
   * он чат видит (это переписка по его проекту), но не участвует в ней.
   */
  canWrite?: boolean
}

const POLL_INTERVAL_MS = 6000

function formatTime(iso: string) {
  try {
    // Fixed locale: SSR and the browser must produce identical text.
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

/** Merges freshly-polled/sent messages into the list, de-duplicated by id. */
function mergeMessages(
  prev: ProjectChatMessageDto[],
  incoming: ProjectChatMessageDto[],
): ProjectChatMessageDto[] {
  const byId = new Map(prev.map((m) => [m.id, m]))
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
}

export function ProjectChatPanel({
  projectId,
  initialMessages,
  compact = false,
  canWrite = true,
}: Props) {
  const [messages, setMessages] = useState(initialMessages)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingIds = useRef(new Set<string>())

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  // Only clears the badge while the tab is actually visible — a message
  // that arrives while the user is elsewhere should stay unread (and still
  // be worth a push notification) until they come back and look at it.
  const markRead = useCallback(() => {
    if (document.visibilityState !== "visible") return
    void fetch(`/api/projects/${projectId}/chat/read`, {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => {
      // Silent — the badge just stays stale until the next successful call.
    })
  }, [projectId])

  useEffect(() => {
    scrollToBottom()
    markRead()
    // Only on mount — later updates scroll explicitly after send/poll below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onVisible = () => markRead()
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [markRead])

  const poll = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        credentials: "same-origin",
      })
      if (!response.ok) return
      const data = (await response.json().catch(() => null)) as {
        messages?: ProjectChatMessageDto[]
      } | null
      if (!data?.messages) return
      setMessages((prev) => {
        const merged = mergeMessages(prev, data.messages!)
        return merged
      })
      markRead()
    } catch {
      // Silent — polling retries on the next tick regardless.
    }
  }, [projectId, markRead])

  useEffect(() => {
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [poll])

  useEffect(() => {
    scrollToBottom()
  }, [messages.length, scrollToBottom])

  const onSend = async () => {
    const body = text.trim()
    if (!body || sending) return

    const tempId = `temp-${Date.now()}`
    const optimistic: ProjectChatMessageDto = {
      id: tempId,
      senderType: "client",
      senderName: "You",
      body,
      delivered: false,
      createdAt: new Date().toISOString(),
    }
    pendingIds.current.add(tempId)
    setMessages((prev) => [...prev, optimistic])
    setText("")
    setSending(true)

    try {
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      })
      const data = (await response.json().catch(() => null)) as {
        message?: ProjectChatMessageDto | string
        errors?: unknown
      } | null

      if (!response.ok || !data?.message || typeof data.message === "string") {
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
        toast.error(
          typeof data?.message === "string"
            ? data.message
            : "Could not send message.",
        )
        return
      }

      pendingIds.current.delete(tempId)
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempId),
        data.message as ProjectChatMessageDto,
      ])
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      toast.error("Unable to reach the server.")
    } finally {
      setSending(false)
    }
  }

  return (
    <section
      className={cn(
        "flex flex-col rounded-2xl border border-border/60 bg-[hsl(var(--surface-1))]/40",
        compact ? "h-[28rem]" : "h-[65vh] min-h-[28rem]",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3.5">
        <MessageSquare className="h-4 w-4 text-primary" />
        <h2 className="font-display text-sm font-semibold tracking-tight">
          Project chat
        </h2>
        <div className="ml-auto">
          <NotificationsToggle />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-5 py-4"
      >
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No messages yet. Send us a note about this project and our team
            will reply here.
          </p>
        ) : (
          messages.map((message) => (
            <ChatBubble key={message.id} message={message} />
          ))
        )}
      </div>

      {canWrite ? (
        <div className="flex items-end gap-2 border-t border-border/60 px-4 py-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void onSend()
              }
            }}
            placeholder="Write a message…"
            rows={1}
            className="min-h-[2.5rem] flex-1 resize-none"
          />
          <Button
            type="button"
            size="icon"
            disabled={sending || !text.trim()}
            onClick={() => void onSend()}
            aria-label="Send message"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      ) : (
        <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
          You have read-only access to this project.
        </p>
      )}
    </section>
  )
}

/** Converts a URL-safe base64 VAPID key into the Uint8Array pushManager.subscribe expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

type PushStatus = "checking" | "unsupported" | "denied" | "off" | "on"

/**
 * Inline opt-in for Web Push notifications on new team replies. Reflects the
 * browser's real subscription state (not just a local flag) so it stays
 * correct across devices/sessions — see lib/push.ts for the send side.
 */
function NotificationsToggle() {
  const [status, setStatus] = useState<PushStatus>("checking")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function check() {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancelled) setStatus("unsupported")
        return
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("denied")
        return
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration("/sw.js")
        const subscription = registration
          ? await registration.pushManager.getSubscription()
          : null
        if (!cancelled) setStatus(subscription ? "on" : "off")
      } catch {
        if (!cancelled) setStatus("off")
      }
    }

    void check()
    return () => {
      cancelled = true
    }
  }, [])

  const enable = async () => {
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off")
        if (permission === "denied") {
          toast.error("Notifications are blocked for this site in your browser.")
        }
        return
      }

      const keyResponse = await fetch("/api/push/vapid-public-key", {
        credentials: "same-origin",
      })
      if (!keyResponse.ok) {
        toast.error("Notifications aren't set up yet.")
        return
      }
      const { publicKey } = (await keyResponse.json()) as { publicKey: string }

      const registration = await navigator.serviceWorker.register("/sw.js")
      await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })

      await fetch("/api/account/push-subscription", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      })

      setStatus("on")
      toast.success("Notifications enabled for this browser.")
    } catch {
      toast.error("Could not enable notifications.")
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js")
      const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null
      if (subscription) {
        await fetch("/api/account/push-subscription", {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        await subscription.unsubscribe()
      }
      setStatus("off")
      toast.success("Notifications turned off.")
    } catch {
      toast.error("Could not turn off notifications.")
    } finally {
      setBusy(false)
    }
  }

  if (status === "checking" || status === "unsupported") return null

  if (status === "denied") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled
        className="gap-1.5 text-xs text-muted-foreground/60"
        title="Notifications are blocked in your browser settings"
      >
        <BellOff className="h-3.5 w-3.5" />
        Blocked
      </Button>
    )
  }

  if (status === "on") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => void disable()}
        className="gap-1.5 text-xs text-primary hover:text-primary"
        title="Turn off notifications for this browser"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <BellRing className="h-3.5 w-3.5" />
        )}
        Notifications on
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={() => void enable()}
      className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Bell className="h-3.5 w-3.5" />
      )}
      Enable notifications
    </Button>
  )
}

function ChatBubble({ message }: { message: ProjectChatMessageDto }) {
  const isClient = message.senderType === "client"
  const isSystem = message.senderType === "system"

  if (isSystem) {
    return (
      <p className="py-1 text-center text-xs text-muted-foreground/70">
        {message.body}
      </p>
    )
  }

  return (
    <div className={cn("flex", isClient ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isClient
            ? "bg-primary/15 text-foreground"
            : "border border-border/60 bg-foreground/[0.03] text-foreground",
        )}
      >
        <p className="mb-0.5 text-xs font-medium text-muted-foreground">
          {isClient ? "You" : message.senderName}
          {" · "}
          {formatTime(message.createdAt)}
          {isClient && !message.delivered && !message.id.startsWith("temp-")
            ? " · sending…"
            : null}
        </p>
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
      </div>
    </div>
  )
}
