/**
 * Проверка справки: реестр тем ↔ файлы статей ↔ якоря в интерфейсе.
 *
 * Без неё затея мертва через полгода. Справка гниёт тихо: параметр
 * переименовали, статью не тронули, якорь остался — и человек читает про
 * настройку, которой уже нет. Тип `HelpTopicId` ловит только опечатку в якоре,
 * всё остальное — здесь.
 *
 * Что проверяется:
 *
 *   1. У каждой темы реестра есть файл content/help/ru/<id>.md.
 *   2. Шапка файла полна: title, summary, updated, tags.
 *   3. Нет файлов статей без темы в реестре.
 *   4. Каждая тема, кроме `standalone`, упомянута в коде интерфейса —
 *      якорем `<HelpDot id="…">`, кнопкой раздела `help="…"` или картой
 *      закладок.
 *   5. Каждый якорь — `<HelpDot id="…">` и `help="…"` — ведёт на
 *      существующую тему.
 *   6. `seeAlso` ссылается на существующие темы.
 *   7. Ссылки `/help/<id>` внутри статей ведут на существующие темы.
 *   8. Картинки статей лежат на диске: `![](/help/<id>/имя.png)` → файл
 *      `public/help/<id>/имя.png`. Нет файла — ошибка; лишний файл, на который
 *      никто не ссылается, — предупреждение.
 *
 * Английский перевод не обязателен: статьи пишутся по-русски, перевод
 * догоняет — про недостающий сказано предупреждением, а не ошибкой.
 *
 * Запуск: npm run help:check
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, dirname, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const registryPath = join(root, "lib/help/topics.ts")
const contentDir = join(root, "content/help")
const publicDir = join(root, "public")
/** Картинки статей: тот же адрес, что у самой статьи, плюс имя файла. */
const imagesDir = join(publicDir, "help")
const BASE_LANG = "ru"

/** Где ищем упоминания тем: код интерфейса, но не сам механизм справки. */
const UI_DIRS = ["components", "app"]
const UI_SKIP = ["components/help"]

const errors = []
const warnings = []

/**
 * Реестр читаем регулярками, а не импортом: файл тянет `@/lib/...`-алиасы, и
 * ради проверки пришлось бы поднимать сборку. Тот же приём, что в
 * admin-nav-check.mjs.
 */
function parseRegistry() {
  const source = readFileSync(registryPath, "utf8")
  const start = source.indexOf("export const HELP_TOPICS")
  const end = source.indexOf("] as const satisfies", start)
  if (start === -1 || end === -1) {
    errors.push("lib/help/topics.ts: не найден массив HELP_TOPICS")
    return []
  }

  const block = source.slice(start, end)
  return block
    .split(/\n {2}\{\n/)
    .slice(1)
    .map((entry) => ({
      id: entry.match(/id:\s*"([^"]+)"/)?.[1],
      standalone: /standalone:\s*true/.test(entry),
      seeAlso: [
        ...(entry.match(/seeAlso:\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g),
      ].map((match) => match[1]),
    }))
    .filter((topic) => topic.id)
}

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    const rel = relative(root, full)
    if (UI_SKIP.some((skip) => rel.startsWith(skip))) continue
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

function frontmatter(raw) {
  if (!raw.startsWith("---")) return null
  const end = raw.indexOf("\n---", 3)
  if (end === -1) return null

  const meta = {}
  for (const line of raw.slice(3, end).split("\n")) {
    const at = line.indexOf(":")
    if (at === -1) continue
    const key = line.slice(0, at).trim()
    if (key) meta[key] = line.slice(at + 1).trim()
  }
  return meta
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i

const topics = parseRegistry()
const ids = new Set(topics.map((topic) => topic.id))
/** Адреса картинок, на которые кто-то сослался: остальное в public/help — сор. */
const usedImages = new Set()

// ── 1-2. Файлы статей и их шапки ────────────────────────────────────────────
for (const topic of topics) {
  const file = join(contentDir, BASE_LANG, `${topic.id}.md`)
  if (!existsSync(file)) {
    errors.push(`${topic.id}: нет статьи content/help/${BASE_LANG}/${topic.id}.md`)
    continue
  }

  const meta = frontmatter(readFileSync(file, "utf8"))
  if (!meta) {
    errors.push(`${topic.id}: нет шапки --- … --- в начале файла`)
    continue
  }
  for (const key of ["title", "summary", "updated", "tags"]) {
    if (!meta[key]) errors.push(`${topic.id}: в шапке нет «${key}»`)
  }
  if (meta.updated && !/^\d{4}-\d{2}-\d{2}$/.test(meta.updated)) {
    errors.push(`${topic.id}: «updated» должно быть YYYY-MM-DD, а не «${meta.updated}»`)
  }

  // 6. Соседние темы.
  for (const related of topic.seeAlso) {
    if (!ids.has(related)) {
      errors.push(`${topic.id}: seeAlso ссылается на несуществующую тему «${related}»`)
    }
  }
}

// ── 3. Осиротевшие файлы + 7. ссылки внутри статей ──────────────────────────
for (const lang of existsSync(contentDir) ? readdirSync(contentDir) : []) {
  const dir = join(contentDir, lang)
  if (!statSync(dir).isDirectory()) continue

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue
    const id = file.slice(0, -3)

    if (!ids.has(id)) {
      errors.push(`content/help/${lang}/${file}: статья без темы в lib/help/topics.ts`)
      continue
    }

    const raw = readFileSync(join(dir, file), "utf8")
    if (lang !== BASE_LANG && !frontmatter(raw)) {
      errors.push(`content/help/${lang}/${file}: нет шапки --- … ---`)
    }
    // Ссылка на статью и ссылка на картинку пишутся одинаково — `/help/…`, —
    // поэтому отличаем по расширению: `/help/x` это тема, `/help/x/y.png` файл.
    for (const match of raw.matchAll(/\]\(\/help\/([^)#\s]+)/g)) {
      if (IMAGE_EXT.test(match[1])) continue
      if (!ids.has(match[1])) {
        errors.push(`content/help/${lang}/${file}: ссылка на несуществующую тему «${match[1]}»`)
      }
    }

    for (const match of [
      ...raw.matchAll(/!\[[^\]]*\]\((\/[^)\s]+)/g),
      ...raw.matchAll(/<img[^>]+src="(\/[^"]+)"/g),
    ]) {
      const src = decodeURI(match[1])
      usedImages.add(src)
      if (!existsSync(join(publicDir, src))) {
        errors.push(`content/help/${lang}/${file}: нет файла картинки «${src}»`)
      } else if (!src.startsWith("/help/")) {
        warnings.push(
          `content/help/${lang}/${file}: картинка «${src}» лежит вне public/help/`,
        )
      }
    }
  }
}

// ── 8. Картинки, на которые никто не ссылается ──────────────────────────────
function walkImages(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkImages(full, out)
    else out.push(full)
  }
  return out
}

for (const file of walkImages(imagesDir)) {
  const src = `/${relative(publicDir, file).split(sep).join("/")}`
  if (!usedImages.has(src)) {
    warnings.push(`public${src}: картинка, на которую никто не ссылается`)
  }
}

// ── 4-5. Якоря в интерфейсе ─────────────────────────────────────────────────
const mentioned = new Set()
for (const dir of UI_DIRS) {
  for (const file of walk(join(root, dir))) {
    const source = readFileSync(file, "utf8")

    // Упоминание темы строкой: и `<HelpDot id="…">`, и карта закладок.
    for (const id of ids) {
      if (source.includes(`"${id}"`)) mentioned.add(id)
    }

    // Якорь на тему, которой нет в реестре. Такое обычно не соберётся, но
    // проверка дешёвая, а сообщение здесь понятнее ошибки типов.
    //
    // Два вида якорей: знак «?» у параметра и кнопка в шапке страницы
    // (`<AdminPageHeader help="…">`). Отсюда и договорённость: атрибут `help`
    // в разметке значит тему справки и ничего другого — иначе эта проверка
    // начнёт ругаться на чужой проп (docs/HELP_SYSTEM.md §2).
    const anchors = [
      ...source.matchAll(/<HelpDot\s+id="([^"]+)"/g),
      ...source.matchAll(/\shelp="([^"]+)"/g),
    ]
    for (const match of anchors) {
      if (!ids.has(match[1])) {
        errors.push(`${relative(root, file)}: якорь на несуществующую тему «${match[1]}»`)
      }
    }
  }
}

for (const topic of topics) {
  if (topic.standalone || mentioned.has(topic.id)) continue
  errors.push(
    `${topic.id}: тема не помечена standalone, но в интерфейсе её никто не показывает`,
  )
}

// ── Переводы ────────────────────────────────────────────────────────────────
for (const topic of topics) {
  if (!existsSync(join(contentDir, "en", `${topic.id}.md`))) {
    warnings.push(`${topic.id}: нет английской версии`)
  }
}

// ── Итог ────────────────────────────────────────────────────────────────────
if (warnings.length > 0) {
  console.log(`Предупреждения (${warnings.length}):`)
  for (const warning of warnings) console.log(`  · ${warning}`)
  console.log("")
}

if (errors.length > 0) {
  console.error(`Ошибки (${errors.length}):`)
  for (const error of errors) console.error(`  ✗ ${error}`)
  process.exit(1)
}

console.log(`Справка в порядке: ${topics.length} тем.`)
