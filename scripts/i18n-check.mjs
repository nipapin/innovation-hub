/**
 * Ищет захардкоженные русские строки в локализуемых зонах UI (/account, /admin).
 *
 * Правило описано в docs/UI_GUIDE.md §13, но одного правила мало: раздел
 * «Конвейер» был написан целиком на хардкоде и прошёл ревью, потому что рядом
 * лежали такие же файлы. Проверка ловит это до ревью.
 *
 * Комментарии не считаются: они в этом проекте по-русски намеренно.
 *
 * Usage:
 *   npm run i18n:check
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

/** Локализуемые зоны. Публичный сайт словаря не имеет — см. техдолг в UI_GUIDE §17. */
const ZONES = [
  "components/account",
  "components/admin",
  "components/help",
  "app/account",
  "app/admin",
  "app/help",
]

/** Сами словари, конечно, по-русски. */
const ALLOWED_FILES = new Set([
  "components/account/i18n.tsx",
  "components/admin/admin-dict.ts",
])

/**
 * Легальные вхождения кириллицы вне словаря: локаль форматирования выбирается
 * тернарником по `lang`, и сама строка "ru-RU" русского текста не содержит,
 * но попадает под поиск, если рядом стоит комментарий. Держим отдельно, чтобы
 * не глушить весь файл.
 */
const ALLOWED_PATTERNS = [
  /"ru-RU"/,
  /'ru-RU'/,
  // Переключатель языка: название языка пишется на нём самом, а не переводится.
  /l === "ru" \? "Русский" : "English"/,
]

const CYRILLIC = /[А-Яа-яЁё]/

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, out)
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Вырезает комментарии, сохраняя нумерацию строк: каждая удалённая строка
 * заменяется пустой, иначе номера в отчёте разъедутся с файлом.
 */
function stripComments(source) {
  const blanked = (match) => match.replace(/[^\n]/g, " ")
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, blanked) // JSX {/* … */}
    .replace(/\/\*[\s\S]*?\*\//g, blanked) // /* … */ и JSDoc
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length))
}

const offenders = []

for (const zone of ZONES) {
  for (const file of walk(join(root, zone))) {
    const rel = relative(root, file).split("\\").join("/")
    if (ALLOWED_FILES.has(rel)) continue

    const lines = stripComments(readFileSync(file, "utf8")).split("\n")
    lines.forEach((line, index) => {
      if (!CYRILLIC.test(line)) return
      if (ALLOWED_PATTERNS.some((p) => p.test(line))) return
      offenders.push({ file: rel, line: index + 1, text: line.trim() })
    })
  }
}

if (offenders.length === 0) {
  console.log("i18n: захардкоженных строк не найдено.")
  process.exit(0)
}

console.error(
  `i18n: найдено ${offenders.length} захардкоженных строк в локализуемых зонах.\n` +
    `Заведите ключ в оба словаря (ru + en) и используйте t.key — docs/UI_GUIDE.md §13.\n`,
)
for (const { file, line, text } of offenders) {
  console.error(`  ${file}:${line}  ${text.slice(0, 120)}`)
}
process.exit(1)
