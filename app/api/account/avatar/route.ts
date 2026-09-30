import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { getSessionLogin } from "@/lib/admin-auth"
import {
  avatarObjectPrefix,
  avatarUrlForKey,
  isOwnAvatarObject,
} from "@/lib/avatar"
import { setAvatarKey } from "@/lib/repositories/users"
import { getS3Client } from "@/lib/s3-client"
import { buildS3ObjectKey, getS3Bucket } from "@/lib/s3-config"
import { safeBaseFileName } from "@/lib/s3-upload-policy"

export const runtime = "nodejs"

/**
 * Аватар человека (docs: миграция 2026-09-29-user-avatars.sql).
 *
 * POST — ссылка на заливку, PUT — сохранить залитое, DELETE — снять. Всё на
 * ВХОДЕ, а не на профиле: аватар общий во всех рабочих местах человека.
 *
 * SVG не принимаем по той же причине, что у логотипов компаний: отдаём файл со
 * своего адреса, и скрипт внутри исполнился бы с нашими куками.
 */
const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])

const presignSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
})

export async function POST(request: NextRequest) {
  const session = await getSessionLogin()
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }

  const parsed = presignSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }
  const contentType = parsed.data.contentType.trim().toLowerCase()
  if (!AVATAR_TYPES.has(contentType)) {
    return NextResponse.json(
      { message: "Upload a PNG, JPEG or WebP image.", code: "unsupported-type" },
      { status: 400 },
    )
  }

  const key = buildS3ObjectKey(
    `${avatarObjectPrefix(session.loginUserId)}avatar-${Date.now()}-${safeBaseFileName(parsed.data.fileName)}`,
  )
  // ContentType в подпись не кладём — см. разбор в app/api/admin/upload/presign.
  const uploadUrl = await getSignedUrl(
    getS3Client(),
    new PutObjectCommand({ Bucket: getS3Bucket(), Key: key }),
    { expiresIn: 900 },
  )
  return NextResponse.json({ uploadUrl, key, method: "PUT" as const })
}

const saveSchema = z.object({ key: z.string().min(1).max(500) })

export async function PUT(request: NextRequest) {
  const session = await getSessionLogin()
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }
  const parsed = saveSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }
  // Ключ от клиента: сверяем с префиксом ЭТОГО входа, иначе аватаром стал бы
  // любой объект бакета.
  if (!isOwnAvatarObject(parsed.data.key, session.loginUserId)) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 })
  }
  return replaceAvatar(session.loginUserId, parsed.data.key)
}

export async function DELETE() {
  const session = await getSessionLogin()
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }
  return replaceAvatar(session.loginUserId, null)
}

async function replaceAvatar(loginUserId: string, key: string | null) {
  const result = await setAvatarKey(loginUserId, key)
  if (!result) {
    return NextResponse.json({ message: "Account not found." }, { status: 404 })
  }
  // Прежний объект сносим по ключу из БАЗЫ и только свой: иначе при замене он
  // висел бы в хранилище, ни на что не ссылаясь.
  const previous = result.previous
  if (previous && previous !== key && isOwnAvatarObject(previous, loginUserId)) {
    await getS3Client()
      .send(new DeleteObjectCommand({ Bucket: getS3Bucket(), Key: previous }))
      .catch((error) => {
        console.error("[account/avatar] delete previous failed", error)
      })
  }
  return NextResponse.json({ avatarUrl: avatarUrlForKey(key) })
}
