import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  OPTIONS_FILE_NAME,
  ProjectStorageError,
  projectOptionsKey,
  updateProjectExposedOptions,
} from "@/lib/project-storage"
import { updateExposedOptionsSchema } from "@/lib/project-schemas"
import { requireProjectAccess } from "@/lib/project-access"
import { isS3Configured } from "@/lib/s3-client"
import { writeSidecarSync } from "@/lib/storage/write-path"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Save edits to automation parameters exposed to the site
 * (`exposedToSite: true` entries in options/options.json on R2).
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const access = await requireProjectAccess(id, auth.userId, "editor")
  if (access instanceof NextResponse) return access
  const project = access.project
  if (!isS3Configured()) {
    return NextResponse.json(
      { message: "Object storage is not available for this project." },
      { status: 409 },
    )
  }

  const payload = await request.json().catch(() => null)
  const parsed = updateExposedOptionsSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid options payload." },
      { status: 400 },
    )
  }

  try {
    const { options, etag } = await updateProjectExposedOptions({
      storageOwnerId: project.storageOwnerId,
      projectId: project.id,
      changes: parsed.data.changes,
      actor: { userId: auth.userId },
    })
    await writeSidecarSync({
      storageOwnerId: project.storageOwnerId,
      projectId: project.id,
      key: projectOptionsKey(project.storageOwnerId, project.id),
      name: OPTIONS_FILE_NAME,
      actor: { userId: auth.userId },
    })
    return NextResponse.json({ options, optionsEtag: etag })
  } catch (error) {
    if (error instanceof ProjectStorageError) {
      return NextResponse.json({ message: error.message }, { status: 409 })
    }
    console.error("[project-storage] options update failed", error)
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to update automation options.",
      },
      { status: 503 },
    )
  }
}
