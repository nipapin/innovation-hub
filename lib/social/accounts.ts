import { randomUUID } from "node:crypto"

import { query, withTransaction } from "@/lib/db"
import {
  decryptFields,
  encryptFields,
  fieldsHint,
  VaultKeyError,
} from "@/lib/vault/crypto"
import { platformAdapter, type SocialSecret } from "./platforms"
import type { SocialAccount, SocialPlatform, SocialTarget } from "./types"

/**
 * Сейф аккаунтов площадок: единственное место, где секрет расшифровывается.
 *
 * Наружу секрет не отдаётся никогда — ни в API, ни в логах, ни в подсказке.
 * Наружу уезжает только «аккаунт такой-то подключён» и хвост токена
 * (`••••4f21`), чтобы отличить два аккаунта глазами.
 *
 * Шифрование общее с ключами вендоров (lib/vault/crypto.ts) — тот же
 * мастер-ключ из окружения и та же процедура отзыва. Разбор, почему таблицы
 * при этом свои, — в шапке миграции 2026-09-07-social-accounts.sql.
 */

type AccountRow = {
  id: string
  userId: string
  platform: SocialPlatform
  label: string
  externalId: string
  status: "active" | "revoked"
  meta: { targets?: SocialTarget[]; targetsAt?: string } | null
  checkedAt: Date | null
  lastError: string | null
  createdAt: Date
  cooldownUntil: Date | null
  cooldownReason: string | null
  secretHint: string | null
  expiresAt: Date | null
}

const ACCOUNT_FIELDS = `
  a.id,
  a.user_id     AS "userId",
  a.platform,
  a.label,
  a.external_id AS "externalId",
  a.status,
  a.meta,
  a.checked_at  AS "checkedAt",
  a.last_error  AS "lastError",
  a.created_at  AS "createdAt",
  a.cooldown_until  AS "cooldownUntil",
  a.cooldown_reason AS "cooldownReason",
  s.hint        AS "secretHint",
  s.expires_at  AS "expiresAt"
`

/**
 * Живой секрет — старшая непогашенная версия. LATERAL, а не подзапрос на
 * каждое поле: иначе одна и та же строка искалась бы дважды.
 */
const LIVE_SECRET_JOIN = `
  LEFT JOIN LATERAL (
    SELECT hint, expires_at
      FROM social_account_secrets
     WHERE account_id = a.id AND revoked_at IS NULL
     ORDER BY version DESC
     LIMIT 1
  ) s ON TRUE
`

function toAccount(row: AccountRow): SocialAccount {
  const meta = row.meta ?? {}
  return {
    id: row.id,
    platform: row.platform,
    label: row.label,
    externalId: row.externalId,
    status: row.status,
    targets: Array.isArray(meta.targets) ? meta.targets : [],
    targetsAt: meta.targetsAt ?? null,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    lastError: row.lastError,
    secretHint: row.secretHint,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
    cooldownReason: row.cooldownReason,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Аккаунты человека. Чужие не отдаются: фильтр по владельцу — не опция. */
export async function listAccounts(
  userId: string,
  platform?: SocialPlatform,
): Promise<SocialAccount[]> {
  const result = await query<AccountRow>(
    `SELECT ${ACCOUNT_FIELDS}
       FROM social_accounts a
       ${LIVE_SECRET_JOIN}
      WHERE a.user_id = $1
        AND ($2::text IS NULL OR a.platform = $2)
      ORDER BY a.platform ASC, a.label ASC`,
    [userId, platform ?? null],
  )
  return result.rows.map(toAccount)
}

export async function findAccount(
  input: { id: string; userId: string },
): Promise<SocialAccount | null> {
  const result = await query<AccountRow>(
    `SELECT ${ACCOUNT_FIELDS}
       FROM social_accounts a
       ${LIVE_SECRET_JOIN}
      WHERE a.id = $1 AND a.user_id = $2`,
    [input.id, input.userId],
  )
  const row = result.rows[0]
  return row ? toAccount(row) : null
}

/**
 * Аккаунт по имени — вход для постинга.
 *
 * В `options.json` лежит ИМЯ аккаунта (так его пишет программа), поэтому
 * публикация начинается именно с этого запроса. Отозванные не отдаём: задача
 * по отозванному аккаунту должна упасть на сборке с внятной причиной, а не
 * уйти в очередь и умереть там как «превышены попытки».
 */
export async function findAccountByLabel(input: {
  userId: string
  platform: SocialPlatform
  label: string
}): Promise<SocialAccount | null> {
  const result = await query<AccountRow>(
    `SELECT ${ACCOUNT_FIELDS}
       FROM social_accounts a
       ${LIVE_SECRET_JOIN}
      WHERE a.user_id = $1 AND a.platform = $2 AND a.label = $3
        AND a.status = 'active'`,
    [input.userId, input.platform, input.label],
  )
  const row = result.rows[0]
  return row ? toAccount(row) : null
}

/**
 * Живой секрет аккаунта. Только для серверного кода публикации.
 *
 * `null` — секрета нет вовсе (аккаунт отозвали). Ошибка расшифровки НЕ
 * глушится: «мастер-ключ не тот» и «токена нет» требуют разных действий, и
 * различать их по пустому ответу было бы ошибкой.
 */
export async function readAccountSecret(
  accountId: string,
): Promise<SocialSecret | null> {
  const result = await query<{ ciphertext: string }>(
    `SELECT ciphertext
       FROM social_account_secrets
      WHERE account_id = $1 AND revoked_at IS NULL
      ORDER BY version DESC
      LIMIT 1`,
    [accountId],
  )
  const row = result.rows[0]
  return row ? decryptFields(row.ciphertext) : null
}

export type ConnectResult =
  | { ok: true; account: SocialAccount; replaced: boolean }
  | { ok: false; code: "invalid-input" | "rejected" | "vault"; message: string }

/**
 * Подключить (или переподключить) аккаунт.
 *
 * Порядок обязателен: сначала спрашиваем ПЛОЩАДКУ, потом пишем в базу. Токен,
 * записанный без проверки, — это аккаунт, который выглядит рабочим до первой
 * публикации; узнать о нём через сутки по упавшей очереди хуже, чем узнать
 * сразу в форме.
 *
 * Переподключение того же аккаунта (совпал `external_id`) не создаёт второй
 * записи: имя аккаунта уехало в `options.json` проектов, и вторая запись с тем
 * же именем сделала бы ссылку из графа двусмысленной. Секрет при этом
 * добавляется НОВОЙ версией, а прежняя гасится — публикация в полёте
 * дочитывает свою.
 */
export async function connectAccount(input: {
  userId: string
  platform: SocialPlatform
  /** Что человек вставил: адрес с токеном, сам токен, токен бота. */
  raw: string
  /** Своё имя аккаунта. Пусто — берём то, которым представилась площадка. */
  label?: string
}): Promise<ConnectResult> {
  const adapter = platformAdapter(input.platform)
  if (!adapter.connectable) {
    return {
      ok: false,
      code: "invalid-input",
      message: `${input.platform} connection is not implemented yet.`,
    }
  }

  const secret = adapter.parse(input.raw)
  if (!secret) {
    return {
      ok: false,
      code: "invalid-input",
      message: "No token found in the pasted text.",
    }
  }

  let identity
  try {
    identity = await adapter.validate(secret)
  } catch (error) {
    // Отказ площадки — это ответ, а не сбой: показываем его человеку как есть,
    // он там осмысленный («User authorization failed»).
    return {
      ok: false,
      code: "rejected",
      message: error instanceof Error ? error.message : String(error),
    }
  }

  const label = (input.label ?? "").trim() || identity.name

  /**
   * Каталог целей тянем ДО транзакции и мягко: не получилось — аккаунт всё
   * равно подключён. Список сообществ обновляется кнопкой, а вот отказать в
   * подключении из-за того, что `groups.get` моргнул, было бы несоразмерно.
   */
  let targets: SocialTarget[] = []
  try {
    targets = await adapter.listTargets(secret)
  } catch {
    targets = []
  }

  try {
    const saved = await withTransaction(async (client) => {
      // Тот же аккаунт ищем по id НА ПЛОЩАДКЕ, а не по имени: человек мог
      // переименоваться в VK, и тогда по имени это выглядело бы как новый
      // аккаунт, а по id — как переподключение старого.
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM social_accounts
          WHERE user_id = $1 AND platform = $2
            AND ($3 <> '' AND external_id = $3 OR label = $4)
          ORDER BY (external_id = $3) DESC
          LIMIT 1`,
        [input.userId, input.platform, identity.externalId, label],
      )

      const meta = JSON.stringify({
        targets,
        targetsAt: new Date().toISOString(),
      })
      const id = existing.rows[0]?.id ?? randomUUID()

      if (existing.rows[0]) {
        await client.query(
          `UPDATE social_accounts
              SET external_id = $2,
                  status = 'active',
                  meta = $3::jsonb,
                  checked_at = NOW(),
                  last_error = NULL,
                  updated_at = NOW()
            WHERE id = $1`,
          [id, identity.externalId, meta],
        )
        // Прежние версии гасим в той же транзакции: живой должна остаться
        // ровно одна, иначе «какой токен сейчас работает» станет вопросом.
        await client.query(
          `UPDATE social_account_secrets
              SET revoked_at = NOW()
            WHERE account_id = $1 AND revoked_at IS NULL`,
          [id],
        )
      } else {
        await client.query(
          `INSERT INTO social_accounts
             (id, user_id, platform, label, external_id, meta, checked_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
          [id, input.userId, input.platform, label, identity.externalId, meta],
        )
      }

      const version = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next
           FROM social_account_secrets WHERE account_id = $1`,
        [id],
      )

      await client.query(
        `INSERT INTO social_account_secrets
           (id, account_id, version, ciphertext, hint, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          id,
          version.rows[0].next,
          encryptFields(secret),
          fieldsHint(secret),
          identity.expiresAt ?? null,
        ],
      )

      return { id, replaced: Boolean(existing.rows[0]) }
    })

    const account = await findAccount({
      id: saved.id,
      userId: input.userId,
    })
    if (!account) {
      return { ok: false, code: "rejected", message: "Account was not saved." }
    }
    return { ok: true, account, replaced: saved.replaced }
  } catch (error) {
    // Сейф не настроен — это не ошибка человека, и «попробуйте ещё раз» здесь
    // вредный совет: без мастер-ключа не поможет ни одна попытка.
    if (error instanceof VaultKeyError) {
      return { ok: false, code: "vault", message: error.message }
    }
    throw error
  }
}

export type RefreshResult =
  | { ok: true; account: SocialAccount }
  | { ok: false; message: string }

/**
 * Обновить каталог целей у площадки.
 *
 * Заодно это проверка живости токена — единственная, которую можно сделать не
 * публикуя. Отказ записываем в `last_error`: «токен протух» обязано быть видно
 * на экране аккаунтов, а не выясняться из упавшей через сутки очереди.
 */
export async function refreshTargets(input: {
  id: string
  userId: string
}): Promise<RefreshResult> {
  const account = await findAccount(input)
  if (!account) return { ok: false, message: "Account not found." }

  const secret = await readAccountSecret(account.id)
  if (!secret) return { ok: false, message: "The account has no live token." }

  const adapter = platformAdapter(account.platform)
  try {
    const targets = await adapter.listTargets(secret)
    await query(
      `UPDATE social_accounts
          SET meta = jsonb_build_object('targets', $2::jsonb, 'targetsAt', $3::text),
              checked_at = NOW(),
              last_error = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [account.id, JSON.stringify(targets), new Date().toISOString()],
    )
    const updated = await findAccount(input)
    return updated
      ? { ok: true, account: updated }
      : { ok: false, message: "Account not found." }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await query(
      `UPDATE social_accounts
          SET last_error = $2, checked_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [account.id, message.slice(0, 500)],
    )
    return { ok: false, message }
  }
}

/**
 * Удалить аккаунт вместе с токенами.
 *
 * Удаление, а не пометка: человек убирает СВОЙ аккаунт со своей страницы, и
 * «убрал, но токен остался лежать» — не то, что он имел в виду. История
 * публикаций от этого не страдает: она хранит id аккаунта без внешнего ключа,
 * ровно как расход вендоров хранит id задачи (см. `vendor_usage`).
 */
export async function deleteAccount(input: {
  id: string
  userId: string
}): Promise<boolean> {
  const result = await query(
    `DELETE FROM social_accounts WHERE id = $1 AND user_id = $2`,
    [input.id, input.userId],
  )
  return (result.rowCount ?? 0) > 0
}

/** Переименовать аккаунт. Имя — то, что уезжает в граф, поэтому не косметика. */
export async function renameAccount(input: {
  id: string
  userId: string
  label: string
}): Promise<SocialAccount | null> {
  await query(
    `UPDATE social_accounts SET label = $3, updated_at = NOW()
      WHERE id = $1 AND user_id = $2`,
    [input.id, input.userId, input.label],
  )
  return findAccount(input)
}

/**
 * Поставить или снять паузу аккаунта после ответа площадки.
 *
 * `until: null` снимает её — так делает успешная публикация: раз площадка снова
 * принимает, держать паузу незачем.
 */
export async function setAccountCooldown(input: {
  accountId: string
  until: Date | null
  reason: string | null
}): Promise<void> {
  await query(
    `UPDATE social_accounts
        SET cooldown_until = $2, cooldown_reason = $3, updated_at = NOW()
      WHERE id = $1`,
    [input.accountId, input.until, input.reason?.slice(0, 500) ?? null],
  )
}
