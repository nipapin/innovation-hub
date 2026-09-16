import { randomUUID } from "node:crypto"
import { query, withTransaction } from "@/lib/db"
import type { CompanyRecord, CompanyRole } from "@/lib/domain-types"

/**
 * Компания как сущность. Этап 3 плана docs/COMPANY_ACCOUNTS_PLAN.md.
 *
 * Компания на этом этапе ещё ничего не открывает — консоли `/company` нет, это
 * этап 4. Здесь только модель: заведение вместе со служебным кошельком, перенос
 * человека одной транзакцией, выключение и удаление пустой компании.
 */

const COMPANY_FIELDS = `
  id,
  slug,
  title,
  wallet_user_id AS "walletUserId",
  domain,
  branding,
  features,
  is_active AS "isActive",
  created_by AS "createdBy",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`

export type CompanyWithCount = CompanyRecord & { memberCount: number }

export async function listCompanies(): Promise<CompanyWithCount[]> {
  const result = await query<CompanyWithCount>(
    `SELECT ${COMPANY_FIELDS}, COALESCE(m.count, 0)::int AS "memberCount"
       FROM companies
       LEFT JOIN (
         SELECT company_id, COUNT(*)::int AS count
           FROM users
          WHERE company_id IS NOT NULL
          GROUP BY company_id
       ) m ON m.company_id = companies.id
      ORDER BY companies.created_at DESC`,
  )
  return result.rows
}

export async function findCompanyById(id: string): Promise<CompanyRecord | null> {
  const result = await query<CompanyRecord>(
    `SELECT ${COMPANY_FIELDS} FROM companies WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

/**
 * Компания по домену — оформление страницы входа (THEMING_PLAN §6.4).
 *
 * Только активная: выключенная компания не должна брендировать чужой вход, а
 * человек по её адресу увидит обычную установку.
 */
export async function findCompanyByDomain(
  domain: string,
): Promise<CompanyRecord | null> {
  const result = await query<CompanyRecord>(
    `SELECT ${COMPANY_FIELDS} FROM companies WHERE lower(domain) = lower($1) AND is_active`,
    [domain],
  )
  return result.rows[0] ?? null
}

export async function setCompanyBranding(input: {
  companyId: string
  branding: Record<string, unknown>
}): Promise<CompanyRecord | null> {
  const result = await query<CompanyRecord>(
    `UPDATE companies
        SET branding = $2::jsonb, updated_at = NOW()
      WHERE id = $1
      RETURNING ${COMPANY_FIELDS}`,
    [input.companyId, JSON.stringify(input.branding)],
  )
  return result.rows[0] ?? null
}

/**
 * Настройки компании (`features`) — правка ПОВЕРХ текущих, ключ за ключом.
 *
 * `||` вместо присваивания намеренно: мешок общий, и запись целиком стёрла бы
 * чужие ключи, которых вызывающий не знает. Форма шлёт то, что человек трогал.
 */
export async function patchCompanyFeatures(input: {
  companyId: string
  patch: Record<string, unknown>
}): Promise<CompanyRecord | null> {
  const result = await query<CompanyRecord>(
    `UPDATE companies
        SET features = features || $2::jsonb, updated_at = NOW()
      WHERE id = $1
      RETURNING ${COMPANY_FIELDS}`,
    [input.companyId, JSON.stringify(input.patch)],
  )
  return result.rows[0] ?? null
}

export async function setCompanyDomain(input: {
  companyId: string
  domain: string | null
}): Promise<{ ok: true } | { ok: false; reason: "domain-taken" | "not-found" }> {
  try {
    const result = await query(
      `UPDATE companies SET domain = $2, updated_at = NOW() WHERE id = $1`,
      [input.companyId, input.domain],
    )
    return (result.rowCount ?? 0) > 0
      ? { ok: true }
      : { ok: false, reason: "not-found" }
  } catch (error) {
    if (isUniqueViolation(error, "companies_domain_key")) {
      return { ok: false, reason: "domain-taken" }
    }
    throw error
  }
}

export type CreateCompanyResult =
  | { ok: true; company: CompanyRecord }
  | { ok: false; reason: "slug-taken" }

/**
 * Заводит компанию вместе со служебным кошельком одной транзакцией — «одной
 * кнопкой», как записано в решении (план §0, §15 этап 3).
 *
 * Email кошелька строится из slug: он уникален по природе (уходит в адреса и
 * префикс хранилища), поэтому не сталкивается с почтой живых людей и не требует
 * отдельного счётчика.
 */
export async function createCompany(input: {
  slug: string
  title: string
  createdBy: string
}): Promise<CreateCompanyResult> {
  const companyId = randomUUID()
  const walletId = randomUUID()
  const walletEmail = `${input.slug}@wallet.internal`

  try {
    const company = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO users (id, full_name, email, password_hash, role, auth_provider, kind)
         VALUES ($1, $2, $3, NULL, 'USER', 'local', 'company_wallet')`,
        [walletId, `Кошелёк «${input.title}»`, walletEmail],
      )
      const result = await client.query<CompanyRecord>(
        `INSERT INTO companies (id, slug, title, wallet_user_id, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${COMPANY_FIELDS}`,
        [companyId, input.slug, input.title, walletId, input.createdBy],
      )
      return result.rows[0]
    })
    return { ok: true, company }
  } catch (error) {
    if (
      isUniqueViolation(error, "companies_slug_key") ||
      isUniqueViolation(error, "users_email_key")
    ) {
      return { ok: false, reason: "slug-taken" }
    }
    throw error
  }
}

export async function setCompanyActive(
  companyId: string,
  isActive: boolean,
): Promise<CompanyRecord | null> {
  const result = await query<CompanyRecord>(
    `UPDATE companies SET is_active = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING ${COMPANY_FIELDS}`,
    [companyId, isActive],
  )
  return result.rows[0] ?? null
}

export type DeleteCompanyProblem =
  | "not-found"
  | "has-members"
  /** На кошельке есть движение денег — удалить его значит стереть ленту. */
  | "wallet-has-ledger"
  /** Кошелёк ещё за кого-то платит — снаружи компании такое возможно. */
  | "wallet-has-dependents"

export type DeleteCompanyResult = { ok: true } | { ok: false; reason: DeleteCompanyProblem }

/**
 * Удаление компании вместе с её служебным кошельком. Приёмка этапа 3 (план §15).
 *
 * Три отказа, и второй с третьим — не перестраховка. `billing_transactions.user_id`
 * стоит `ON DELETE CASCADE` (db/migrations/2026-08-27-billing.sql), поэтому
 * удаление кошелька унесло бы ВСЮ ленту компании молча — ни ошибки, ни следа.
 * Лента переживает компанию: сначала кошелёк разгружают, потом удаляют.
 *
 * Подопечные проверяются отдельно от FK (`payer_user_id ... ON DELETE RESTRICT`)
 * по той же причине, что и в lib/billing/payer.ts: причина понятнее ошибки базы.
 */
export async function deleteCompany(companyId: string): Promise<DeleteCompanyResult> {
  return withTransaction(async (client) => {
    const company = await client.query<{ walletUserId: string }>(
      `SELECT wallet_user_id AS "walletUserId" FROM companies WHERE id = $1 FOR UPDATE`,
      [companyId],
    )
    const walletUserId = company.rows[0]?.walletUserId
    if (!walletUserId) return { ok: false, reason: "not-found" }

    const members = await client.query(
      `SELECT 1 FROM users WHERE company_id = $1 LIMIT 1`,
      [companyId],
    )
    if ((members.rowCount ?? 0) > 0) return { ok: false, reason: "has-members" }

    const dependents = await client.query(
      `SELECT 1 FROM users WHERE payer_user_id = $1 LIMIT 1`,
      [walletUserId],
    )
    if ((dependents.rowCount ?? 0) > 0) {
      return { ok: false, reason: "wallet-has-dependents" }
    }

    // Подарки смотрим вместе со списаниями: грант без единой транзакции — это
    // всё равно выданные деньги, и его исчезновение объяснить будет нечем.
    const ledger = await client.query(
      `SELECT 1 FROM billing_transactions WHERE user_id = $1
        UNION ALL
       SELECT 1 FROM billing_grants WHERE user_id = $1
        LIMIT 1`,
      [walletUserId],
    )
    if ((ledger.rowCount ?? 0) > 0) {
      return { ok: false, reason: "wallet-has-ledger" }
    }

    await client.query(`DELETE FROM companies WHERE id = $1`, [companyId])
    await client.query(`DELETE FROM users WHERE id = $1 AND kind = 'company_wallet'`, [
      walletUserId,
    ])
    return { ok: true }
  })
}

export type CompanyMember = {
  userId: string
  email: string
  fullName: string
  companyRole: CompanyRole
}

export async function listCompanyMembers(companyId: string): Promise<CompanyMember[]> {
  const result = await query<CompanyMember>(
    `SELECT id AS "userId", email, full_name AS "fullName", company_role AS "companyRole"
       FROM users
      WHERE company_id = $1 AND kind = 'person'
      ORDER BY lower(COALESCE(NULLIF(full_name, ''), email))`,
    [companyId],
  )
  return result.rows
}

export type TransferProblem =
  | "not-found"
  | "is-wallet"
  | "company-not-found"
  | "company-inactive"
  | "invalid-pair"
  /** Человек сам платит за других — цепочек нет (план §7.4). */
  | "has-dependents"
  /** У человека открыт подарок на его личном кошельке. */
  | "has-open-grants"

export type TransferResult =
  | {
      ok: true
      changed: boolean
      previousCompanyId: string | null
      /** С какого кошелька теперь платят — первый вопрос после перевода. */
      payerUserId: string | null
      previousPayerUserId: string | null
    }
  | { ok: false; reason: TransferProblem }

/**
 * Перевод человека между компаниями или в общий раздел — одна транзакция
 * (план §3): смена company_id, выставление или снятие company_role, снятие
 * всех company_capabilities и решение payer_user_id (план §7.4).
 *
 * Плательщик подставляется на кошелёк компании при входе и снимается при
 * выходе, но только если это был кошелёк ИМЕННО прежней компании: личного
 * плательщика, назначенного в общем разделе через lib/billing/payer.ts, смена
 * компании не касается.
 *
 * Смена плательщика здесь — та же операция, что и на экране акций, поэтому и
 * защиты у неё те же (lib/billing/payer.ts, setPayer). Без них перевод обходил
 * бы их молча: открытый подарок остался бы на личном кошельке, с которого уже
 * никто не платит, а «платит за других» упёрлось бы в триггер базы и вернуло
 * 500 вместо причины.
 */
export async function transferUserToCompany(input: {
  userId: string
  companyId: string | null
  companyRole: CompanyRole | null
}): Promise<TransferResult> {
  if ((input.companyId === null) !== (input.companyRole === null)) {
    return { ok: false, reason: "invalid-pair" }
  }

  return withTransaction(async (client) => {
    const userRes = await client.query<{
      id: string
      kind: string
      companyId: string | null
      companyRole: string | null
      payerUserId: string | null
    }>(
      `SELECT id, kind, company_id AS "companyId", company_role AS "companyRole",
              payer_user_id AS "payerUserId"
         FROM users
        WHERE id = $1
          FOR UPDATE`,
      [input.userId],
    )
    const user = userRes.rows[0]
    if (!user) return { ok: false, reason: "not-found" }
    if (user.kind !== "person") return { ok: false, reason: "is-wallet" }

    let walletUserId: string | null = null
    if (input.companyId) {
      const companyRes = await client.query<{
        isActive: boolean
        walletUserId: string
      }>(
        `SELECT is_active AS "isActive", wallet_user_id AS "walletUserId"
           FROM companies
          WHERE id = $1
            FOR UPDATE`,
        [input.companyId],
      )
      const company = companyRes.rows[0]
      if (!company) return { ok: false, reason: "company-not-found" }
      if (!company.isActive) return { ok: false, reason: "company-inactive" }
      walletUserId = company.walletUserId
    }

    const previousCompanyId = user.companyId
    if (previousCompanyId === input.companyId && user.companyRole === input.companyRole) {
      return {
        ok: true,
        changed: false,
        previousCompanyId,
        payerUserId: user.payerUserId,
        previousPayerUserId: user.payerUserId,
      }
    }

    let nextPayerUserId = user.payerUserId
    if (walletUserId) {
      nextPayerUserId = walletUserId
    } else if (previousCompanyId) {
      const prevCompany = await client.query<{ walletUserId: string }>(
        `SELECT wallet_user_id AS "walletUserId" FROM companies WHERE id = $1`,
        [previousCompanyId],
      )
      if (prevCompany.rows[0]?.walletUserId === user.payerUserId) {
        nextPayerUserId = null
      }
    }

    if (nextPayerUserId !== user.payerUserId) {
      const dependents = await client.query(
        `SELECT 1 FROM users WHERE payer_user_id = $1 LIMIT 1`,
        [input.userId],
      )
      if ((dependents.rowCount ?? 0) > 0) {
        return { ok: false, reason: "has-dependents" }
      }

      // Подарок лежит на кошельке человека, а платить после перевода будет
      // другой — начисленное повисло бы невидимым.
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

    await client.query(`DELETE FROM company_capabilities WHERE user_id = $1`, [
      input.userId,
    ])

    await client.query(
      `UPDATE users
          SET company_id = $2, company_role = $3, payer_user_id = $4, updated_at = NOW()
        WHERE id = $1`,
      [input.userId, input.companyId, input.companyRole, nextPayerUserId],
    )

    return {
      ok: true,
      changed: true,
      previousCompanyId,
      payerUserId: nextPayerUserId,
      previousPayerUserId: user.payerUserId,
    }
  })
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505" &&
    (error as { constraint?: unknown }).constraint === constraint
  )
}
