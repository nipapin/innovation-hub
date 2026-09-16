import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { companyObjectPrefix, isOwnCompanyObject } from "@/lib/branding"
import { findCompanyById } from "@/lib/repositories/companies"
import { getS3Client } from "@/lib/s3-client"
import {
  appMediaProxyPathForKey,
  buildS3ObjectKey,
  getS3Bucket,
  publicObjectUrlForKey,
} from "@/lib/s3-config"
import { safeBaseFileName } from "@/lib/s3-upload-policy"

export const runtime = "nodejs"

/**
 * Ссылка на загрузку логотипа компании.
 *
 * Свой роут, а не общий `/api/admin/upload/presign`: тот стоит под тегом
 * `content.manage` — «видео и идеи сайта». Оформление компании выдаётся тегом
 * `companies.manage`, и человек с ним не обязан иметь права на контент сайта.
 * Расширять смысл чужого тега ради одной кнопки — способ однажды выдать лишнее.
 *
 * Ключ кладётся под `companies/<slug>/`, а не в общую кучу `admin/`: так
 * логотипы видно глазами в хранилище, и удалить их вместе с компанией можно
 * префиксом.
 */
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])

const schema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
})

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const company = await findCompanyById(id)
  if (!company) {
    return NextResponse.json({ message: "Company not found." }, { status: 404 })
  }

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }

  const contentType = parsed.data.contentType.trim().toLowerCase()
  /**
   * SVG не принимаем намеренно, хотя логотипы чаще всего именно в нём.
   *
   * SVG — это документ, а не картинка: внутри может лежать скрипт, а отдаём мы
   * файл со СВОЕГО адреса через `/api/media/`. Значит чужой скрипт исполнился бы
   * в нашем источнике, со всеми куками сессии. Пускать его стоит только вместе с
   * чисткой содержимого или отдачей с отдельного домена — это отдельная работа,
   * а не галочка в списке типов.
   */
  if (!LOGO_TYPES.has(contentType)) {
    return NextResponse.json(
      {
        message: "Upload a PNG, JPEG or WebP image.",
        code: "unsupported-type",
      },
      { status: 400 },
    )
  }

  const key = buildS3ObjectKey(
    `${companyObjectPrefix(company.slug)}logo-${Date.now()}-${safeBaseFileName(parsed.data.fileName)}`,
  )

  // ContentType в подпись не кладём — см. разбор в app/api/admin/upload/presign.
  const uploadUrl = await getSignedUrl(
    getS3Client(),
    new PutObjectCommand({ Bucket: getS3Bucket(), Key: key }),
    { expiresIn: 900 },
  )

  return NextResponse.json({
    uploadUrl,
    key,
    method: "PUT" as const,
    contentType,
    // CDN — только подтверждённый; иначе путь прокси. Разбор — в
    // publicObjectUrlForKey (lib/s3-config.ts).
    publicUrl: publicObjectUrlForKey(key) ?? appMediaProxyPathForKey(key),
  })
}

const deleteSchema = z.object({ key: z.string().min(1).max(500) })

/**
 * Убрать залитый объект.
 *
 * Нужен для одного случая: файл ушёл в хранилище, а сохранение оформления
 * следом не прошло. Объект в этот момент уже существует, но ни на что не
 * ссылается — и без этого вызова остался бы висеть навсегда.
 *
 * Удаление при ЗАМЕНЕ и СНЯТИИ логотипа делает не этот роут, а сохранение
 * оформления: там прежний ключ известен из базы, то есть из своего источника, а
 * не со слов клиента.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const company = await findCompanyById(id)
  if (!company) {
    return NextResponse.json({ message: "Company not found." }, { status: 404 })
  }

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }

  // Ключ приходит от клиента, поэтому сверяется с префиксом ЭТОЙ компании:
  // иначе роут стал бы «удалить любой объект бакета» по чужому имени.
  if (!isOwnCompanyObject(parsed.data.key, company.slug)) {
    return NextResponse.json(
      { message: "This object does not belong to the company.", code: "foreign-key" },
      { status: 403 },
    )
  }

  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: getS3Bucket(), Key: parsed.data.key }),
  )
  return NextResponse.json({ ok: true })
}
