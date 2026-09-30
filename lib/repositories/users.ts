import { randomUUID } from "node:crypto"
import { query, withTransaction } from "@/lib/db"
import type {
  AuthProvider,
  UserRecord,
  UserRecordWithPassword,
  UserRole,
} from "@/lib/domain-types"

/**
 * Действующая активность профиля: своя И его входа.
 *
 * Заблокированный вход закрывает все профили человека
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §4.4). Считать это в каждом гварде
 * значило бы учить гварды про входы; здесь же ответ приходит готовым вместе с
 * пользователем, и любой, кто проверяет `isActive`, получает верный.
 *
 * Ссылка `users.login_user_id` — на строку самого запроса: выражение стоит и в
 * `SELECT ... FROM users`, и в `RETURNING` у `INSERT`/`UPDATE users`.
 */
const EFFECTIVE_IS_ACTIVE = `(
    is_active
    AND COALESCE(
      (SELECT l.is_active FROM users l WHERE l.id = users.login_user_id),
      TRUE
    )
  ) AS "isActive"`

const PUBLIC_USER_FIELDS = `
  id,
  full_name AS "fullName",
  contact_name AS "contactName",
  email,
  role,
  ${EFFECTIVE_IS_ACTIVE},
  created_at AS "createdAt",
  COALESCE(balance_cents, 0) AS "balanceCents",
  drive_folder_id AS "driveFolderId",
  COALESCE(must_change_password, FALSE) AS "mustChangePassword",
  COALESCE(automation_enabled, FALSE) AS "automationEnabled",
  company_id AS "companyId",
  company_role AS "companyRole",
  login_user_id AS "loginUserId"
`

const FULL_USER_FIELDS = `
  id,
  full_name AS "fullName",
  contact_name AS "contactName",
  email,
  password_hash AS "passwordHash",
  role,
  ${EFFECTIVE_IS_ACTIVE},
  created_at AS "createdAt",
  auth_provider AS "authProvider",
  provider_account_id AS "providerAccountId",
  COALESCE(balance_cents, 0) AS "balanceCents",
  drive_folder_id AS "driveFolderId",
  COALESCE(must_change_password, FALSE) AS "mustChangePassword",
  COALESCE(automation_enabled, FALSE) AS "automationEnabled",
  -- Компания здесь ОБЯЗАТЕЛЬНА, потому что её обещает тип: UserRecordWithPassword
  -- расширяет UserRecord, а у того companyId есть. Пока этих двух строк не было,
  -- всякий, кто читал компанию у поиска по почте, молча получал undefined — и,
  -- например, проверка «свой или посторонний» в приглашении считала чужими
  -- вообще всех, включая коллег. Компилятор такое не ловит: поле в типе есть.
  company_id AS "companyId",
  company_role AS "companyRole",
  login_user_id AS "loginUserId",
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

/**
 * Вход по почте — строка с паролем и Google, а не рабочее место.
 *
 * Почта уникальна только среди входов: у подпрофиля она копия рабочей
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §3.3), и поиск по одному `email = $1`
 * стал бы неоднозначным. Прежний поиск без фильтра переименован сюда, а не
 * тихо дополнен фильтром: так каждый вызов пришлось пересмотреть при сборке.
 *
 * ТЕКУЩЕГО пользователя этой функцией не ищут никогда — только по id из сессии.
 * В подпрофиле такой поиск молча попал бы во вход: сменил бы пароль не тому или
 * удалил бы не то. Проверка — `npm run profiles:check`.
 */
export async function findLoginByEmail(
  email: string,
): Promise<UserRecordWithPassword | null> {
  const result = await query<UserRecordWithPassword>(
    `SELECT ${FULL_USER_FIELDS} FROM users WHERE email = $1 AND login_user_id IS NULL`,
    [email],
  )
  return result.rows[0] ?? null
}

/**
 * Вход с паролем — по id из сессии (`getSessionLogin().loginUserId`).
 *
 * Для операций над учётными данными: сменить пароль, удалить аккаунт. `null`,
 * если это не вход, а подпрофиль: у него учётных данных нет, и ответить по нему
 * значило бы проверять пароль, которого не существует.
 */
export async function findLoginById(
  loginUserId: string,
): Promise<UserRecordWithPassword | null> {
  const result = await query<UserRecordWithPassword>(
    `SELECT ${FULL_USER_FIELDS} FROM users WHERE id = $1 AND login_user_id IS NULL`,
    [loginUserId],
  )
  return result.rows[0] ?? null
}

/**
 * Вход этого профиля: он сам, если это и есть вход. `null` — такой строки нет.
 *
 * Считается по базе, а не берётся из токена: у сотрудников, переведённых
 * миграцией 2026-09-28-login-profiles-split.sql, в уже выданной куке `sub` —
 * старая строка, ставшая подпрофилем, а `lid` там нет вовсе (§4.1 плана).
 */
export async function loginIdOf(userId: string): Promise<string | null> {
  const result = await query<{ loginId: string }>(
    `SELECT COALESCE(login_user_id, id) AS "loginId" FROM users WHERE id = $1`,
    [userId],
  )
  return result.rows[0]?.loginId ?? null
}

/**
 * Чьё участие в проекте засчитывается этому профилю: его собственное и его
 * входа (docs/MULTI_COMPANY_PROFILES_PLAN.md §8.3).
 *
 * Доступ, выданный на вход, работает из любого профиля человека: так проект
 * чужой компании, расшаренный по почте, виден и из «Личного», и из каждой его
 * компании. Обратное неверно — участие подпрофиля остаётся в его компании.
 *
 * Единственное место, где права читаются не только по активному профилю, и
 * поэтому одна функция на все запросы к `project_members`, а не условие,
 * переписанное в каждом по-своему. Проверка — `npm run profiles:check`.
 */
export async function accessIdsFor(userId: string): Promise<string[]> {
  const loginId = await loginIdOf(userId)
  return loginId && loginId !== userId ? [userId, loginId] : [userId]
}

/** Профиль входа в переключателе: сам вход или подпрофиль с компанией. */
export type LoginProfile = {
  id: string
  /** NULL — это вход, «Личное». */
  companyId: string | null
  companyTitle: string | null
  companyBranding: Record<string, unknown> | null
  isActive: boolean
}

/**
 * Вход и все его подпрофили — для переключателя (§6 плана).
 *
 * Неактивные тоже возвращаются: решать, показывать ли их, — вызывающему. Вход
 * первым, компании — по названию.
 */
export async function listLoginProfiles(loginUserId: string): Promise<LoginProfile[]> {
  const result = await query<LoginProfile>(
    `SELECT u.id,
            u.company_id AS "companyId",
            c.title AS "companyTitle",
            c.branding AS "companyBranding",
            (u.is_active AND COALESCE(l.is_active, TRUE)) AS "isActive"
       FROM users u
       LEFT JOIN users l ON l.id = u.login_user_id
       LEFT JOIN companies c ON c.id = u.company_id
      WHERE u.id = $1 OR u.login_user_id = $1
      ORDER BY (u.login_user_id IS NULL) DESC, lower(COALESCE(c.title, ''))`,
    [loginUserId],
  )
  return result.rows
}

/**
 * Активный профиль этого входа в этой компании — или `null`.
 *
 * Вход тоже проверяется, а не только подпрофили: между выкатом кода и
 * миграцией перевода сотрудник компании ещё живёт одной строкой, и считать его
 * в этот момент посторонним для своей же компании было бы неверно.
 */
export async function findProfileInCompany(
  loginUserId: string,
  companyId: string,
): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `SELECT ${PUBLIC_USER_FIELDS}
       FROM users
      WHERE (id = $1 OR login_user_id = $1)
        AND company_id = $2
        AND kind = 'person'
        AND is_active
      ORDER BY (login_user_id IS NOT NULL) DESC
      LIMIT 1`,
    [loginUserId, companyId],
  )
  return result.rows[0] ?? null
}

/** Сколько у входа подпрофилей, включая выведенных из компаний. */
export async function countSubprofiles(loginUserId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM users WHERE login_user_id = $1`,
    [loginUserId],
  )
  return result.rows[0]?.count ?? 0
}

/**
 * Колонки ещё нет — миграция `2026-09-28-last-profile.sql` не применена.
 *
 * «Куда пустить после входа» — удобство, а не условие входа: dev-сервер ходит в
 * боевую базу, и код, подхваченный раньше миграции, не должен класть вход. Без
 * колонки человек просто попадает в «Личное», как до неё.
 */
function isMissingLastProfileColumn(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "42703"
  )
}

/**
 * Профиль, в котором человек работал в прошлый раз, — у его входа
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §17.6). `null` — «Личное» или неизвестно.
 *
 * Годен ли он ещё (не выведен ли человек из компании), решает вызывающий:
 * здесь только то, что записано.
 */
export async function readLastProfileId(loginUserId: string): Promise<string | null> {
  try {
    const result = await query<{ lastProfileId: string | null }>(
      `SELECT last_profile_id AS "lastProfileId"
         FROM users
        WHERE id = $1 AND login_user_id IS NULL`,
      [loginUserId],
    )
    return result.rows[0]?.lastProfileId ?? null
  } catch (error) {
    if (isMissingLastProfileColumn(error)) return null
    throw error
  }
}

/**
 * Запомнить профиль, в котором человек сейчас работает, — чтобы следующий вход
 * открыл его же. Сам вход записывается как NULL: «Личное» — умолчание.
 */
export async function rememberLastProfile(
  loginUserId: string,
  profileId: string,
): Promise<void> {
  try {
    await query(
      `UPDATE users
          SET last_profile_id = NULLIF($2::text, $1::text)
        WHERE id = $1 AND login_user_id IS NULL`,
      [loginUserId, profileId],
    )
  } catch (error) {
    if (isMissingLastProfileColumn(error)) return
    throw error
  }
}

/**
 * Общие поля человека — на входе и во всех его подпрофилях одной транзакцией.
 *
 * Почта, имя и подпись в статистике у человека одни (§3.3 плана): у подпрофиля
 * это копии, и разойдись они, письма компании ушли бы на старый адрес, а
 * статистика расщепила бы одного человека на две подписи.
 *
 * Возвращает вход. `null` — такого входа нет (или это подпрофиль).
 */
export async function updateLoginIdentity(
  loginUserId: string,
  input: {
    email?: string
    fullName?: string
    /** Пустая строка сбрасывает на fullName — как у updateUser. */
    contactName?: string | null
  },
): Promise<UserRecord | null> {
  return withTransaction(async (client) => {
    const updated = await client.query<UserRecord>(
      `UPDATE users
          SET full_name    = COALESCE($2, full_name),
              email        = COALESCE($3, email),
              contact_name = CASE WHEN $4::text IS NULL THEN contact_name
                                  ELSE NULLIF(TRIM($4::text), '') END,
              updated_at   = NOW()
        WHERE id = $1 AND login_user_id IS NULL
        RETURNING ${PUBLIC_USER_FIELDS}`,
      [
        loginUserId,
        input.fullName ?? null,
        input.email ?? null,
        input.contactName ?? null,
      ],
    )
    const login = updated.rows[0]
    if (!login) return null

    await client.query(
      `UPDATE users s
          SET email = l.email,
              full_name = l.full_name,
              contact_name = l.contact_name,
              updated_at = NOW()
         FROM users l
        WHERE l.id = $1
          AND s.login_user_id = l.id`,
      [loginUserId],
    )
    return login
  })
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

/**
 * Ключ аватара человека — со ВХОДА, из какого бы профиля ни спрашивали.
 *
 * Отдельным запросом, а не в PUBLIC_USER_FIELDS: колонка приходит миграцией
 * 2026-09-29-user-avatars.sql, а код и база выезжают не одновременно. Пока
 * колонки нет (42703), ответ — «аватара нет», и кружок рисует инициалы, а не
 * роняет каждую страницу кабинета.
 */
export async function findAvatarKey(userId: string): Promise<string | null> {
  try {
    const result = await query<{ key: string | null }>(
      `SELECT l.avatar_key AS key
         FROM users u
         JOIN users l ON l.id = COALESCE(u.login_user_id, u.id)
        WHERE u.id = $1`,
      [userId],
    )
    return result.rows[0]?.key ?? null
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "42703") return null
    throw error
  }
}

/** Поставить или снять аватар входа. Возвращает прежний ключ — его удаляют. */
export async function setAvatarKey(
  loginUserId: string,
  key: string | null,
): Promise<{ previous: string | null } | null> {
  const result = await query<{ previous: string | null }>(
    `UPDATE users u
        SET avatar_key = $2
       FROM (SELECT avatar_key FROM users WHERE id = $1) old
      WHERE u.id = $1
      RETURNING old.avatar_key AS previous`,
    [loginUserId, key],
  )
  return result.rows[0] ?? null
}
