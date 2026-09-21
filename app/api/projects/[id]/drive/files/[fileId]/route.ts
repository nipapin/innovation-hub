import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { findFileById } from "@/lib/repositories/project-files"
import {
  requireProjectAccess,
  type ProjectAccessRole,
} from "@/lib/project-access"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { writeFileDelete, writeRename, StorageWriteError } from "@/lib/storage/write-path"

export const runtime = "nodejs"

const PREVIEW_URL_TTL_SECONDS = 3600

type RouteContext = {
  params: Promise<{ id: string; fileId: string }>
}

/**
 * Файл проекта плюс проверка доступа.
 *
 * `minimum` разный у методов не случайно: скачать может и читатель — он для
 * этого и приглашён, работать с готовым результатом; переименовать и удалить —
 * только с правом правки. До появления ролей все три метода пускали любого
 * участника, то есть читатель мог удалить файл из чужого проекта.
 */
async function requireProjectFile(
  projectId: string,
  userId: string,
  fileId: string,
  minimum: ProjectAccessRole,
) {
  const access = await requireProjectAccess(projectId, userId, minimum)
  if (access instanceof NextResponse) return { error: access }
  const file = await findFileById(fileId)
  if (!file || file.projectId !== projectId) {
    return { error: NextResponse.json({ message: "File not found." }, { status: 404 }) }
  }
  return { project: access.project, file }
}

/** Download a project file from R2. */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id, fileId } = await context.params
  const owned = await requireProjectFile(id, auth.userId, fileId, "viewer")
  if ("error" in owned && owned.error) return owned.error
  const { file } = owned as { file: NonNullable<Awaited<ReturnType<typeof findFileById>>> }

  if (file.isFolder || !file.s3Key) {
    return NextResponse.json(
      { message: "Folders cannot be downloaded." },
      { status: 400 },
    )
  }
  if (!isS3Configured()) {
    return NextResponse.json(
      { message: "Object storage is not available." },
      { status: 503 },
    )
  }

  // `?inline=1` — запрос от панели превью, и отвечаем на него редиректом на
  // presigned URL, как это делает /api/media. Проксировать медиа через Next
  // нельзя: роут отдаёт тело одним куском, без `Accept-Ranges` и 206, поэтому
  // браузер обязан скачать файл целиком прежде чем показать первый кадр, а
  // перемотка вперёд по незагруженному невозможна в принципе. У хранилища Range
  // есть из коробки.
  //
  // Скачивание и чтение dialog.json инструментами остаются на прежнем пути
  // намеренно: presigned URL — чужой источник, и CORS закрыл бы чтение тела
  // через fetch(), а `attachment` для скачивания задаётся только здесь.
  const inline = request.nextUrl.searchParams.has("inline")
  const contentType =
    file.contentType || "application/octet-stream"

  try {
    const command = new GetObjectCommand({
      Bucket: getS3Bucket(),
      Key: file.s3Key,
      ...(inline
        ? {
            ResponseContentType: contentType,
            ResponseContentDisposition: `inline; filename="${encodeURIComponent(file.name)}"`,
          }
        : {}),
    })

    if (inline) {
      const signedUrl = await getSignedUrl(getS3Client(), command, {
        expiresIn: PREVIEW_URL_TTL_SECONDS,
      })
      const redirect = NextResponse.redirect(signedUrl, { status: 307 })
      // Половина срока жизни ссылки: пока браузер держит редирект в кэше,
      // ссылка под ним заведомо ещё действует.
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
    // Потоком, а не transformToByteArray: скачивание большого файла иначе
    // целиком оседает в памяти сервера.
    return new Response(body.transformToWebStream() as unknown as ReadableStream, {
      headers: {
        "Content-Type": contentType || response.ContentType || "application/octet-stream",
        ...(response.ContentLength
          ? { "Content-Length": String(response.ContentLength) }
          : {}),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.name)}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    console.error("[project-storage] download failed", error)
    return NextResponse.json(
      { message: "Failed to download file." },
      { status: 503 },
    )
  }
}

/** Rename a file or folder. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id, fileId } = await context.params
  const owned = await requireProjectFile(id, auth.userId, fileId, "editor")
  if ("error" in owned && owned.error) return owned.error

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
      storageOwnerId: owned.project.storageOwnerId,
      fileId,
      projectId: id,
      name,
      folderPath,
      // Кабинет переименовывает через этот роут: снятие `-` с папки — событие
      // готовности витка, его актор становится contact задачи.
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

/** Delete a file or folder (and cascade). */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id, fileId } = await context.params
  const owned = await requireProjectFile(id, auth.userId, fileId, "editor")
  if ("error" in owned && owned.error) return owned.error

  try {
    await writeFileDelete({
      storageOwnerId: owned.project.storageOwnerId,
      projectId: id,
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
