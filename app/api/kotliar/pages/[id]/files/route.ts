import { randomUUID } from "node:crypto"
import { DeleteObjectCommand } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { NextResponse, type NextRequest } from "next/server"
import { requireKotliarOwner } from "@/lib/kotliar/auth"
import {
  kotliarMaxBytesFor,
  kotliarObjectKey,
  resolveKotliarContentType,
} from "@/lib/kotliar/upload"
import {
  findKotliarPageById,
  insertKotliarFile,
} from "@/lib/repositories/kotliar"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client } from "@/lib/s3-client"

export const runtime = "nodejs"
export const maxDuration = 120

type Params = { params: Promise<{ id: string }> }

const PAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireKotliarOwner(request)
  if (auth instanceof NextResponse) return auth

  const { id: pageId } = await params
  if (!PAGE_ID.test(pageId)) {
    return jsonError("Not found.", 404)
  }
  const page = await findKotliarPageById(pageId)
  if (!page) return jsonError("Not found.", 404)

  const url = new URL(request.url)
  const fileName = decodeFileNameHeader(
    url.searchParams.get("fileName") ?? request.headers.get("x-file-name"),
  )
  const contentType = resolveKotliarContentType({
    name: fileName,
    type: request.headers.get("content-type") ?? "",
  })
  if (!contentType) {
    return jsonError("Unsupported file type. Use JPEG, PNG, WebP, GIF or PDF.", 400)
  }

  const maxBytes = kotliarMaxBytesFor(contentType)
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

  const fileId = randomUUID()
  const key = kotliarObjectKey(pageId, fileId, fileName)
  const bucket = getS3Bucket()
  const client = getS3Client()

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
      queueSize: 2,
      leavePartsOnError: false,
    })
    await upload.done()
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Upload failed."
    return jsonError(msg, 502)
  }

  const sizeBytes = Number.isFinite(declaredLength) ? declaredLength : 0

  try {
    const file = await insertKotliarFile({
      id: fileId,
      pageId,
      originalName: fileName,
      contentType,
      sizeBytes,
      s3Key: key,
    })
    return NextResponse.json(
      {
        file: {
          id: file.id,
          pageId: file.pageId,
          originalName: file.originalName,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          createdAt: file.createdAt.toISOString(),
        },
      },
      { status: 201 },
    )
  } catch (error) {
    await client
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      .catch(() => undefined)
    const msg = error instanceof Error ? error.message : "Unable to save file."
    return jsonError(msg, 500)
  }
}
