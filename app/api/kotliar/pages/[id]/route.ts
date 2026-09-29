import { DeleteObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { requireKotliarOwner } from "@/lib/kotliar/auth"
import { kotliarPageUpdateSchema, normalizeKotliarSlug } from "@/lib/kotliar/schemas"
import {
  deleteKotliarPage,
  findKotliarPageById,
  findKotliarPageBySlug,
  listKotliarFilesByPage,
  updateKotliarPage,
} from "@/lib/repositories/kotliar"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

const PAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonFile(file: {
  id: string
  pageId: string
  originalName: string
  contentType: string
  sizeBytes: number
  createdAt: Date
}) {
  return {
    id: file.id,
    pageId: file.pageId,
    originalName: file.originalName,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt.toISOString(),
  }
}

async function loadPage(id: string) {
  const page = await findKotliarPageById(id)
  if (!page) return null
  const files = await listKotliarFilesByPage(page.id)
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    body: page.body,
    sortOrder: page.sortOrder,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
    files: files.map(jsonFile),
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireKotliarOwner(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!PAGE_ID.test(id)) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }
  const page = await loadPage(id)
  if (!page) return NextResponse.json({ message: "Not found." }, { status: 404 })
  return NextResponse.json({ page })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireKotliarOwner(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!PAGE_ID.test(id)) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }
  const current = await findKotliarPageById(id)
  if (!current) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  const payload = await request.json().catch(() => null)
  const parsed = kotliarPageUpdateSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid page data." }, { status: 400 })
  }

  let slug: string | undefined
  if (parsed.data.slug !== undefined) {
    const normalized = normalizeKotliarSlug(parsed.data.slug)
    if (normalized === null) {
      return NextResponse.json({ message: "Invalid slug." }, { status: 400 })
    }
    if (normalized !== current.slug) {
      const taken = await findKotliarPageBySlug(normalized)
      if (taken) {
        return NextResponse.json({ message: "Slug already in use." }, { status: 409 })
      }
    }
    slug = normalized
  }

  try {
    const updated = await updateKotliarPage(id, {
      title: parsed.data.title,
      slug,
      body: parsed.data.body,
      sortOrder: parsed.data.sortOrder,
    })
    if (!updated) {
      return NextResponse.json({ message: "Not found." }, { status: 404 })
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return NextResponse.json({ message: "Slug already in use." }, { status: 409 })
    }
    throw error
  }

  const page = await loadPage(id)
  return NextResponse.json({ page })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireKotliarOwner(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!PAGE_ID.test(id)) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  const files = await deleteKotliarPage(id)
  if (files === null) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  if (isS3Configured()) {
    const client = getS3Client()
    const bucket = getS3Bucket()
    await Promise.all(
      files
        .filter((file) => file.s3Key.startsWith("ffworks/kotliar/"))
        .map((file) =>
          client
            .send(new DeleteObjectCommand({ Bucket: bucket, Key: file.s3Key }))
            .catch(() => undefined),
        ),
    )
  }

  return NextResponse.json({ ok: true })
}
