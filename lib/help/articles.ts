/**
 * Чтение статей справки с диска. Только для серверных компонентов и роутов.
 *
 * Тексты лежат файлами в репозитории (`content/help/<lang>/<id>.md`), а не в
 * базе, и это осознанно: «почему так, а не иначе» меняется ровно тогда, когда
 * меняется код, и должно ехать тем же PR. В базе оно неминуемо разъедется с
 * интерфейсом, и никакая проверка этого не поймает — файл хотя бы виден в
 * диффе рядом с правкой, из-за которой устарел.
 *
 * Если однажды понадобится правка без деплоя, поверх файлов кладётся оверрайд
 * из базы: `loadArticle` остаётся единственной точкой чтения, и ломать ничего не
 * придётся.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { cache } from "react"

import type { HelpTopicId } from "@/lib/help/topics"

const HELP_DIR = join(process.cwd(), "content", "help")

/**
 * Тот же союз, что `Lang` в словаре кабинета, но объявленный здесь: серверный
 * модуль не должен импортировать клиентский `components/account/i18n.tsx` даже
 * ради типа. Так же поступает `formatCents` в lib/billing/types.ts.
 */
export type HelpLang = "ru" | "en"

/** Язык, на котором статьи пишутся первыми: с него же идёт фолбэк. */
const BASE_LANG: HelpLang = "ru"

export type HelpArticle = {
  id: string
  lang: HelpLang
  title: string
  summary: string
  /** Дата последней осмысленной правки, `YYYY-MM-DD`. Не берётся из mtime. */
  updated: string
  tags: string[]
  body: string
  /** Перевода на запрошенный язык нет — показан текст базового языка. */
  fallback: boolean
}

/**
 * Разбор шапки файла.
 *
 * Свой разбор, а не зависимость: шапка — это четыре строки `ключ: значение` без
 * вложенности, и тащить ради них YAML-парсер (и его вариант в проверочном
 * скрипте) дороже, чем двадцать строк здесь. Всё, что сложнее пары
 * «ключ-значение», в шапке запрещено контрактом — docs/HELP_SYSTEM.md §2.
 */
function parseFrontmatter(raw: string): {
  meta: Record<string, string>
  body: string
} {
  if (!raw.startsWith("---")) return { meta: {}, body: raw }

  const end = raw.indexOf("\n---", 3)
  if (end === -1) return { meta: {}, body: raw }

  const meta: Record<string, string> = {}
  for (const line of raw.slice(3, end).split("\n")) {
    const at = line.indexOf(":")
    if (at === -1) continue
    const key = line.slice(0, at).trim()
    if (key) meta[key] = line.slice(at + 1).trim()
  }

  // +4 — длина "\n---"; дальше отрезаем остаток строки и пустые строки за ней.
  return { meta, body: raw.slice(end + 4).replace(/^[^\n]*\n+/, "") }
}

function readArticle(id: string, lang: HelpLang): HelpArticle | null {
  let raw: string
  try {
    raw = readFileSync(join(HELP_DIR, lang, `${id}.md`), "utf8")
  } catch {
    return null
  }

  const { meta, body } = parseFrontmatter(raw)
  return {
    id,
    lang,
    title: meta.title ?? id,
    summary: meta.summary ?? "",
    updated: meta.updated ?? "",
    tags: (meta.tags ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    body,
    fallback: false,
  }
}

/**
 * Статья на нужном языке; если перевода нет — базовый язык с пометкой.
 *
 * Пометка, а не молчаливая подмена: человек в EN-интерфейсе должен понимать,
 * почему текст вдруг по-русски, иначе это выглядит поломкой.
 *
 * `cache` — на время одного запроса: индекс справки читает те же файлы, что и
 * страница статьи, и без него один рендер лез бы на диск дважды.
 */
export const loadArticle = cache(
  (id: HelpTopicId | string, lang: HelpLang): HelpArticle | null => {
    const direct = readArticle(id, lang)
    if (direct) return direct
    if (lang === BASE_LANG) return null

    const base = readArticle(id, BASE_LANG)
    return base ? { ...base, lang, fallback: true } : null
  },
)

/**
 * Обе языковые версии сразу.
 *
 * Язык интерфейса живёт в `localStorage`, то есть сервер его не знает и выбрать
 * версию за клиента не может. Поэтому страница отдаёт обе, а переключает уже
 * браузер — так смена языка не требует похода на сервер.
 *
 * `en: null` значит «перевода нет»: копию русского текста вторым полем не шлём,
 * клиент покажет базовый с пометкой.
 */
export type HelpArticleBundle = {
  id: string
  ru: HelpArticle
  en: HelpArticle | null
}

export function loadBundle(id: HelpTopicId | string): HelpArticleBundle | null {
  const ru = loadArticle(id, "ru")
  if (!ru) return null

  const en = loadArticle(id, "en")
  return { id, ru, en: en && !en.fallback ? en : null }
}
