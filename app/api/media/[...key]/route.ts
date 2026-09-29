import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { resolveProjectAccess } from "@/lib/project-access"
import { findFileByS3Key } from "@/lib/repositories/project-files"
import { findUserById } from "@/lib/repositories/users"
import { getS3Bucket, isAllowedMediaObjectKey } from "@/lib/s3-config"
import { getS3Client } from "@/lib/s3-client"
import { isElevated } from "@/lib/admin-roles"
import { hasCapability } from "@/lib/admin-capabilities"
import { listCapabilitiesFor } from "@/lib/repositories/admin-capabilities"

export const runtime = "nodejs"

type Params = {
  params: Promise<{ key?: string[] }>
}

const SIGNED_URL_TTL_SECONDS = 3600

function decodeKey(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return null
  const parts: string[] = []
  for (const segment of segments) {
    if (!segment) continue
    // Reject path-traversal attempts pre-decode and post-decode.
    if (segment.includes("..")) return null
    try {
      const decoded = decodeURIComponent(segment)
      if (decoded.includes("..") || decoded.includes("/")) return null
      parts.push(decoded)
    } catch {
      return null
    }
  }
  const key = parts.join("/")
  return key ? key : null
}

async function authorizeProjectKey(
  request: NextRequest,
  key: string,
): Promise<NextResponse | null> {
  const [namespace, keyStorageOwnerId, keyProjectId] = key.split("/")
  const isCurrentProjectKey =
    namespace === "projects" &&
    Boolean(keyStorageOwnerId && keyProjectId) &&
    /^[0-9a-f-]{36}$/i.test(keyStorageOwnerId) &&
    /^[0-9a-f-]{36}$/i.test(keyProjectId)
  const isLegacyProjectKey =
    key.startsWith("innohub/projects/") || key.startsWith("ffworks/projects/")
  if (!isCurrentProjectKey && !isLegacyProjectKey) return null

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }
  const session = await verifySessionToken(token)
  if (!session?.userId) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }

  const user = await findUserById(session.userId)
  if (!user || !user.isActive) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 })
  }

  // Чужие файлы открывает не всякий админ, а только тот, кому выдан
  // projects.access: это единственный тег, дающий смотреть чужое, и держать его
  // раздачу отдельно от самой админской роли — весь смысл разделения прав.
  // Машины сюда не ходят: /api/media — путь браузера, у него всегда сессия.
  if (isElevated(user.role)) {
    const capabilities = await listCapabilitiesFor(user.id)
    if (hasCapability(user.role, capabilities, "projects.access")) return null
  }

  // Доступ спрашиваем у базы, а не у ключа.
  //
  // Раньше здесь стоял быстрый путь `keyUserId === user.id`: сегмент ключа и был
  // владельцем, поэтому лишний запрос выглядел ненужным. С передачей проекта
  // другому человеку это перестало быть правдой — первый сегмент остаётся
  // прежним навсегда (`projects.storage_owner_id`), и по нему бывший владелец
  // продолжал бы открывать файлы проекта, которого у него больше нет.
  // См. docs/ADMIN_WORKSPACE_PLAN.md §5.4.
  //
  // Смотреть файл может не только владелец, а любой участник проекта, начиная с
  // читателя: право `read` у всех ролей (lib/project-roles.ts). Раньше здесь
  // стояло строгое `ownerId === user.id`, и тот, с кем поделились проектом, не
  // мог открыть в нём ни одного видео. Проверка — та же `resolveProjectAccess`,
  // что у роутов кабинета: владелец строго этим профилем, участие — своё или
  // входа. Нет доступа — 404, как везде: чужой проект не подтверждает, что он есть.
  if (isCurrentProjectKey && keyProjectId) {
    const access = await resolveProjectAccess(keyProjectId, user.id)
    if (!access) {
      return NextResponse.json({ message: "Not found." }, { status: 404 })
    }
    return null
  }

  // Старые ключи без проекта в пути: проект узнаём по строке каталога.
  const file = await findFileByS3Key(key)
  const access = file ? await resolveProjectAccess(file.projectId, user.id) : null
  if (!access) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }
  return null
}

export async function GET(request: NextRequest, { params }: Params) {
  const key = decodeKey((await params).key)
  if (!key) {
    return NextResponse.json({ message: "Invalid media key." }, { status: 400 })
  }

  // Hard-scope the proxy to objects under known app prefixes. Without this,
  // any caller could mint a signed URL for any object in the bucket — including
  // siblings owned by other tenants/apps sharing the same bucket.
  if (!isAllowedMediaObjectKey(key)) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  const denied = await authorizeProjectKey(request, key)
  if (denied) return denied

  try {
    const bucket = getS3Bucket()
    const client = getS3Client()
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })

    // ?raw=1: stream the object body instead of redirecting. The next/image
    // optimizer can't follow the 307 to the presigned URL, so thumbnails go
    // through this branch (the optimizer caches the result, so each image is
    // proxied rarely). Videos keep using the redirect for range requests.
    if (request.nextUrl.searchParams.has("raw")) {
      const object = await client.send(command)
      const body = object.Body?.transformToWebStream()
      if (!body) {
        return NextResponse.json({ message: "Not found." }, { status: 404 })
      }
      return new Response(body as unknown as ReadableStream, {
        headers: {
          "Content-Type": object.ContentType ?? "application/octet-stream",
          ...(object.ContentLength
            ? { "Content-Length": String(object.ContentLength) }
            : {}),
          "Cache-Control": "public, max-age=86400",
        },
      })
    }

    const signedGetUrl = await getSignedUrl(client, command, {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    })
    const response = NextResponse.redirect(signedGetUrl, { status: 307 })
    response.headers.set(
      "Cache-Control",
      `private, max-age=${Math.floor(SIGNED_URL_TTL_SECONDS / 2)}, must-revalidate`,
    )
    return response
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unable to open media."
    return NextResponse.json({ message: msg }, { status: 502 })
  }
}

export async function HEAD(request: NextRequest, context: Params) {
  return GET(request, context)
}
