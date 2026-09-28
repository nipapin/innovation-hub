import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getSessionLogin, requireUserApi } from "@/lib/admin-auth"
import {
  deletePushSubscriptionByEndpoint,
  upsertPushSubscription,
} from "@/lib/repositories/push-subscriptions"

export const runtime = "nodejs"

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
})

/**
 * Registers (or updates) a browser's push subscription for the current user.
 *
 * Подписка — на ВХОД, а не на активный профиль (docs/MULTI_COMPANY_PROFILES_PLAN.md
 * §9.4): браузер один, а профилей у человека несколько. Запиши её на профиль —
 * и уведомления из других компаний не доходили бы, пока человек в этой.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  const session = await getSessionLogin()

  const payload = await request.json().catch(() => null)
  const parsed = subscriptionSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid subscription." }, { status: 400 })
  }

  await upsertPushSubscription({
    userId: session?.loginUserId ?? auth.userId,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    userAgent: request.headers.get("user-agent") ?? "",
  })

  return NextResponse.json({ ok: true })
}

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
})

/** Removes a subscription — called when the user turns notifications off. */
export async function DELETE(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const payload = await request.json().catch(() => null)
  const parsed = unsubscribeSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 })
  }

  await deletePushSubscriptionByEndpoint(parsed.data.endpoint)
  return NextResponse.json({ ok: true })
}
