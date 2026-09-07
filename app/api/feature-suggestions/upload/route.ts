import { randomUUID } from "node:crypto"
import { isEnvFeatureEnabled } from "@/lib/features-env"
import { Upload } from "@aws-sdk/lib-storage"
import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  getPublicUploadMaxBytes,
} from "@/lib/public-upload-policy"
import { relativeMediaUrlForKey } from "@/lib/attachment-public-url"
import { buildS3ObjectKey, getS3Bucket } from "@/lib/s3-config"
import { getS3Client } from "@/lib/s3-client"
import {
  resolveUploadContentType,
  safeBaseFileName,
} from "@/lib/s3-upload-policy"

export const runtime = "nodejs"
export const maxDuration = 120

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status })
}

function decodeFileNameHeader(value: string | null): string {
  if (!value) return "upload"
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

async function runUpload(request: NextRequest): Promise<Response> {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const maxBytes = getPublicUploadMaxBytes()

  const url = new URL(request.url)
  const fileNameRaw =
    url.searchParams.get("fileName") ??
    request.headers.get("x-file-name") ??
    "upload"
  const fileName = decodeFileNameHeader(fileNameRaw)

  const headerType = request.headers.get("content-type") ?? ""
  const contentType = resolveUploadContentType({
    name: fileName,
    type: headerType,
  })
  if (!contentType) {
    return jsonError("Unsupported file type for upload.", 400)
  }

  const declaredLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10,
  )
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return jsonError(`File too large (max ${maxBytes} bytes).`, 413)
  }

  if (!request.body) {
    return jsonError("Empty request body.", 400)
  }

  let bucket: string
  let key: string
  try {
    bucket = getS3Bucket()
    key = buildS3ObjectKey(
      `feature-suggestions/${randomUUID()}-${safeBaseFileName(fileName)}`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Storage configuration error."
    return jsonError(msg, 500)
  }

  let client: ReturnType<typeof getS3Client>
  try {
    client = getS3Client()
  } catch (e) {
    const msg = e instanceof Error ? e.message : "S3 client configuration error."
    return jsonError(msg, 500)
  }

  try {
    const upload = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: request.body,
        ContentType: contentType,
      },
      partSize: 8 * 1024 * 1024,
      queueSize: 4,
      leavePartsOnError: false,
    })

    await upload.done()

    return NextResponse.json({
      key,
      contentType,
      /** Relative path — resolved to a public/presigned URL for external delivery. */
      url: relativeMediaUrlForKey(key),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "S3 upload failed."
    return jsonError(msg, 502)
  }
}

export async function POST(request: NextRequest) {
  // Страницы этого раздела на установке нет — не должно быть и данных: живой
  // роут отдавал бы содержимое того, чего на сайте не существует.
  if (!isEnvFeatureEnabled("public.pages")) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  try {
    return await runUpload(request)
  } catch (e) {
    console.error("[api/feature-suggestions/upload]", e)
    const msg =
      e instanceof Error ? e.message : "Unexpected error in upload handler."
    return jsonError(msg, 500)
  }
}
