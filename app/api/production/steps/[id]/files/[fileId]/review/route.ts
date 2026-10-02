import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { badRequest, requireChat } from "@/lib/production/chat-api"
import {
  addReviewComment,
  deleteReviewComment,
  getReview,
  reviewShapesSchema,
  updateReviewComment,
  type ReviewError,
} from "@/lib/production/review"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string; fileId: string }> }

/**
 * Пометки ревью к файлу этапа — docs/PRODUCTION_PLAN.md §8. Хранятся json-ом
 * в `<рабочая>/.review/<fileId>.json` (lib/production/review.ts).
 *
 * Доступ — кто видит чат этапа (requireChat): читать и добавлять может любой;
 * править — только своё; удалять — своё, автор пайплайна — любое;
 * «исправлено» — исполнитель, проверяющий, автор пайплайна.
 */

function failed(result: ReviewError) {
  const status = { "not-found": 404, forbidden: 403, storage: 503, conflict: 409, "too-many": 409 }[result.reason]
  return NextResponse.json({ message: "Review failed.", code: result.reason }, { status })
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id, fileId } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const view = await getReview(guard.access, guard.auth.userId, fileId)
  if (!view) return NextResponse.json({ message: "Not found." }, { status: 404 })
  return NextResponse.json(view)
}

const addSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  shapes: reviewShapesSchema.default([]),
})

export async function POST(request: NextRequest, { params }: Params) {
  const { id, fileId } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const parsed = addSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest()
  const result = await addReviewComment(guard.access, guard.auth.userId, fileId, parsed.data)
  if (!result.ok) return failed(result)
  return NextResponse.json({ comment: result.comment }, { status: 201 })
}

const patchSchema = z
  .object({
    commentId: z.string().min(1).max(80),
    body: z.string().trim().min(1).max(4000).optional(),
    shapes: reviewShapesSchema.optional(),
    resolved: z.boolean().optional(),
  })
  .refine((v) => v.body !== undefined || v.shapes !== undefined || v.resolved !== undefined)

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, fileId } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest()
  const result = await updateReviewComment(guard.access, guard.auth.userId, fileId, parsed.data)
  if (!result.ok) return failed(result)
  return NextResponse.json({ comment: result.comment })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, fileId } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const commentId = request.nextUrl.searchParams.get("commentId")
  if (!commentId || commentId.length > 80) return badRequest()
  const result = await deleteReviewComment(guard.access, guard.auth.userId, fileId, commentId)
  if (!result.ok) return failed(result)
  return NextResponse.json({ ok: true })
}
