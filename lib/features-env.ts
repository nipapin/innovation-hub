/**
 * Значения флагов, заданных окружением. Без базы — намеренно.
 *
 * Отдельным файлом от реестра, потому что этот модуль читает `process.env`, а
 * реестр (lib/features.ts) обязан оставаться чистым: его импортируют и
 * клиентские компоненты, где переменных окружения нет вовсе.
 *
 * ПОЧЕМУ КАРТА ВЫПИСАНА РУКАМИ, А НЕ `process.env[feature.env]`.
 * Этот модуль читает `proxy.ts`, а он выполняется в edge-рантайме, где
 * переменные подставляются на сборке по статическому упоминанию в коде.
 * Обращение по вычисляемому ключу там вернёт `undefined` — молча, без ошибки,
 * то есть флаг просто перестанет работать в единственном месте, где от него
 * зависит маршрутизация. Поэтому каждая переменная упомянута буквально, а
 * `npm run features:check` следит, чтобы карта не отстала от реестра.
 */
import {
  FEATURES,
  findFeature,
  parseFlagValue,
  type Feature,
  type FeatureKey,
} from "@/lib/features"

const ENV_VALUES: Record<string, string | undefined> = {
  FEATURE_PUBLIC_CATALOG: process.env.FEATURE_PUBLIC_CATALOG,
  FEATURE_PUBLIC_PAGES: process.env.FEATURE_PUBLIC_PAGES,
  FEATURE_BILLING: process.env.FEATURE_BILLING,
}

/**
 * Умолчание установки: чему равен флаг, о котором никто не принимал решения.
 *
 * На основном сайте не задано — значит всё новое приезжает включённым, как и
 * было до появления выключателей. На упрощённой копии стоит `off` — и тогда
 * инструмент, приехавший туда очередным слиянием, появляется погашенным, а не
 * начинает работать сам по себе. Это и есть способ «не принимать ненужное», не
 * удаляя код и не отклоняя коммиты руками.
 */
export function installationDefault(): boolean {
  return parseFlagValue(process.env.FEATURE_DEFAULT) ?? true
}

/** Значение env-флага. Для `runtime`-флагов не применимо и вернёт умолчание. */
export function envFeatureValue(feature: Feature): boolean {
  if (feature.source !== "env" || !feature.env) return installationDefault()
  return parseFlagValue(ENV_VALUES[feature.env]) ?? installationDefault()
}

/**
 * Включён ли env-флаг. Единственная проверка, доступная в `proxy.ts`.
 *
 * Для `runtime`-флага бросает, а не отдаёт `false`: тихий отказ здесь означал бы
 * погасший раздел без единой строчки в логах, и искать причину пришлось бы
 * по симптомам.
 */
export function isEnvFeatureEnabled(key: FeatureKey): boolean {
  const feature = findFeature(key)
  if (!feature) throw new Error(`Unknown feature: ${key}`)
  if (feature.source !== "env") {
    throw new Error(
      `Feature ${key} is runtime-sourced — read it via lib/features-state.ts.`,
    )
  }
  return envFeatureValue(feature)
}

/** Env-флаги списком — для страницы админки, где они показаны на чтение. */
export function envFeatureState(): Record<string, boolean> {
  const state: Record<string, boolean> = {}
  for (const feature of FEATURES) {
    if (feature.source === "env") state[feature.key] = envFeatureValue(feature)
  }
  return state
}
