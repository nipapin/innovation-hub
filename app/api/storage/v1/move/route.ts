import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  actorFromAuth,
  requireEditableProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { buildCopyPlan } from "@/lib/storage/copy"
import { StorageWriteError } from "@/lib/storage/errors"
import { createJob } from "@/lib/storage/jobs"
import { scheduleJob } from "@/lib/storage/job-runner"
import { assertMovableAcrossProjects, moveSingleFile } from "@/lib/storage/move"
import { writeEnsureFolderPath } from "@/lib/storage/write-path"

export const runtime = "nodejs"

const schema = z.object({
  projectId: z.string().uuid(),
  fileIds: z.array(z.string().uuid()).min(1).max(500),
  destProjectId: z.string().uuid(),
  destFolderPath: z.string().default(""),
  eventId: z.string().optional(),
})

/**
 * POST /api/storage/v1/move — перенос в другой проект (lib/storage/move.ts).
 * Single file → 200 { files }; folder/batch → 202 { jobId }.
 * Внутри одного проекта — `/rename`: там объект в R2 не трогается вовсе.
 */
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
  if (data.destProjectId === data.projectId) {
    return NextResponse.json(
      { message: "Use POST /api/storage/v1/rename to move within one project." },
      { status: 400 },
    )
  }

  // Оригинал уходит в корзину, поэтому источнику нужна запись, а не только
  // чтение, как у copy.
  const sourceAccess = await requireEditableProjectAccess(auth, data.projectId)
  if (sourceAccess instanceof NextResponse) return sourceAccess

  const destAccess = await requireEditableProjectAccess(auth, data.destProjectId)
  if (destAccess instanceof NextResponse) return destAccess

  const actor = actorFromAuth(auth)

  try {
    const { items, roots } = await buildCopyPlan({
      projectId: sourceAccess.projectId,
      fileIds: data.fileIds,
    })
    assertMovableAcrossProjects(roots, data.destFolderPath)

    const single =
      roots.length === 1 && !roots[0]!.isFolder && items.length === 1
        ? roots[0]!
        : null
    if (single) {
      const file = await moveSingleFile({
        sourceProjectId: sourceAccess.projectId,
        sourceStorageOwnerId: sourceAccess.storageOwnerId,
        destProjectId: destAccess.projectId,
        destStorageOwnerId: destAccess.storageOwnerId,
        destFolderPath: data.destFolderPath,
        source: single,
        eventId: data.eventId ?? null,
        actor,
      })
      return NextResponse.json({ files: [file], fileIds: [file.id] })
    }

    // Папка назначения — строкой, один раз на задание, как у copy: без неё
    // перенесённое поддерево не покажется в дереве проекта.
    if (data.destFolderPath.replace(/^\/+|\/+$/g, "")) {
      await writeEnsureFolderPath({
        storageOwnerId: destAccess.storageOwnerId,
        projectId: destAccess.projectId,
        folderPath: data.destFolderPath,
        actor,
      })
    }

    const job = await createJob({
      userId: auth.userId,
      projectId: destAccess.projectId,
      kind: "move",
      total: items.length,
      eventId: data.eventId ?? null,
      payload: {
        sourceProjectId: sourceAccess.projectId,
        sourceStorageOwnerId: sourceAccess.storageOwnerId,
        destProjectId: destAccess.projectId,
        destStorageOwnerId: destAccess.storageOwnerId,
        destFolderPath: data.destFolderPath,
        sourceFileIds: data.fileIds,
        eventId: data.eventId,
        // Работу исполняет job-runner уже без запроса — актора кладём в payload.
        actorUserId: auth.userId,
        actorIsUploader: auth.computerId == null,
      },
    })
    scheduleJob(job.id)
    return NextResponse.json({ jobId: job.id }, { status: 202 })
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      )
    }
    console.error("[storage/move]", error)
    return NextResponse.json({ message: "Move failed." }, { status: 500 })
  }
}
