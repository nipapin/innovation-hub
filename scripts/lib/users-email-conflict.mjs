/**
 * Как сказать `ON CONFLICT` по почте пользователя — зависит от того, накачена ли
 * миграция подпрофилей (db/migrations/2026-09-28-login-profiles.sql).
 *
 * До неё почта уникальна ограничением `users_email_key`, и хватает
 * `ON CONFLICT (email)`. После — только среди входов, частичным индексом, и
 * Postgres сопоставит его, лишь если условие индекса повторено дословно. Без
 * этого скрипт падает с «no unique or exclusion constraint matching the ON
 * CONFLICT specification» — на чистой базе и на рабочей по-разному.
 *
 * @param {import('pg').Client} client
 * @returns {Promise<string>} Готовый `ON CONFLICT (...)` без `DO ...`.
 */
export async function usersEmailConflictTarget(client) {
  const { rowCount } = await client.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'users'
        AND column_name = 'login_user_id'`,
  )
  return rowCount && rowCount > 0
    ? "ON CONFLICT (email) WHERE login_user_id IS NULL"
    : "ON CONFLICT (email)"
}
