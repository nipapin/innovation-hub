import { query } from "@/lib/db"
import type { GrantKind, GrantStatus } from "@/lib/billing/types"

/**
 * Выборки для наблюдения в «Тарифах»: кто активировал период, какие проекты
 * входят в пробный набор, у кого не задана единица тарификации.
 *
 * Отдельно от `lib/billing/projects.ts`: там правки, здесь только чтение, и
 * запросы тут заведомо тяжелее — им место не рядом с горячим путём конвейера.
 */

export type Activation = {
  grantId: string
  userId: string
  email: string
  fullName: string
  kind: GrantKind
  status: GrantStatus
  amountCents: number
  remainingCents: number
  activatedAt: Date
  expiresAt: Date | null
  /** Когда человек зарегистрировался. Рядом с активацией — чтобы серия
   *  однотипных аккаунтов была видна глазом. */
  registeredAt: Date
  projectCount: number
  /** Сброшен ли период — тогда человеку кнопка доступна снова (П9.1). */
  resetAt: Date | null
  /**
   * Который это подарок у человека по счёту. Серия сбросов у одного должна быть
   * видна глазом — как и серия однотипных регистраций рядом.
   */
  attempt: number
  /** Комментарий выдавшего. У периода он служебный, у акции — суть выдачи. */
  comment: string
}

/**
 * Половина списка, в которую смотрят.
 *
 * `active` — то, что ещё живёт и за что мы платим прямо сейчас; `closed` —
 * история. Делить обязательно: закрытых со временем становится на порядок
 * больше, и одним списком действующие тонут в них ровно тогда, когда за ними и
 * пришли. Сброшенный период — в истории независимо от статуса: он больше не
 * действует, даже если строка осталась в `provisioning`.
 */
export type GrantScope = "active" | "closed"

const SCOPE_SQL: Record<GrantScope, string> = {
  active: "g.status IN ('provisioning', 'active') AND g.reset_at IS NULL",
  closed: "(g.status IN ('exhausted', 'expired', 'revoked') OR g.reset_at IS NOT NULL)",
}

/**
 * Выданные подарки одного вида: страницами, с поиском и делением на живые и
 * закрытые.
 *
 * Поиск идёт по базе, а не по загруженной странице: искать в двадцати строках,
 * которые и так на экране, незачем — смысл ровно в том, чтобы найти выдачу,
 * уехавшую вниз за давностью. Ищем по почте, имени и комментарию: у акции
 * комментарий и есть её название («новогодняя»), и не искать по нему значило бы
 * заставлять помнить, кому именно её выдали.
 *
 * Номер попытки считается ДО отбора — оконной функцией по всем подаркам
 * человека этого вида. Посчитанный после он врал бы: на второй странице у
 * первого же периода вышло бы «период №1», хотя он третий.
 */
export async function listGrants(input: {
  kind: GrantKind
  scope: GrantScope
  search?: string
  limit?: number
  offset?: number
}): Promise<Activation[]> {
  const search = (input.search ?? "").trim()
  const result = await query<
    Omit<Activation, "amountCents" | "remainingCents" | "projectCount" | "attempt"> & {
      amountCents: string
      remainingCents: string
      projectCount: number
      attempt: number
    }
  >(
    `WITH ranked AS (
       SELECT g.*,
              ROW_NUMBER() OVER (
                PARTITION BY g.user_id ORDER BY g.created_at
              )::int AS attempt
         FROM billing_grants g
        WHERE g.kind = $1
     )
     SELECT g.id                 AS "grantId",
            g.user_id            AS "userId",
            u.email,
            COALESCE(u.full_name, '') AS "fullName",
            g.kind,
            g.status,
            g.amount_cents::text AS "amountCents",
            COALESCE((
              SELECT SUM(b.amount_cents) FROM billing_transactions b
               WHERE b.grant_id = g.id
            ), 0)::text          AS "remainingCents",
            g.created_at         AS "activatedAt",
            g.expires_at         AS "expiresAt",
            u.created_at         AS "registeredAt",
            (SELECT COUNT(*)::int FROM billing_grant_projects gp
              WHERE gp.grant_id = g.id) AS "projectCount",
            g.reset_at           AS "resetAt",
            g.attempt,
            COALESCE(g.comment, '') AS comment
       FROM ranked g
       JOIN users u ON u.id = g.user_id
      WHERE ${SCOPE_SQL[input.scope]}
        AND (
          $2 = ''
          OR u.email ILIKE '%' || $2 || '%'
          OR COALESCE(u.full_name, '') ILIKE '%' || $2 || '%'
          OR COALESCE(g.comment, '') ILIKE '%' || $2 || '%'
        )
      ORDER BY g.created_at DESC
      LIMIT $3 OFFSET $4`,
    [input.kind, search, input.limit ?? 20, input.offset ?? 0],
  )

  return result.rows.map((row) => ({
    ...row,
    amountCents: Number(row.amountCents),
    remainingCents: Number(row.remainingCents),
  }))
}

export type ProjectPick = {
  projectId: string
  name: string
  ownerEmail: string
  isTemplate: boolean
}

/**
 * Поиск проекта, чтобы отметить его шаблоном.
 *
 * По имени проекта и по почте владельца сразу: шаблоны лежат у служебного
 * аккаунта, и «показать всё, что у templates@…» — самый частый запрос здесь.
 */
export async function searchProjects(q: string, limit = 20): Promise<ProjectPick[]> {
  const term = `%${q.trim().toLowerCase()}%`
  const result = await query<ProjectPick>(
    `SELECT p.id AS "projectId",
            p.name,
            u.email AS "ownerEmail",
            COALESCE(p.is_template, FALSE) AS "isTemplate"
       FROM projects p
       JOIN users u ON u.id = p.user_id
      WHERE p.deleted_at IS NULL
        AND (lower(p.name) LIKE $1 OR lower(u.email) LIKE $1)
      ORDER BY COALESCE(p.is_template, FALSE) DESC, p.updated_at DESC
      LIMIT $2`,
    [term, limit],
  )
  return result.rows
}

export type TemplateCost = {
  projectId: string
  /**
   * Во что фактически обошлась секунда результата по последним обработкам.
   *
   * Из неё назначается размер подарка: обещание «100 минут за 6 000 ₽» правдиво
   * только если минута наших шаблонов действительно столько стоит. Ставка сайта
   * на этот вопрос не отвечает — она лишь часть цены.
   */
  centsPerSec: number | null
  charges: number
}

export async function listTemplateCosts(
  projectIds: string[],
): Promise<Map<string, TemplateCost>> {
  if (projectIds.length === 0) return new Map()
  const result = await query<{
    projectId: string
    value: string | null
    charges: number
  }>(
    `SELECT b.project_id AS "projectId",
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (b.our_cents + b.vendor_cents + b.margin_cents) / b.units
            )::text AS value,
            COUNT(*)::int AS charges
       FROM billing_transactions b
      WHERE b.project_id = ANY($1::text[])
        AND b.kind IN ('charge', 'exempt')
        AND b.pay_meter = 'sec'
        AND b.units > 0
      GROUP BY b.project_id`,
    [projectIds],
  )

  const map = new Map<string, TemplateCost>()
  for (const row of result.rows) {
    const value = row.value == null ? null : Number(row.value)
    map.set(row.projectId, {
      projectId: row.projectId,
      centsPerSec: value != null && Number.isFinite(value) ? value : null,
      charges: row.charges,
    })
  }
  return map
}

export type UserPick = {
  userId: string
  email: string
  fullName: string
  balanceOwnCents: number
  balanceGiftCents: number
}

/** Поиск человека для адресного подарка. */
export async function searchUsers(q: string, limit = 20): Promise<UserPick[]> {
  const term = `%${q.trim().toLowerCase()}%`
  const result = await query<
    Omit<UserPick, "balanceOwnCents" | "balanceGiftCents"> & {
      balanceOwnCents: string
      balanceGiftCents: string
    }
  >(
    `SELECT id AS "userId",
            email,
            COALESCE(full_name, '') AS "fullName",
            COALESCE(balance_own_cents, 0)::text  AS "balanceOwnCents",
            COALESCE(balance_gift_cents, 0)::text AS "balanceGiftCents"
       FROM users
      WHERE is_active
        AND (lower(email) LIKE $1 OR lower(COALESCE(full_name, '')) LIKE $1)
      ORDER BY email
      LIMIT $2`,
    [term, limit],
  )
  return result.rows.map((row) => ({
    ...row,
    balanceOwnCents: Number(row.balanceOwnCents),
    balanceGiftCents: Number(row.balanceGiftCents),
  }))
}

export type UserProject = {
  projectId: string
  name: string
  isArchived: boolean
}

/**
 * Проекты человека — чтобы отметить, где действует подарок.
 *
 * Архивные показываем тоже: подарок могут дарить под конкретную работу, и
 * проект вполне мог быть отправлен в архив до того, как о нём договорились.
 */
export async function listUserProjects(userId: string): Promise<UserProject[]> {
  const result = await query<UserProject>(
    `SELECT id AS "projectId",
            name,
            COALESCE(is_archived, FALSE) AS "isArchived"
       FROM projects
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY COALESCE(is_archived, FALSE), lower(name)`,
    [userId],
  )
  return result.rows
}

export type GrantRow = {
  grantId: string
  kind: string
  status: string
  amountCents: number
  remainingCents: number
  createdAt: Date
  expiresAt: Date | null
  comment: string
  projectIds: string[]
}

/** Все подарки одного человека — и период, и акции. */
export async function listUserGrants(userId: string): Promise<GrantRow[]> {
  const result = await query<
    Omit<GrantRow, "amountCents" | "remainingCents" | "projectIds"> & {
      amountCents: string
      remainingCents: string
      projectIds: string[] | null
    }
  >(
    `SELECT g.id AS "grantId",
            g.kind,
            g.status,
            g.amount_cents::text AS "amountCents",
            COALESCE((
              SELECT SUM(b.amount_cents) FROM billing_transactions b
               WHERE b.grant_id = g.id
            ), 0)::text AS "remainingCents",
            g.created_at AS "createdAt",
            g.expires_at AS "expiresAt",
            g.comment,
            ARRAY(
              SELECT gp.project_id FROM billing_grant_projects gp
               WHERE gp.grant_id = g.id
            ) AS "projectIds"
       FROM billing_grants g
      WHERE g.user_id = $1
      ORDER BY g.created_at DESC`,
    [userId],
  )
  return result.rows.map((row) => ({
    ...row,
    amountCents: Number(row.amountCents),
    remainingCents: Number(row.remainingCents),
    projectIds: row.projectIds ?? [],
  }))
}

/**
 * Персональный лимит овердрафта.
 *
 * `null` — действует общий из «Тарифов». Своё значение ставится осознанно,
 * поэтому ноль у человека означает именно «этому в кредит не даём», а не
 * «возьми общий»: иначе снять доверие было бы нечем.
 */
export async function setOverdraftLimit(input: {
  userId: string
  limitCents: number | null
}): Promise<void> {
  await query(`UPDATE users SET overdraft_limit_cents = $2 WHERE id = $1`, [
    input.userId,
    input.limitCents,
  ])
}

export async function readOverdraftLimit(
  userId: string,
): Promise<number | null> {
  const result = await query<{ limit: string | null }>(
    `SELECT overdraft_limit_cents::text AS limit FROM users WHERE id = $1`,
    [userId],
  )
  const raw = result.rows[0]?.limit
  return raw == null ? null : Number(raw)
}
