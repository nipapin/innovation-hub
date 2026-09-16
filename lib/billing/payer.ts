import { query, withTransaction } from "@/lib/db"

/**
 * Кто за кого платит — общий кошелёк, этап 1 docs/COMPANY_ACCOUNTS_PLAN.md (§7).
 *
 * `users.payer_user_id` стоит на том, ЗА КОГО платят. NULL — платит сам, как
 * было всегда. Заполнено — задачи его проектов резервируются и списываются с
 * кошелька плательщика: остаток, подарки и лимит овердрафта берутся у него.
 *
 * Связь не зависит от компаний: в общем разделе один человек может платить за
 * коллегу, а у сотрудника компании плательщиком станет кошелёк компании. Поэтому
 * это отдельная колонка, а не «платит моя компания».
 *
 * Цепочек нет: плательщик платит за себя сам, а тот, за кого уже платят, сам ни
 * за кого не платит. Держит это триггер `users_payer_no_chain` в базе; здесь те
 * же проверки делаются заранее, чтобы ответить человеку причиной, а не ошибкой
 * базы.
 */

export type PersonRef = {
  userId: string
  email: string
  fullName: string
}

const PERSON_FIELDS = `p.id AS "userId", p.email, p.full_name AS "fullName"`

/** Как подписать человека в интерфейсе: имя, а без него — почта. */
export function personLabel(person: PersonRef): string {
  return person.fullName.trim() || person.email
}

/** Кто платит за этого человека. null — платит сам. */
export async function readPayer(userId: string): Promise<PersonRef | null> {
  const result = await query<PersonRef>(
    `SELECT ${PERSON_FIELDS}
       FROM users u
       JOIN users p ON p.id = u.payer_user_id
      WHERE u.id = $1`,
    [userId],
  )
  return result.rows[0] ?? null
}

/** За кого платит этот человек. */
export async function listDependents(payerId: string): Promise<PersonRef[]> {
  const result = await query<PersonRef>(
    `SELECT ${PERSON_FIELDS}
       FROM users p
      WHERE p.payer_user_id = $1
      ORDER BY lower(COALESCE(NULLIF(p.full_name, ''), p.email))`,
    [payerId],
  )
  return result.rows
}

/**
 * Платит ли человек за кого-то.
 *
 * Удалить такого не даст внешний ключ (`ON DELETE RESTRICT`), но ответ «сначала
 * переведите тех, за кого он платит» понятнее ошибки базы.
 */
export async function hasDependents(userId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM users WHERE payer_user_id = $1 LIMIT 1`,
    [userId],
  )
  return (result.rowCount ?? 0) > 0
}

export type SetPayerProblem =
  | "not-found"
  | "payer-not-found"
  | "self"
  /** Плательщик сам платит не за себя — цепочки запрещены. */
  | "payer-has-payer"
  /** Человек сам платит за других — цепочки запрещены. */
  | "has-dependents"
  /**
   * У человека открыт подарок. Подарок лежит на его кошельке, а платить после
   * смены будет другой — начисленное повисло бы невидимым.
   */
  | "has-open-grants"
  /**
   * Прежний плательщик держит подарок, привязанный к проектам этого человека.
   * Сменить плательщика — значит оставить подарок в проектах, за которые его
   * хозяин больше не платит.
   */
  | "payer-grants-cover-projects"

export type SetPayerResult =
  | { ok: true; previousPayerId: string | null; changed: boolean }
  | { ok: false; reason: SetPayerProblem }

/**
 * Назначить или снять плательщика.
 *
 * Смена действует на всё, что ещё не списано: и резерв живых задач, и списание
 * завершённых считаются по ТЕКУЩЕМУ плательщику, а не по тому, кто был на момент
 * допуска. Так резерв и списание всегда смотрят на один и тот же кошелёк.
 *
 * Обе строки блокируются одним запросом в порядке id: две встречные смены иначе
 * могли бы взять блокировки в разном порядке и упереться друг в друга.
 */
export async function setPayer(input: {
  userId: string
  payerId: string | null
}): Promise<SetPayerResult> {
  if (input.payerId === input.userId) return { ok: false, reason: "self" }

  try {
    return await withTransaction(async (client): Promise<SetPayerResult> => {
      const ids = input.payerId ? [input.userId, input.payerId] : [input.userId]
      const locked = await client.query<{
        id: string
        payerUserId: string | null
        isActive: boolean
      }>(
        `SELECT id, payer_user_id AS "payerUserId", is_active AS "isActive"
           FROM users
          WHERE id = ANY($1::text[])
          ORDER BY id
          FOR UPDATE`,
        [ids],
      )

      const target = locked.rows.find((row) => row.id === input.userId)
      if (!target) return { ok: false, reason: "not-found" }

      const previous = target.payerUserId
      if (previous === input.payerId) {
        return { ok: true, previousPayerId: previous, changed: false }
      }

      if (input.payerId) {
        const payer = locked.rows.find((row) => row.id === input.payerId)
        // Заблокированному новых подопечных не даём: его кошелёк никто не
        // пополнит, и проекты встанут сразу после назначения.
        if (!payer || !payer.isActive) return { ok: false, reason: "payer-not-found" }
        if (payer.payerUserId) return { ok: false, reason: "payer-has-payer" }

        const dependents = await client.query(
          `SELECT 1 FROM users WHERE payer_user_id = $1 LIMIT 1`,
          [input.userId],
        )
        if ((dependents.rowCount ?? 0) > 0) {
          return { ok: false, reason: "has-dependents" }
        }

        const grants = await client.query(
          `SELECT 1 FROM billing_grants
            WHERE user_id = $1
              AND status IN ('provisioning', 'active')
              AND reset_at IS NULL
            LIMIT 1`,
          [input.userId],
        )
        if ((grants.rowCount ?? 0) > 0) {
          return { ok: false, reason: "has-open-grants" }
        }
      }

      if (previous) {
        // Подарок без проектов («в любом проекте») здесь не мешает: он не
        // привязан к этому человеку и остаётся тратиться там, где платит его
        // хозяин. Мешает только тот, что назван проектами этого человека.
        const covering = await client.query(
          `SELECT 1
             FROM billing_grants g
             JOIN billing_grant_projects gp ON gp.grant_id = g.id
             JOIN projects p ON p.id = gp.project_id
            WHERE g.user_id = $1
              AND g.status IN ('provisioning', 'active')
              AND p.user_id = $2
            LIMIT 1`,
          [previous, input.userId],
        )
        if ((covering.rowCount ?? 0) > 0) {
          return { ok: false, reason: "payer-grants-cover-projects" }
        }
      }

      await client.query(
        `UPDATE users SET payer_user_id = $2, updated_at = NOW() WHERE id = $1`,
        [input.userId, input.payerId],
      )
      return { ok: true, previousPayerId: previous, changed: true }
    })
  } catch (error) {
    // Встречная смена успела раньше: триггер базы увидел цепочку, которую
    // проверки выше не застали. Ответ тот же, что дала бы проверка.
    if (isConstraint(error, "users_payer_no_chain")) {
      return { ok: false, reason: "payer-has-payer" }
    }
    throw error
  }
}

function isConstraint(error: unknown, name: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "constraint" in error &&
    (error as { constraint?: unknown }).constraint === name
  )
}
