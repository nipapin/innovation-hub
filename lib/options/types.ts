import type { NumericConfig } from "./numeric-format"
import type { SocialOptionToken } from "@/lib/social/types"

/**
 * Контракт настроек, которые автор графа отдал клиенту на сайт.
 *
 * Форма свойства задана программой (`PropertyBase` в
 * `fs.manager.tauri/src/NODE_WIN/definitions/types.ts`): флаг `exposedToSite`
 * стоит на самом свойстве, а значение и все его настройки — уровнем ниже, в
 * `controlProps`. Сайт ничего не досочиняет: как контрол настроен в программе,
 * так он и рисуется здесь.
 */

/**
 * Контролы, которым в редакторе доступна галочка «показать на сайте»
 * (`EXPOSABLE_CONTROL_TYPES` в программе). Всё остальное — тяжёлые контролы с
 * объектом в `value`; сайт их не рисует и не отдаёт.
 */
export const EXPOSED_CONTROL_TYPES = [
  "checkbox",
  "slider",
  "timecode",
  "ddm",
  "autocomplete",
  "textedit",
  "valueRange",
  /**
   * Учётка внешнего сервиса (VENDOR_KEYS_CLIENT_REQUESTS, пункт 7). Отдельный
   * контрол, а не `ddm` со списком: варианты знает не граф, а сайт — это
   * учётки ЭТОГО человека по ЭТОМУ сервису, и меняются они на «Моих ключах».
   *
   * В значении лежит МЕТКА учётки, не секрет: иначе ключ оказался бы в
   * `options.json` проекта и в его зеркале на каждой машине.
   */
  "vendorAccount",
] as const

export type ExposedOptionControl = (typeof EXPOSED_CONTROL_TYPES)[number]

export function isExposedControl(raw: unknown): raw is ExposedOptionControl {
  return (
    typeof raw === "string" &&
    (EXPOSED_CONTROL_TYPES as readonly string[]).includes(raw)
  )
}

/**
 * Значение свойства. Массивы обязательны: `valueRange` хранит пару чисел, а
 * `autocomplete` — список строк даже в одиночном режиме.
 */
export type ExposedOptionValue =
  | boolean
  | number
  | string
  | string[]
  | [number, number]

export type ExposedOption = {
  /** Путь до объекта, в котором лежит `value` — то есть до `controlProps`. */
  path: string[]
  /**
   * Ключ ноды, которой принадлежит свойство: путь до списка `properties`.
   *
   * Клиенту ноды не показываются и показываться не будут
   * (docs/PROJECT_OPTIONS_PANEL.md §1), но одно свойство всё-таки зависит от
   * соседнего: список сообществ (`#vkGroups`) имеет смысл только для аккаунта,
   * выбранного тут же, в поле `account` ТОЙ ЖЕ ноды. Без этого ключа контрол
   * цели не отличил бы «свой» аккаунт от аккаунта другой ноды-постера.
   */
  siblingKey: string
  /** `id` свойства в графе. Для человека это не имя — имя в `label`. */
  key: string
  label: string
  /** Подсказка автора графа, приведённая к простому тексту. */
  tooltip: string | null
  control: ExposedOptionControl
  value: ExposedOptionValue

  /** Варианты, которые сайт может показать сам (`ddm`, `autocomplete`). */
  options: string[]
  /**
   * Токены `#…` из списка вариантов: `#tgChannels`, `#vkGroups`, `#folders` и
   * прочие. Их резолвит только программа — у неё есть учётки и локальные папки.
   */
  dynamicOptions: string[]
  /**
   * false — список вариантов знает только машина, менять с сайта нечем.
   * Свойство всё равно показываем: пользователю важно видеть, что параметр
   * существует и какое у него значение.
   */
  editable: boolean

  /** `slider` и `valueRange`: формат, границы, шаг — как их задал автор. */
  numeric: NumericConfig | null
  /** `slider`: показывать подписи границ (`minMaxValueVisible`). */
  showMinMax: boolean
  /** `slider`: рядом со шкалой поле ввода, а не только значение. */
  manualInput: boolean

  /** `ddm`: разрешён свободный ввод помимо списка. */
  freeInput: boolean
  /** `autocomplete`: выбор нескольких значений. */
  multiSelect: boolean
  /** `autocomplete`: только из списка, своё вписать нельзя. */
  optionsOnly: boolean
  /** `autocomplete`: одно и то же значение можно выбрать дважды. */
  allowDuplicates: boolean

  /** `textedit`: подсветка синтаксиса в программе; на сайте — просто текст. */
  language: string | null

  /**
   * `vendorAccount`: слаг сервиса, чьи учётки предлагать. Приходит из графа —
   * сайт его не угадывает. Пустой слаг означает, что автор графа контрол
   * поставил, а сервис не назвал: список тогда пуст, и это видно.
   */
  service: string | null

  /**
   * Аккаунт площадки или цель публикации — если в списке вариантов стоит
   * соответствующий токен (`#vkAccounts`, `#vkGroups`, `#tgChannels`…).
   *
   * Это единственные динамические токены, которые сайт РАСКРЫВАЕТ сам: с
   * переездом аккаунтов площадок в сейф (docs/SOCIAL_POSTING_PLAN.md §4)
   * учётки появились и у него. Остальные (`#folders`, `#typeOfFile`) по-прежнему
   * знает только программа, и такие свойства остаются нередактируемыми.
   */
  social: SocialOptionToken | null
}
