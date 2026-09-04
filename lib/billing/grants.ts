import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { query, queryVia, withTransaction } from "@/lib/db"
import { recordTransaction } from "@/lib/billing/ledger"
import type { GrantKind, GrantRecord, GrantStatus } from "@/lib/billing/types"

/**
 * Подарки: тестовый период и адресные начисления.
 *
 * Деньги появляются на кошельке НЕ в момент создания строки гранта, а в момент
 * активации — вместе со статусом `active`. Иначе у пользователя был бы баланс,
 * которым нельзя воспользоваться: пробные проекты ещё копируются, тратить не на
 * что, а число в кабинете уже показано.
 *
 * «Один тестовый период на человека» держит частичный уникальный индекс, а не
 * код: строка переживает удаление проектов, архив и корзину.
 */

const GRANT_FIELDS = `
  id,
  user_id      AS "userId",
  kind,
  amount_cents::float8 AS "amountCents",
  status,
  expires_at   AS "expiresAt",
  granted_by   AS "grantedBy",
  comment,
  provision_job_id AS "provisionJobId",
  closed_at    AS "closedAt",
  created_at   AS "createdAt",
  reset_at     AS "resetAt"
`

export async function findGrant(id: string): Promise<GrantRecord | null> {
  const result = await query<GrantRecord>(
    `SELECT ${GRANT_FIELDS} FROM billing_grants WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

/**
 * Действующий тестовый период человека. Сброшенные не считаются: после сброса
 * кнопка «Попробовать» обязана загореться снова, а состояние периода выводится
 * из этого запроса, а не из флага у пользователя (П9.1).
 *
 * Тот же предикат, что у уникального индекса `billing_grants_trial_once_idx` —
 * и это не совпадение: «что мешает завести новый» и «что показывать как
 * текущий» обязаны быть одним условием, иначе кнопка будет обещать то, что
 * база откажется выдать.
 */
export async function findTrialGrant(
  userId: string,
  /** Читать внутри чужой транзакции: активация период дожимает свой же грант. */
  client?: PoolClient,
): Promise<GrantRecord | null> {
  const result = await queryVia(client)<GrantRecord>(
    `SELECT ${GRANT_FIELDS}
       FROM billing_grants
      WHERE user_id = $1 AND kind = 'trial' AND reset_at IS NULL`,
    [userId],
  )
  return result.rows[0] ?? null
}

/**
 * Открытый подарок, в котором участвует проект. null — проект ничем не оплачен.
 *
 * Нужен переносу: проект, живущий на чужие подарочные деньги, нельзя молча
 * отдать другому человеку — вместе с папкой уехал бы и остаток чужого подарка.
 * Закрытые подарки не мешают: по ним уже не платят.
 */
export async function findOpenGrantForProject(
  projectId: string,
): Promise<GrantRecord | null> {
  const result = await query<GrantRecord>(
    `SELECT ${GRANT_FIELDS}
       FROM billing_grants g
       JOIN billing_grant_projects gp ON gp.grant_id = g.id
      WHERE gp.project_id = $1
        AND g.status IN ('provisioning', 'active')
      LIMIT 1`,
    [projectId],
  )
  return result.rows[0] ?? null
}

export async function listGrantsFor(userId: string): Promise<GrantRecord[]> {
  const result = await query<GrantRecord>(
    `SELECT ${GRANT_FIELDS}
       FROM billing_grants
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  )
  return result.rows
}

export type CreateGrantInput = {
  userId: string
  kind: GrantKind
  amountCents: number
  /** null — бессрочный. Срок хранится в гранте, а не в настройке: настройка
   * меняется, выданный подарок — нет. */
  lifetimeDays?: number | null
  /** Проекты, в которых подарок действует. Пустой список — в любом. */
  projectIds?: string[]
  grantedBy?: string | null
  comment?: string
  /**
   * Начислить деньги сразу. Для адресного подарка — да, тратить есть где.
   * Для тестового периода — нет: сначала копируются проекты.
   */
  activateNow: boolean
}

export async function createGrant(
  input: CreateGrantInput,
  /**
   * Уже открытая транзакция вызывающего. Тестовый период кладёт грант и работу
   * копирования одной записью: грант без работы — это вечное «копируются».
   */
  outer?: PoolClient,
): Promise<GrantRecord | null> {
  const run = async (client: PoolClient) => {
    const id = randomUUID()
    const status: GrantStatus = input.activateNow ? "active" : "provisioning"

    const inserted = await client.query<GrantRecord>(
      `INSERT INTO billing_grants (
         id, user_id, kind, amount_cents, status, expires_at, granted_by, comment
       )
       VALUES ($1, $2, $3, $4, $5,
               CASE WHEN $6::int IS NULL THEN NULL
                    ELSE NOW() + ($6::int || ' days')::interval END,
               $7, $8)
       ON CONFLICT DO NOTHING
       RETURNING ${GRANT_FIELDS}`,
      [
        id,
        input.userId,
        input.kind,
        Math.round(input.amountCents),
        status,
        input.lifetimeDays ?? null,
        input.grantedBy ?? null,
        input.comment ?? "",
      ],
    )

    // Ноль строк — сработал уникальный индекс: тестовый период у человека уже
    // был. Это не ошибка вызова, а ответ на вопрос «можно ли ещё раз».
    const grant = inserted.rows[0]
    if (!grant) return null

    for (const projectId of input.projectIds ?? []) {
      await client.query(
        `INSERT INTO billing_grant_projects (grant_id, project_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [grant.id, projectId],
      )
    }

    if (input.activateNow) {
      await creditGrant(client, grant, input.comment ?? "")
    }

    return grant
  }

  return outer ? run(outer) : withTransaction(run)
}

/** Начислить деньги подарка на подарочный кошелёк. */
async function creditGrant(
  client: PoolClient,
  grant: GrantRecord,
  comment: string,
): Promise<void> {
  await recordTransaction(
    {
      userId: grant.userId,
      wallet: "gift",
      grantId: grant.id,
      kind: "grant",
      amountCents: Math.round(grant.amountCents),
      actorUserId: grant.grantedBy,
      comment,
    },
    client,
  )
}

/**
 * Перевести грант в рабочее состояние: начислить деньги и открыть его для трат.
 *
 * Идемпотентно по статусу: повторный вызов на уже активном гранте не начислит
 * второй раз. Важно, потому что работа провижининга может быть перезапущена.
 */
export async function activateGrant(input: {
  grantId: string
  projectIds: string[]
  comment?: string
}): Promise<GrantRecord | null> {
  return withTransaction(async (client) => {
    const updated = await client.query<GrantRecord>(
      `UPDATE billing_grants
          SET status = 'active', updated_at = NOW()
        WHERE id = $1 AND status = 'provisioning'
        RETURNING ${GRANT_FIELDS}`,
      [input.grantId],
    )
    const grant = updated.rows[0]
    if (!grant) return null

    for (const projectId of input.projectIds) {
      await client.query(
        `INSERT INTO billing_grant_projects (grant_id, project_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [grant.id, projectId],
      )
    }

    await creditGrant(client, grant, input.comment ?? "Тестовый период")
    return grant
  })
}

/**
 * Закрыть грант и погасить остаток.
 *
 * Зовётся, когда остатка не хватает даже на минимальный кусок работы или когда
 * истёк срок. Остаток гасим строкой, а не обнулением поля: висящие двенадцать
 * рублей, на которые ничего не купить, — это непонятная строка в кабинете, а
 * молча стёртые деньги — дыра в ленте.
 */
export async function closeGrant(input: {
  grantId: string
  status: Extract<GrantStatus, "exhausted" | "expired" | "revoked">
  remainingCents: number
  actorUserId?: string | null
  comment?: string
}): Promise<void> {
  await withTransaction(async (client) => {
    const updated = await client.query<GrantRecord>(
      `UPDATE billing_grants
          SET status = $2, closed_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'active'
        RETURNING ${GRANT_FIELDS}`,
      [input.grantId, input.status],
    )
    const grant = updated.rows[0]
    if (!grant) return

    if (input.remainingCents > 0) {
      await recordTransaction(
        {
          userId: grant.userId,
          wallet: "gift",
          grantId: grant.id,
          kind: "adjust",
          amountCents: -Math.round(input.remainingCents),
          actorUserId: input.actorUserId ?? null,
          comment: input.comment ?? `Остаток погашен: ${input.status}`,
        },
        client,
      )
    }
  })
}

/**
 * Отзыв и сброс тестового периода (П9.1).
 *
 * Это ДВА действия, и слить их в одно нельзя. Отзыв — про деньги сейчас:
 * закрывает активный грант и гасит остаток. Сброс — про право на будущее:
 * снимает замок «один раз на человека». Самый частый сценарий (поменяли набор
 * шаблонов, человек ещё внутри периода) собирается из них по очереди, и именно
 * поэтому в интерфейсе это две команды, а не одна кнопка с двумя смыслами.
 */

export type TrialRevokeResult =
  | { ok: true; burnedCents: number }
  | { ok: false; reason: "not-found" | "not-trial" | "not-active" }

/** Остаток подарка по ленте. Считаем по транзакциям, а не по счётчику. */
async function grantRemainingCents(grantId: string): Promise<number> {
  const result = await query<{ remaining: string }>(
    `SELECT COALESCE(SUM(amount_cents), 0)::text AS remaining
       FROM billing_transactions WHERE grant_id = $1`,
    [grantId],
  )
  return Math.max(0, Number(result.rows[0]?.remaining ?? 0))
}

/**
 * Закрыть активный период досрочно и погасить остаток.
 *
 * Пробные проекты при этом НЕ трогаем: это его файлы и его работа поверх
 * шаблона. Мы забираем подарок, а не имущество. Дальше судьбу проектов решает
 * общий допуск — есть свои деньги, работает за свои; нет, конвейер остановится
 * той же причиной, что и при обычном исходе периода.
 */
export async function revokeTrialGrant(input: {
  grantId: string
  actorUserId: string
}): Promise<TrialRevokeResult> {
  const grant = await findGrant(input.grantId)
  if (!grant) return { ok: false, reason: "not-found" }
  if (grant.kind !== "trial") return { ok: false, reason: "not-trial" }
  // `provisioning` тоже не подходит: деньги ещё не начислены, гасить нечего, а
  // закрытие оставило бы работу копирования без гранта, к которому она идёт.
  if (grant.status !== "active") return { ok: false, reason: "not-active" }

  const remainingCents = await grantRemainingCents(grant.id)
  await closeGrant({
    grantId: grant.id,
    status: "revoked",
    remainingCents,
    actorUserId: input.actorUserId,
    comment: "Тестовый период отозван",
  })
  return { ok: true, burnedCents: remainingCents }
}

export type TrialResetResult =
  | { ok: true; attempt: number }
  | { ok: false; reason: "not-found" | "not-trial" | "already-reset" | "still-open" }

/**
 * Разрешить человеку пройти период заново.
 *
 * Строку не удаляем и статус не трогаем: удаление каскадом снесло бы
 * `billing_grant_projects` — запись о том, где подарок действовал, — а у
 * `billing_transactions.grant_id` стоит `ON DELETE SET NULL`, и движения денег
 * остались бы сиротами. Сброс обязан учесть, что период был, а не сделать вид,
 * что его не было.
 *
 * Открытый период не сбрасываем: сначала отзыв. Иначе у человека одновременно
 * жили бы два гранта, и правило выбора кошелька (П3) выбирало бы из них молча.
 */
export async function resetTrialGrant(input: {
  grantId: string
  actorUserId: string
}): Promise<TrialResetResult> {
  const grant = await findGrant(input.grantId)
  if (!grant) return { ok: false, reason: "not-found" }
  if (grant.kind !== "trial") return { ok: false, reason: "not-trial" }
  if (grant.resetAt) return { ok: false, reason: "already-reset" }
  if (grant.status === "active" || grant.status === "provisioning") {
    return { ok: false, reason: "still-open" }
  }

  await query(
    `UPDATE billing_grants
        SET reset_at = NOW(), reset_by = $2, updated_at = NOW()
      WHERE id = $1 AND reset_at IS NULL`,
    [grant.id, input.actorUserId],
  )

  // Номер следующей попытки. Считаем по строкам, а не отдельным счётчиком:
  // сколько раз человеку давали период, видно по количеству его грантов.
  const counted = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM billing_grants
      WHERE user_id = $1 AND kind = 'trial'`,
    [grant.userId],
  )
  return { ok: true, attempt: Number(counted.rows[0]?.n ?? 1) + 1 }
}

/**
 * Акции глазами того, кому они достались.
 *
 * Отдельно от `listGrantsFor`: там строка гранта как она лежит в базе, здесь —
 * ответ на вопросы, которые задаёт человек в кабинете: сколько дали, сколько
 * съедено, до какого числа и где этим можно платить. Считается по ленте, а не
 * счётчиком: у каждой транзакции есть `grant_id`, и разъехаться сумме не с чем.
 */
export type AccountPromo = {
  grantId: string
  kind: GrantKind
  status: GrantStatus
  amountCents: number
  /**
   * Потрачено по подарку — только списания. Погашенный при закрытии хвост сюда
   * не входит: человек его не тратил, и записать это в «потрачено» значило бы
   * соврать ему в лицо.
   */
  spentCents: number
  /** Остаток по ленте. У закрытого подарка — ноль. */
  remainingCents: number
  /** Хвост, сгоревший при закрытии: не успели потратить. */
  burnedCents: number
  createdAt: Date
  expiresAt: Date | null
  comment: string
  /**
   * Привязан ли подарок к проектам вообще. Отдельно от списка ниже: проект
   * могли удалить, и тогда список пуст, а подарок всё равно НЕ «в любом
   * проекте» — сказать обратное значило бы пообещать деньги, которыми нигде не
   * заплатишь.
   */
  scoped: boolean
  /** Где действует. Пусто при `scoped: false` — в любом проекте владельца. */
  projects: { id: string; name: string }[]
}

export async function listAccountPromos(userId: string): Promise<AccountPromo[]> {
  const result = await query<{
    grantId: string
    kind: GrantKind
    status: GrantStatus
    amountCents: string
    spentCents: string
    remainingCents: string
    createdAt: Date
    expiresAt: Date | null
    comment: string
    scoped: boolean
    projects: { id: string; name: string }[] | null
  }>(
    `SELECT g.id AS "grantId",
            g.kind,
            g.status,
            g.amount_cents::text AS "amountCents",
            COALESCE((
              SELECT -SUM(b.amount_cents) FROM billing_transactions b
               WHERE b.grant_id = g.id AND b.kind = 'charge'
            ), 0)::text AS "spentCents",
            COALESCE((
              SELECT SUM(b.amount_cents) FROM billing_transactions b
               WHERE b.grant_id = g.id
            ), 0)::text AS "remainingCents",
            g.created_at AS "createdAt",
            g.expires_at AS "expiresAt",
            g.comment,
            EXISTS (
              SELECT 1 FROM billing_grant_projects gp WHERE gp.grant_id = g.id
            ) AS "scoped",
            COALESCE((
              SELECT json_agg(json_build_object('id', p.id, 'name', p.name)
                              ORDER BY p.name)
                FROM billing_grant_projects gp
                JOIN projects p ON p.id = gp.project_id
               WHERE gp.grant_id = g.id
                 AND p.deleted_at IS NULL
            ), '[]'::json) AS projects
       FROM billing_grants g
      WHERE g.user_id = $1
      -- Действующие сверху: закрытые остаются историей, а не поводом искать
      -- живой подарок в конце списка.
      ORDER BY (g.status = 'active') DESC, g.created_at DESC`,
    [userId],
  )

  return result.rows.map((row) => {
    const amountCents = Number(row.amountCents)
    const spentCents = Number(row.spentCents)
    const remainingCents = Number(row.remainingCents)
    return {
      grantId: row.grantId,
      kind: row.kind,
      status: row.status,
      amountCents,
      spentCents,
      remainingCents,
      // Ноль, а не отрицательное: пока грант не активирован, начисления ещё нет,
      // и «сгоревшим» его хвост назвать нельзя.
      burnedCents: Math.max(0, amountCents - spentCents - remainingCents),
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      comment: row.comment,
      scoped: row.scoped,
      projects: row.projects ?? [],
    }
  })
}
