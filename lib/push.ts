import webpush from "web-push"
import {
  deletePushSubscriptionByEndpoint,
  listPushSubscriptionsByUserId,
} from "@/lib/repositories/push-subscriptions"
import { findCompanyById } from "@/lib/repositories/companies"
import { findUserById } from "@/lib/repositories/users"

export function isPushConfigured(): boolean {
  return !!(
    process.env.VAPID_PUBLIC_KEY?.trim() &&
    process.env.VAPID_PRIVATE_KEY?.trim() &&
    process.env.VAPID_SUBJECT?.trim()
  )
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null
}

let configured = false
function ensureConfigured() {
  if (configured) return
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.VAPID_SUBJECT?.trim()
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Web Push is not configured (missing VAPID_* env vars).")
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  configured = true
}

export type PushPayload = {
  title: string
  body: string
  /** Path (e.g. "/account/projects/123/chat") opened on notification click. */
  url: string
}

/**
 * Sends a push notification to every browser/device the user has subscribed
 * from. Best-effort: a subscription that the push service reports as gone
 * (404/410 — e.g. the user cleared browsing data or uninstalled) is deleted;
 * any other per-subscription failure is logged and otherwise ignored so one
 * dead device never blocks notifying the user's other devices.
 *
 * `userId` — профиль-адресат (docs/MULTI_COMPANY_PROFILES_PLAN.md §9.4).
 * Подписки лежат на его входе, поэтому уведомление приходит, какой бы профиль
 * ни был открыт. Профиль в компании — префикс «Компания · » в заголовке, а
 * ссылка несёт `?profile=`: страница сама переключится туда, где проект виден.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  if (!isPushConfigured()) return
  ensureConfigured()

  const profile = await findUserById(userId)
  const loginUserId = profile?.loginUserId ?? userId
  const subscriptions = await listPushSubscriptionsByUserId(loginUserId)
  if (subscriptions.length === 0) return

  const company = profile?.companyId ? await findCompanyById(profile.companyId) : null
  const message: PushPayload = {
    ...payload,
    title: company ? `${company.title} · ${payload.title}` : payload.title,
    url: withProfileParam(payload.url, userId),
  }

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(message),
        )
      } catch (error) {
        const statusCode =
          error && typeof error === "object" && "statusCode" in error
            ? (error as { statusCode?: number }).statusCode
            : undefined
        if (statusCode === 404 || statusCode === 410) {
          await deletePushSubscriptionByEndpoint(sub.endpoint).catch(() => {})
        } else {
          console.error("[push] sendNotification failed", {
            userId,
            statusCode,
            error,
          })
        }
      }
    }),
  )
}

/** Путь уведомления с `?profile=` — какой бы запрос в нём уже ни был. */
function withProfileParam(path: string, profileId: string): string {
  const url = new URL(path, "http://push.local")
  url.searchParams.set("profile", profileId)
  return `${url.pathname}${url.search}${url.hash}`
}
