import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  actorFromAuth,
  requireEditableProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import {
  StorageWriteError,
  writeRename,
  writeRenameBatch,
} from "@/lib/storage/write-path"

export const runtime = "nodejs"

/**
 * Одна операция пачки. Та же форма, что у одиночного запроса, минус `projectId`:
 * пачка целиком относится к одному проекту.
 */
const itemSchema = z.object({
  fileId: z.string().min(1),
  name: z.string().min(1).max(500).optional(),
  folderPath: z.string().optional(),
})

/**
 * Либо один файл, либо пачка.
 *
 * Пачка нужна перенумерации слотов в папке элемента: там номер — это позиция, и
 * перестановка двух соседей поштучно невыполнима вовсе (цикл `01` ↔ `02`,
 * см. writeRenameBatch). Предел в 500 — как у `/move`, чтобы одна транзакция не
 * держала каталог проекта дольше, чем человек готов ждать ответа.
 */
const schema = z.object({
  projectId: z.string().min(1),
  fileId: z.string().min(1).optional(),
  name: z.string().min(1).max(500).optional(),
  folderPath: z.string().optional(),
  items: z.array(itemSchema).min(1).max(500).optional(),
  eventId: z.string().optional(),
})

/** Косая черта в имени превратила бы переименование в перенос по чужому пути. */
function hasSeparator(name: string | undefined): boolean {
  return name !== undefined && (name.includes("/") || name.includes("\\"))
}

/**
 * Отказ записи человеческим кодом. Один на оба пути: «имя занято» приезжает и
 * исключением `StorageWriteError`, и текстом ошибки уникального индекса, а
 * клиент на 409 отвечает переименованием — спутать его с 500 нельзя.
 */
function failure(error: unknown): NextResponse {
  if (error instanceof StorageWriteError) {
    return NextResponse.json({ message: error.message }, { status: error.status })
  }
  const msg = error instanceof Error ? error.message : "Could not rename."
  if (msg.includes("unique") || msg.includes("duplicate")) {
    return NextResponse.json(
      { message: "A file or folder with that name already exists." },
      { status: 409 },
    )
  }
  return NextResponse.json({ message: msg }, { status: 500 })
}

/** POST /api/storage/v1/rename — rename/move file or folder (no R2 key change). */
export async function POST(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const data = parsed.data

  // Пачка и одиночный файл разведены на два ранних выхода, а не на ветки внутри
  // одного `try`: иначе проверку «fileId задан» приходится доказывать типу
  // второй раз в месте вызова, где о ней уже ничего не известно.
  if (data.items) {
    if (data.fileId) {
      return NextResponse.json(
        { message: "Provide either fileId or items, not both." },
        { status: 400 },
      )
    }
    for (const item of data.items) {
      if (item.name === undefined && item.folderPath === undefined) {
        return NextResponse.json(
          { message: "Each item needs name and/or folderPath." },
          { status: 400 },
        )
      }
      if (hasSeparator(item.name)) {
        return NextResponse.json({ message: "Invalid name." }, { status: 400 })
      }
    }

    const access = await requireEditableProjectAccess(auth, data.projectId)
    if (access instanceof NextResponse) return access

    try {
      const files = await writeRenameBatch({
        storageOwnerId: access.storageOwnerId,
        projectId: access.projectId,
        items: data.items,
        eventId: data.eventId,
        actor: actorFromAuth(auth),
      })
      return NextResponse.json({ files, fileIds: files.map((file) => file.id) })
    } catch (error) {
      return failure(error)
    }
  }

  const fileId = data.fileId
  if (!fileId) {
    return NextResponse.json(
      { message: "Provide fileId or items." },
      { status: 400 },
    )
  }
  if (data.name === undefined && data.folderPath === undefined) {
    return NextResponse.json(
      { message: "Provide name and/or folderPath." },
      { status: 400 },
    )
  }
  if (hasSeparator(data.name)) {
    return NextResponse.json({ message: "Invalid name." }, { status: 400 })
  }

  const access = await requireEditableProjectAccess(auth, data.projectId)
  if (access instanceof NextResponse) return access

  try {
    const file = await writeRename({
      storageOwnerId: access.storageOwnerId,
      projectId: access.projectId,
      fileId,
      name: data.name,
      folderPath: data.folderPath,
      eventId: data.eventId,
      // Снятие `-` с имени папки приходит сюда: это событие готовности витка, и
      // его актор становится contact задачи (lib/pipeline/scan.ts).
      actor: actorFromAuth(auth),
    })
    if (!file) {
      return NextResponse.json({ message: "File not found." }, { status: 404 })
    }
    return NextResponse.json({ file, fileIds: [file.id] })
  } catch (error) {
    return failure(error)
  }
}
