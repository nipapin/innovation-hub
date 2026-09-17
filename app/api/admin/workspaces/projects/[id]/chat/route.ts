import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { isProjectChatSyncEnabled } from "@/lib/company-chat-gate"
import { sendProjectChatMessageSchema } from "@/lib/project-chat-schemas"
import { syncProjectChatFromYouGile } from "@/lib/project-chat-sync"
import {
  insertProjectChatMessage,
  listProjectChatMessages,
  markProjectChatMessageDelivered,
} from "@/lib/repositories/project-chat"
import { findProjectById } from "@/lib/repositories/projects"
import { findUserById } from "@/lib/repositories/users"
import { deliverProjectMessageToYouGile } from "@/lib/project-yougile-chat"
import { isYouGileConfigured, YouGileError } from "@/lib/yougile"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Тот же чат проекта, но с другой стороны.
 *
 * В кабинете сообщения пользователя пишутся как 'client', здесь ответ админа —
 * как 'team', то есть ровно то, что приходит из YouGile, когда команда отвечает
 * оттуда. Пользователь видит его как сообщение команды, независимо от того,
 * написали его в YouGile или в админке.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "projects.access")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectById(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  await syncProjectChatFromYouGile(project)

  const messages = await listProjectChatMessages(project.id)
  return NextResponse.json({ messages })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "projects.access")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectById(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  const payload = await request.json().catch(() => null)
  const parsed = sendProjectChatMessageSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Enter a valid message.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const admin = await findUserById(auth.userId)
  const senderName = admin?.fullName?.trim() || auth.email

  let message = await insertProjectChatMessage({
    projectId: project.id,
    senderType: "team",
    senderUserId: auth.userId,
    senderName,
    body: parsed.data.text,
  })

  // Уходит в YouGile, чтобы команда видела ответ там же, где переписку клиента.
  // Сообщение уже сохранено — сбой доставки не должен его терять, поэтому
  // только логируем и оставляем delivered: false.
  //
  // Обратной синхронизацией это не задублируется: отправляем ботом, а
  // syncProjectChatFromYouGile сообщения бота отбрасывает по fromUserId.
  // Зеркало выключено у компании — ответ админа остаётся на сайте и в YouGile
  // не уезжает (§2.6). Сам чат здесь намеренно НЕ закрыт: это наша сторона
  // переписки, и она нужна нам читаемой независимо от набора клиента.
  if (isYouGileConfigured() && (await isProjectChatSyncEnabled(project.ownerId))) {
    try {
      const ownerEmail = (await findUserById(project.ownerId))?.email ?? ""
      const yougileMessageId = await deliverProjectMessageToYouGile({
        projectId: project.id,
        projectName: project.name,
        yougileChatId: project.yougileChatId,
        writerEmail: ownerEmail,
        text: `${senderName} (админ сайта): ${parsed.data.text}`,
      })
      await markProjectChatMessageDelivered(message.id, yougileMessageId)
      message = { ...message, yougileMessageId, delivered: true }
    } catch (error) {
      console.error("[pipeline/chat] YouGile delivery failed", {
        projectId: project.id,
        error: error instanceof YouGileError ? error.message : error,
      })
    }
  }

  return NextResponse.json({ message })
}
