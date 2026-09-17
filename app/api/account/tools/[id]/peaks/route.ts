import { createHash, randomUUID } from "node:crypto"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { requireUserApi } from "@/lib/admin-auth"
import { requireProjectAccess } from "@/lib/project-access"
import { findLiveUserTool } from "@/lib/tool-instance-gate"
import { getS3Bucket } from "@/lib/s3-config"
import { projectUploadObjectKey } from "@/lib/project-storage"
import { listFilesInFolder } from "@/lib/repositories/project-files"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { StorageWriteError, writeNotifyUpload } from "@/lib/storage/write-path"
import { parsePeaks } from "@/lib/tools/dialog/peaks"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

const schema = z.object({
  /** Путь внутри папки задачи: `01/audio.peaks.json`. */
  path: z.string().min(1).max(400),
  peaks: z.unknown(),
})

/** Путь годится, если он относительный, без выхода вверх и это файл волны. */
function safePeaksPath(value: string): string | null {
  const path = value.replace(/^\/+/, "")
  if (!path.endsWith(".peaks.json")) return null
  if (path.split("/").some((part) => part === "" || part === "." || part === "..")) return null
  return path
}

/**
 * Запись волны, посчитанной инструментом.
 *
 * Волну считает браузер (`lib/tools/dialog/peaks-compute.ts`), а класть её в
 * папку через общий `presign` нельзя: тот открыт только правщику, а работать с
 * задачей должен и читатель. Поэтому отдельный узкий канал: один тип файла, имя
 * с фиксированным окончанием, папка — только та, что выбрана источником этого
 * экземпляра инструмента.
 *
 * Содержимое проверяется тем же разбором, что и чтение: файл, который потом не
 * прочитается, писать незачем.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const tool = await findLiveUserTool(id, auth.userId)
  if (!tool) return NextResponse.json({ message: "Tool not found." }, { status: 404 })

  const source = (tool.source ?? {}) as { projectId?: string | null; folderPath?: string | null }
  const projectId = source.projectId ?? null
  const folderPath = source.folderPath ?? null
  if (!projectId || !folderPath) {
    return NextResponse.json({ message: "Tool has no source folder." }, { status: 400 })
  }

  const access = await requireProjectAccess(projectId, auth.userId, "viewer")
  if (access instanceof NextResponse) return access
  if (!isS3Configured()) {
    return NextResponse.json({ message: "Object storage is not available." }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid input." }, { status: 400 })
  }

  const relative = safePeaksPath(parsed.data.path)
  if (!relative) {
    return NextResponse.json({ message: "Invalid peaks path." }, { status: 400 })
  }
  if (!parsePeaks(parsed.data.peaks)) {
    return NextResponse.json({ message: "Peaks file is not readable." }, { status: 422 })
  }

  const slash = relative.lastIndexOf("/")
  const dir = slash === -1 ? folderPath : `${folderPath}/${relative.slice(0, slash)}`
  const fileName = relative.slice(slash + 1)

  /**
   * Перезаписываем существующий файл по его ключу, новый — минтим как presign.
   *
   * Файлы проекта лежат под `{uuid}-{имя}`; запись «по понятному пути» дала бы
   * второй объект с тем же логическим именем, и каталог получил бы две строки
   * одной волны.
   */
  const existing = (await listFilesInFolder(projectId, dir)).find(
    (file) => !file.isFolder && file.name === fileName,
  )
  const s3Key =
    existing?.s3Key ??
    projectUploadObjectKey(
      access.project.storageOwnerId,
      projectId,
      dir,
      `${randomUUID()}-${fileName}`,
    )
  const bytes = Buffer.from(JSON.stringify(parsed.data.peaks), "utf-8")
  const at = new Date().toISOString()

  try {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: getS3Bucket(),
        Key: s3Key,
        Body: bytes,
        ContentType: "application/json",
      }),
    )
  } catch (error) {
    console.error("[srt-editor] peaks write failed", error)
    return NextResponse.json({ message: "Failed to write peaks." }, { status: 503 })
  }

  try {
    await writeNotifyUpload({
      storageOwnerId: access.project.storageOwnerId,
      projectId,
      s3Key,
      folderPath: dir,
      fileName,
      sizeBytes: bytes.byteLength,
      contentType: "application/json",
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      originMtime: Math.floor(Date.parse(at) / 1000),
      // Волна — производное от материала, а не принесённый файл: атрибуцию
      // задачи она не меняет.
      actor: { userId: auth.userId, isUploader: false },
    })
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    console.error("[srt-editor] notify after peaks write failed", error)
  }

  return NextResponse.json({ path: relative, sizeBytes: bytes.byteLength })
}
