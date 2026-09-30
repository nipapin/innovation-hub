import { query } from "@/lib/db"

/**
 * Круг людей, которых автор пайплайна может назначать в этапы —
 * docs/PRODUCTION_PLAN.md §6.1.
 *
 * - В компании — активные сотрудники этой компании (служебный кошелёк не
 *   человек и сюда не попадает).
 * - В «Личном» — свои контакты из «Поделиться», у которых есть аккаунт: человека,
 *   которого на сайте нет, назначить нельзя — назначение не создаёт аккаунт и не
 *   шлёт письмо.
 * - Сам автор — всегда: этап он может делать и сам.
 *
 * Тот же круг фильтрует людей при активации и правке на месте, а не только
 * подсказки в редакторе: граф приходит с клиента.
 */

import type { PersonOption } from "./people-types"

export type { PersonOption }

const NAME = `COALESCE(NULLIF(TRIM(u.contact_name), ''), NULLIF(TRIM(u.full_name), ''), u.email)`

export async function listPipelinePeople(ownerUserId: string): Promise<PersonOption[]> {
  const { rows } = await query<PersonOption>(
    `WITH owner AS (
       SELECT id, company_id FROM users WHERE id = $1
     )
     SELECT u.id, ${NAME} AS name, u.email
       FROM users u, owner o
      WHERE u.is_active AND u.kind = 'person'
        AND (
          u.id = o.id
          OR (o.company_id IS NOT NULL AND u.company_id = o.company_id)
          OR (
            o.company_id IS NULL
            AND u.login_user_id IS NULL
            AND lower(u.email) IN (SELECT lower(email) FROM share_contacts WHERE user_id = o.id)
          )
        )
      ORDER BY u.id = o.id DESC, name ASC`,
    [ownerUserId],
  )
  return rows
}

/** Оставить только тех, кто в круге. */
export async function allowedPeopleIds(ownerUserId: string): Promise<Set<string>> {
  return new Set((await listPipelinePeople(ownerUserId)).map((person) => person.id))
}
