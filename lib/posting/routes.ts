import {
  createProcessQueue,
  type FlowNode,
  type Graph,
  type QueueStep,
} from "@/lib/pipeline/process-queue"
import type { SocialPlatform } from "@/lib/social/types"
import { normalizeIntervalRange } from "./interval"

/**
 * `options.json` → маршруты постинга.
 *
 * Порт `src/NODE_WIN/utils/syncPostSourcesSidecar.ts` из fs.manager.tauri, но с
 * одним принципиальным отличием: программа компилирует маршруты ПРИ
 * СОХРАНЕНИИ графа и кладёт результат в сайдкар `options/postSources.json`, а
 * сайт читает сам граф.
 *
 * Так и должно быть: сайдкар в облако не синхронизируется (он локальный
 * build-артефакт), а источник истины — граф, который в облаке есть всегда.
 * Читать сайдкар значило бы зависеть от того, сохранял ли человек флоу в
 * программе после последней правки настроек на сайте.
 *
 * ── Чего сайт НЕ делает ─────────────────────────────────────────────────────
 *
 * Программа исполняет ВЕСЬ подграф от Finder'а: Finder → Poster → всё, что
 * дальше (copyFile, переносы). Сайт исполняет только публикацию: остальные
 * ноды — работа машины, у неё ffmpeg и локальные пути. Судьба файла после
 * публикации решается свойством `afterPost` самой ноды публикации — тремя
 * операциями каталога, как описано в docs/SOCIAL_POSTING_PLAN.md §7.1.
 */

/** Тип ноды-источника в графе. Совпадает с `FINDER_TYPE` в программе. */
const FINDER_TYPE = "finder"

/**
 * Реестр нод-постеров: pluginId → площадка.
 *
 * Копия `POSTER_PLATFORM` из `src/PROCESSING/autoPost/posters.ts`. Площадка НЕ
 * хранится отдельным полем: граф уже связывает Finder с Poster'ом конкретной
 * площадки, и обе стороны выводят её одинаково — из того, КАКОЙ Poster стоит в
 * пайплайне. Добавление площадки = одна строка здесь и одна там.
 */
const POSTER_PLATFORM: Record<string, SocialPlatform> = {
  autoPostVK: "vk",
  autoPostYT: "youtube",
  autoPostTG: "telegram",
}

export type PostRoute = {
  /** id ноды-источника: ключ маршрута и ссылка на него в задачах. */
  finderId: string
  /** Папка проекта, из которой берём файлы. Пусто — корень проекта. */
  folder: string
  /** Тип файлов (`video`, `photo`…) — как его назвали в графе. */
  searchType: string
  order: string
  /** [min, max] секунд между публикациями. */
  interval: [number, number]
  /** ['Mon', …]; пусто — все дни. */
  daysOfWeek: string[]
  /** [начало, конец] окна суток в секундах от полуночи. */
  window: [number, number]
  /** Что делать с исходником после успешной публикации. */
  afterPost: AfterPost
  /**
   * Сколько уровней вверх от проекта. 0 — своя папка, 1 — соседний проект
   * (первый сегмент пути тогда его имя). Больше единицы сюда не доходит.
   */
  afterPostUp: number
  /**
   * Куда переносить при `move` — путь, ещё С МАСКАМИ. Пусто — переносить
   * некуда, значит «оставить».
   */
  afterPostFolder: string

  platform: SocialPlatform
  /** Имя аккаунта из ноды Poster — по нему ищется аккаунт в сейфе. */
  account: string
  /** Цель: `Profile` либо имя сообщества/канала. */
  target: string
  /** Текст поста, как он напечатан в ноде. Маски ещё не раскрыты. */
  description: string
  /**
   * Текст описания приходит СВЯЗЬЮ от другой ноды, а не из поля.
   *
   * Связь главнее напечатанного (так это работает в программе), но вычислить
   * её значение может только исполнитель графа — то есть машина. Публиковать
   * при этом текстом из поля нельзя: он заведомо не тот, который имел в виду
   * автор. Поэтому такой маршрут не исполняется, и причина называется вслух.
   */
  descriptionLinked: boolean
}

function propValue(node: FlowNode, id: string): unknown {
  const props = node.data?.properties ?? []
  return props.find((prop) => prop.id === id)?.controlProps?.value
}

function firstString(raw: unknown, fallback = ""): string {
  if (Array.isArray(raw)) return String(raw[0] ?? fallback)
  return raw != null && raw !== "" ? String(raw) : fallback
}

/**
 * Значение свойства-папки (`#folders`) → путь внутри проекта.
 *
 * Форма у них одна и та же и у Finder'а, и у Poster'а: чипы-сегменты, где
 * `../` поднимает на уровень. Разбор общий, чтобы «папка-источник» и «куда
 * перенести после публикации» не разъехались в трактовке одного и того же чипа.
 */
function folderFromValue(raw: unknown): string {
  const segments = (
    Array.isArray(raw) ? raw : raw != null && raw !== "" ? [raw] : []
  ).map(String)

  /**
   * Абсолютный путь означает `CustomFolder...` — папку вне проекта, на машине
   * человека. В облаке такой папки нет: там всё лежит внутри проекта. Маршрут
   * с абсолютным путём сайт не исполняет — пустая папка тут была бы враньём.
   */
  if (segments.length > 0 && /^([A-Za-z]:[\\/]|\/)/.test(segments[0])) {
    return segments.join("/")
  }

  const out: string[] = []
  for (const segment of segments) {
    if (segment === "../" || segment === "..") out.pop()
    else if (segment && segment !== "./") out.push(segment)
  }
  return out.join("/")
}

/**
 * Папка-источник Finder'а.
 *
 * Ищем свойство по наличию `#folders` в списке вариантов, а не по id: так же
 * это сделано в программе (`folderProp`), и по той же причине — id у свойства
 * исторически то `folder`, то `autocomplete`.
 */
function finderFolder(node: FlowNode): string {
  const props = node.data?.properties ?? []
  const prop =
    props.find((item) => {
      const options = item.controlProps?.options
      return Array.isArray(options) && options.includes("#folders")
    }) ?? props.find((item) => item.id === "folder" || item.id === "autocomplete")

  return folderFromValue(prop?.controlProps?.value)
}

/**
 * Что делать с исходником после успешной публикации.
 *
 * Живёт у ноды ПУБЛИКАЦИИ, а не у Finder'а, и это правильное место: решение
 * принимается по итогу публикации, а Finder к тому моменту своё дело сделал.
 * Галочки `deleteAfter` у Finder'а больше нет — она убрана вместе с переездом
 * решения, и читать её как запасное значение незачем: графов с ней не осталось.
 */
export type AfterPost = "keep" | "delete" | "move"

/**
 * Действие и путь — ОДНО свойство-автокомплит, а не два.
 *
 * Второе поле («куда перенести») при выбранных «оставить» или «удалить» висело
 * бы пустым и бессмысленным, а условной видимости в редакторе нод нет. Поэтому
 * в одном списке и действия, и токены пути, разделённые заголовками:
 *
 *     ["---Что сделать", "Keep", "Delete after",
 *      "---Или перенести в папку", "#pathPattern", "#folders", …]
 *
 * ПРАВИЛО, которое делает это однозначным: **решает первый чип.** Он либо
 * известное действие — тогда остальные чипы не значат ничего, — либо начало
 * пути, и тогда весь список чипов и есть путь. Без такого правила «Delete
 * after» вперемешку с папкой означали бы что угодно.
 *
 * Цена правила: папка, названная буквально «Keep» или «Delete after», будет
 * принята за действие. Это записано в подсказке свойства; выдумывать разбор
 * кавычек ради такого имени папки дороже, чем его переименовать.
 */
/**
 * Чипы назначения → «на сколько уровней вверх» + сегменты пути.
 *
 * `..` в НАЧАЛЕ означает выход за пределы проекта — в соседний проект того же
 * человека. `..` в середине (`A/../B`) по-прежнему просто поднимается на
 * уровень внутри пути, как в чип-навигации программы: два разных смысла у
 * одного символа развести можно только по позиции.
 */
function splitDestination(chips: string[]): { up: number; segments: string[] } {
  const segments: string[] = []
  let up = 0
  for (const chip of chips) {
    for (const raw of chip.split("/")) {
      const segment = raw.trim()
      if (!segment || segment === ".") continue
      if (segment === "..") {
        if (segments.length > 0) segments.pop()
        else up += 1
        continue
      }
      segments.push(segment)
    }
  }
  return { up, segments }
}

function normalizeAction(raw: unknown): AfterPost | null {
  const value = String(raw ?? "").trim().toLowerCase()
  if (!value) return null
  if (/^(delete|remove|удалить|удалить после)/.test(value)) return "delete"
  if (/^(keep|leave|оставить|ничего)/.test(value)) return "keep"
  return null
}

/**
 * Разбор свойства `afterPost`.
 *
 * Путь возвращается СЫРЫМ, вместе с масками: раскрыть `$clearName` или
 * `$YYYY.$MM` можно только когда известен файл, то есть при постановке задачи
 * (см. `scan.ts`). Здесь мы знаем лишь маршрут.
 *
 * `../` в начале уводит В СОСЕДНИЙ ПРОЕКТ того же человека: `../Другой/IN`.
 * Ровно один уровень, не больше. Выше проектов лежат чужие папки и чужие люди,
 * и «подняться на два» означало бы дать графу дотянуться туда, куда его автору
 * доступа никто не давал. Поэтому два и более `../` — это не «выше», а отказ:
 * файл остаётся на месте.
 *
 * Ещё два случая, когда «перенести» превращается в «оставить»:
 *
 *   • путь пуст — значение по умолчанию, самое частое. Оставить файл на месте
 *     это ровно то, чего ждёт человек, ничего не выбравший;
 *   • путь абсолютный (`Custom Folder...` из соседних нод) — папка на машине
 *     человека, а в облаке файл живёт внутри проекта и вынести его наружу
 *     некуда. Придумывать замену нельзя: файл уехал бы неизвестно куда.
 */
function resolveAfterPost(poster: QueueStep): {
  afterPost: AfterPost
  afterPostUp: number
  afterPostFolder: string
} {
  const keep = { afterPost: "keep" as const, afterPostUp: 0, afterPostFolder: "" }

  const raw = poster.afterPost
  const chips = (Array.isArray(raw) ? raw : raw != null && raw !== "" ? [raw] : [])
    .map(String)
    .filter((chip) => chip.trim() !== "")

  const action = normalizeAction(chips[0])
  if (action !== null) {
    return { afterPost: action, afterPostUp: 0, afterPostFolder: "" }
  }

  if (chips.length > 0 && isLocalOnlyFolder(chips[0].trim())) return keep

  const { up, segments } = splitDestination(chips)
  if (up > 1 || segments.length === 0) return keep

  return {
    afterPost: "move",
    afterPostUp: up,
    afterPostFolder: segments.join("/"),
  }
}

/** Ветка `Poster` в скомпилированном пайплайне Finder'а. */
function findPoster(queue: QueueStep[]): QueueStep | null {
  return (
    queue.find(
      (step) =>
        typeof step.pluginId === "string" &&
        POSTER_PLATFORM[step.pluginId] !== undefined,
    ) ?? null
  )
}

/**
 * Приходит ли значение свойства СВЯЗЬЮ.
 *
 * Спрашиваем у самого компилятора (`import` в шаге), а не обходим рёбра
 * заново: он уже учёл выключенные рёбра и «сплющил» spy-ноды, и вторая
 * реализация того же правила однажды разошлась бы с первой.
 */
function isLinked(step: QueueStep, propertyId: string): boolean {
  const imports = step.import as Record<string, string> | undefined
  return Boolean(imports && imports[propertyId])
}

/**
 * Маршруты постинга проекта.
 *
 * Выключенные ноды-источники пропускаются (`data.disabled`), как в программе.
 * Finder без Poster'а в пайплайне маршрутом не становится: постить его файлы
 * некуда, и молча считать площадку «vk по умолчанию» (как делает легаси-ветка
 * в программе) на сайте нельзя — тут это чужой аккаунт.
 */
export function readPostRoutes(optionsJson: unknown): PostRoute[] {
  const graph = optionsJson as Graph
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const finders = nodes.filter(
    (node) => node.type === FINDER_TYPE && node.data?.disabled !== true,
  )
  if (finders.length === 0) return []

  const routes: PostRoute[] = []
  for (const finder of finders) {
    const queue = createProcessQueue(graph, finder.id)
    const poster = findPoster(queue)
    if (!poster) continue

    const platform = POSTER_PLATFORM[poster.pluginId as string]
    const window = propValue(finder, "window")

    routes.push({
      finderId: finder.id,
      folder: finderFolder(finder),
      searchType: firstString(propValue(finder, "searchType"), "video") || "video",
      order: firstString(propValue(finder, "order"), "by Time") || "by Time",
      interval: normalizeIntervalRange(propValue(finder, "interval")),
      daysOfWeek: Array.isArray(propValue(finder, "daysOfWeek"))
        ? (propValue(finder, "daysOfWeek") as unknown[]).map(String)
        : [],
      window:
        Array.isArray(window) && window.length >= 2
          ? [Number(window[0]), Number(window[1])]
          : [0, 86400],
      ...resolveAfterPost(poster),

      platform,
      // Свойства Poster'а берём из СКОМПИЛИРОВАННОГО шага, а не из ноды: там
      // ключи уже приведены к тем, по которым их читает плагин.
      account: firstString(poster.account),
      target: firstString(poster.target, "Profile") || "Profile",
      description: firstString(poster.description),
      descriptionLinked: isLinked(poster, "description"),
    })
  }
  return routes
}

/** Абсолютный путь у папки-источника — папка на машине, в облаке её нет. */
export function isLocalOnlyFolder(folder: string): boolean {
  return /^([A-Za-z]:[\\/]|\/)/.test(folder)
}
