import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireUserApi } from "@/lib/admin-auth"
import { requireProjectAccess } from "@/lib/project-access"
import { findFileById } from "@/lib/repositories/project-files"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { getMaxUploadBytes } from "@/lib/s3-upload-policy"
import { isCanonicalSidecar } from "@/lib/storage/keys"
import { StorageWriteError, writeNotifyUpload } from "@/lib/storage/write-path"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; fileId: string }>
}

const schema = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("presign"), sizeBytes: z.number().int().min(0) }),
  z.object({ stage: z.literal("complete") }),
])

/**
 * Сохранить правку файла проекта поверх него — docs/TEXT_FORMATS_PLAN.md, шаг 4.
 *
 * Та же пара, что у этапа конвейера (`/api/production/steps/…/replace`):
 * `presign` — подпись на PUT в ключ самого файла, `complete` — штатный
 * `writeNotifyUpload` по существующему ключу. Объект, id, имя и строка каталога
 * те же, в журнал ложится `put`, размер и etag — новые, автор правки —
 * сохранивший. Право — как у переименования и удаления: `editor`.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id, fileId } = await context.params
  const access = await requireProjectAccess(id, auth.userId, "editor")
  if (access instanceof NextResponse) return access

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid input." }, { status: 400 })
  }

  // findFileById без includeDeleted: файл из корзины сюда не попадает.
  const file = await findFileById(fileId)
  if (!file || file.projectId !== id) {
    return NextResponse.json({ message: "File not found." }, { status: 404 })
  }
  if (file.isFolder || !file.s3Key) {
    return NextResponse.json({ message: "Folders cannot be edited." }, { status: 400 })
  }
  // Канонические сайдкары пишутся только через /api/storage/v1/sidecars.
  if (isCanonicalSidecar(file.folderPath, file.name)) {
    return NextResponse.json({ message: "This file is written by its own route." }, { status: 409 })
  }
  if (!isS3Configured()) {
    return NextResponse.json({ message: "Object storage is not available." }, { status: 503 })
  }

  if (parsed.data.stage === "presign") {
    if (parsed.data.sizeBytes > getMaxUploadBytes()) {
      return NextResponse.json({ message: "File is too big." }, { status: 413 })
    }
    const contentType = file.contentType || "application/octet-stream"
    // ContentLength входит в подпись: залить больше заявленного по этой ссылке нельзя.
    // Срок короткий — правка уходит сразу после подписи.
    const url = await getSignedUrl(
      getS3Client(),
      new PutObjectCommand({
        Bucket: getS3Bucket(),
        Key: file.s3Key,
        ContentType: contentType,
        ContentLength: parsed.data.sizeBytes,
      }),
      { expiresIn: 600 },
    )
    return NextResponse.json({ ok: true, url, contentType })
  }

  try {
    const saved = await writeNotifyUpload({
      storageOwnerId: access.project.storageOwnerId,
      projectId: id,
      s3Key: file.s3Key,
      folderPath: file.folderPath,
      fileName: file.name,
      contentType: file.contentType,
      actor: { userId: auth.userId, isUploader: true },
    })
    return NextResponse.json({ ok: true, file: saved })
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    throw error
  }
}
