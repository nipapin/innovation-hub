import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import type {
  AuthProvider,
  UserRecord,
  UserRecordWithPassword,
  UserRole,
} from "@/lib/domain-types"

const PUBLIC_USER_FIELDS = `
  id,
  full_name AS "fullName",
  contact_name AS "contactName",
  email,
  role,
  is_active AS "isActive",
  created_at AS "createdAt",
  COALESCE(balance_cents, 0) AS "balanceCents",
  drive_folder_id AS "driveFolderId",
  COALESCE(must_change_password, FALSE) AS "mustChangePassword",
  COALESCE(automation_enabled, FALSE) AS "automationEnabled",
  company_id AS "companyId",
  company_role AS "companyRole"
`

const FULL_USER_FIELDS = `
  id,
  full_name AS "fullName",
  contact_name AS "contactName",
  email,
  password_hash AS "passwordHash",
  role,
  is_active AS "isActive",
  created_at AS "createdAt",
  auth_provider AS "authProvider",
  provider_account_id AS "providerAccountId",
  COALESCE(balance_cents, 0) AS "balanceCents",
  drive_folder_id AS "driveFolderId",
  COALESCE(must_change_password, FALSE) AS "mustChangePassword",
  COALESCE(automation_enabled, FALSE) AS "automationEnabled",
  -- Компания здесь ОБЯЗАТЕЛЬНА, потому что её обещает тип: UserRecordWithPassword
  -- расширяет UserRecord, а у того companyId есть. Пока этих двух строк не было,
  -- всякий, кто читал компанию у findUserByEmail, молча получал undefined — и,
  -- например, проверка «свой или посторонний» в приглашении считала чужими
  -- вообще всех, включая коллег. Компилятор такое не ловит: поле в типе есть.
  company_id AS "companyId",
  company_role AS "companyRole",
  kind
`

/**
 * Контактная идентичность для статистики обработки.
 *
 * `name` — то, что уедет в `description.contact` задачи и дальше в
 * `processing_stats` на машине. Приоритет у `contact_name`: при локальной
 * обработке человек подписывается конкретной строкой, а статистика группируется
 * по ней, поэтому «Aleksey Ivanov» вместо привычного «Алексей» расщепил бы
 * одного человека на два ряда. Без него — full_name, в последнюю очередь email.
 */
export type ContactIdentity = {
  userId: string
  name: string
  email: string
}

export async function listContactIdentities(
  userIds: string[],
): Promise<Map<string, ContactIdentity>> {
  const unique = [...new Set(userIds.filter(Boolean))]
  if (unique.length === 0) return new Map()

  const result = await query<{
    userId: string
    name: string
    email: string
  }>(
    `SELECT id AS "userId",
            COALESCE(NULLIF(TRIM(contact_name), ''), NULLIF(TRIM(full_name), ''), email) AS name,
            email
       FROM users
      WHERE id = ANY($1::text[])`,
    [unique],
  )
  return new Map(result.rows.map((row) => [row.userId, row]))
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function findUserByEmail(
  email: string,
): Promise<UserRecordWithPassword | null> {
  const result = await query<UserRecordWithPassword>(
    `SELECT ${FULL_USER_FIELDS} FROM users WHERE email = $1`,
    [email],
  )
  return result.rows[0] ?? null
}

/**
 * Список людей — единственная выборка «покажи всех» (docs/COMPANY_ACCOUNTS_PLAN.md
 * §2). Служебный кошелёк компании (kind = 'company_wallet') сюда не попадает: он
 * не показывается ни в одном списке людей.
 */
export async function listUsers(): Promise<UserRecord[]> {
  const result = await query<UserRecord>(
    `SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE kind = 'person' ORDER BY created_at DESC`,
  )
  return result.rows
}

export async function listUsersByIds(ids: string[]): Promise<UserRecord[]> {
  if (ids.length === 0) return []
  const unique = [...new Set(ids)]
  const result = await query<UserRecord>(
    `SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id = ANY($1::text[])`,
    [unique],
  )
  return result.rows
}

/**
 * Сколько активных аккаунтов с доступом в админку, кроме указанного.
 *
 * Считает ОБЕ верхние ступени: инвариант этапа 1 — «админка не должна стать
 * недостижимой», а для этого годится любой из них. На этапе 3, когда роли
 * начнёт раздавать только суперадмин, рядом появится отдельный
 * countActiveSuperAdmins с более узким условием: последний суперадмин не
 * должен уходить, даже если обычные админы в системе остаются.
 */
export async function countActiveAdmins(excludeUserId?: string): Promise<number> {
  if (excludeUserId) {
    const result = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM users
        WHERE role IN ('ADMIN', 'SUPERADMIN') AND is_active = TRUE AND id <> $1`,
      [excludeUserId],
    )
    return result.rows[0]?.count ?? 0
  }
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM users
      WHERE role IN ('ADMIN', 'SUPERADMIN') AND is_active = TRUE`,
  )
  return result.rows[0]?.count ?? 0
}

/**
 * Сколько активных суперадминов, кроме указанного.
 *
 * Отдельно от countActiveAdmins, потому что инварианты разные и первый второго
 * не заменяет. «Админка достижима» выполняется и одними админами; «роли и права
 * есть кому раздать» — только суперадмином. Уйди последний, и понизить кого-то
 * обратно будет некому: изнутри система в таком состоянии не разблокируется.
 */
export async function countActiveSuperAdmins(
  excludeUserId?: string,
): Promise<number> {
  if (excludeUserId) {
    const result = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM users
        WHERE role = 'SUPERADMIN' AND is_active = TRUE AND id <> $1`,
      [excludeUserId],
    )
    return result.rows[0]?.count ?? 0
  }
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM users
      WHERE role = 'SUPERADMIN' AND is_active = TRUE`,
  )
  return result.rows[0]?.count ?? 0
}

/**
 * Числится ли человек в этой компании.
 *
 * Отдельный запрос вместо чтения всей строки: зовётся на каждый машинный доступ
 * к чужому проекту, и тянуть ради булева ответа полный `UserRecord` незачем.
 */
export async function isUserInCompany(
  userId: string,
  companyId: string,
): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM users WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [userId, companyId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function createUser(input: {
  fullName: string
  email: string
  passwordHash: string
  role?: UserRole
}): Promise<UserRecord> {
  const id = randomUUID()
  const result = await query<UserRecord>(
    `INSERT INTO users (id, full_name, email, password_hash, role, auth_provider)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'USER'), 'local')
     RETURNING ${PUBLIC_USER_FIELDS}`,
    [id, input.fullName, input.email, input.passwordHash, input.role ?? null],
  )
  return result.rows[0]
}

export async function findUserByProviderAccount(
  provider: AuthProvider,
  providerAccountId: string,
): Promise<UserRecordWithPassword | null> {
  const result = await query<UserRecordWithPassword>(
    `SELECT ${FULL_USER_FIELDS}
       FROM users
      WHERE auth_provider = $1 AND provider_account_id = $2`,
    [provider, providerAccountId],
  )
  return result.rows[0] ?? null
}

/** Creates a user that authenticates via an external OAuth provider. */
export async function createOAuthUser(input: {
  fullName: string
  email: string
  provider: AuthProvider
  providerAccountId: string
  role?: UserRole
}): Promise<UserRecord> {
  const id = randomUUID()
  const result = await query<UserRecord>(
    `INSERT INTO users (
        id, full_name, email, password_hash, role,
        auth_provider, provider_account_id
     )
     VALUES ($1, $2, $3, NULL, COALESCE($4, 'USER'), $5, $6)
     RETURNING ${PUBLIC_USER_FIELDS}`,
    [
      id,
      input.fullName,
      input.email,
      input.role ?? null,
      input.provider,
      input.providerAccountId,
    ],
  )
  return result.rows[0]
}

/**
 * Attaches an OAuth identity to an existing local account so that the user can
 * sign in with either method going forward. Used when a Google email matches an
 * existing email/password user — we don't silently replace the password, we
 * only fill in the provider columns.
 */
export async function linkProviderToUser(input: {
  userId: string
  provider: AuthProvider
  providerAccountId: string
}): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `UPDATE users
        SET auth_provider       = $2,
            provider_account_id = $3,
            updated_at          = NOW()
      WHERE id = $1
      RETURNING ${PUBLIC_USER_FIELDS}`,
    [input.userId, input.provider, input.providerAccountId],
  )
  return result.rows[0] ?? null
}

export async function updateUser(
  id: string,
  input: {
    fullName?: string
    /** Пустая строка сбрасывает на fullName. */
    contactName?: string | null
    email?: string
    passwordHash?: string
    role?: UserRole
    isActive?: boolean
    mustChangePassword?: boolean
  },
): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `UPDATE users
        SET full_name     = COALESCE($2, full_name),
            email         = COALESCE($3, email),
            password_hash = COALESCE($4, password_hash),
            role          = COALESCE($5, role),
            is_active     = COALESCE($6, is_active),
            must_change_password = COALESCE($7, must_change_password),
            -- Пустая строка — осознанный сброс на full_name, поэтому NULLIF, а
            -- не COALESCE по самому значению.
            contact_name  = CASE WHEN $8::text IS NULL THEN contact_name
                                 ELSE NULLIF(TRIM($8::text), '') END,
            updated_at    = NOW()
      WHERE id = $1
      RETURNING ${PUBLIC_USER_FIELDS}`,
    [
      id,
      input.fullName ?? null,
      input.email ?? null,
      input.passwordHash ?? null,
      input.role ?? null,
      input.isActive ?? null,
      input.mustChangePassword ?? null,
      input.contactName ?? null,
    ],
  )
  return result.rows[0] ?? null
}

/**
 * Админский гейт конвейера. Отдельно от updateUser осознанно: это не свойство
 * аккаунта, а решение администратора про обработку, и меняется оно из другого
 * места интерфейса (/admin/pipeline, колонка пользователей).
 */
export async function setUserAutomationEnabled(
  id: string,
  enabled: boolean,
): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `UPDATE users
        SET automation_enabled = $2,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${PUBLIC_USER_FIELDS}`,
    [id, enabled],
  )
  return result.rows[0] ?? null
}

export async function setUserDriveFolderId(
  id: string,
  driveFolderId: string,
): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `UPDATE users
        SET drive_folder_id = $2,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${PUBLIC_USER_FIELDS}`,
    [id, driveFolderId],
  )
  return result.rows[0] ?? null
}

export async function deleteUser(id: string) {
  await query(`DELETE FROM users WHERE id = $1`, [id])
}

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`Email already registered: ${email}`)
    this.name = "DuplicateEmailError"
  }
}
