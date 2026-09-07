import { NextResponse, type NextRequest } from "next/server"
import { isEnvFeatureEnabled } from "@/lib/features-env"
import { requireUserApi } from "@/lib/admin-auth"
import { featureSuggestionSchema } from "@/lib/feature-suggestion-schemas"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"

export const runtime = "nodejs"

const RATE_LIMIT = 3
const RATE_WINDOW_MS = 10 * 60 * 1000

export async function POST(request: NextRequest) {
  // Страницы этого раздела на установке нет — не должно быть и данных: живой
  // роут отдавал бы содержимое того, чего на сайте не существует.
  if (!isEnvFeatureEnabled("public.pages")) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const ip = getClientIp(request)
  const rate = checkRateLimit(
    `feature-suggestion:${ip}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  )
  if (!rate.allowed) {
    return NextResponse.json(
      {
        message: `Too many submissions. Try again in ${rate.retryAfterSec} seconds.`,
      },
      { status: 429 },
    )
  }

  const payload = await request.json().catch(() => null)
  const parsed = featureSuggestionSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Please check the form and try again.",
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  if (parsed.data.website?.trim()) {
    return NextResponse.json({ message: "Invalid submission." }, { status: 400 })
  }

  // TODO(yougile): no delivery integration is wired up yet. Send this into
  // YouGile (chat message / task) once that integration lands — see
  // `lib/feature-suggestion-schemas.ts` for the note builder, still usable as-is.
  console.warn("[api/feature-suggestions] delivery not configured", {
    name: parsed.data.name,
    email: parsed.data.email,
  })

  return NextResponse.json(
    {
      message: "Submission service is not configured. Please try again later.",
    },
    { status: 503 },
  )
}
