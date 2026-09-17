import { createHash } from "node:crypto"
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { requireUserApi } from "@/lib/admin-auth"
import { requireProjectAccess } from "@/lib/project-access"
import { listFilesInFolder } from "@/lib/repositories/project-files"
import { findLiveUserTool } from "@/lib/tool-instance-gate"
import { getS3Bucket } from "@/lib/s3-config"
import { projectUploadObjectKey } from "@/lib/project-storage"
import { randomUUID } from "node:crypto"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { StorageWriteError, writeFileDelete, writeNotifyUpload } from "@/lib/storage/write-path"
import { parseDialogDoc, type DialogDoc } from "@/lib/tools/dialog/dialog-doc"
import { serializeDialogDoc, stampForSave } from "@/lib/tools/dialog/serialize"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

const DOC_NAME = "dialog.json"
const PRODUCER = "innovation-hub/srt-editor 0.1"
/** Версии лежат рядом с документом: `dialog.v1.json`, `dialog.v2.json`. */
const VERSION_NAME = /^dialog\.v(\d+)\.json$/

const schema = z.discriminatedUnion("action", [
  /** Отложить текущий документ в версию, ничего не меняя. */
  z.object({ action: z.literal("snapshot") }),
  /** Отложить текущий и поставить на его место собранный заново. */
  z.object({ action: z.literal("replace"), doc: z.unknown() }),
  /** Отложить текущий и вернуть в работу одну из старых версий. */
  z.object({ action: z.literal("activate"), file: z.string().min(1) }),
])

export function versionNo(name: string): number | null {
  const match = VERSION_NAME.exec(name)
  return match ? Number(match[1]) : null
}

/**
 * Версии документа задачи.
 *
 * Активная версия — всегда `dialog.json`: имя закреплено контрактом, и его же
 * читает программа. Остальные лежат рядом под своими номерами, поэтому человек
 * видит их в папке как обычные файлы, а не ищет в скрытой служебной папке.
 *
 * Любое действие начинается с того, что текущий документ откладывается в
 * версию. Это и есть смысл: ни «пересобрать заново», ни «вернуть старое» не
 * должны стирать то, над чем работали, — вернуться можно к чему угодно.
 */
export async function POST(request: NextRequest, { params }: Params) {
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

  const files = await listFilesInFolder(projectId, folderPath)
  const docRow = files.find((file) => !file.isFolder && file.name === DOC_NAME)

  const client = getS3Client()
  const bucket = getS3Bucket()
  /**
   * Ключ для записи: у существующего файла — его собственный, у нового — такой
   * же, как минтит `presign`.
   *
   * Разница не косметическая. Файлы проекта лежат под `{uuid}-{имя}`, и запись
   * «по понятному пути» создаёт **второй объект с тем же логическим именем**:
   * каталог получает вторую строку, а инструмент и программа начинают читать
   * разные файлы. Именно на этом ломалась замена документа — имя уже занято.
   */
  const keyFor = (name: string) => {
    const row = files.find((file) => !file.isFolder && file.name === name)
    if (row?.s3Key) return row.s3Key
    return projectUploadObjectKey(
      access.project.storageOwnerId,
      projectId,
      folderPath,
      `${randomUUID()}-${name}`,
    )
  }

  const readDoc = async (s3Key: string): Promise<DialogDoc | null> => {
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }))
      const text = await object.Body?.transformToString("utf-8")
      const parsedDoc = parseDialogDoc(text ? JSON.parse(text) : null)
      return parsedDoc.ok ? parsedDoc.doc : null
    } catch {
      return null
    }
  }

  const write = async (name: string, doc: DialogDoc) => {
    const bytes = Buffer.from(serializeDialogDoc(doc), "utf-8")
    const s3Key = keyFor(name)
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: bytes,
        ContentType: "application/json",
      }),
    )
    try {
      await writeNotifyUpload({
        storageOwnerId: access.project.storageOwnerId,
        projectId,
        s3Key,
        folderPath,
        fileName: name,
        sizeBytes: bytes.byteLength,
        contentType: "application/json",
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        originMtime: Math.floor(Date.now() / 1000),
        actor: { userId: auth.userId, isUploader: false },
      })
    } catch (error) {
      // Байты уже в хранилище. Строка каталога догонит переиндексацией, а
      // ронять из-за неё замену документа нельзя: человек останется без
      // результата при полностью записанном файле.
      console.error("[srt-editor] notify after version write failed", error)
    }
  }

  /**
   * Текущего документа может не быть вовсе — папку открыли впервые или человек
   * удалил `dialog.json`, чтобы собрать задачу с нуля. Откладывать тогда нечего,
   * и это не отказ: новая версия просто становится первой.
   */
  const current = docRow?.s3Key ? await readDoc(docRow.s3Key) : null
  if (docRow?.s3Key && !current) {
    return NextResponse.json({ message: "Current document is unreadable." }, { status: 422 })
  }

  const taken = files
    .map((file) => (file.isFolder ? null : versionNo(file.name)))
    .filter((no): no is number => no != null)
  const nextNo = taken.length > 0 ? Math.max(...taken) + 1 : 1
  const archiveName = `dialog.v${nextNo}.json`

  /** Что встанет на место активного документа. `null` — только отложить. */
  let incoming: DialogDoc | null = null
  if (parsed.data.action === "replace") {
    const check = parseDialogDoc(parsed.data.doc)
    if (!check.ok) {
      return NextResponse.json(
        { message: "Document is invalid.", error: check.error },
        { status: 422 },
      )
    }
    incoming = check.doc
  }
  if (parsed.data.action === "activate") {
    const wanted = parsed.data.file
    if (versionNo(wanted) == null) {
      return NextResponse.json({ message: "Not a version file." }, { status: 400 })
    }
    const row = files.find((file) => !file.isFolder && file.name === wanted)
    if (!row?.s3Key) return NextResponse.json({ message: "Version not found." }, { status: 404 })
    incoming = await readDoc(row.s3Key)
    if (!incoming) {
      return NextResponse.json({ message: "Version is unreadable." }, { status: 422 })
    }
  }

  if (!current && parsed.data.action === "snapshot") {
    // Отложить нечего: документа нет. Это единственное действие, которое без
    // него бессмысленно, — остальные создают его заново.
    return NextResponse.json({ message: "dialog.json not found." }, { status: 404 })
  }

  const at = new Date().toISOString()
  try {
    if (current) await write(archiveName, current)
    if (incoming) {
      // Ревизия строго выше и текущей, и той, что возвращаем: иначе слияние на
      // второй стороне сочтёт наш документ старым и вернёт то, что мы заменили.
      await write(
        DOC_NAME,
        stampForSave(incoming, {
          revision: Math.max(current?.revision ?? 0, incoming.revision) + 1,
          updatedBy: auth.email,
          producer: PRODUCER,
          at,
        }),
      )
    }
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    console.error("[srt-editor] version write failed", error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to write the version." },
      { status: 503 },
    )
  }

  return NextResponse.json({
    // Пусто — откладывать было нечего: документа в папке не было.
    archived: current ? archiveName : "",
    activated: Boolean(incoming),
    at,
  })
}

/**
 * Удалить отложенную версию.
 *
 * Только `dialog.vN.json` и только в папке задачи: активный документ этим
 * каналом не удаляется никогда — задача без него перестала бы открываться, а
 * «удалить» в списке версий такого не обещает.
 *
 * Удаление обычное, через корзину проекта (30 дней): версия — файл человека, а
 * не служебный мусор, и ошибиться в списке легко.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }
  const parsed = z.object({ file: z.string().min(1) }).safeParse(body)
  if (!parsed.success || versionNo(parsed.data.file) == null) {
    return NextResponse.json({ message: "Not a version file." }, { status: 400 })
  }

  const files = await listFilesInFolder(projectId, folderPath)
  const row = files.find((file) => !file.isFolder && file.name === parsed.data.file)
  if (!row) return NextResponse.json({ message: "Version not found." }, { status: 404 })

  try {
    await writeFileDelete({
      storageOwnerId: access.project.storageOwnerId,
      projectId,
      fileId: row.id,
      deletedBy: auth.userId,
      actor: { userId: auth.userId, isUploader: false },
    })
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    console.error("[srt-editor] version delete failed", error)
    return NextResponse.json({ message: "Failed to delete the version." }, { status: 503 })
  }

  return NextResponse.json({ deleted: parsed.data.file })
}
