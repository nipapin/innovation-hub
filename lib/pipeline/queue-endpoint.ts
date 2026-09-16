import { NextResponse } from "next/server"
import { z } from "zod"
import {
  ensureRemoteComputerByUuid,
  recordComputerIdentity,
  touchMachineContact,
} from "@/lib/repositories/remote-computers"
import {
  claimNextTask,
  completeTask,
  failTask,
  releaseTask,
  reportTaskProgress,
  type QueueCaller,
  type QueueMutationResult,
} from "@/lib/pipeline/queue"
import type { StorageApiAuth } from "@/lib/storage/auth"
import { readVaultRevision } from "@/lib/vault/services"

/**
 * Общая логика очереди для обеих поверхностей: экшены на `POST /api/v1` (токен
 * `rc_…`) и REST под `/api/storage/v1/queue/*` (токен `mch_…`, которым десктоп
 * уже ходит). Тот же приём, что у общих словарей — одна логика, тонкие обёртки,
 * иначе поверхности разъедутся.
 *
 * Разные токены дают разную идентичность машины:
 *
 * - `rc_…` — компьютер заведён в админке, `computerId` приходит из токена;
 * - `mch_…` — компьютера в токене нет, машина присылает свой `machineUuid` и
 *   сайт заводит строку сам (PIPELINE_BACKEND_REQUESTS.md §4). Так десктопу не
 *   нужен второй токен в настройках.
 */

/** Идентификация машины, общая для обеих поверхностей. */
export const machineIdentitySchema = z.object({
  /**
   * UUID машины из её настроек. Обязателен, когда в токене нет компьютера
   * (`mch_…`); для `rc_…` — необязателен, но принимается и запоминается.
   */
  machineUuid: z.string().trim().min(8).max(64).optional(),
  /** Человекочитаемая подпись для админки. */
  hostname: z.string().trim().max(200).optional(),
})

export const claimTaskSchema = machineIdentitySchema.extend({
  /** На будущее: теги вроде ffmpeg / ae для гибридного роутинга. */
  capabilities: z.array(z.string().trim().max(40)).max(20).optional(),
})

export const taskProgressSchema = machineIdentitySchema.extend({
  taskId: z.string().uuid(),
  stepId: z.string().trim().min(1).max(200),
  status: z.enum(["running", "done", "error"]),
  message: z.string().max(2000).nullable().optional(),
})

export const taskDoneSchema = machineIdentitySchema.extend({
  taskId: z.string().uuid(),
  outFiles: z.array(z.string().max(1024)).max(500).optional(),
  totalCost: z.number().nonnegative().optional(),
})

export const taskFailedSchema = machineIdentitySchema.extend({
  taskId: z.string().uuid(),
  error: z.string().trim().min(1).max(4000),
})

export const releaseTaskSchema = machineIdentitySchema.extend({
  taskId: z.string().uuid(),
})

/**
 * Кто именно зовёт очередь.
 *
 * `NextResponse` — отказ: машину не удалось опознать. Это единственное место, где
 * решается идентичность, поэтому обе поверхности ведут себя одинаково.
 */
export async function resolveQueueCaller(
  auth: StorageApiAuth,
  props: { machineUuid?: string; hostname?: string },
): Promise<QueueCaller | NextResponse> {
  if (auth.computerId) {
    // Компьютер заведён в админке: сам компьютер и есть машина под своим токеном.
    // UUID, если прислали, пишем НА ЭТУ ЖЕ строку, а не заводим вторую: иначе одна
    // машина числилась бы дважды, и вторая запись висела бы без токена вообще.
    if (props.machineUuid) {
      await recordComputerIdentity({
        computerId: auth.computerId,
        machineUuid: props.machineUuid,
        hostname: props.hostname,
      }).catch(() => {
        // UUID уже занят другой строкой — не повод отказывать в задаче.
      })
    }
    return {
      computerId: auth.computerId,
      userId: auth.userId,
      role: auth.role,
      // Компания машины приходит из её же токена (`rc_`), а не из запроса:
      // подменить её, назвавшись чужой, нечем.
      companyId: auth.machineCompanyId,
    }
  }

  if (!props.machineUuid) {
    return NextResponse.json(
      {
        message:
          "machineUuid is required: this token is not bound to a computer.",
      },
      { status: 400 },
    )
  }

  // Без токена машины машину не завести: строка, не привязанная ни к токену, ни к
  // компьютеру, повисла бы в списке ничьей. Сессия браузера очередь не разгребает.
  if (!auth.machineTokenId) {
    return NextResponse.json(
      { message: "A machine token is required to work the queue." },
      { status: 403 },
    )
  }

  const computer = await ensureRemoteComputerByUuid({
    machineUuid: props.machineUuid,
    hostname: props.hostname,
    userId: auth.userId,
    // Токен, которым машина зашла: по нему её видно в списке машин этого токена.
    registeredTokenId: auth.machineTokenId,
  })

  // Машина под `mch_`-токеном человека: компании у неё нет и быть не может —
  // токен уже скоуплен своим владельцем.
  return {
    computerId: computer.id,
    userId: auth.userId,
    role: auth.role,
    companyId: null,
  }
}

/**
 * Отметка «я на связи», без запроса задачи.
 *
 * Нужна потому, что иначе состояние «машина включена, но воркер выключен» сайту
 * не видно вовсе: от `mch_`-десктопа он слышит только когда воркер зовёт очередь.
 * Программе стоит звать это на пульсе синхронизации независимо от воркера — тогда
 * в админке горят два разных индикатора, а не один на оба состояния.
 */
export async function handlePing(
  auth: StorageApiAuth,
  props: z.infer<typeof machineIdentitySchema>,
): Promise<NextResponse> {
  const caller = await resolveQueueCaller(auth, props)
  if (caller instanceof NextResponse) return caller
  await touchMachineContact({ computerId: caller.computerId })
  // Ревизия сейфа едет в каждом ударе сердца: машина сравнивает её со своей и,
  // если разошлось, идёт за ключами. Так отзыв доезжает за полминуты, а не по
  // истечении TTL копии (docs/VENDOR_SERVICES_PLAN.md, С4). Одно число из
  // синглтон-строки — дешевле, чем отдельный опрос сейфа по расписанию.
  return NextResponse.json({ ok: true, vaultRevision: await readVaultRevision() })
}

function mutationResponse(result: QueueMutationResult): NextResponse {
  if (result.ok) return NextResponse.json({ ok: true })
  return NextResponse.json(
    {
      message:
        result.reason === "not-found"
          ? "Task not found."
          : "Task is held by another machine — its lease probably expired.",
    },
    { status: result.reason === "not-found" ? 404 : 409 },
  )
}

export async function handleClaimTask(
  auth: StorageApiAuth,
  props: z.infer<typeof claimTaskSchema>,
): Promise<NextResponse> {
  const caller = await resolveQueueCaller(auth, props)
  if (caller instanceof NextResponse) return caller

  // Отмечаем ДО захвата: даже если очередь пуста, факт «воркер спрашивал» —
  // это и есть признак работающего воркера, а он гаснет быстрее, чем «на связи».
  await touchMachineContact({ computerId: caller.computerId, claimed: true })

  const task = await claimNextTask(caller)
  // null — очередь пуста. Штатный ответ, а не ошибка: машина спрашивает каждые
  // несколько секунд и почти всегда получает именно его.
  return NextResponse.json({ task })
}

export async function handleTaskProgress(
  auth: StorageApiAuth,
  props: z.infer<typeof taskProgressSchema>,
): Promise<NextResponse> {
  const caller = await resolveQueueCaller(auth, props)
  if (caller instanceof NextResponse) return caller
  await touchMachineContact({ computerId: caller.computerId, claimed: true })
  return mutationResponse(
    await reportTaskProgress({
      caller,
      taskId: props.taskId,
      stepId: props.stepId,
      status: props.status,
      message: props.message ?? null,
    }),
  )
}

export async function handleTaskDone(
  auth: StorageApiAuth,
  props: z.infer<typeof taskDoneSchema>,
): Promise<NextResponse> {
  const caller = await resolveQueueCaller(auth, props)
  if (caller instanceof NextResponse) return caller
  await touchMachineContact({ computerId: caller.computerId, claimed: true })
  return mutationResponse(
    await completeTask({
      caller,
      taskId: props.taskId,
      outFiles: props.outFiles,
      totalCost: props.totalCost,
    }),
  )
}

export async function handleTaskFailed(
  auth: StorageApiAuth,
  props: z.infer<typeof taskFailedSchema>,
): Promise<NextResponse> {
  const caller = await resolveQueueCaller(auth, props)
  if (caller instanceof NextResponse) return caller
  await touchMachineContact({ computerId: caller.computerId, claimed: true })
  return mutationResponse(
    await failTask({ caller, taskId: props.taskId, error: props.error }),
  )
}

export async function handleReleaseTask(
  auth: StorageApiAuth,
  props: z.infer<typeof releaseTaskSchema>,
): Promise<NextResponse> {
  const caller = await resolveQueueCaller(auth, props)
  if (caller instanceof NextResponse) return caller
  await touchMachineContact({ computerId: caller.computerId, claimed: true })
  return mutationResponse(await releaseTask({ caller, taskId: props.taskId }))
}
