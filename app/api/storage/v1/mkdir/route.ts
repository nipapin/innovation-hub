import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  actorFromAuth,
  requireEditableProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import {
  StorageWriteError,
  writeEnsureFolderPath,
  writeFolderCreate,
  writeFolderCreateBatch,
} from "@/lib/storage/write-path"

export const runtime = "nodejs"

const itemSchema = z.object({
  folderPath: z.string().default(""),
  name: z.string().min(1).max(180),
})

const schema = z.object({
  projectId: z.string().min(1),
  folderPath: z.string().default(""),
  name: z.string().min(1).max(180).optional(),
  /** Full relative path to ensure (a/b/c) — creates missing parents. */
  ensurePath: z.string().min(1).max(1000).optional(),
  /**
   * Пачка папок одной транзакцией, родитель раньше ребёнка.
   *
   * Предел — как у пакетного переименования и по той же причине: одна
   * транзакция не должна держать каталог проекта дольше, чем человек готов
   * ждать ответа. Структуры элементов на порядок мельче этого предела.
   */
  items: z.array(itemSchema).min(1).max(200).optional(),
  eventId: z.string().optional(),
})

/** POST /api/storage/v1/mkdir */
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
  const access = await requireEditableProjectAccess(auth, data.projectId)
  if (access instanceof NextResponse) return access

  // Взаимоисключение, как в пакетном переименовании: молча предпочесть одну
  // форму другой значило бы тихо не выполнить половину запроса.
  if (data.items && (data.name || data.ensurePath)) {
    return NextResponse.json(
      { message: "Provide either items or name/ensurePath, not both." },
      { status: 400 },
    )
  }

  try {
    if (data.items) {
      const base = data.folderPath.replace(/^\/+|\/+$/g, "")
      const files = await writeFolderCreateBatch({
        storageOwnerId: access.storageOwnerId,
        projectId: access.projectId,
        items: data.items.map((item) => {
          const rel = item.folderPath.replace(/^\/+|\/+$/g, "")
          return {
            folderPath: base && rel ? `${base}/${rel}` : base || rel,
            name: item.name,
          }
        }),
        eventId: data.eventId,
        actor: actorFromAuth(auth),
      })
      return NextResponse.json(
        { files, fileIds: files.map((file) => file.id) },
        { status: 201 },
      )
    }

    if (data.ensurePath) {
      const base = data.folderPath.replace(/^\/+|\/+$/g, "")
      const rel = data.ensurePath.replace(/^\/+|\/+$/g, "")
      const full = base ? `${base}/${rel}` : rel
      const result = await writeEnsureFolderPath({
        storageOwnerId: access.storageOwnerId,
        projectId: access.projectId,
        folderPath: full,
        eventId: data.eventId,
        actor: actorFromAuth(auth),
      })
      return NextResponse.json(
        { folderPath: result.folderPath, fileIds: result.folderIds },
        { status: 201 },
      )
    }

    if (!data.name) {
      return NextResponse.json({ message: "name is required." }, { status: 400 })
    }
    if (data.name.includes("/") || data.name.includes("\\")) {
      return NextResponse.json({ message: "Invalid folder name." }, { status: 400 })
    }
    const file = await writeFolderCreate({
      storageOwnerId: access.storageOwnerId,
      projectId: access.projectId,
      folderPath: data.folderPath,
      name: data.name,
      eventId: data.eventId,
      actor: actorFromAuth(auth),
    })
    return NextResponse.json({ file, fileIds: [file.id] }, { status: 201 })
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Could not create folder."
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { message: "A file or folder with that name already exists." },
        { status: 409 },
      )
    }
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}
