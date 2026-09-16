/**
 * Проверка консоли компании — docs/COMPANY_ACCOUNTS_PLAN.md §6.3.
 *
 * Консоль — единственная поверхность сайта, которая смотрит ПОПЕРЁК нескольких
 * человек. Всё остальное скоупится по владельцу само (§2), поэтому забытый гейт
 * здесь стоит дороже, чем где-либо ещё: роут без него показал бы админу одной
 * компании людей другой.
 *
 * Документацией это не лечится, поэтому проверка. В проекте таких шесть —
 * `i18n:check`, `md:check`, `dialog:check`, `admin:check`, `help:check`,
 * `features:check`; эта седьмая и устроена так же.
 *
 * Что проверяется:
 *
 *   1. Каждый роут под app/api/company/** зовёт `requireCompanyApi`
 *      или `requireCompanyApiAnyAdmin` — в КАЖДОМ экспортируемом обработчике.
 *   2. Каждая страница под app/company/** зовёт `requireCompanyPage`
 *      или `requireCompanyMember`.
 *   3. Результат гейта проверяется на `NextResponse` — иначе отказ утёк бы
 *      в тело ответа вместо кода состояния.
 *   4. Ни один роут консоли не зовёт админские гварды: перепутанный гвард
 *      открыл бы страницу не тем людям, и снаружи это выглядит одинаково.
 *
 * Запуск: npm run company:check
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const apiDir = join(root, "app/api/company")
const pagesDir = join(root, "app/company")

const API_GUARDS = ["requireCompanyApi", "requireCompanyApiAnyAdmin"]
const PAGE_GUARDS = ["requireCompanyPage", "requireCompanyMember"]
const ADMIN_GUARDS = ["requireAdminApi", "requireCapabilityPage"]
/** Обработчики роута: каждый отвечает сам за себя. */
const HANDLERS = ["GET", "POST", "PUT", "PATCH", "DELETE"]

const errors = []

function walk(dir, filename) {
  const found = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch (error) {
    if (error?.code === "ENOENT") return found
    throw error
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...walk(full, filename))
    else if (entry === filename) found.push(full)
  }
  return found
}

/**
 * Тело функции-обработчика, грубо: от её объявления до следующего экспорта.
 *
 * Скобки не считаем намеренно — проверке нужно «упомянут ли здесь гвард», а не
 * разбор синтаксиса. Парсер ради этого был бы дороже самой проверки.
 */
function handlerBody(source, handler) {
  const start = source.search(
    new RegExp(`export\\s+(async\\s+)?function\\s+${handler}\\s*\\(`),
  )
  if (start === -1) return null
  const rest = source.slice(start + 1)
  const next = rest.search(/\nexport\s+(async\s+)?function\s/)
  return next === -1 ? rest : rest.slice(0, next)
}

for (const file of walk(apiDir, "route.ts")) {
  const rel = relative(root, file)
  const source = readFileSync(file, "utf8")

  for (const guard of ADMIN_GUARDS) {
    if (source.includes(guard)) {
      errors.push(`${rel}: зовёт админский гвард ${guard} — в консоли нужен гейт компании`)
    }
  }

  const present = HANDLERS.filter((h) => handlerBody(source, h) !== null)
  if (present.length === 0) {
    errors.push(`${rel}: нет ни одного экспортируемого обработчика`)
    continue
  }

  for (const handler of present) {
    const body = handlerBody(source, handler)
    if (!API_GUARDS.some((guard) => body.includes(guard))) {
      errors.push(
        `${rel}: ${handler} не проходит через гейт компании (${API_GUARDS.join(" / ")})`,
      )
      continue
    }
    if (!body.includes("instanceof NextResponse")) {
      errors.push(
        `${rel}: ${handler} не проверяет результат гейта на NextResponse — отказ уйдёт в тело ответа`,
      )
    }
  }
}

for (const file of walk(pagesDir, "page.tsx")) {
  const rel = relative(root, file)
  const source = readFileSync(file, "utf8")

  for (const guard of ADMIN_GUARDS) {
    if (source.includes(guard)) {
      errors.push(`${rel}: зовёт админский гвард ${guard} — в консоли нужен гейт компании`)
    }
  }
  if (!PAGE_GUARDS.some((guard) => source.includes(guard))) {
    errors.push(`${rel}: не проходит через гейт компании (${PAGE_GUARDS.join(" / ")})`)
  }
}

const routes = walk(apiDir, "route.ts").length
const pages = walk(pagesDir, "page.tsx").length

if (errors.length > 0) {
  console.error(
    `company: найдено ${errors.length} нарушений гейта консоли.\n` +
      "Каждый роут и каждая страница консоли обязаны идти через гейт компании — docs/COMPANY_ACCOUNTS_PLAN.md §6.3.\n",
  )
  for (const error of errors) console.error(`  · ${error}`)
  process.exit(1)
}

console.log(`company: гейт на месте — ${routes} роут(ов), ${pages} страниц(ы).`)
