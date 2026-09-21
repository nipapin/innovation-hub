import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { findFileById } from "@/lib/repositories/project-files"
import { findProjectById } from "@/lib/repositories/projects"
import { getS3Bucket, projectObjectPrefix } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import {
  StorageWriteError,
  writeFileDelete,
  writeRename,
} from "@/lib/storage/write-path"

export const runtime = "nodejs"

const PREVIEW_URL_TTL_SECONDS = 3600

type RouteContext = {
  params: Promise<{ id: string; fileId: string }>
}

/**
 * Отдаёт содержимое файла проекта для колонки 3 и панели превью.
 *
 * Переименование и удаление — ниже, оба по ступени 1: это работа с файлами, а
 * не распоряжение проектом (docs/ADMIN_WORKSPACE_PLAN.md §3).
 *
 * fileId бывает двух видов, и это следствие того, что служебных файлов нет в
 * project_files (см. listProjectServiceFiles):
 *
 *   — uuid строки project_files — обычный файл пользователя;
 *   — сам ключ в объектном хранилище — файл из папки options.
 *
 * Второй случай означает, что идентификатор приходит от клиента, поэтому ключ
 * проверяется на принадлежность именно этому проекту и именно папке options.
 * Без проверки это был бы чтение любого объекта бакета по произвольному пути.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "projects.access")
  if (auth instanceof NextResponse) return auth

  const { id, fileId } = await context.params
  const project = await findProjectById(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  if (!isS3Configured()) {
    return NextResponse.json(
      { message: "Object storage is not available." },
      { status: 503 },
    )
  }

  const decodedId = decodeURIComponent(fileId)
  const optionsPrefix = `${projectObjectPrefix(project.storageOwnerId, project.id)}options/`

  let key: string
  let name: string
  let contentType: string

  if (decodedId.startsWith("projects/")) {
    if (!decodedId.startsWith(optionsPrefix) || decodedId.includes("..")) {
      return NextResponse.json({ message: "File not found." }, { status: 404 })
    }
    key = decodedId
    name = decodedId.slice(decodedId.lastIndexOf("/") + 1)
    contentType = name.endsWith(".json")
      ? "application/json; charset=utf-8"
      : name.endsWith(".md")
        ? "text/markdown; charset=utf-8"
        : "application/octet-stream"
  } else {
    const file = await findFileById(decodedId)
    if (!file || file.projectId !== project.id) {
      return NextResponse.json({ message: "File not found." }, { status: 404 })
    }
    if (file.isFolder || !file.s3Key) {
      return NextResponse.json(
        { message: "Folders cannot be downloaded." },
        { status: 400 },
      )
    }
    key = file.s3Key
    name = file.name
    contentType = file.contentType || "application/octet-stream"
  }

  // `?inline=1` — запрос медиа от панели превью. Тем же редиректом на presigned
  // URL, что и в кабинете: у роута нет Range, поэтому проксированное видео
  // грузится целиком и не перематывается (см. кабинетский двойник).
  const inline = request.nextUrl.searchParams.has("inline")

  try {
    const command = new GetObjectCommand({
      Bucket: getS3Bucket(),
      Key: key,
      ...(inline
        ? {
            ResponseContentType: contentType,
            ResponseContentDisposition: `inline; filename="${encodeURIComponent(name)}"`,
          }
        : {}),
    })

    if (inline) {
      const signedUrl = await getSignedUrl(getS3Client(), command, {
        expiresIn: PREVIEW_URL_TTL_SECONDS,
      })
      const redirect = NextResponse.redirect(signedUrl, { status: 307 })
      redirect.headers.set(
        "Cache-Control",
        `private, max-age=${Math.floor(PREVIEW_URL_TTL_SECONDS / 2)}, must-revalidate`,
      )
      return redirect
    }

    const response = await getS3Client().send(command)
    const body = response.Body
    if (!body) {
      return NextResponse.json({ message: "Empty object." }, { status: 404 })
    }
    return new Response(body.transformToWebStream() as unknown as ReadableStream, {
      headers: {
        "Content-Type": contentType || response.ContentType || "application/octet-stream",
        ...(response.ContentLength
          ? { "Content-Length": String(response.ContentLength) }
          : {}),
        // inline, а не attachment: панель превью показывает файл на месте,
        // а не скачивает его при каждом выборе в списке.
        "Content-Disposition": `inline; filename="${encodeURIComponent(name)}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    console.error("[pipeline] file read failed", error)
    return NextResponse.json(
      { message: "Failed to read file." },
      { status: 503 },
    )
  }
}

/**
 * Переименовать файл или папку в чужом проекте.
 *
 * Тот же `writeRename`, что в кабинете, и по той же причине, что у создания
 * папки: снятие `-` с папки — это событие готовности витка, и собрать его
 * вторым путём означало бы получить второй ответ на вопрос «кто автор задачи».
 *
 * Служебные файлы этим путём не переименовываются: writeRename защищает
 * канонические сайдкары сам (lib/storage/keys.ts#isCanonicalSidecar), поэтому
 * отдельной проверки здесь нет — она была бы вторым списком, который разъедется
 * с первым.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "projects.access")
  if (auth instanceof NextResponse) return auth

  const { id, fileId } = await context.params
  const project = await findProjectById(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const name =
    typeof body?.name === "string" ? body.name.trim().slice(0, 180) : undefined
  const folderPath =
    typeof body?.folderPath === "string" ? body.folderPath : undefined
  if (name === undefined && folderPath === undefined) {
    return NextResponse.json({ message: "Invalid name." }, { status: 400 })
  }
  if (name !== undefined && (!name || name.includes("/") || name.includes("\\"))) {
    return NextResponse.json({ message: "Invalid name." }, { status: 400 })
  }

  try {
    const file = await writeRename({
      storageOwnerId: project.storageOwnerId,
      projectId: project.id,
      fileId,
      name,
      folderPath,
      actor: { userId: auth.userId },
    })
    if (!file) {
      return NextResponse.json({ message: "File not found." }, { status: 404 })
    }
    return NextResponse.json({ file })
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Rename failed."
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { message: "A file or folder with that name already exists." },
        { status: 409 },
      )
    }
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}

/** Удалить файл или папку (с содержимым) в чужом проекте. Ступень 1. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "projects.access")
  if (auth instanceof NextResponse) return auth

  const { id, fileId } = await context.params
  const project = await findProjectById(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  try {
    await writeFileDelete({
      storageOwnerId: project.storageOwnerId,
      projectId: project.id,
      fileId,
      deletedBy: auth.userId,
      actor: { userId: auth.userId },
    })
  } catch (error) {
    // Канонический сайдкар и сама папка options защищены от удаления: сайт
    // читает их по фиксированному ключу.
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    throw error
  }

  return NextResponse.json({ ok: true })
}
