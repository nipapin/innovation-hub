import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  requireOwnedProjectAccess,
  requireProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { setProjectPaused } from "@/lib/project-automation"
import {
  getObjectTextWithMeta,
  OPTIONS_FILE_NAME,
  projectDescriptionKey,
  projectFolderStateKey,
  projectOptionsKey,
  projectSiteFormKey,
  ProjectStorageError,
  siteUpdatedBy,
  updateProjectExposedOptions,
} from "@/lib/project-storage"
import { exposedOptionChangeSchema } from "@/lib/project-schemas"
import { findFileByName } from "@/lib/repositories/project-files"
import {
  DESCRIPTION_FILE_NAME,
  FOLDER_STATE_FILE_NAME,
  OPTIONS_FOLDER_NAME,
  SITE_FORM_FILE_NAME,
} from "@/lib/storage/keys"
import {
  StorageWriteError,
  writeSidecarPut,
  writeSidecarSync,
} from "@/lib/storage/write-path"

export const runtime = "nodejs"

/** Имя сайдкара → ключ в объектном хранилище. null — имя неизвестно. */
function sidecarKey(
  name: string,
  storageOwnerId: string,
  projectId: string,
): string | null {
  if (name === "folder-state") {
    return projectFolderStateKey(storageOwnerId, projectId)
  }
  if (name === "options") return projectOptionsKey(storageOwnerId, projectId)
  if (name === "description") {
    return projectDescriptionKey(storageOwnerId, projectId)
  }
  if (name === "on-site-folder-check-form") {
    return projectSiteFormKey(storageOwnerId, projectId)
  }
  return null
}

/** Имя сайдкара → логическое имя файла в папке `options`. */
function sidecarFileName(name: string): string | null {
  if (name === "folder-state") return FOLDER_STATE_FILE_NAME
  if (name === "options") return OPTIONS_FILE_NAME
  if (name === "description") return DESCRIPTION_FILE_NAME
  if (name === "on-site-folder-check-form") return SITE_FORM_FILE_NAME
  return null
}

/**
 * Сайдкар, лежащий по физическому ключу `{uuid}-{имя}`.
 *
 * Так выглядит ЛЮБОЙ файл, попавший в проект обычной заливкой: presign минтит
 * ключ с uuid, чтобы два файла с одним именем не затирали друг друга. Именно
 * этим путём программа доставляет форму сборки — она синхронизирует папку
 * целиком и отдельных команд записи не шлёт.
 *
 * Поэтому искать такой файл надо ПО ИМЕНИ, а не по фиксированному адресу: имя
 * в каталоге уникально по индексу, а ключ у каждой заливки свой. Второго
 * источника правды это не заводит — строка в каталоге одна.
 *
 * Перекладывать байты на канонический ключ здесь не пытаемся: запись на чтении
 * — это молчаливая правка чужого проекта.
 */
async function readLegacySidecar(
  projectId: string,
  name: string,
  canonicalKey: string,
): Promise<{ key: string; object: Awaited<ReturnType<typeof getObjectTextWithMeta>> } | null> {
  const fileName = sidecarFileName(name)
  if (!fileName) return null

  const row = await findFileByName({
    projectId,
    folderPath: OPTIONS_FOLDER_NAME,
    name: fileName,
  })
  if (!row?.s3Key || row.s3Key === canonicalKey) return null

  const object = await getObjectTextWithMeta(row.s3Key)
  return object ? { key: row.s3Key, object } : null
}

const putSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("folder-state"),
    projectId: z.string().min(1),
    enabled: z.boolean(),
  }),
  z.object({
    kind: z.literal("options"),
    projectId: z.string().min(1),
    changes: z.array(exposedOptionChangeSchema),
  }),
  z.object({
    kind: z.literal("raw"),
    projectId: z.string().min(1),
    // description — развёрнутое описание проекта в markdown (options/description.md).
    // on-site-folder-check-form — форма сборки элемента в IN, артефакт графа
    // (options/onSiteFolderCheckForm.json).
    // Десктоп читает и пишет их тем же путём, что folderState и options.
    sidecar: z.enum(["folder-state", "options", "description", "on-site-folder-check-form"]),
    body: z.string().min(1),
    ifMatch: z.string().optional(),
  }),
])

/**
 * GET /api/storage/v1/sidecars?projectId=&name=…
 *
 * Имена: `folder-state`, `options`, `description`, `on-site-folder-check-form`.
 */
export async function GET(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  const projectId = request.nextUrl.searchParams.get("projectId")?.trim()
  const name = request.nextUrl.searchParams.get("name")?.trim()
  if (!projectId || !name) {
    return NextResponse.json(
      { message: "projectId and name are required." },
      { status: 400 },
    )
  }

  const access = await requireProjectAccess(auth, projectId)
  if (access instanceof NextResponse) return access

  const key = sidecarKey(name, access.storageOwnerId, access.projectId)
  if (!key) {
    return NextResponse.json({ message: "Unknown sidecar." }, { status: 400 })
  }

  let objectKey = key
  let object = await getObjectTextWithMeta(key)
  if (object == null) {
    const legacy = await readLegacySidecar(access.projectId, name, key)
    if (legacy?.object) {
      objectKey = legacy.key
      object = legacy.object
    }
  }
  if (object == null) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }
  // etag отдаётся вместе с телом: он и есть версия, которую клиент возвращает в
  // `ifMatch` при записи. Без него сравнить облачную копию с локальной и
  // перезаписать её без риска затереть чужую правку нечем.
  //
  // `key` отдаём тот, откуда РЕАЛЬНО прочитали: клиент, собравшийся писать,
  // должен видеть настоящее положение файла, а не то, где он обязан лежать.
  return NextResponse.json({
    key: objectKey,
    body: object.body,
    etag: object.etag,
    sizeBytes: object.sizeBytes,
    lastModified: object.lastModified,
  })
}

/** PUT /api/storage/v1/sidecars */
export async function PUT(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const data = parsed.data
  const access = await requireOwnedProjectAccess(auth, data.projectId)
  if (access instanceof NextResponse) return access

  try {
    if (data.kind === "folder-state") {
      const { folderState } = await setProjectPaused({
        projectId: access.projectId,
        ownerId: access.ownerId,
        storageOwnerId: access.storageOwnerId,
        paused: !data.enabled,
        updatedBy: siteUpdatedBy(auth.email),
        actorUserId: auth.userId,
      })
      return NextResponse.json({ folderState })
    }

    if (data.kind === "options") {
      const { options, etag } = await updateProjectExposedOptions({
        storageOwnerId: access.storageOwnerId,
        projectId: access.projectId,
        changes: data.changes,
        actor: { userId: auth.userId },
      })
      await writeSidecarSync({
        storageOwnerId: access.storageOwnerId,
        projectId: access.projectId,
        key: projectOptionsKey(access.storageOwnerId, access.projectId),
        name: OPTIONS_FILE_NAME,
        actor: { userId: auth.userId },
      })
      return NextResponse.json({ options, etag })
    }

    const key = sidecarKey(data.sidecar, access.storageOwnerId, access.projectId)
    if (!key) {
      return NextResponse.json({ message: "Unknown sidecar." }, { status: 400 })
    }
    const { etag, file } = await writeSidecarPut({
      storageOwnerId: access.storageOwnerId,
      projectId: access.projectId,
      key,
      body: data.body,
      ifMatch: data.ifMatch,
      actor: { userId: auth.userId },
    })
    return NextResponse.json({ ok: true, etag, file })
  } catch (error) {
    // Статус берём у ошибки: 412 (версия устарела) клиенту нужно отличать от 409
    // (имя занято) — на второе он ответил бы переименованием, а тут надо
    // перечитать сайдкар и решить, чья версия едет в облако.
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    if (error instanceof ProjectStorageError) {
      return NextResponse.json({ message: error.message }, { status: 409 })
    }
    console.error("[storage] sidecar put failed", error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Update failed." },
      { status: 503 },
    )
  }
}
