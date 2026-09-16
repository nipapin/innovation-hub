/**
 * Presigned PUT URL for uploading directly to S3-compatible object storage
 * from the browser.
 *
 * Notes for S3-compatible providers:
 *  - The bucket MUST have CORS allowing PUT from the app origin
 *    (run `pnpm s3:set-cors`).
 *  - We deliberately do NOT pass ContentType to PutObjectCommand. If we did,
 *    Content-Type would be added to SignedHeaders, and the browser would
 *    have to send a byte-identical Content-Type or the upload would fail
 *    with SignatureDoesNotMatch *after* the body finishes uploading
 *    (manifests as a CORS / "network error" in XHR). S3 still stores the
 *    Content-Type the browser actually sends — it just isn't part of the
 *    signature.
 *  - Flexible checksums are disabled at the client level (see lib/s3-client.ts)
 *    so x-amz-sdk-checksum-algorithm / x-amz-checksum-* are never added to
 *    SignedHeaders either.
 */
import { randomUUID } from "node:crypto"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { getS3Client } from "@/lib/s3-client"
import {
  appMediaProxyPathForKey,
  buildS3ObjectKey,
  getS3Bucket,
  publicObjectUrlForKey,
} from "@/lib/s3-config"
import {
  isAllowedUploadContentType,
  safeBaseFileName,
} from "@/lib/s3-upload-policy"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "content.manage")
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const fileName =
    typeof body === "object" &&
    body !== null &&
    "fileName" in body &&
    typeof (body as { fileName?: unknown }).fileName === "string"
      ? (body as { fileName: string }).fileName.trim()
      : ""

  const contentType =
    typeof body === "object" &&
    body !== null &&
    "contentType" in body &&
    typeof (body as { contentType?: unknown }).contentType === "string"
      ? (body as { contentType: string }).contentType.trim().toLowerCase()
      : ""

  if (!fileName || !contentType || !isAllowedUploadContentType(contentType)) {
    return NextResponse.json(
      { message: "Invalid fileName or unsupported Content-Type." },
      { status: 400 },
    )
  }

  const bucket = getS3Bucket()
  const key = buildS3ObjectKey(
    `admin/${randomUUID()}-${safeBaseFileName(fileName)}`,
  )

  /**
   * Intentionally do NOT pass ContentType here — see file header comment.
   * The browser will send Content-Type on the actual PUT and S3 will store it.
   */
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
  })

  const client = getS3Client()

  try {
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 })

    // CDN — только подтверждённый (`S3_PUBLIC_BASE_CONFIRMED`, разбор там же, в
    // publicObjectUrlForKey). Иначе относительный путь прокси, чтобы локальные
    // загрузки не зашивали в базу localhost.
    const publicUrl = publicObjectUrlForKey(key) ?? appMediaProxyPathForKey(key)

    return NextResponse.json({
      uploadUrl,
      key,
      method: "PUT" as const,
      contentType,
      publicUrl,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not prepare upload URL."
    return NextResponse.json({ message: msg }, { status: 502 })
  }
}
