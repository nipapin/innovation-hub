import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { badRequest, requireChat } from "@/lib/production/chat-api"
import { completeChatUpload } from "@/lib/production/uploads"
import { StorageWriteError } from "@/lib/storage/errors"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

const schema = z.object({
  s3Key: z.string().min(1).max(1024),
  fileName: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().min(0),
  contentType: z.string().min(1).max(200),
  slot: z.object({ rowId: z.string().min(1).max(40), index: z.number().int().min(1).max(999), dir: z.string().max(500) }).optional(),
})

/** Байты доехали — записать файл в каталог рабочей папки этапа. */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const guard = await requireChat(request, id)
  if (guard instanceof NextResponse) return guard
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest()
  try {
    const result = await completeChatUpload(guard.access, guard.auth.userId, parsed.data)
    if (result.ok) return NextResponse.json({ file: result.file }, { status: 201 })
    return NextResponse.json({ message: "Cannot complete.", code: result.reason }, { status: 400 })
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    throw error
  }
}
