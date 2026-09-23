/**
 * Временные маски в имени папки элемента — шесть подстановок и `$random`.
 *
 * ⚠️ ЭТО ПОЛОВИНА КОНТРАКТА. Вторая половина — движок масок в программе
 * (`fs.manager.tauri`, `src/Utils/masks.ts`), и он завязан на Node, поэтому
 * переиспользовать его здесь нечем: подстановки написаны заново. Правила —
 * docs/TOOLS_FOLDER_ASSEMBLY_PLAN.md §7.1, и менять что-то здесь = менять
 * контракт.
 *
 * Поддержаны ТОЛЬКО те маски, которые не зависят от обрабатываемого файла:
 * имя папки придумывается до того, как в ней что-либо появилось, и остальные
 * маски движка (имя исходника, его разрешение, длительность) подставить нечем.
 *
 * Чистый модуль: ни React, ни обращений к хранилищу — те же правила
 * понадобятся программе, если папку начнут собирать и там.
 */

/**
 * Длина `$random` без числа.
 *
 * В программе он сделан на `nanoid`, у которого умолчание 21 знак, но здесь
 * закреплено 10 — так решено в контракте. Точный алфавит сайту повторять не
 * нужно (значение всё равно случайное), а вот длина обязана совпадать: имена
 * элементов читают люди, и «10 знаков у меня и 21 у них» замечают сразу.
 */
export const RANDOM_DEFAULT_LENGTH = 10

/** Алфавит `nanoid` — url-safe, чтобы имя не требовало экранирования в ключе. */
const RANDOM_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"

/**
 * Источник случайности. Отдельным параметром, потому что иначе имя папки
 * невозможно проверить: у функции с внутренним `crypto` нет предсказуемого
 * выхода, и `npm run element:check` не смог бы сказать о ней ничего.
 */
export type RandomSource = (length: number) => string

/** Случайная строка из алфавита `nanoid`. Работает и в браузере, и в Node. */
export function defaultRandom(length: number): string {
  const bytes = new Uint8Array(length)
  const webCrypto =
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.getRandomValues === "function"
      ? globalThis.crypto
      : null

  if (webCrypto) {
    webCrypto.getRandomValues(bytes)
  } else {
    // Ветка на крайний случай: значение всё равно случайное, а уникальность имени
    // обеспечивает не оно, а суффикс « (2)» при занятом имени.
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  let out = ""
  for (let i = 0; i < length; i += 1) {
    // `& 63` — ровно длина алфавита, поэтому распределение остаётся равномерным.
    out += RANDOM_ALPHABET[bytes[i]! & 63]
  }
  return out
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0")
}

/**
 * Значения временных масок.
 *
 * Время берём ЛОКАЛЬНОЕ, а не UTC, и это решение контракта: имя папки читает
 * человек, и «вчера» у него своё. Поэтому здесь `getMonth`, а не
 * `getUTCMonth` — разойдись это с программой, и одна и та же папка называлась
 * бы по-разному в зависимости от того, кто её создал.
 */
function timeValues(now: Date): Record<string, string> {
  return {
    YYYY: pad(now.getFullYear(), 4),
    // Регистр значим: `MM` — месяц, `mm` — минуты. Ровно поэтому подстановка
    // ниже идёт одним проходом с учётом регистра, а не цепочкой `replace`.
    MM: pad(now.getMonth() + 1),
    DD: pad(now.getDate()),
    HH: pad(now.getHours()),
    mm: pad(now.getMinutes()),
    ss: pad(now.getSeconds()),
  }
}

/**
 * Маски в шаблоне: `$random(N)` / `$random()` / `$random` и шесть временных.
 *
 * `$random` стоит первым в чередовании намеренно: иначе его хвост мог бы
 * попасть под другую ветку разбора. Регистр учитывается — `$mm` и `$MM` это
 * разные маски, и регуляркой без флага `i` они не путаются.
 */
const MASK_RE = /\$random(?:\((\d*)\))?|\$(YYYY|MM|DD|HH|mm|ss)/g

/**
 * Подставляет маски в шаблон имени папки элемента.
 *
 * Неизвестная маска остаётся как есть: шаблон правит человек в графе, и молча
 * съеденный `$width` выглядел бы как «программа потеряла часть имени». Пустой
 * шаблон отдаём пустым — чем его заменить, знает вызывающий (`data.label` ноды),
 * а этот модуль о нодах ничего не знает.
 */
export function applyNameMasks(
  template: string,
  options: { now?: Date; random?: RandomSource } = {},
): string {
  const now = options.now ?? new Date()
  const random = options.random ?? defaultRandom
  const values = timeValues(now)

  return template.replace(MASK_RE, (match, randomLength, timeKey) => {
    if (typeof timeKey === "string") return values[timeKey] ?? match

    // `$random` без числа и `$random()` — оба про умолчание, а не «ноль знаков»:
    // пустое имя папки не имя. Явный `$random(0)` тоже приводим к умолчанию по
    // той же причине.
    const length = Number.parseInt(String(randomLength ?? ""), 10)
    return random(Number.isFinite(length) && length > 0 ? length : RANDOM_DEFAULT_LENGTH)
  })
}
