import { DeleteObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { requireKotliarOwner } from "@/lib/kotliar/auth"
import { deleteKotliarFile } from "@/lib/repositories/kotliar"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

const FILE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireKotliarOwner(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!FILE_ID.test(id)) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  const file = await deleteKotliarFile(id)
  if (!file) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  if (isS3Configured() && file.s3Key.startsWith("ffworks/kotliar/")) {
    await getS3Client()
      .send(
        new DeleteObjectCommand({ Bucket: getS3Bucket(), Key: file.s3Key }),
      )
      .catch(() => undefined)
  }

  return NextResponse.json({ ok: true })
}
