import type { PoolClient } from "pg"
import { query, queryVia, withTransaction } from "@/lib/db"
import { activateGrant, createGrant, findTrialGrant } from "@/lib/billing/grants"
import { listTemplateProjects } from "@/lib/billing/projects"
import { readBillingSettings } from "@/lib/billing/settings"
import {
  createJob,
  findJobByEventId,
  isJobInFlight,
  requeueStuckJob,
  type StorageJobRecord,
} from "@/lib/storage/jobs"
import { scheduleJob } from "@/lib/storage/job-runner"
import { provisionEventId, type GrantRecord } from "@/lib/billing/types"

/**
 * Тестовый период: подарок на баланс и копии подготовленных проектов.
 *
 * Не отдельная подсистема со своей арифметикой, а первый потребитель биллинга:
 * те же оценки, тот же резерв, те же списания, та же остановка при нуле.
 * Отличается ровно двумя вещами — деньги подарочные и тратятся только в
 * скопированных проектах.
 *
 * Период НЕ включается сам при регистрации: кнопка доносит намерение, а
 * активирует человек. Иначе копии шаблонов заняли бы место у каждого, кто
 * зарегистрировался и ушёл.
 */

export type TrialState =
  | { status: "unavailable"; reason: "disabled" | "no-templates" }
  | { status: "available"; amountCents: number; lifetimeDays: number | null }
  | {
      status: "provisioning" | "active" | "exhausted" | "expired" | "revoked"
      grant: GrantRecord
      projectIds: string[]
    }

export async function readTrialState(userId: string): Promise<TrialState> {
  const existing = await findTrialGrant(userId)
  if (existing) {
    const projects = await query<{ projectId: string }>(
      `SELECT project_id AS "projectId"
         FROM billing_grant_projects WHERE grant_id = $1`,
      [existing.id],
    )
    return {
      status: existing.status,
      grant: existing,
      projectIds: projects.rows.map((r) => r.projectId),
    }
  }

  const { settings } = await readBillingSettings()
  if (!settings.trial.enabled) {
    return { status: "unavailable", reason: "disabled" }
  }
  const templates = await listTemplateProjects()
  if (templates.length === 0) {
    // Кнопка без шаблонов выдала бы подарок и пустой кабинет — обещание, за
    // которым ничего нет.
    return { status: "unavailable", reason: "no-templates" }
  }
  return {
    status: "available",
    amountCents: settings.trial.amountCents,
    lifetimeDays: settings.trial.lifetimeDays,
  }
}

export type ActivateResult =
  | {
      ok: true
      grant: GrantRecord
      jobId: string
      /**
       * Период уже был выдан, а копии не доехали — мы дожали незаконченную
       * выдачу, а не начали новую. Интерфейсу это нужно, чтобы не поздравлять
       * человека второй раз с тем, что у него давно есть.
       */
      resumed: boolean
    }
  | { ok: false; reason: "disabled" | "no-templates" | "already-used" }

/**
 * Выдать тестовый период.
 *
 * Грант и работа копирования кладутся ОДНОЙ транзакцией. Порознь это уже
 * ломалось: вставка гранта коммитилась, вставка работы падала, и человек
 * оставался с грантом в `provisioning`, для которого никто не копирует, — а
 * карточка вечно показывала «проекты копируются». Либо обе строки, либо ни
 * одной; сама работа запускается после коммита, иначе она увидела бы грант,
 * которого ещё нет.
 *
 * Повторный вызов на незаконченной выдаче ДОЖИМАЕТ её, а не отвечает «уже
 * использован»: право на период человек потратил, а получил пока ничего.
 */
export async function activateTrial(userId: string): Promise<ActivateResult> {
  const { settings } = await readBillingSettings()
  if (!settings.trial.enabled) return { ok: false, reason: "disabled" }

  const templates = await listTemplateProjects()
  if (templates.length === 0) return { ok: false, reason: "no-templates" }

  const templateIds = templates.map((t) => t.projectId)

  const outcome = await withTransaction(async (client) => {
    const grant = await createGrant(
      {
        userId,
        kind: "trial",
        amountCents: settings.trial.amountCents,
        lifetimeDays: settings.trial.lifetimeDays,
        comment: "Тестовый период",
        // Деньги начислятся, когда копии доедут: до тех пор тратить их негде.
        activateNow: false,
      },
      client,
    )

    // Ноль строк от уникального индекса — период у человека уже есть. Он либо
    // застрял на полпути (тогда дожимаем), либо давно прожит (тогда отказ).
    if (!grant) {
      const existing = await findTrialGrant(userId, client)
      if (!existing || existing.status !== "provisioning") {
        return { ok: false as const, reason: "already-used" as const }
      }
      const job = await ensureProvisionJob(
        { grant: existing, templateIds },
        client,
      )
      return { ok: true as const, grant: existing, job, resumed: true }
    }

    const job = await ensureProvisionJob({ grant, templateIds }, client)
    return { ok: true as const, grant, job, resumed: false }
  })

  if (!outcome.ok) return outcome

  // Зависшую работу возвращаем в очередь ПОСЛЕ коммита: requeue идёт своим
  // запросом и не должен откатываться вместе с чужой транзакцией. Берём и
  // упавшую, и вставшую в `running`: вторую иначе не сдвинуть ничем, кроме
  // общего обхода из cron, и «Повторить» молчал бы до его прихода.
  await requeueStuckJob(outcome.job.id)

  scheduleJob(outcome.job.id)
  return {
    ok: true,
    grant: outcome.grant,
    jobId: outcome.job.id,
    resumed: outcome.resumed,
  }
}

/**
 * Работа копирования для гранта — найти или поставить.
 *
 * Идемпотентность держит `event_id`, привязанный к гранту: сколько бы раз
 * человек ни нажал, набор шаблонов у него один. Ссылку на работу пишем в сам
 * грант, чтобы «что копирует этот период» отвечала строка гранта, а не поиск
 * по журналу работ.
 */
async function ensureProvisionJob(
  input: { grant: GrantRecord; templateIds: string[] },
  /**
   * Транзакция активации. У дожима её нет: грант давно лежит в базе, и
   * связывать с ним нечего — работа ставится своим запросом.
   */
  client?: PoolClient,
) {
  const job = await createJob(
    {
      userId: input.grant.userId,
      projectId: null,
      kind: "trial-provision",
      total: input.templateIds.length,
      payload: { grantId: input.grant.id, templateIds: input.templateIds },
      eventId: provisionEventId(input.grant.id),
    },
    client,
  )

  await queryVia(client)(
    `UPDATE billing_grants SET provision_job_id = $2, updated_at = NOW()
      WHERE id = $1`,
    [input.grant.id, job.id],
  )

  return job
}

export type ResumeTrialResult =
  | { ok: true; jobId: string }
  | { ok: false; reason: "not-provisioning" | "no-templates" | "in-flight" }

/**
 * Дожать незаконченную выдачу.
 *
 * То же, что делает «Повторить» в кабинете, но по чужому гранту и без вопроса
 * «включена ли кнопка»: право на период человек уже получил, и выключенная
 * впоследствии кнопка не повод оставлять его с вечным «проекты копируются».
 *
 * Идущее копирование не трогаем: второй прогон по живой работе — это вторые
 * копии тех же проектов.
 */
export async function resumeTrialProvision(
  grant: GrantRecord,
): Promise<ResumeTrialResult> {
  if (grant.kind !== "trial" || grant.status !== "provisioning" || grant.resetAt) {
    return { ok: false, reason: "not-provisioning" }
  }

  const existing = await findJobByEventId(provisionEventId(grant.id))
  if (existing && isJobInFlight(existing)) {
    return { ok: false, reason: "in-flight" }
  }

  // Работа доехала, а грант остался в `provisioning` — копии есть, денег нет.
  // Дожимать нечего: недостаёт ровно начисления, его и делаем.
  if (existing?.state === "done") {
    const projectIds = (existing.payload.projectIds as string[] | undefined) ?? []
    await activateGrant({ grantId: grant.id, projectIds })
    return { ok: true, jobId: existing.id }
  }

  let job: StorageJobRecord
  if (existing) {
    job = existing
  } else {
    // Работы нет вовсе — так выглядит выдача, у которой вставка работы упала
    // после коммита гранта. Ставим её по ТЕКУЩЕМУ набору: другого набора у нас
    // нет, а прежний нигде не записан.
    const templates = await listTemplateProjects()
    if (templates.length === 0) return { ok: false, reason: "no-templates" }
    job = await ensureProvisionJob({
      grant,
      templateIds: templates.map((t) => t.projectId),
    })
  }

  await requeueStuckJob(job.id)
  scheduleJob(job.id)
  return { ok: true, jobId: job.id }
}
