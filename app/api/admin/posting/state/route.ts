import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { requireAdminApi } from "@/lib/admin-auth"
import { countPostJobsByStatus } from "@/lib/posting/jobs"
import {
  readPostScanState,
  setPostRunning,
  setPostScanInterval,
} from "@/lib/posting/repository"

export const runtime = "nodejs"

/**
 * Состояние автопостинга: пульт и счётчики очереди.
 *
 * Как и у конвейера, выбирать проект не нужно — постинг идёт по всем
 * включённым проектам сразу, и это одно состояние на всю установку.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "posting.operate")
  if (auth instanceof NextResponse) return auth

  const [state, counts] = await Promise.all([
    readPostScanState(),
    countPostJobsByStatus(),
  ])
  return NextResponse.json({ state, counts })
}

const patchSchema = z
  .object({
    running: z.boolean().optional(),
    /** Период обхода в минутах; 0 снимает расписание. */
    scanIntervalMin: z.number().int().min(0).max(1440).optional(),
  })
  .refine(
    (value) =>
      value.running !== undefined || value.scanIntervalMin !== undefined,
    { message: "Nothing to update." },
  )

/**
 * Пуск и остановка.
 *
 * Стоп прекращает ПОСТАНОВКУ задач; уже стоящие в очереди остаются и уедут,
 * когда постинг снова включат. Гасить их автоматически нельзя: «остановить
 * обход» и «отменить запланированные публикации» — разные решения, и второе
 * принимается по каждой задаче отдельно.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi(request, "posting.operate")
  if (auth instanceof NextResponse) return auth

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  if (parsed.data.scanIntervalMin !== undefined) {
    await setPostScanInterval(parsed.data.scanIntervalMin)
  }
  if (parsed.data.running !== undefined) {
    await setPostRunning({
      isRunning: parsed.data.running,
      actorId: auth.userId,
    })
  }

  const [state, counts] = await Promise.all([
    readPostScanState(),
    countPostJobsByStatus(),
  ])
  return NextResponse.json({ state, counts })
}
