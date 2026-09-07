import { cache } from "react"
import {
  FEATURES,
  featureForTool,
  findFeature,
  type FeatureKey,
  type FeatureState,
} from "@/lib/features"
import { envFeatureValue, installationDefault } from "@/lib/features-env"
import { readFeatureOverrides } from "@/lib/repositories/feature-flags"
import { TOOLS } from "@/lib/tools/registry"

/**
 * Разрешённое состояние всех выключателей: окружение + решения из базы.
 *
 * Серверный модуль — тянет `pg`. Клиентским компонентам состояние приходит
 * пропсами или ответом роута, а не импортом: иначе `pg` уехал бы в бандл.
 *
 * `React.cache` схлопывает вызовы внутри одного рендера — layout и страница
 * платят за один запрос, а не за два. Между запросами кэша нет намеренно:
 * погашенный раздел должен исчезать сразу, а не через минуту.
 */
export const getFeatureState = cache(async (): Promise<FeatureState> => {
  const overrides = await readFeatureOverrides()
  const fallback = installationDefault()

  const state = {} as FeatureState
  for (const feature of FEATURES) {
    state[feature.key] =
      feature.source === "env"
        ? envFeatureValue(feature)
        : // Решения нет — берём умолчание установки. Именно здесь работает
          // правило «на копии всё новое приезжает выключенным».
          overrides.get(feature.key) ?? fallback
  }
  return state
})

/** Включён ли флаг. Для одиночной проверки в роуте или на странице. */
export async function isEnabled(key: FeatureKey): Promise<boolean> {
  const state = await getFeatureState()
  return state[key]
}

/**
 * Строки таблицы в форме страницы админки: значение плюс откуда оно взялось.
 *
 * Источник показывается человеку, иначе переключатель, не поддающийся нажатию,
 * выглядит сломанным, а не «заданным в окружении».
 */
export type FeatureRow = {
  key: FeatureKey
  enabled: boolean
  source: "env" | "runtime"
  /** У env-флага — имя переменной, чтобы было понятно, что править на сервере. */
  env: string | null
  /** Есть ли решение человека. `false` — значение взято из умолчания установки. */
  decided: boolean
}

export async function listFeatureRows(): Promise<FeatureRow[]> {
  const overrides = await readFeatureOverrides()
  const state = await getFeatureState()

  return FEATURES.map((feature) => {
    const env = "env" in feature ? feature.env : null
    return {
      key: feature.key,
      enabled: state[feature.key],
      source: feature.source,
      env,
      // У env-флага «решение принято» означает «переменная задана на сервере».
      // Читаем по вычисляемому ключу сознательно: это серверный модуль, а не
      // proxy.ts, здесь `process.env` живой (см. комментарий в features-env.ts).
      decided:
        feature.source === "env"
          ? Boolean(env && process.env[env] != null)
          : overrides.has(feature.key),
    }
  })
}

/** Гейт серверного роута: 404, если раздел на этой установке погашен. */
export async function requireFeature(key: FeatureKey): Promise<boolean> {
  const feature = findFeature(key)
  if (!feature) throw new Error(`Unknown feature: ${key}`)
  return isEnabled(key)
}

/**
 * Ключи инструментов, доступных на этой установке.
 *
 * Инструмент без флага в реестре доступен всегда: заводить выключатель на каждый
 * — обязанность автора инструмента (docs/TOOLS_DEV_GUIDE.md), а не условие
 * работы каталога.
 */
export async function enabledToolKeys(): Promise<string[]> {
  const state = await getFeatureState()
  return TOOLS.filter((tool) => {
    const feature = featureForTool(tool.key)
    return !feature || state[feature.key]
  }).map((tool) => tool.key)
}

/**
 * Адреса разделов админки, погашенных на этой установке.
 *
 * Именно адреса, а не ключи: реестр навигации опознаёт инструмент по `href`, и
 * второй способ ссылаться на тот же раздел означал бы, что однажды они
 * разойдутся. `npm run features:check` следит, чтобы каждый такой адрес
 * существовал в ADMIN_TOOLS.
 */
export async function disabledAdminHrefs(): Promise<string[]> {
  const state = await getFeatureState()
  return FEATURES.filter(
    (feature) => "nav" in feature && !state[feature.key],
  ).map((feature) => (feature as { nav: string }).nav)
}
