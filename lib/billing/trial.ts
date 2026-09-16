import type { PoolClient } from "pg"
import { query, queryVia, withTransaction } from "@/lib/db"
import {
  activateGrant,
  createGrant,
  findTrialGrant,
  resetTrialGrant,
} from "@/lib/billing/grants"
import { listTemplateProjects } from "@/lib/billing/projects"
import { readPayer } from "@/lib/billing/payer"
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
  | { status: "unavailable"; reason: "disabled" | "no-templates" | "paid-by-other" }
  | {
      status: "available"
      amountCents: number
      lifetimeDays: number | null
      /**
       * Из чего состоит набор ПРЯМО СЕЙЧАС. Едет вместе с состоянием, потому
       * что обещание в диалоге обязано совпадать с тем, что человек получит:
       * состав меняют в админке, и зашитое в текст число врёт молча — ошибку
       * видно не нам, а человеку, которому приехало другое количество.
       */
      templates: { projectId: string; name: string }[]
    }
  | {
      status: "provisioning" | "active" | "exhausted" | "expired" | "revoked"
      grant: GrantRecord
      projectIds: string[]
      /**
       * Сколько проектов уже скопировано. Едет здесь, а не читается напрямую из
       * работы: журнал работ закрыт машинным ключом (`requireStorageApi`), и
       * браузеру до него не дотянуться. `null` — работы нет либо копирование
       * уже не идёт.
       */
      progress: { done: number; total: number } | null
    }

/**
 * Продление по новому набору: завершённый период, выданный ДО обновления
 * состава пробных проектов, разрешается заново сам.
 *
 * Так «разрешить заново всем, кто уже пробовал» обходится без обхода: нет ни
 * массовой операции, правящей чужие гранты пачкой, ни фоновой задачи, которая
 * обязана знать список пользователей. Правило применяется там, где состояние и
 * так читают, и ровно к тому человеку, который за ним пришёл.
 *
 * Действующий период не трогается: `resetTrialGrant` сам отказывает открытому
 * и тому, у которого прямо сейчас едут копии. Это не обход ограничения, а его
 * смысл — человека не выкидывают из периода посреди работы ради нового набора.
 * Когда период закончится, он попадёт сюда же и продлится тогда.
 *
 * Возвращает `true`, если грант сброшен и состояние надо считать заново.
 */
async function renewForNewTemplateSet(
  grant: GrantRecord,
  resetFrom: string | null,
): Promise<boolean> {
  if (!resetFrom || grant.resetAt) return false
  const renewedAt = Date.parse(resetFrom)
  // Неразобранная дата — не повод трогать чужой грант.
  if (!Number.isFinite(renewedAt)) return false
  // Период, выданный уже ПОСЛЕ обновления, человек и получил из нового набора.
  if (new Date(grant.createdAt).getTime() >= renewedAt) return false

  // actorUserId: null — сбросил не человек, а правило. Отказ (период ещё идёт)
  // здесь совершенно нормален и означает «не сейчас, а когда закончится».
  const result = await resetTrialGrant({ grantId: grant.id, actorUserId: null })
  return result.ok
}

/**
 * Ход копирования — сколько проектов из набора уже доехало.
 *
 * Спрашиваем только у идущей выдачи: у прожитого периода работа давно в `done`,
 * и лишний запрос к журналу работ на каждое чтение состояния не нужен.
 */
async function readProvisionProgress(
  grant: GrantRecord,
): Promise<{ done: number; total: number } | null> {
  if (grant.status !== "provisioning") return null
  const job = await findJobByEventId(provisionEventId(grant.id))
  if (!job || job.total <= 0) return null
  return { done: job.done, total: job.total }
}

export async function readTrialState(userId: string): Promise<TrialState> {
  const { settings } = await readBillingSettings()
  const existing = await findTrialGrant(userId)
  // Сброшенный только что грант перестаёт быть текущим — состояние считаем
  // дальше, как у человека без периода, и кнопка загорается снова.
  if (existing && !(await renewForNewTemplateSet(existing, settings.trial.resetFrom))) {
    const projects = await query<{ projectId: string }>(
      `SELECT project_id AS "projectId"
         FROM billing_grant_projects WHERE grant_id = $1`,
      [existing.id],
    )
    return {
      status: existing.status,
      grant: existing,
      projectIds: projects.rows.map((r) => r.projectId),
      progress: await readProvisionProgress(existing),
    }
  }

  // За кого платит другой, тому период не выдаётся: подарок лёг бы на него, а
  // деньги читаются у плательщика — начисленное повисло бы невидимым. Период —
  // механизм для одиночки; компания заходит с деньгами
  // (docs/COMPANY_ACCOUNTS_PLAN.md §7.8).
  if (await readPayer(userId)) {
    return { status: "unavailable", reason: "paid-by-other" }
  }

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
    // Порядок тот же, в котором они приедут: `listTemplateProjects` сортирует
    // по `template_order`.
    templates: templates.map((p) => ({ projectId: p.projectId, name: p.name })),
  }
}

/**
 * Проект прошлой выдачи, чьё имя занято шаблоном нового набора.
 *
 * Ищем НЕ по имени среди всех проектов человека, а среди тех, что выдал
 * прошлый — сброшенный — период: связь хранит `billing_grant_projects`, а сброс
 * строку гранта не удаляет, он ставит `reset_at`. Поэтому проект, который
 * человек завёл сам и назвал так же, конфликтом не считается и не трогается.
 */
export type TrialConflict = {
  templateId: string
  /** Имя шаблона — оно же имя занятого проекта. */
  name: string
  /** Проект прошлой выдачи, который придётся переименовать или заменить. */
  projectId: string
}

/**
 * Что делать с совпавшими именами. Вариантов ровно два, и слияния среди них
 * нет намеренно: в пробном периоде человек оценивает продукт, а не работает в
 * нём, — вложенной работы, ради которой стоило бы сливать настройки с файлами,
 * там ещё нет.
 */
export type TrialChoice =
  | { strategy: "rename"; names: Record<string, string> }
  | { strategy: "replace" }

async function findTrialConflicts(
  userId: string,
  templates: { projectId: string; name: string }[],
): Promise<TrialConflict[]> {
  const previous = await query<{ projectId: string; name: string }>(
    `SELECT p.id AS "projectId", p.name
       FROM billing_grants g
       JOIN billing_grant_projects gp ON gp.grant_id = g.id
       JOIN projects p ON p.id = gp.project_id
      WHERE g.user_id = $1
        AND g.kind = 'trial'
        AND g.reset_at IS NOT NULL
        AND p.deleted_at IS NULL`,
    [userId],
  )

  // Регистронезависимо: на macOS и Windows папка зеркала у «Логотип» и
  // «логотип» одна и та же (lower() в хранилище — по той же причине).
  const byName = new Map(
    previous.rows.map((row) => [row.name.toLowerCase(), row]),
  )

  const conflicts: TrialConflict[] = []
  for (const template of templates) {
    const hit = byName.get(template.name.toLowerCase())
    if (hit) {
      conflicts.push({
        templateId: template.projectId,
        name: template.name,
        projectId: hit.projectId,
      })
    }
  }
  return conflicts
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
  | { ok: false; reason: "disabled" | "no-templates" | "already-used" | "paid-by-other" }
  /**
   * У человека уже есть проекты прошлой выдачи с такими же именами. Не отказ и
   * не ошибка — вопрос: копию нужно положить рядом под другим именем или
   * заменить ею старую. Спрашиваем ДО постановки работы, потому что копирование
   * идёт фоном и переспросить в процессе будет некого.
   */
  | { ok: false; reason: "conflicts"; conflicts: TrialConflict[] }

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
export async function activateTrial(
  userId: string,
  /**
   * Что делать с совпавшими именами. Не задан — сначала спрашиваем: при
   * конфликте вернём `reason: "conflicts"`, и решение примет человек.
   */
  choice?: TrialChoice,
): Promise<ActivateResult> {
  // Та же причина, что в readTrialState: кнопку он не увидит, но запрос в
  // обход интерфейса не должен выдать то, что интерфейс не предлагает.
  if (await readPayer(userId)) return { ok: false, reason: "paid-by-other" }

  const { settings } = await readBillingSettings()
  if (!settings.trial.enabled) return { ok: false, reason: "disabled" }

  const templates = await listTemplateProjects()
  if (templates.length === 0) return { ok: false, reason: "no-templates" }

  const templateIds = templates.map((t) => t.projectId)

  const conflicts = await findTrialConflicts(userId, templates)
  if (conflicts.length > 0 && !choice) {
    return { ok: false, reason: "conflicts", conflicts }
  }

  /**
   * Куда класть замену: `templateId` → проект прошлой выдачи. Считаем здесь, а
   * не в работе: конфликты уже найдены, и второй запрос из фона дал бы другой
   * ответ, если человек что-то переименовал, пока думал над диалогом.
   */
  const replaceTargets: Record<string, string> = {}
  if (choice?.strategy === "replace") {
    for (const conflict of conflicts) {
      replaceTargets[conflict.templateId] = conflict.projectId
    }
  }

  const names = choice?.strategy === "rename" ? choice.names : {}

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
        { grant: existing, templateIds, names, replaceTargets },
        client,
      )
      return { ok: true as const, grant: existing, job, resumed: true }
    }

    const job = await ensureProvisionJob(
      { grant, templateIds, names, replaceTargets },
      client,
    )
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
  input: {
    grant: GrantRecord
    templateIds: string[]
    /** `templateId` → имя, которое выбрал человек. Пусто — имя шаблона. */
    names?: Record<string, string>
    /** `templateId` → проект прошлой выдачи, в который копируем поверх. */
    replaceTargets?: Record<string, string>
  },
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
      payload: {
        grantId: input.grant.id,
        templateIds: input.templateIds,
        names: input.names ?? {},
        replaceTargets: input.replaceTargets ?? {},
      },
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
