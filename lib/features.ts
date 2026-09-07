/**
 * Реестр выключателей — что на этой установке вообще можно погасить.
 *
 * Чистый модуль: без базы, без `next/server` и без чтения окружения, потому что
 * его импортируют и страница админки, и серверные роуты, и `proxy.ts`. Реестр
 * один, а не по копии на слой — как у тегов прав (lib/admin-capabilities.ts) и у
 * навигации админки (components/admin/shell/nav-config.ts).
 *
 * Зачем он нужен. Сайт живёт в двух установках сразу: основной и упрощённой
 * копии. Разница между ними обязана быть НАСТРОЙКОЙ, а не удалённым кодом.
 * Удали половину — и общие файлы разойдутся навсегда, а каждый перенос правки
 * между установками превратится в разбор конфликтов. Выключенное же не стоит
 * ничего: код лежит, ветка до него не доходит, файлы совпадают байт в байт.
 * Полный разбор — docs/FEATURE_FLAGS.md.
 *
 * ГЛАВНОЕ ПРАВИЛО: выключение СКРЫВАЕТ, но никогда не УДАЛЯЕТ. Экземпляры
 * инструментов у людей, проекты, записи в журнале остаются на месте. Иначе это
 * уже не выключатель, а необратимая операция под видом галочки.
 */
import type { AdminDictKey } from "@/components/admin/admin-dict"

/**
 * Что именно гасит флаг. Влияет только на группировку в интерфейсе, но задаётся
 * явно: по одному ключу не отличить раздел админки от инструмента кабинета.
 */
export type FeatureKind = "subsystem" | "admin" | "tool"

/**
 * Откуда берётся значение — и это не вопрос удобства.
 *
 * `env` — свойство установки: какой это вообще сайт. Меняется один раз за жизнь
 * проекта, и меняется деплоем. Такие флаги читаются и в `proxy.ts`, где базы
 * нет вовсе, поэтому всё, от чего зависит маршрутизация, обязано быть `env`.
 *
 * `runtime` — обычная настройка: галка в админке, значение в таблице
 * `feature_flags`.
 *
 * Биллинг здесь `env` намеренно. Он сидит в рабочем цикле: lib/pipeline/scan.ts
 * не пускает задачу без денег, а фоновый lib/statistics/stats-loop.ts закрывает
 * гранты и проводит списания. Погасить его галкой на работающем сайте — значит
 * пропустить пачку задач мимо реестра и оставить незакрытые гранты, которые
 * потом сводить руками в базе. Это порча данных, а не переключение отображения.
 */
export type FeatureSource = "env" | "runtime"

/** Группы — только для отрисовки. В базе и в коде никакой иерархии нет. */
export const FEATURE_GROUPS = [
  "public",
  "billing",
  "insights",
  "tools",
] as const

export type FeatureGroup = (typeof FEATURE_GROUPS)[number]

export type FeatureDefinition = {
  /** Стабильный ключ: попадает в БД, менять нельзя. */
  key: string
  kind: FeatureKind
  group: FeatureGroup
  source: FeatureSource
  labelKey: AdminDictKey
  descriptionKey: AdminDictKey
  /** Только у `source: "env"` — имя переменной окружения. */
  env?: string
  /** Только у `kind: "tool"` — ключ из lib/tools/registry.ts. */
  tool?: string
  /** Только у `kind: "admin"` — href из ADMIN_TOOLS. */
  nav?: string
}

export const FEATURES = [
  // ─── Публичная часть ──────────────────────────────────────────────────────
  // Гасит `/`, `/videos`, `/video/[id]` и их роуты. `env`, потому что от этого
  // зависит, куда ведёт корень сайта, а это решает proxy.ts до всякой базы.
  {
    key: "public.catalog",
    kind: "subsystem",
    group: "public",
    source: "env",
    env: "FEATURE_PUBLIC_CATALOG",
    labelKey: "featurePublicCatalog",
    descriptionKey: "featurePublicCatalogDesc",
  },
  {
    key: "public.pages",
    kind: "subsystem",
    group: "public",
    source: "env",
    env: "FEATURE_PUBLIC_PAGES",
    labelKey: "featurePublicPages",
    descriptionKey: "featurePublicPagesDesc",
  },

  // ─── Деньги ───────────────────────────────────────────────────────────────
  {
    key: "billing",
    kind: "subsystem",
    group: "billing",
    source: "env",
    env: "FEATURE_BILLING",
    labelKey: "featureBilling",
    descriptionKey: "featureBillingDesc",
  },

  // ─── Аналитика ────────────────────────────────────────────────────────────
  {
    key: "admin.visitors",
    kind: "admin",
    group: "insights",
    source: "runtime",
    nav: "/admin/visitors",
    labelKey: "featureAdminVisitors",
    descriptionKey: "featureAdminVisitorsDesc",
  },
  {
    key: "admin.statistics",
    kind: "admin",
    group: "insights",
    source: "runtime",
    nav: "/admin/statistics",
    labelKey: "featureAdminStatistics",
    descriptionKey: "featureAdminStatisticsDesc",
  },

  // ─── Инструменты кабинета ─────────────────────────────────────────────────
  // Гасится каталог: инструмент нельзя добавить и нельзя открыть. Уже добавленные
  // экземпляры остаются в `user_tools` нетронутыми — включили обратно, и всё на
  // месте вместе с настройками.
  {
    key: "tool.srt-editor",
    kind: "tool",
    group: "tools",
    source: "runtime",
    tool: "srt-editor",
    labelKey: "featureToolSrtEditor",
    descriptionKey: "featureToolSrtEditorDesc",
  },
  {
    key: "tool.voice-over",
    kind: "tool",
    group: "tools",
    source: "runtime",
    tool: "voice-over",
    labelKey: "featureToolVoiceOver",
    descriptionKey: "featureToolVoiceOverDesc",
  },
] as const satisfies readonly FeatureDefinition[]

export type Feature = (typeof FEATURES)[number]
export type FeatureKey = Feature["key"]

/** Разрешённое состояние всех флагов установки. */
export type FeatureState = Record<FeatureKey, boolean>

const BY_KEY = new Map<string, Feature>(
  FEATURES.map((feature) => [feature.key, feature]),
)

export function findFeature(key: string): Feature | undefined {
  return BY_KEY.get(key)
}

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && BY_KEY.has(value)
}

/**
 * Флаг инструмента каталога, если он заведён.
 *
 * `"tool" in feature` — не украшение: реестр объявлен через `as const`, поэтому
 * необязательных полей у конкретной записи попросту нет, и обращение к ним без
 * сужения не собирается. Заодно это и не даёт перепутать вид флага.
 */
export function featureForTool(toolKey: string): Feature | undefined {
  return FEATURES.find(
    (feature) => "tool" in feature && feature.tool === toolKey,
  )
}

/** Флаг раздела админки, если он заведён. */
export function featureForNav(href: string): Feature | undefined {
  return FEATURES.find((feature) => "nav" in feature && feature.nav === href)
}

/**
 * Разбор значения переменной окружения.
 *
 * `undefined` означает «не задано» и отдаётся вызывающему, а не подменяется
 * умолчанием: подставить его — работа того, кто знает умолчание установки.
 * Мусор в переменной трактуется как «не задано» намеренно: опечатка в
 * `FEATURE_BILLING=of` не должна тихо гасить деньги на проде.
 */
export function parseFlagValue(raw: string | undefined): boolean | undefined {
  if (raw == null) return undefined
  const value = raw.trim().toLowerCase()
  if (value === "on" || value === "true" || value === "1" || value === "yes") {
    return true
  }
  if (value === "off" || value === "false" || value === "0" || value === "no") {
    return false
  }
  return undefined
}
