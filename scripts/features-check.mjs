/**
 * Проверка выключателей: реестр ↔ окружение ↔ гейты в коде.
 *
 * Без неё затея разваливается тихо, и всегда одинаково: раздел убрали из меню,
 * а страницу забыли — и «выключенное» открывается по прямой ссылке. Об этом же
 * написано в шапке admin-nav-check.mjs: документацией такое не лечится.
 *
 * Что проверяется:
 *
 *   1. Каждый ключ, встреченный в коде как `isEnabled("…")`,
 *      `isEnvFeatureEnabled("…")` или `requireFeature("…")`, есть в реестре.
 *      Ловит опечатки и флаги, оставшиеся от удалённого кода.
 *   2. У каждого `source: "env"` переменная упомянута в lib/features-env.ts
 *      БУКВАЛЬНО. Это не педантизм: карта читается из proxy.ts, а там
 *      обращение по вычисляемому ключу молча вернёт undefined.
 *   3. Каждая такая переменная описана в .env.example.
 *   4. Каждый `kind: "tool"` ссылается на существующий инструмент каталога.
 *   5. Каждый `kind: "admin"` ссылается на существующий раздел ADMIN_TOOLS.
 *   6. У каждого `kind: "admin"` гейт есть и на самой странице, а не только в
 *      меню. Пункт ради которого всё и написано.
 *
 * Запуск: npm run features:check
 */
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (rel) => readFileSync(join(root, rel), "utf8")

const registrySource = read("lib/features.ts")
const envSource = read("lib/features-env.ts")
const toolsSource = read("lib/tools/registry.ts")
const navSource = read("components/admin/shell/nav-config.ts")
const envExample = existsSync(join(root, ".env.example")) ? read(".env.example") : ""

const errors = []

/** Записи реестра. Разбор регуляркой — как в admin-nav-check.mjs. */
const features = [...registrySource.matchAll(/\{\s*key: "([^"]+)",([\s\S]*?)\n  \}/g)].map(
  ([, key, body]) => ({
    key,
    kind: /kind: "([^"]+)"/.exec(body)?.[1] ?? "",
    source: /source: "([^"]+)"/.exec(body)?.[1] ?? "",
    env: /env: "([^"]+)"/.exec(body)?.[1] ?? null,
    tool: /tool: "([^"]+)"/.exec(body)?.[1] ?? null,
    nav: /nav: "([^"]+)"/.exec(body)?.[1] ?? null,
  }),
)

if (features.length === 0) {
  console.error("features: не удалось разобрать реестр lib/features.ts.")
  process.exit(1)
}

const known = new Set(features.map((f) => f.key))
const toolKeys = new Set(
  [...toolsSource.matchAll(/^\s+key: "([^"]+)",/gm)].map(([, key]) => key),
)
const navHrefs = new Set(
  [...navSource.matchAll(/^\s+href: "([^"]+)",/gm)].map(([, href]) => href),
)

for (const feature of features) {
  // 2 + 3. Переменная окружения: буквально в карте и описана в примере.
  if (feature.source === "env") {
    if (!feature.env) {
      errors.push(`${feature.key}: source "env", но имя переменной не указано.`)
    } else {
      if (!envSource.includes(`${feature.env}: process.env.${feature.env}`)) {
        errors.push(
          `${feature.key}: переменная ${feature.env} не упомянута буквально в ` +
            `ENV_VALUES (lib/features-env.ts). В edge-рантайме она вернёт undefined.`,
        )
      }
      if (!envExample.includes(feature.env)) {
        errors.push(`${feature.key}: переменная ${feature.env} не описана в .env.example.`)
      }
    }
  } else if (feature.env) {
    errors.push(`${feature.key}: source "${feature.source}", но задано имя переменной.`)
  }

  // 4. Инструмент каталога существует.
  if (feature.kind === "tool") {
    if (!feature.tool) {
      errors.push(`${feature.key}: kind "tool", но ключ инструмента не указан.`)
    } else if (!toolKeys.has(feature.tool)) {
      errors.push(
        `${feature.key}: инструмента "${feature.tool}" нет в lib/tools/registry.ts.`,
      )
    }
  }

  // 5 + 6. Раздел админки существует, и гейт стоит на самой странице.
  if (feature.kind === "admin") {
    if (!feature.nav) {
      errors.push(`${feature.key}: kind "admin", но адрес раздела не указан.`)
      continue
    }
    if (!navHrefs.has(feature.nav)) {
      errors.push(
        `${feature.key}: адреса "${feature.nav}" нет в ADMIN_TOOLS ` +
          `(components/admin/shell/nav-config.ts).`,
      )
    }
    const pageRel = `app${feature.nav}/page.tsx`
    if (!existsSync(join(root, pageRel))) {
      errors.push(`${feature.key}: страница ${pageRel} не найдена.`)
    } else if (!read(pageRel).includes(`"${feature.key}"`)) {
      errors.push(
        `${feature.key}: в ${pageRel} нет гейта. Скрытый пункт меню защитой не ` +
          `является — по прямой ссылке страница откроется.`,
      )
    }
  }
}

// 1. Все ключи, использованные в коде, известны реестру.
const USED = /\b(?:isEnabled|isEnvFeatureEnabled|requireFeature)\(\s*"([^"]+)"/g
for (const rel of ["app", "components", "lib"]) {
  const stack = [join(root, rel)]
  while (stack.length > 0) {
    const dir = stack.pop()
    const { readdirSync, statSync } = await import("node:fs")
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        stack.push(full)
      } else if (/\.tsx?$/.test(entry)) {
        const source = readFileSync(full, "utf8")
        for (const [, key] of source.matchAll(USED)) {
          if (!known.has(key)) {
            errors.push(
              `${full.slice(root.length + 1)}: неизвестный флаг "${key}" — ` +
                `его нет в lib/features.ts.`,
            )
          }
        }
      }
    }
  }
}

if (errors.length === 0) {
  console.log(`features: ${features.length} выключателей, замечаний нет.`)
  process.exit(0)
}

console.error(`features: найдено ${errors.length} замечаний.\n`)
for (const error of errors) console.error(`  ${error}`)
process.exit(1)
