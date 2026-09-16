import { query } from "@/lib/db"
import { isRemoteComputerOnline } from "@/lib/repositories/remote-computers"
import { hashMachineToken } from "@/lib/storage/write-path"
import type { CompanyRole } from "@/lib/domain-types"

/**
 * Выборки консоли компании — docs/COMPANY_ACCOUNTS_PLAN.md §6.
 *
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: `companyId` — обязательный первый аргумент
 * каждой функции, и он всегда попадает в `WHERE`. Это единственное место в
 * коде, которое смотрит поперёк нескольких человек (§2), поэтому забытый фильтр
 * здесь означал бы, что админ одной компании видит людей другой.
 *
 * Функции намеренно не принимают «необязательный» companyId и не имеют
 * умолчаний: значение приходит из гейта (lib/company-auth.ts), который без него
 * не возвращается.
 *
 * Денег здесь нет: остаток и резерв компании считает `getFunds(walletUserId)`
 * из lib/billing/funds.ts. Свой запрос был бы вторым ответом на вопрос «сколько
 * доступно» — и разошёлся бы с тем, по которому работает допуск задач
 * (`liveReserves` учитывает статус `claimed`, окно досчёта у завершённых и
 * разделение кошельков; наивная сумма по `queued/running` этого не знает).
 */

export type CompanyPerson = {
  userId: string
  email: string
  fullName: string
  companyRole: CompanyRole
  isActive: boolean
  createdAt: Date
}

export async function listPeople(companyId: string): Promise<CompanyPerson[]> {
  const result = await query<CompanyPerson>(
    `SELECT id AS "userId",
            email,
            COALESCE(full_name, '') AS "fullName",
            company_role AS "companyRole",
            is_active AS "isActive",
            created_at AS "createdAt"
       FROM users
      WHERE company_id = $1
        AND kind = 'person'
      ORDER BY
        CASE company_role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
        lower(COALESCE(NULLIF(full_name, ''), email))`,
    [companyId],
  )
  return result.rows
}

/**
 * Роль человека в ЭТОЙ компании. `null` — он не её сотрудник.
 *
 * Нужна перед каждым изменением: без неё «сменить роль» принимало бы чужой
 * идентификатор и меняло человека в соседней компании.
 */
export async function readMemberRole(
  companyId: string,
  userId: string,
): Promise<CompanyRole | null> {
  const result = await query<{ companyRole: CompanyRole }>(
    `SELECT company_role AS "companyRole"
       FROM users
      WHERE id = $1 AND company_id = $2 AND kind = 'person'`,
    [userId, companyId],
  )
  return result.rows[0]?.companyRole ?? null
}

export async function setMemberRole(input: {
  companyId: string
  userId: string
  companyRole: CompanyRole
}): Promise<boolean> {
  const result = await query(
    `UPDATE users
        SET company_role = $3, updated_at = NOW()
      WHERE id = $1 AND company_id = $2 AND kind = 'person'`,
    [input.userId, input.companyId, input.companyRole],
  )
  return (result.rowCount ?? 0) > 0
}

export type CompanyLedgerRow = {
  id: string
  kind: string
  wallet: string
  amountCents: number
  comment: string
  createdAt: Date
  projectName: string | null
  /** Чья работа: компания платит за многих, и «кто потратил» — первый вопрос. */
  spenderName: string | null
}

/**
 * Лента кошелька компании.
 *
 * «Кто потратил» берётся через владельца проекта, а не отдельной колонкой:
 * связь `billing_transactions.project_id → projects.user_id` уже есть, а
 * `spender_user_id` был бы вторым источником правды (план §7.9). Проект удалён
 * (`ON DELETE SET NULL`) — строка остаётся без имени, и это честнее, чем
 * подставить чужое.
 */
export async function listCompanyLedger(input: {
  walletUserId: string
  limit: number
  before?: string | null
}): Promise<{ rows: CompanyLedgerRow[]; nextCursor: string | null }> {
  const params: unknown[] = [input.walletUserId]
  let cursor = ""
  if (input.before) {
    params.push(input.before)
    cursor = `AND b.created_at < (SELECT created_at FROM billing_transactions WHERE id = $${params.length})`
  }
  params.push(input.limit + 1)

  const result = await query<CompanyLedgerRow & { amountCents: string }>(
    `SELECT b.id,
            b.kind,
            b.wallet,
            b.amount_cents::text AS "amountCents",
            b.comment,
            b.created_at AS "createdAt",
            p.name AS "projectName",
            COALESCE(NULLIF(u.contact_name, ''), NULLIF(u.full_name, ''), u.email)
              AS "spenderName"
       FROM billing_transactions b
       LEFT JOIN projects p ON p.id = b.project_id
       LEFT JOIN users u ON u.id = p.user_id
      WHERE b.user_id = $1
        ${cursor}
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT $${params.length}`,
    params,
  )

  const all = result.rows.map((row) => ({
    ...row,
    amountCents: Number(row.amountCents),
  }))
  const hasMore = all.length > input.limit
  const rows = hasMore ? all.slice(0, input.limit) : all
  return {
    rows,
    nextCursor: hasMore ? (rows[rows.length - 1]?.id ?? null) : null,
  }
}

export type CompanyKeyRow = {
  accountId: string
  label: string
  serviceSlug: string
  serviceTitle: string
  status: string
  createdAt: Date
}

/**
 * Учётки внешних сервисов компании — те, чей владелец её служебный кошелёк
 * (план §11). Ключи не отдаются никогда: только метки, как и сотруднику при
 * настройке узла.
 */
export async function listCompanyKeys(
  walletUserId: string,
): Promise<CompanyKeyRow[]> {
  const result = await query<CompanyKeyRow>(
    `SELECT a.id AS "accountId",
            a.label,
            s.slug AS "serviceSlug",
            s.name AS "serviceTitle",
            a.status,
            a.created_at AS "createdAt"
       FROM vendor_accounts a
       JOIN vendor_services s ON s.id = a.service_id
      WHERE a.owner_user_id = $1
      ORDER BY s.name, a.label`,
    [walletUserId],
  )
  return result.rows
}

/** Кого компания оплачивает: сотрудники, у которых плательщик — её кошелёк. */
export async function listCompanyPayees(
  walletUserId: string,
): Promise<{ userId: string; email: string; fullName: string }[]> {
  const result = await query<{ userId: string; email: string; fullName: string }>(
    `SELECT id AS "userId", email, COALESCE(full_name, '') AS "fullName"
       FROM users
      WHERE payer_user_id = $1
      ORDER BY lower(COALESCE(NULLIF(full_name, ''), email))`,
    [walletUserId],
  )
  return result.rows
}

export type CompanyMachine = {
  id: string
  name: string
  description: string
  status: string
  online: boolean
  lastHeartbeatAt: Date | null
  currentProjectName: string | null
  createdAt: Date
}

/**
 * Машины компании — docs/COMPANY_PIPELINE_PLAN.md §2.
 *
 * `company_id` в `WHERE`, как и у всего в этом файле: список машин — ровно то
 * место, где чужая строка означала бы чужой токен на экране клиента.
 */
export async function listCompanyMachines(
  companyId: string,
): Promise<CompanyMachine[]> {
  const result = await query<
    Omit<CompanyMachine, "online"> & { lastHeartbeatAt: Date | null }
  >(
    `SELECT rc.id,
            rc.name,
            rc.description,
            rc.status,
            rc.last_heartbeat_at AS "lastHeartbeatAt",
            rc.created_at AS "createdAt",
            p.name AS "currentProjectName"
       FROM remote_computers rc
       LEFT JOIN projects p ON p.id = rc.current_project_id
      WHERE rc.company_id = $1
        AND rc.revoked_at IS NULL
      ORDER BY rc.created_at DESC`,
    [companyId],
  )
  return result.rows.map((row) => ({
    ...row,
    online: isRemoteComputerOnline(row.lastHeartbeatAt, null),
  }))
}

/**
 * Отзыв машины компании.
 *
 * `company_id` стоит в `WHERE` вместе с `id`, а не проверяется отдельным
 * чтением: так чужой идентификатор просто не находит строки, и между проверкой
 * и записью нет промежутка, в котором машину успели бы перевесить.
 */
export async function revokeCompanyMachine(
  companyId: string,
  id: string,
): Promise<boolean> {
  const result = await query(
    `UPDATE remote_computers
        SET revoked_at = NOW()
      WHERE id = $1 AND company_id = $2 AND revoked_at IS NULL`,
    [id, companyId],
  )
  return (result.rowCount ?? 0) > 0
}

/** Смена токена машины компании — ответ на «ключ утёк». Рамка та же. */
export async function rotateCompanyMachineToken(
  companyId: string,
  id: string,
  rawToken: string,
): Promise<boolean> {
  const result = await query(
    `UPDATE remote_computers
        SET token_hash = $3
      WHERE id = $1 AND company_id = $2 AND revoked_at IS NULL`,
    [id, companyId, hashMachineToken(rawToken)],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Внешний участник проекта компании: человек, у которого есть доступ к её
 * работе, но сам он не её сотрудник.
 *
 * Строка на ПАРУ «человек + проект», а не на человека: один и тот же фрилансер
 * может сидеть в трёх проектах с разными ролями, и «отозвать» должно снимать
 * доступ к конкретному, а не ко всем сразу. Свернуть строки в человека — работа
 * интерфейса, не запроса.
 */
export type CompanyOutsider = {
  userId: string
  email: string
  fullName: string
  projectId: string
  projectName: string
  /** viewer | editor | full — роль в проекте, не в компании. */
  role: string
  /** Кто позвал. Пусто, если приглашавшего уже удалили. */
  invitedByName: string | null
  invitedAt: Date
}

/**
 * Кто извне сидит в проектах компании.
 *
 * Принадлежность проекта считается по ВЛАДЕЛЬЦУ: компания у работы одна — та,
 * чей это проект и чей кошелёк за него платит.
 *
 * `IS DISTINCT FROM` вместо `<>`: у человека из общего раздела `company_id`
 * пустой, а `NULL <> 'ca'` даёт NULL, то есть строка тихо выпала бы из списка —
 * и именно тот, кого важнее всего увидеть, остался бы невидимым.
 *
 * Корзина исключена: доступ к удалённому проекту отзывать не от чего, а в
 * списке он выглядел бы как живая утечка.
 */
export async function listCompanyOutsiders(
  companyId: string,
): Promise<CompanyOutsider[]> {
  const result = await query<CompanyOutsider>(
    `SELECT u.id AS "userId",
            u.email,
            COALESCE(u.full_name, '') AS "fullName",
            p.id AS "projectId",
            p.name AS "projectName",
            pm.role,
            NULLIF(COALESCE(inv.full_name, inv.email, ''), '') AS "invitedByName",
            pm.created_at AS "invitedAt"
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       JOIN users owner ON owner.id = p.user_id
       JOIN users u ON u.id = pm.user_id
       LEFT JOIN users inv ON inv.id = pm.invited_by
      WHERE owner.company_id = $1
        AND u.company_id IS DISTINCT FROM $1
        AND u.id <> p.user_id
        AND p.deleted_at IS NULL
      ORDER BY pm.created_at DESC`,
    [companyId],
  )
  return result.rows
}

/**
 * Отозвать доступ внешнего участника к проекту компании.
 *
 * Рамка компании стоит В САМОМ `DELETE`, как у машин: чужая пара
 * «проект + человек» просто не находит строки, и между проверкой и удалением
 * нет промежутка. Условие `company_id IS DISTINCT FROM` повторено намеренно —
 * этой ручкой нельзя выкинуть из проекта СВОЕГО сотрудника: для этого есть
 * диалог «Поделиться» у владельца, а здесь инструмент про посторонних.
 */
export async function revokeCompanyOutsider(
  companyId: string,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const result = await query(
    `DELETE FROM project_members pm
      USING projects p, users owner, users u
      WHERE pm.project_id = $2
        AND pm.user_id = $3
        AND p.id = pm.project_id
        AND owner.id = p.user_id
        AND owner.company_id = $1
        AND u.id = pm.user_id
        AND u.company_id IS DISTINCT FROM $1`,
    [companyId, projectId, userId],
  )
  return (result.rowCount ?? 0) > 0
}
