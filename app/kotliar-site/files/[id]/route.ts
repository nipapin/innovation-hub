import { GetObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { isKotliarRequest } from "@/lib/kotliar/host"
import { findKotliarFileById } from "@/lib/repositories/kotliar"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client } from "@/lib/s3-client"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

const FILE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function contentDisposition(name: string): string {
  const cleaned = name.replace(/[\r\n"]/g, "").trim() || "file"
  const ascii = cleaned.replace(/[^\x20-\x7E]/g, "_") || "file"
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`
}

export async function GET(request: NextRequest, { params }: Params) {
  if (!isKotliarRequest(request.headers)) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  const { id } = await params
  if (!FILE_ID.test(id)) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  const file = await findKotliarFileById(id)
  if (!file || !file.s3Key.startsWith("ffworks/kotliar/")) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  try {
    const object = await getS3Client().send(
      new GetObjectCommand({
        Bucket: getS3Bucket(),
        Key: file.s3Key,
      }),
    )
    const body = object.Body?.transformToWebStream()
    if (!body) {
      return NextResponse.json({ message: "Not found." }, { status: 404 })
    }
    return new Response(body as unknown as ReadableStream, {
      headers: {
        "Content-Type": file.contentType || "application/octet-stream",
        "Content-Disposition": contentDisposition(file.originalName),
        ...(object.ContentLength
          ? { "Content-Length": String(object.ContentLength) }
          : {}),
        "Cache-Control": "public, max-age=86400, immutable",
      },
    })
  } catch {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }
}

export async function HEAD(request: NextRequest, context: Params) {
  return GET(request, context)
}
