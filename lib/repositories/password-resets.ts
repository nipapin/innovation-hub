import { createHash, randomBytes, randomUUID } from "node:crypto"

import { query, withTransaction } from "@/lib/db"

/**
 * Сколько живёт ссылка из письма. Час — компромисс: почта доходит за минуты, а
 * ссылка, живущая сутки, слишком долго лежит в чужом ящике готовой к работе.
 */
const TTL_MS = 60 * 60 * 1000

/**
 * В базе лежит хэш, в письме — сырой токен. SHA-256, а не bcrypt: токен уже
 * случайный на 256 бит, растягивать его от перебора незачем, а проверка идёт
 * поиском по индексу — с bcrypt пришлось бы перебирать строки и сравнивать
 * каждую.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export type IssuedReset = {
  /** Только для ссылки в письме. В базе его нет. */
  token: string
  expiresAt: Date
}

/**
 * Выдать запрос на сброс, погасив прежние.
 *
 * Прежние гасятся, потому что иначе у человека, нажавшего «забыл пароль»
 * трижды, остаётся три рабочих ссылки в трёх письмах, и самая старая переживёт
 * смену пароля по самой новой.
 */
export async function issuePasswordReset(userId: string): Promise<IssuedReset> {
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + TTL_MS)

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE password_resets
          SET used_at = NOW()
        WHERE user_id = $1
          AND used_at IS NULL`,
      [userId],
    )
    await client.query(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), userId, hashToken(token), expiresAt],
    )
  })

  return { token, expiresAt }
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "unknown" | "used" | "expired" }

/**
 * Разменять токен на право сменить пароль — ровно один раз.
 *
 * Пометка used_at ставится тем же запросом, что и выборка (UPDATE ... WHERE
 * used_at IS NULL ... RETURNING), а не двумя шагами: два параллельных перехода
 * по одной ссылке иначе оба прошли бы проверку и оба сменили бы пароль. Здесь
 * второй не увидит ни одной строки.
 *
 * Причина отказа различает «уже использован» и «просрочен», но наружу её отдаёт
 * не всякий вызывающий: человеку у формы они одинаково означают «запросите
 * ссылку заново».
 */
export async function consumePasswordReset(token: string): Promise<ConsumeResult> {
  const tokenHash = hashToken(token)

  const claimed = await query<{ userId: string }>(
    `UPDATE password_resets
        SET used_at = NOW()
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > NOW()
      RETURNING user_id AS "userId"`,
    [tokenHash],
  )
  const row = claimed.rows[0]
  if (row) return { ok: true, userId: row.userId }

  // Строку не забрали — разбираемся, почему, чтобы отличить просроченную ссылку
  // от выдуманной: первую перевыпускают, вторая означает, что письмо не наше.
  const existing = await query<{ used: boolean; expired: boolean }>(
    `SELECT used_at IS NOT NULL AS "used",
            expires_at <= NOW() AS "expired"
       FROM password_resets
      WHERE token_hash = $1`,
    [tokenHash],
  )
  const found = existing.rows[0]
  if (!found) return { ok: false, reason: "unknown" }
  return { ok: false, reason: found.used ? "used" : "expired" }
}
