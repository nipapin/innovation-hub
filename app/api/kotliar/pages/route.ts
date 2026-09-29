import { NextResponse, type NextRequest } from "next/server"
import { requireKotliarOwner } from "@/lib/kotliar/auth"
import { normalizeKotliarSlug, kotliarPageCreateSchema } from "@/lib/kotliar/schemas"
import { slugify } from "@/lib/slug"
import {
  createKotliarPage,
  findKotliarPageBySlug,
  listKotliarPages,
} from "@/lib/repositories/kotliar"

export const runtime = "nodejs"

function jsonPage(page: Awaited<ReturnType<typeof createKotliarPage>>) {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    body: page.body,
    sortOrder: page.sortOrder,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireKotliarOwner(request)
  if (auth instanceof NextResponse) return auth

  const pages = await listKotliarPages()
  return NextResponse.json({ pages: pages.map(jsonPage) })
}

export async function POST(request: NextRequest) {
  const auth = await requireKotliarOwner(request)
  if (auth instanceof NextResponse) return auth

  const payload = await request.json().catch(() => null)
  const parsed = kotliarPageCreateSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid page data." }, { status: 400 })
  }

  let slug: string
  if (parsed.data.slug !== undefined) {
    const normalized = normalizeKotliarSlug(parsed.data.slug)
    if (normalized === null) {
      return NextResponse.json({ message: "Invalid slug." }, { status: 400 })
    }
    slug = normalized
  } else {
    const home = await findKotliarPageBySlug("")
    if (!home) {
      slug = ""
    } else {
      slug = normalizeKotliarSlug(slugify(parsed.data.title)) ?? ""
      if (!slug) slug = `page-${Date.now().toString(36)}`
    }
  }

  const existing = await findKotliarPageBySlug(slug)
  if (existing) {
    return NextResponse.json({ message: "Slug already in use." }, { status: 409 })
  }

  try {
    const page = await createKotliarPage({
      title: parsed.data.title,
      slug,
      body: parsed.data.body ?? "",
    })
    return NextResponse.json({ page: jsonPage(page) }, { status: 201 })
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
}
