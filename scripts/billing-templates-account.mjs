/**
 * Служебный аккаунт для шаблонов пробного периода.
 *
 * Заводит пользователя, чьи проекты становятся пробным набором. Отдельная
 * сущность для этого не нужна: раскладка в R2 — `projects/{userId}/{projectId}/`,
 * а зеркало в десктопе — `<корень>/<владелец>/<проект>/`, где имя папки берётся
 * из ПОЧТЫ. То есть «папка шаблонов» и есть аккаунт, а её имя — его адрес.
 *
 * Роль USER, а не ADMIN, намеренно. Машинный токен читает роль живым запросом
 * (lib/storage/auth.ts), и админский токен видел бы ЧУЖИЕ проекты: подключив
 * его к десктопу, вы получили бы в зеркале весь сайт. Аккаунту нужно ровно
 * три вещи — войти, выпустить себе токен и владеть проектами; админских прав
 * ни одна из них не требует.
 *
 * `billing_exempt` включаем: если шаблон временно снять с пометки и прогнать
 * через конвейер для проверки, прогон не должен ничего стоить. Учёт при этом
 * ведётся — строкой `exempt`, чтобы расход на внешних сервисах не пропал.
 *
 * Идемпотентно: повторный запуск обновляет пароль и флаги, но не создаёт
 * второго аккаунта и не трогает уже заведённые проекты.
 *
 * Заодно выпускает машинный токен `mch_…`. Интерфейса ВЫПУСКА для него нет
 * нигде: единственный вход — `POST /api/account/machine-tokens`, то есть из
 * браузера под этим же аккаунтом (отзыв в админке есть, выдача — нет). Гонять человека через devtools ради одной строки
 * незачем, а формат токена и хеширование здесь повторены один в один с
 * `lib/storage/write-path.ts` — разойдись они, токен просто не подошёл бы.
 *
 * Проверка вместо изменения:
 *   TEMPLATES_PASSWORD=... node scripts/billing-templates-account.mjs --verify
 * Сверяет пароль с хешем в базе и ничего не пишет. Нужна, чтобы разделить два
 * разных «не пускает»: хеш не тот — чинится здесь; хеш тот — значит браузер
 * отправляет не то, что вы набрали (автозаполнение менеджера паролей).
 *
 * Запуск:
 *   TEMPLATES_EMAIL=templates@ffworks.pro TEMPLATES_PASSWORD=... \
 *     node scripts/billing-templates-account.mjs
 *
 * Пароль и токен можно не задавать — сгенерируем и напечатаем один раз.
 * Повторный запуск выпускает ЕЩЁ один токен: старые не отзываются, потому что
 * ими могут ходить другие машины. Лишний снимается в админке — «Удалённый
 * доступ», меню на строке токена; новый всегда даёт повторный запуск.
 */
import "dotenv/config"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import { Client } from "pg"
import { readConnectionConfig, resolvePgSsl } from "./pg-connection.mjs"
import { usersEmailConflictTarget } from "./lib/users-email-conflict.mjs"

const email = (process.env.TEMPLATES_EMAIL ?? "templates@ffworks.pro")
  .trim()
  .toLowerCase()
const generated = !process.env.TEMPLATES_PASSWORD
const password =
  process.env.TEMPLATES_PASSWORD ?? randomBytes(12).toString("base64url")

let config
try {
  config = readConnectionConfig()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const client = new Client({
  user: config.user,
  password: config.password,
  host: config.host,
  port: config.port,
  database: config.database,
  ssl: resolvePgSsl(),
})

const VERIFY_ONLY = process.argv.includes("--verify")

async function verify() {
  const result = await client.query(
    `SELECT id, is_active AS "isActive", role, auth_provider AS "authProvider",
            password_hash AS "passwordHash", length(email) AS "emailLen"
       FROM users WHERE email = $1`,
    [email],
  )
  const user = result.rows[0]

  console.log("")
  if (!user) {
    console.log(`Пользователя ${email} в этой базе НЕТ.`)
    // Ищем похожие: невидимый символ или другой регистр дают ровно такую
    // картину — в списке админки строка есть, а точное сравнение её не находит.
    const like = await client.query(
      `SELECT email, length(email) AS len FROM users WHERE lower(email) LIKE $1`,
      [`%templates%`],
    )
    if (like.rows.length > 0) {
      console.log("Похожие адреса в базе:")
      for (const row of like.rows) {
        console.log(`  «${row.email}» (символов: ${row.len})`)
      }
      console.log(
        `  для сравнения: «${email}» (символов: ${email.length})`,
      )
    }
    return
  }

  console.log(`Пользователь ${email} найден.`)
  console.log(
    `  вход:   ${user.isActive ? "активен" : "ЗАБЛОКИРОВАН"}, ` +
      `роль ${user.role}, провайдер ${user.authProvider}`,
  )
  console.log(
    `  хеш:    ${user.passwordHash ? `есть (${user.passwordHash.slice(0, 4)}…)` : "ОТСУТСТВУЕТ"}`,
  )

  if (!process.env.TEMPLATES_PASSWORD) {
    console.log("")
    console.log("  Пароль не задан — сверять нечего.")
    console.log("  TEMPLATES_PASSWORD='…' node scripts/billing-templates-account.mjs --verify")
    return
  }
  if (!user.passwordHash) return

  const ok = await bcrypt.compare(process.env.TEMPLATES_PASSWORD, user.passwordHash)
  console.log("")
  console.log(
    ok
      ? "  ✓ Пароль СОВПАДАЕТ с хешем. Значит база в порядке, и вход ломает\n" +
          "    что-то на клиенте — почти всегда автозаполнение менеджера паролей.\n" +
          "    Очистите поле руками или откройте приватное окно."
      : "  ✗ Пароль НЕ совпадает с хешем. Задайте его заново:\n" +
          "    TEMPLATES_PASSWORD='…' npm run billing:templates-account",
  )
}

async function main() {
  await client.connect()

  if (VERIFY_ONLY) {
    await verify()
    return
  }

  const passwordHash = await bcrypt.hash(password, 10)

  // Только базовые колонки: они есть в схеме всегда. `billing_exempt` приезжает
  // миграцией биллинга, и завязывать на неё создание аккаунта нельзя — иначе
  // скрипт падает целиком там, где не хватает одного необязательного флага, и
  // человек остаётся без аккаунта, не поняв почему.
  const result = await client.query(
    `INSERT INTO users (
       id, full_name, email, password_hash, role, is_active, auth_provider
     )
     VALUES ($1, $2, $3, $4, 'USER', TRUE, 'local')
     ${await usersEmailConflictTarget(client)} DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           is_active     = TRUE
     RETURNING id, (xmax = 0) AS created`,
    [randomUUID(), "Шаблоны пробного периода", email, passwordHash],
  )

  const { id, created } = result.rows[0]

  // Освобождение от оплаты — отдельным шагом и без падения: миграция биллингa
  // могла быть ещё не накачена, а аккаунт нужен уже сейчас.
  let exemptSet = false
  try {
    await client.query(
      `UPDATE users SET billing_exempt = TRUE WHERE id = $1`,
      [id],
    )
    exemptSet = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/column .*billing_exempt.* does not exist/i.test(message)) throw error
  }

  // Формат — `mch_` + 32 случайных байта в base64url, хранится только SHA-256.
  // Обе половины повторяют lib/storage/write-path.ts.
  const rawToken = `mch_${randomBytes(32).toString("base64url")}`
  const tokenHash = createHash("sha256").update(rawToken).digest("hex")
  await client.query(
    `INSERT INTO machine_tokens (id, user_id, project_id, name, token_hash)
     VALUES ($1, $2, NULL, $3, $4)`,
    [randomUUID(), id, "Шаблоны пробного периода", tokenHash],
  )

  const templates = await client.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(is_template, FALSE))::int AS marked
       FROM projects
      WHERE user_id = $1 AND deleted_at IS NULL`,
    [id],
  )
  const { total, marked } = templates.rows[0]

  // Сверка по факту, а не по нашим ожиданиям: если вход не работает, первым
  // делом надо знать, что в базе, а не что мы туда собирались положить.
  const check = await client.query(
    `SELECT is_active AS "isActive",
            password_hash IS NOT NULL AS "hasPassword",
            role,
            auth_provider AS "authProvider",
            (SELECT COUNT(*)::int FROM machine_tokens mt
              WHERE mt.user_id = u.id AND mt.revoked_at IS NULL) AS "tokens"
       FROM users u WHERE u.id = $1`,
    [id],
  )
  const state = check.rows[0]

  console.log("")
  console.log(created ? "Аккаунт создан." : "Аккаунт уже был, обновлён.")
  console.log(`  почта:   ${email}`)
  console.log(`  id:      ${id}`)
  console.log(
    `  вход:    ${state.isActive ? "активен" : "ЗАБЛОКИРОВАН"}, ` +
      `пароль ${state.hasPassword ? "задан" : "ОТСУТСТВУЕТ"}, ` +
      `роль ${state.role}, провайдер ${state.authProvider}`,
  )
  console.log(`  токены:  ${state.tokens}`)
  console.log(`  проекты: ${total}, из них в пробном наборе: ${marked}`)
  if (!exemptSet) {
    console.log("")
    console.log(
      "  ⚠ billing_exempt не выставлен: миграция биллинга ещё не накачена.",
    )
    console.log(
      "    На вход и на шаблоны это не влияет — перезапустите скрипт после npm run db:migrate.",
    )
  }
  if (generated) {
    console.log(`  пароль:  ${password}`)
    console.log("  (сгенерирован; больше нигде не показывается)")
  }
  console.log(`  токен:   ${rawToken}`)
  console.log("  (показывается один раз; в базе только хеш)")
  console.log("")
  console.log("Дальше:")
  console.log("  1. Вписать токен в настройки десктопа")
  console.log(
    `  2. Завести проекты — в зеркале они лягут под папкой «${email}»`,
  )
  console.log("  3. Наполнить IN и положить options/options.json")
  console.log("  4. В админке «Тарифы» отметить их как пробный набор")
  console.log("")
  console.log(
    `Войти на сайт под ${email} можно тем же паролем, но для шаблонов это не нужно:`,
  )
  console.log("проекты правятся из десктопа, набор собирается в админке.")
  console.log("")
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => client.end())
