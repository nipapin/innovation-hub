import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { DeleteObjectCommand } from "@aws-sdk/client-s3"
import { ACCENT_KEYS, isOwnCompanyObject, readBranding } from "@/lib/branding"
import { getS3Client } from "@/lib/s3-client"
import { getS3Bucket } from "@/lib/s3-config"
import {
  accentContrast,
  isHslToken,
  nearestReadable,
  MIN_CONTRAST,
} from "@/lib/color-contrast"
import {
  findCompanyById,
  setCompanyBranding,
  setCompanyDomain,
} from "@/lib/repositories/companies"

export const runtime = "nodejs"

/**
 * Оформление компании — docs/THEMING_PLAN.md §6.
 *
 * Настраивает суперадмин или админ с тегом `companies.manage`: на первом шаге
 * все первоначальные настройки делает наша сторона. Отдать это самой компании
 * можно будет отдельным тегом консоли, когда появится кому.
 *
 * Акцент — из ЗАКРЫТОГО набора, а не произвольный цвет (§6.2). Свободный hex
 * требовал бы проверки контраста в обеих темах, иначе первая же компания
 * поставит жёлтый и белый текст на кнопках исчезнет.
 */
const accentSchema = z.union([
  z.enum(ACCENT_KEYS as [string, ...string[]]),
  z.object({
    light: z.string().refine(isHslToken, "Expected an HSL token."),
    dark: z.string().refine(isHslToken, "Expected an HSL token."),
  }),
])

const schema = z.object({
  accent: accentSchema.optional(),
  /** Пустая строка — снять логотип и вернуть монограмму. */
  logoUrl: z.string().max(500).nullable().optional(),
  /** Ключ объекта, если логотип залит файлом. По нему потом удаляется прежний. */
  logoKey: z.string().max(500).nullable().optional(),
  /** Пустая строка — считать монограмму из названия. */
  monogram: z.string().max(2).nullable().optional(),
  /** Пустая строка — отвязать домен. */
  domain: z
    .string()
    .max(253)
    .regex(/^$|^[a-z0-9.-]+$/i, "Invalid domain.")
    .nullable()
    .optional(),
})

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const company = await findCompanyById(id)
  if (!company) {
    return NextResponse.json({ message: "Company not found." }, { status: 404 })
  }

  /**
   * Свой цвет проверяется на читаемость ЗДЕСЬ, а не только в форме: проверка,
   * живущая в интерфейсе, обходится одним запросом мимо него. Наборы проверены
   * заранее и повторной проверки не требуют.
   *
   * Отказ называет тему и отношение: «не подходит» без числа человек не знает,
   * насколько промахнулся и в какую сторону крутить.
   */
  if (parsed.data.accent && typeof parsed.data.accent !== "string") {
    const pair = parsed.data.accent
    const failed = (["light", "dark"] as const)
      .map((theme) => ({ theme, ratio: accentContrast(pair[theme], theme) }))
      .filter(({ ratio }) => ratio < MIN_CONTRAST)

    if (failed.length > 0) {
      return NextResponse.json(
        {
          message: "This accent is not readable enough for button text.",
          code: "low-contrast",
          failed: failed.map(({ theme, ratio }) => ({
            theme,
            ratio: Math.round(ratio * 100) / 100,
            required: MIN_CONTRAST,
            suggestion: nearestReadable(pair[theme], theme),
          })),
        },
        { status: 422 },
      )
    }
  }

  if (parsed.data.domain !== undefined) {
    const domain = parsed.data.domain?.trim().toLowerCase() || null
    const result = await setCompanyDomain({ companyId: id, domain })
    if (!result.ok) {
      return NextResponse.json(
        {
          message:
            result.reason === "domain-taken"
              ? "This domain already belongs to another company."
              : "Company not found.",
          code: result.reason,
        },
        { status: result.reason === "domain-taken" ? 409 : 404 },
      )
    }
  }

  // Правим поверх текущего: экран шлёт то, что человек трогал, а не всё сразу.
  const current = readBranding(company.branding)
  const next = {
    accent: parsed.data.accent ?? current.accent,
    logoUrl:
      parsed.data.logoUrl === undefined
        ? current.logoUrl
        : parsed.data.logoUrl?.trim() || null,
    logoKey:
      parsed.data.logoKey === undefined
        ? current.logoKey
        : parsed.data.logoKey?.trim() || null,
    monogram:
      parsed.data.monogram === undefined
        ? current.monogram
        : parsed.data.monogram?.trim().toUpperCase() || null,
  }

  const updated = await setCompanyBranding({ companyId: id, branding: next })
  if (!updated) {
    return NextResponse.json({ message: "Company not found." }, { status: 404 })
  }

  /**
   * Прежний файл сносится ПОСЛЕ успешной записи, а не до.
   *
   * Порядок важен: удали мы сначала, а запись не прошла бы — компания осталась
   * бы со ссылкой на несуществующий объект, то есть с битой картинкой вместо
   * логотипа. Лишний файл в хранилище — меньшая беда, чем сломанное оформление.
   *
   * Ключ берётся из БАЗЫ (`current.logoKey`), а не из запроса: удаление
   * необратимо, и решать, что сносить, по присланному значению нельзя.
   */
  if (current.logoKey && current.logoKey !== next.logoKey) {
    if (isOwnCompanyObject(current.logoKey, company.slug)) {
      try {
        await getS3Client().send(
          new DeleteObjectCommand({
            Bucket: getS3Bucket(),
            Key: current.logoKey,
          }),
        )
      } catch (error) {
        // Оформление уже сохранено и работает. Не снёсшийся файл — повод для
        // записи в лог, а не для отказа тому, кто менял логотип.
        console.error("[branding] не удалось снести прежний логотип", error)
      }
    }
  }

  await auditFrom(request, auth)({
    action: "company.branding_changed",
    targetType: "company",
    targetId: id,
    targetLabel: company.title,
    companyId: id,
    meta: { accent: next.accent, domain: parsed.data.domain },
  })

  return NextResponse.json({ ok: true, branding: next })
}
