import { randomUUID } from "node:crypto"
import { query, withTransaction } from "@/lib/db"
import type { PoolClient } from "pg"
import type { CompanyRecord, CompanyRole } from "@/lib/domain-types"

/**
 * Компания как сущность. Этап 3 плана docs/COMPANY_ACCOUNTS_PLAN.md.
 *
 * Заведение вместе со служебным кошельком, выключение и удаление пустой
 * компании. Люди попадают в компанию подпрофилем под своим входом
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md): `createSubprofile` и
 * `deactivateSubprofile` ниже.
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
         -- Выведенные из компании подпрофили остаются строками (на них
         -- ссылаются проекты компании), но людьми компании уже не считаются.
         SELECT company_id, COUNT(*)::int AS count
           FROM users
          WHERE company_id IS NOT NULL
            AND kind = 'person'
            AND is_active
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

/**
 * Настройки компании ЧЕЛОВЕКА — один запрос вместо двух.
 *
 * Нужен кабинету (`/api/account/tools`): там на руках только `userId`, а
 * спросить надо набор проданного его компании. Вне компании человек живёт в
 * общем разделе — ему возвращается `null`, и набор к нему не применяется вовсе.
 */
export async function findCompanyFeaturesForUser(
  userId: string,
): Promise<Record<string, unknown> | null> {
  const result = await query<{ features: Record<string, unknown> }>(
    `SELECT c.features
       FROM users u JOIN companies c ON c.id = u.company_id
      WHERE u.id = $1`,
    [userId],
  )
  return result.rows[0]?.features ?? null
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

/**
 * Переименование компании — docs/COMPANY_SETUP_PANEL_PLAN.md §1.
 *
 * Название читается отовсюду: сайдбар каждого сотрудника, шапка консоли,
 * письма, заголовок страницы. Всё это берёт его из одной колонки и подхватит
 * само — отдельной рассылки не требуется.
 *
 * Служебный кошелёк переименовывается ТОЙ ЖЕ транзакцией, потому что имя ему
 * дали из названия при заведении (`createCompany`), и иначе оно осталось бы
 * прежним навсегда: в наших списках движения денег компания «Б» с кошельком
 * «Кошелёк «А»» читается как чужой кошелёк, случайно попавший в выборку.
 *
 * Но только если имя ещё ТО САМОЕ, что мы выдали. Кошелёк — обычная строка в
 * `users`, и переименовать его могли снаружи; затирать чужую правку ради
 * косметики нельзя, а разойтись с названием ей и так позволено.
 *
 * `slug` при этом не трогается вовсе: он уходит в префикс хранилища и в почту
 * кошелька, и его смена означала бы переезд файлов (план §1.4).
 */
export type SetCompanyTitleResult =
  | { ok: true; company: CompanyRecord }
  | { ok: false; reason: "not-found" | "stale" }

export async function setCompanyTitle(input: {
  companyId: string
  title: string
  /**
   * Название, которое видел тот, кто правит. Сверяется под замком.
   *
   * Без него переименование — слепая запись. Экран оформления шлёт название на
   * КАЖДОЕ сохранение, а не только когда его трогали, поэтому вкладка,
   * открытая до чужого переименования, сохранением логотипа вернула бы старое
   * имя всей компании — и кошельку заодно, потому что для него оно к тому
   * моменту снова «то самое». Расхождение здесь означает, что компанию
   * переименовали, пока экран был открыт, и решать это должен человек.
   */
  expectedTitle: string
}): Promise<SetCompanyTitleResult> {
  return withTransaction(async (client) => {
    const current = await client.query<{ title: string; walletUserId: string }>(
      `SELECT title, wallet_user_id AS "walletUserId"
         FROM companies WHERE id = $1 FOR UPDATE`,
      [input.companyId],
    )
    const company = current.rows[0]
    if (!company) return { ok: false, reason: "not-found" }
    // Под замком, взятым строкой выше: между сверкой и записью никто не влезет.
    if (company.title !== input.expectedTitle) return { ok: false, reason: "stale" }

    const updated = await client.query<CompanyRecord>(
      `UPDATE companies SET title = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING ${COMPANY_FIELDS}`,
      [input.companyId, input.title],
    )

    await client.query(
      `UPDATE users SET full_name = $2, updated_at = NOW()
        WHERE id = $1 AND kind = 'company_wallet' AND full_name = $3`,
      [company.walletUserId, walletName(input.title), walletName(company.title)],
    )

    const row = updated.rows[0]
    return row ? { ok: true, company: row } : { ok: false, reason: "not-found" }
  })
}

/** Имя служебного кошелька. Одно место на заведение и переименование. */
function walletName(companyTitle: string): string {
  return `Кошелёк «${companyTitle}»`
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
        [walletId, walletName(input.title), walletEmail],
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
    // Почта кошелька уникальна среди входов: до миграции подпрофилей — своим
    // ограничением, после — частичным индексом. Имена у них разные, а причина
    // отказа одна.
    if (
      isUniqueViolation(error, "companies_slug_key") ||
      isUniqueViolation(error, "users_email_key") ||
      isUniqueViolation(error, "users_login_email_idx")
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

/**
 * Люди компании для нашей админки. Только действующие: выведенный подпрофиль
 * остаётся строкой (на него ссылаются проекты компании), но сотрудником уже не
 * числится, и в списке он путал бы — «убрали, а он на месте».
 */
export async function listCompanyMembers(companyId: string): Promise<CompanyMember[]> {
  const result = await query<CompanyMember>(
    `SELECT id AS "userId", email, full_name AS "fullName", company_role AS "companyRole"
       FROM users
      WHERE company_id = $1 AND kind = 'person' AND is_active
      ORDER BY lower(COALESCE(NULLIF(full_name, ''), email))`,
    [companyId],
  )
  return result.rows
}

/**
 * Коллеги по компании для подсказок диалога «Поделиться»: действующие люди
 * той же компании, кроме самого спрашивающего.
 */
export async function listCompanyColleagues(input: {
  companyId: string
  excludeUserId: string
}): Promise<{ email: string; fullName: string }[]> {
  const result = await query<{ email: string; fullName: string }>(
    `SELECT email, full_name AS "fullName"
       FROM users
      WHERE company_id = $1 AND kind = 'person' AND is_active
        AND id <> $2
      ORDER BY lower(COALESCE(NULLIF(full_name, ''), email))
      LIMIT 500`,
    [input.companyId, input.excludeUserId],
  )
  return result.rows
}

/**
 * Кто платит за работу сотрудника этой компании — её кошелёк.
 *
 * Одно место на весь код, куда ведёт вопрос «чей кошелёк у сотрудника»: прежде
 * ответ жил внутри переноса человека между компаниями, а второй INSERT со
 * своими правилами плательщика разошёлся бы с ним молча
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §3.5).
 *
 * `null` — компании нет или она выключена: в выключенную компанию не
 * добавляют, и объяснять это надо причиной, а не ошибкой базы.
 */
async function companyPayerFor(
  client: PoolClient,
  companyId: string,
): Promise<
  | { ok: true; walletUserId: string }
  | { ok: false; reason: "company-not-found" | "company-inactive" }
> {
  const companyRes = await client.query<{ isActive: boolean; walletUserId: string }>(
    `SELECT is_active AS "isActive", wallet_user_id AS "walletUserId"
       FROM companies
      WHERE id = $1
        FOR UPDATE`,
    [companyId],
  )
  const company = companyRes.rows[0]
  if (!company) return { ok: false, reason: "company-not-found" }
  if (!company.isActive) return { ok: false, reason: "company-inactive" }
  return { ok: true, walletUserId: company.walletUserId }
}

export type SubprofileProblem =
  /** Такого входа нет, или это не вход (подпрофиль, кошелёк компании). */
  | "login-not-found"
  /** Вход заблокирован — в компанию его не добавляют. */
  | "login-inactive"
  | "company-not-found"
  | "company-inactive"

export type CreateSubprofileResult =
  | {
      ok: true
      /**
       * created — новый подпрофиль; reactivated — прежний, выведенный из
       * компании, вернули; already — действующий профиль в ней уже есть.
       */
      outcome: "created" | "reactivated" | "already"
      profileId: string
      /** Роль в компании ДО вызова. Только у `already`. */
      currentRole: CompanyRole | null
    }
  | { ok: false; reason: SubprofileProblem }

/**
 * Рабочее место человека в компании — подпрофиль под его входом
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §3.5, §7).
 *
 * ЕДИНСТВЕННЫЙ путь создать подпрофиль — для консоли компании, для нашей
 * админки и для возвращения выведенного. Инварианты, которых CHECK не выразит
 * (§3.2), держатся здесь: цепочка глубиной один (вход — строка без
 * `login_user_id`), вход — активный человек, второй профиль в той же компании
 * не заводится.
 *
 * Общие поля (почта, имя, подпись) копируются со входа, роль сайта — всегда
 * `USER`, средств входа нет: всё это требует и CHECK, но отказ базы здесь был
 * бы 500, а не причина. Платит кошелёк компании — как у любого её сотрудника.
 *
 * Уже есть действующий профиль в этой компании — `already`, и роль НЕ
 * меняется: повторное добавление не должно молча понижать владельца до
 * участника. Менять роль — отдельным действием.
 */
export async function createSubprofile(input: {
  loginUserId: string
  companyId: string
  companyRole: CompanyRole
}): Promise<CreateSubprofileResult> {
  return withTransaction(async (client) => {
    const loginRes = await client.query<{
      id: string
      kind: string
      loginUserId: string | null
      isActive: boolean
      companyId: string | null
      companyRole: CompanyRole | null
    }>(
      `SELECT id, kind, login_user_id AS "loginUserId", is_active AS "isActive",
              company_id AS "companyId", company_role AS "companyRole"
         FROM users
        WHERE id = $1
          FOR UPDATE`,
      [input.loginUserId],
    )
    const login = loginRes.rows[0]
    if (!login || login.kind !== "person" || login.loginUserId !== null) {
      return { ok: false, reason: "login-not-found" }
    }
    if (!login.isActive) return { ok: false, reason: "login-inactive" }

    const payer = await companyPayerFor(client, input.companyId)
    if (!payer.ok) return payer

    // Между выкатом кода и миграцией перевода сотрудник ещё живёт одной строкой
    // — входом с компанией. Для своей компании он «уже в ней».
    if (login.companyId === input.companyId) {
      return {
        ok: true,
        outcome: "already",
        profileId: login.id,
        currentRole: login.companyRole,
      }
    }

    const existingRes = await client.query<{
      id: string
      isActive: boolean
      companyRole: CompanyRole
    }>(
      `SELECT id, is_active AS "isActive", company_role AS "companyRole"
         FROM users
        WHERE login_user_id = $1 AND company_id = $2
          FOR UPDATE`,
      [input.loginUserId, input.companyId],
    )
    const existing = existingRes.rows[0]

    if (existing?.isActive) {
      return {
        ok: true,
        outcome: "already",
        profileId: existing.id,
        currentRole: existing.companyRole,
      }
    }

    if (existing) {
      // Возвращение выведенного. Права компании сняли при выводе, но чистим и
      // здесь: теги, всплывшие из прошлой жизни, вернули бы доступ, которого в
      // этот раз никто не выдавал.
      await client.query(`DELETE FROM company_capabilities WHERE user_id = $1`, [
        existing.id,
      ])
      await client.query(
        `UPDATE users s
            SET is_active     = TRUE,
                company_role  = $2,
                payer_user_id = $3,
                email         = l.email,
                full_name     = l.full_name,
                contact_name  = l.contact_name,
                updated_at    = NOW()
           FROM users l
          WHERE s.id = $1
            AND l.id = s.login_user_id`,
        [existing.id, input.companyRole, payer.walletUserId],
      )
      return {
        ok: true,
        outcome: "reactivated",
        profileId: existing.id,
        currentRole: null,
      }
    }

    const profileId = randomUUID()
    await client.query(
      `INSERT INTO users (
         id, full_name, contact_name, email, password_hash, role, auth_provider,
         provider_account_id, kind, company_id, company_role, payer_user_id,
         login_user_id
       )
       SELECT $1, l.full_name, l.contact_name, l.email, NULL, 'USER', 'local',
              NULL, 'person', $2, $3, $4, l.id
         FROM users l
        WHERE l.id = $5`,
      [profileId, input.companyId, input.companyRole, payer.walletUserId, input.loginUserId],
    )
    return { ok: true, outcome: "created", profileId, currentRole: null }
  })
}

export type DeactivateSubprofileResult =
  | { ok: true; changed: boolean; email: string }
  | { ok: false; reason: "not-found" }

/**
 * Вывести человека из компании — выключить его подпрофиль
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §7.3).
 *
 * Строку НЕ удаляем: на неё ссылаются проекты компании, задачи и журнал, и
 * проекты остаются компании, как у уволенного. Права компании снимаются здесь
 * же: выключенный профиль их не использует, но при возвращении они всплыли бы
 * сами.
 *
 * Плательщик не трогается: работа по проектам компании — её расход, кто бы их
 * ни завёл. Вход и остальные компании человека не меняются.
 *
 * Только подпрофиль в ЭТОЙ компании: чужой идентификатор просто не находится.
 */
export async function deactivateSubprofile(input: {
  companyId: string
  profileId: string
}): Promise<DeactivateSubprofileResult> {
  return withTransaction(async (client) => {
    const res = await client.query<{ isActive: boolean; email: string }>(
      `SELECT is_active AS "isActive", email
         FROM users
        WHERE id = $1
          AND company_id = $2
          AND login_user_id IS NOT NULL
          FOR UPDATE`,
      [input.profileId, input.companyId],
    )
    const row = res.rows[0]
    if (!row) return { ok: false, reason: "not-found" }

    await client.query(`DELETE FROM company_capabilities WHERE user_id = $1`, [
      input.profileId,
    ])
    if (!row.isActive) return { ok: true, changed: false, email: row.email }

    await client.query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [input.profileId],
    )
    return { ok: true, changed: true, email: row.email }
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
