import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { requireUserApi } from "@/lib/admin-auth"
import { connectAccount, listAccounts } from "@/lib/social/accounts"
import { platformAdapter } from "@/lib/social/platforms"
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_INFO,
  isSocialPlatform,
  type SocialPlatform,
} from "@/lib/social/types"
import { vaultConfigured } from "@/lib/vault/crypto"

export const runtime = "nodejs"

/**
 * «Аккаунты площадок» — то, чем сайт публикует от имени человека.
 *
 * Только СВОИ: фильтр по владельцу стоит в каждом запросе репозитория, а не в
 * этом файле. Админского близнеца у роута нет намеренно — аккаунт площадки не
 * студийный ресурс, и распоряжаться чужим VK у нас нет ни повода, ни права.
 *
 * Разбор — docs/SOCIAL_POSTING_PLAN.md §4.
 */

const connectSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  /** Адрес с токеном, сам токен или токен бота — разбирает адаптер площадки. */
  raw: z.string().trim().min(1).max(8192),
  label: z.string().trim().max(64).optional(),
})

export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const platformParam = request.nextUrl.searchParams.get("platform")
  const platform: SocialPlatform | undefined = isSocialPlatform(platformParam)
    ? platformParam
    : undefined

  /**
   * Список аккаунтов может не прочитаться — например, до применения миграций
   * таблицы просто нет. Каталог площадок при этом ЗНАТЬ НЕ ОБЯЗАН: он
   * статический, базы не касается, и ронять его вместе с базой значит забрать у
   * человека кнопку «Открыть вход» ровно тогда, когда что-то сломалось.
   *
   * Ошибку не проглатываем: она уезжает в ответ отдельным полем и показывается
   * на экране. Пустой список без объяснения — худшее, что здесь можно сделать:
   * он выглядит как «аккаунтов нет», а не как «спросить не удалось».
   */
  let accounts: Awaited<ReturnType<typeof listAccounts>> = []
  let accountsError: string | null = null
  try {
    accounts = await listAccounts(auth.userId, platform)
  } catch (error) {
    accountsError = error instanceof Error ? error.message : String(error)
    console.error("[social] cannot list accounts", error)
  }

  return NextResponse.json({
    accounts,
    accountsError,
    /**
     * Площадки отдаём вместе со списком: экрану нужно знать не только что уже
     * подключено, но и что подключить МОЖНО — иначе «а где YouTube?» станет
     * вопросом в поддержку.
     */
    platforms: SOCIAL_PLATFORMS.map((slug) => ({
      ...SOCIAL_PLATFORM_INFO[slug],
      connectable: platformAdapter(slug).connectable,
      /**
       * Куда ведёт кнопка «Открыть вход». Считается на сервере: адрес зависит
       * от `client_id` и набора прав, а держать их копию в браузере значило бы
       * разойтись с тем, что реально проверяет площадка.
       */
      authUrl: platformAdapter(slug).authUrl(),
    })),
    /**
     * Без мастер-ключа подключать нечего: сайт откажется писать секрет,
     * который не сможет прочитать. Экран должен сказать это заранее, а не
     * после заполненной формы.
     */
    vaultReady: vaultConfigured(),
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = connectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const result = await connectAccount({
    // Владелец — всегда сам вызывающий. Поля «чей аккаунт» здесь нет и быть не
    // может: иначе человек подключил бы аккаунт от чужого имени.
    userId: auth.userId,
    platform: parsed.data.platform,
    raw: parsed.data.raw,
    label: parsed.data.label,
  })

  if (!result.ok) {
    // 400 на отказ площадки, а не 502: с точки зрения человека это ответ на то,
    // что он вставил, и исправляет он именно это.
    const status = result.code === "vault" ? 503 : 400
    return NextResponse.json(
      { code: result.code, message: result.message },
      { status },
    )
  }

  return NextResponse.json(
    { account: result.account, replaced: result.replaced },
    { status: result.replaced ? 200 : 201 },
  )
}
