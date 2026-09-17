import { NextResponse, type NextRequest } from "next/server"
import { isProjectChatSyncEnabled } from "@/lib/company-chat-gate"
import { findProjectByYougileChatId } from "@/lib/repositories/projects"
import {
  findProjectChatMessageByYougileId,
  insertProjectChatMessage,
} from "@/lib/repositories/project-chat"
import { getYouGileConfig } from "@/lib/yougile"

export const runtime = "nodejs"

/**
 * Receives YouGile's `chat_message-created` webhook and mirrors team
 * replies into the site chat (see project_chat_messages / the two-way sync
 * plan). No user session here — auth is a shared secret in `?token=`,
 * matched against YOUGILE_WEBHOOK_SECRET.
 *
 * We always answer fast with 200/204 and only log failures: YouGile retries
 * webhooks on non-2xx responses, and a bad/slow event here should never
 * take down message ingestion.
 */

type YouGileWebhookEnvelope = {
  event?: unknown
  eventType?: unknown
  type?: unknown
  data?: unknown
}

/**
 * Field names confirmed against the real ChatMessageListDtoBase (see
 * https://yougile.com/api-json): `id` (a numeric timestamp) and
 * `fromUserId`. `chatId` isn't part of that DTO (it's implicit in the
 * `/chats/{chatId}/messages` URL for direct API calls) — the outbound
 * webhook envelope isn't documented anywhere, so several historical/likely
 * alternate spellings are kept as fallbacks in case YouGile's actual
 * payload differs; unmatched shapes are logged via `rawBody` for
 * debugging.
 */
type YouGileWebhookMessageData = {
  id?: unknown
  chatId?: unknown
  chat_id?: unknown
  fromUserId?: unknown
  from_user_id?: unknown
  authorId?: unknown
  author_id?: unknown
  userId?: unknown
  fromUserName?: unknown
  authorName?: unknown
  author_name?: unknown
  text?: unknown
  textHtml?: unknown
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

/** `id` is a number (timestamp) per the real schema; also accepts a string. */
function asId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return asString(value)
}

function isChatMessageCreatedEvent(envelope: YouGileWebhookEnvelope): boolean {
  const event =
    asString(envelope.event) ??
    asString(envelope.eventType) ??
    asString(envelope.type) ??
    ""
  const normalized = event.toLowerCase().replace(/[\s_-]+/g, "")
  return normalized.includes("chatmessage") && normalized.includes("creat")
}

function checkToken(request: NextRequest): boolean {
  let secret: string | undefined
  try {
    secret = getYouGileConfig().webhookSecret
  } catch {
    // YOUGILE_API_KEY missing entirely — treat like "not configured".
    secret = undefined
  }
  if (!secret) {
    // No secret configured — refuse rather than silently accept unverified
    // events once this route is wired up in production.
    return false
  }
  const token = request.nextUrl.searchParams.get("token")
  return token === secret
}

export async function POST(request: NextRequest) {
  if (!checkToken(request)) {
    return NextResponse.json({ message: "Invalid token." }, { status: 401 })
  }

  const rawBody = await request.text()
  let envelope: YouGileWebhookEnvelope | null = null
  try {
    envelope = JSON.parse(rawBody) as YouGileWebhookEnvelope
  } catch {
    console.error("[webhooks/yougile] invalid JSON body", { rawBody })
    return NextResponse.json({ ok: true })
  }

  if (!envelope || !isChatMessageCreatedEvent(envelope)) {
    // Not the event we care about (or an unrecognized envelope shape) —
    // acknowledge so YouGile doesn't retry, but log for shape debugging.
    console.warn("[webhooks/yougile] ignored event", { rawBody })
    return NextResponse.json({ ok: true })
  }

  const data = (envelope.data ?? envelope) as YouGileWebhookMessageData
  const yougileMessageId = asId(data.id)
  const chatId = asString(data.chatId) ?? asString(data.chat_id)
  const authorId =
    asString(data.fromUserId) ??
    asString(data.from_user_id) ??
    asString(data.authorId) ??
    asString(data.author_id) ??
    asString(data.userId)
  const text = asString(data.text) ?? asString(data.textHtml) ?? ""

  if (!yougileMessageId || !chatId) {
    console.error("[webhooks/yougile] missing id/chatId in payload", { rawBody })
    return NextResponse.json({ ok: true })
  }

  try {
    const config = getYouGileConfig()
    if (config.botUserId && authorId === config.botUserId) {
      // Echo of a message the site itself sent — already stored via the
      // POST /chat route, so ignore it here.
      return NextResponse.json({ ok: true })
    }

    const existing = await findProjectChatMessageByYougileId(yougileMessageId)
    if (existing) {
      return NextResponse.json({ ok: true })
    }

    const project = await findProjectByYougileChatId(chatId)
    if (!project) {
      // Not a project chat we manage (e.g. a chat created outside the site).
      return NextResponse.json({ ok: true })
    }

    /**
     * Зеркало у компании выключено — событие принимаем и выбрасываем (§2.6).
     *
     * Именно 200, а не отказ: YouGile повторяет доставку на любой не-2xx, и
     * отказ здесь превратил бы выключенное зеркало в бесконечные ретраи с их
     * стороны. Проверка после поиска проекта — до него владельца ещё нет.
     */
    if (!(await isProjectChatSyncEnabled(project.userId))) {
      return NextResponse.json({ ok: true })
    }

    const senderName =
      asString(data.fromUserName) ??
      asString(data.authorName) ??
      asString(data.author_name) ??
      "YouGile"

    await insertProjectChatMessage({
      projectId: project.id,
      senderType: "team",
      senderName,
      body: text,
      yougileMessageId,
      delivered: true,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[webhooks/yougile] failed to process event", error)
    return NextResponse.json({ ok: true })
  }
}
