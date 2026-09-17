import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { isProjectChatSyncEnabled } from "@/lib/company-chat-gate"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"
import { findUserById } from "@/lib/repositories/users"
import { requireProjectAccess } from "@/lib/project-access"
import {
  insertProjectChatMessage,
  listProjectChatMessages,
  markProjectChatMessageDelivered,
} from "@/lib/repositories/project-chat"
import { sendProjectChatMessageSchema } from "@/lib/project-chat-schemas"
import { syncProjectChatFromYouGile } from "@/lib/project-chat-sync"
import { deliverProjectMessageToYouGile } from "@/lib/project-yougile-chat"
import { isYouGileConfigured, YouGileError } from "@/lib/yougile"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

const RATE_LIMIT = 20
const RATE_WINDOW_MS = 10 * 60 * 1000

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const access = await requireProjectAccess(id, auth.userId)
  if (access instanceof NextResponse) return access
  const project = access.project

  // YouGile's webhook only fires for messages sent through its own REST
  // API, never for messages typed directly in the YouGile app — so team
  // replies have to be pulled here instead of pushed to us. See
  // lib/project-chat-sync.ts for details.
  await syncProjectChatFromYouGile(project)

  const messages = await listProjectChatMessages(project.id)
  return NextResponse.json({ messages })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const ip = getClientIp(request)
  const rate = checkRateLimit(`project-chat:${auth.userId}:${ip}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (!rate.allowed) {
    return NextResponse.json(
      { message: `Too many messages. Try again in ${rate.retryAfterSec} seconds.` },
      { status: 429 },
    )
  }

  const { id } = await context.params
  const access = await requireProjectAccess(id, auth.userId, "editor")
  if (access instanceof NextResponse) return access
  const project = access.project

  const payload = await request.json().catch(() => null)
  const parsed = sendProjectChatMessageSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Enter a valid message.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const user = await findUserById(auth.userId)
  const senderName = user?.fullName?.trim() || auth.email

  let message = await insertProjectChatMessage({
    projectId: project.id,
    senderType: "client",
    senderUserId: auth.userId,
    senderName,
    body: parsed.data.text,
  })

  // The message is already safely stored; a YouGile delivery failure should
  // not make the user lose it — just log and leave `delivered: false`.
  // Зеркало — отдельное решение от самого чата: компания может писать нам, не
  // отдавая переписку в нашу внутреннюю доску (§2.6). Сообщение при этом уже
  // сохранено и видно обеим сторонам на сайте.
  if (isYouGileConfigured() && (await isProjectChatSyncEnabled(project.userId))) {
    try {
      const yougileMessageId = await deliverProjectMessageToYouGile({
        projectId: project.id,
        projectName: project.name,
        yougileChatId: project.yougileChatId,
        writerEmail: auth.email,
        text: `${senderName}: ${parsed.data.text}`,
      })
      await markProjectChatMessageDelivered(message.id, yougileMessageId)
      message = { ...message, yougileMessageId, delivered: true }
    } catch (error) {
      console.error("[api/projects/chat] YouGile delivery failed", {
        projectId: project.id,
        error: error instanceof YouGileError ? error.message : error,
      })
    }
  }

  return NextResponse.json({ message })
}
