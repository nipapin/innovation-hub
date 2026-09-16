import { NextResponse, type NextRequest } from "next/server"
import {
  requireEditableProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { StorageWriteError } from "@/lib/storage/errors"
import {
  emptyProjectTrash,
  listTrash,
  listTrashForOwner,
  purgeExpiredTrash,
  purgeTrashItem,
} from "@/lib/storage/trash"

export const runtime = "nodejs"

/**
 * GET /api/storage/v1/trash[?projectId=]
 *
 * Без `projectId` — корень корзины: удалённые файлы по всем СВОИМ проектам.
 * Рамка здесь намеренно уже, чем у остальных роутов хранилища: тег
 * `projects.access` открывает чужие папки, но не сводную корзину чужого
 * человека — такого экрана нет и заводить его этим запросом не следует. Чужая
 * корзина смотрится как и раньше, по одному проекту.
 */
export async function GET(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  await purgeExpiredTrash().catch((error) => {
    console.error("[storage] trash purge failed", error)
  })

  const projectId = request.nextUrl.searchParams.get("projectId")?.trim()
  if (!projectId) {
    return NextResponse.json({ items: await listTrashForOwner(auth.userId) })
  }

  const access = await requireEditableProjectAccess(auth, projectId)
  if (access instanceof NextResponse) return access

  const items = await listTrash(access.projectId)
  return NextResponse.json({ items })
}

/**
 * DELETE /api/storage/v1/trash?projectId=[&fileId=] — стереть навсегда.
 *
 * С `fileId` — одну вещь (папку вместе с содержимым), без него — корзину этого
 * проекта целиком. `projectId` обязателен в обоих случаях: «очистить всё сразу»
 * одним запросом по всем проектам не делается намеренно — право проверяется на
 * проект, и чистка всей корзины идёт по проектам, чтобы отказ в одном из них
 * был виден, а не растворился в общем «готово».
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  const params = request.nextUrl.searchParams
  const projectId = params.get("projectId")?.trim()
  if (!projectId) {
    return NextResponse.json({ message: "projectId is required." }, { status: 400 })
  }

  const access = await requireEditableProjectAccess(auth, projectId)
  if (access instanceof NextResponse) return access

  const fileId = params.get("fileId")?.trim()

  try {
    const result = fileId
      ? await purgeTrashItem({ projectId: access.projectId, fileId })
      : await emptyProjectTrash(access.projectId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      )
    }
    console.error("[storage] trash purge failed", error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Purge failed." },
      { status: 500 },
    )
  }
}
