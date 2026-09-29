import { exactUnits } from "@/lib/billing/estimate"
import {
  resolvePayUnitForGraph,
  type PayAxes,
  type PayUnitResolution,
} from "@/lib/billing/pay-unit"
import {
  createProcessQueue,
  nodeProps,
  type FlowNode,
  type Graph,
} from "@/lib/pipeline/process-queue"

/**
 * options.json → объект для обработки.
 *
 * Форма повторяет то, что собирает десктоп в
 * src/PROCESSING/findFilesForSingleFolder.ts: processingQueue со списком id,
 * сами шаги по ключам, mainSearch с найденным элементом и description с
 * контекстом проекта.
 *
 * Два отличия, и оба обязательны, потому что здесь оркестратор, а не исполнитель:
 *
 * 1. Никаких ссылок и никаких путей. Presigned URL живёт минуты, а задача может
 *    простоять в очереди часы и переретраиться на следующий день — приедет с
 *    мёртвой ссылкой. Вместо пути в mainSearch лежит идентичность файла, байты
 *    машина получает экшеном presign, когда действительно начинает работу.
 *
 * 2. Почти ничего машинно-локального. programmPath, folderPath, pathAliases и
 *    localFolder десктоп подставляет из СВОИХ настроек: у каждой машины свои
 *    пути к After Effects и ffmpeg. Эти поля заполняет машина.
 *
 *    Исключение — typeOfFile. После синхронизации словарей (docs/SETTINGS_SYNC.md)
 *    он перестал быть свойством машины и стал общей конвенцией, поэтому его
 *    кладёт сюда сайт: иначе две машины развернули бы один searchType по-разному.
 */

/** Словарь `{ "video": ["mp4", "mov"], … }` — то же, что typeOfFile в десктопе. */
export type FileTypeDictionary = Record<string, string[]>

export type TaskSourceEntry = {
  /** id строки project_files; у служебных файлов его нет. */
  fileId: string | null
  /** Ключ в объектном хранилище — стабильная идентичность. */
  s3Key: string
  name: string
  /** Логический путь от корня проекта, например IN или IN/raw. */
  folderPath: string
  sizeBytes: number
  contentHash: string | null
}

/**
 * Источник витка обработки — ОДИН элемент в IN: файл или папка.
 *
 * Для папки перечисление содержимого делается один раз, в момент снятия `-` с
 * имени: до этого папку наполняют, после — она заморожена, поэтому манифест не
 * устаревает. Машина разворачивает папку в scratch целиком и дальше работает как
 * при локальной обработке.
 */
export type TaskSourceFolder = TaskSourceEntry & {
  isFolder: true
  children: TaskSourceEntry[]
}

export type TaskSource = TaskSourceEntry | TaskSourceFolder

export function isFolderSource(source: TaskSource): source is TaskSourceFolder {
  return (source as TaskSourceFolder).isFolder === true
}

/** @deprecated историческое имя; осталось, чтобы не ломать импорты. */
export type TaskSourceFile = TaskSourceEntry

export type TaskPayload = {
  schemaVersion: 1
  processingQueue: string[]
  description: Record<string, unknown>
  /** Шаг-источник: его output — найденный элемент, а не результат исполнения. */
  mainSearch: Record<string, unknown> & { output: TaskSource[] }
  /** Остальные шаги очереди лежат по своим id. */
  [stepId: string]: unknown
}

export type BuildTaskFailure =
  | "invalid-options"
  | "no-main-search"
  | "no-search-type"
  | "unknown-search-type"
  | "no-search-exts"

export type BuildTaskOutcome =
  | {
      ok: true
      payload: TaskPayload
      searchExts: string[]
      /**
       * Чем тарифицируется этот виток. Сборку НЕ останавливает: пока гейт денег
       * выключен, проект без осей обрабатывается как раньше, а неразрешённая
       * единица становится видимой проблемой, а не тихой остановкой конвейера.
       * Отказ по ней включается вместе с допуском (П13).
       */
      payUnit: PayUnitResolution
    }
  | { ok: false; reason: BuildTaskFailure }

/** Расширения — без ведущей точки и в нижнем регистре. */
function normalizeExts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((e) => String(e).trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean)
}

/**
 * Типы файлов из узла mainSearch.
 *
 * Из узла всегда выходит массив, даже когда элемент в нём один:
 * `searchType: ["video"]`. Раньше здесь стояла проверка `typeof === "string"`,
 * и по ней отсекался любой граф из редактора — `no-search-type`, файл залит,
 * событие в журнале есть, а задача не создаётся никогда. Одиночную строку
 * принимаем на всякий случай, но нормальная форма — массив.
 */
function normalizeSearchTypes(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : [raw]
  return values
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
}

/**
 * Тип поиска «папками»: элемент витка — папка верхнего уровня в IN, целиком, с
 * любым содержимым.
 *
 * Это не тип файлов, а тип данных (домен `dataType` в automation_settings), и в
 * словаре типов файлов его нет и быть не должно. Поэтому разворачивать его в
 * расширения нельзя: раньше он шёл общей дорогой, получал пустой список и
 * отсекал проект причиной `unknown-search-type` — граф, нарисованный под
 * папки, онлайн не обрабатывался никогда.
 */
export const FOLDER_SEARCH_TYPE = "folders"

export type SearchExtsOutcome =
  | {
      ok: true
      /**
       * Граф ищет папки, а не файлы. Расширения тогда не проверяются вовсе:
       * берётся любая непустая папка, а одиночные файлы в IN — никогда.
       */
      foldersOnly: boolean
      searchExts: string[]
      /** Список типов из узла; null — типа в графе нет. */
      searchType: string[] | null
      /** Словарь, которым разворачивался тип: он же уезжает в description. */
      fileTypes: FileTypeDictionary
    }
  | { ok: false; reason: BuildTaskFailure }

/**
 * Снимок словаря типов из самого графа.
 *
 * Программа пишет его соседним ключом рядом с nodes/edges при каждом сохранении
 * (PIPELINE_BACKEND_REQUESTS.md §1). Снимок, а не ссылка на общий словарь:
 * задача обязана быть воспроизводимой тем графом, каким её нарисовали, иначе
 * правка настройки молча меняет поведение старых проектов.
 */
export function readFileTypesSnapshot(
  optionsJson: unknown,
): FileTypeDictionary | null {
  if (!optionsJson || typeof optionsJson !== "object") return null
  const raw = (optionsJson as Record<string, unknown>).fileTypes
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null

  const out: FileTypeDictionary = {}
  for (const [name, exts] of Object.entries(raw as Record<string, unknown>)) {
    const list = normalizeExts(exts)
    if (list.length > 0) out[name] = list
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Какие типы файлов ищет граф.
 *
 * Отдельно от buildTaskPayload, чтобы сканер отсекал неподходящие файлы до
 * сборки очереди: на проект приходит пачка событий, а обход графа для файла,
 * который всё равно не подойдёт, — работа впустую.
 *
 * Порядок источников расширений:
 *
 * 1. `searchExts` прямо в узле — если программа его проставила, доверяем как есть;
 * 2. `searchType` + снимок `fileTypes` из того же options.json — основной путь;
 * 3. `searchType` + синхронизированный словарь (`fallback`) — для проектов,
 *    сохранённых до появления снимка. Без него у них не было бы вообще ничего,
 *    и каждый пришлось бы открывать и пересохранять руками.
 *
 * Словарь нужен целиком, а не только расширения одного типа: граф уходит в другие
 * папки за аудио, текстом, скриптами, и плагины читают весь `typeOfFile`.
 */
export function readSearchExts(
  optionsJson: unknown,
  fallback: FileTypeDictionary = {},
): SearchExtsOutcome {
  if (!optionsJson || typeof optionsJson !== "object" || Array.isArray(optionsJson)) {
    return { ok: false, reason: "invalid-options" }
  }

  const nodes = (optionsJson as Graph).nodes
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { ok: false, reason: "invalid-options" }
  }

  const mainSearchNode = nodes.find((n) => n.id.toLowerCase() === "mainsearch")
  // Выключенный mainSearch — это пауза обработки на уровне графа: источника нет,
  // значит и элементов нет.
  if (!mainSearchNode || mainSearchNode.data?.disabled === true) {
    return { ok: false, reason: "no-main-search" }
  }

  const snapshot = readFileTypesSnapshot(optionsJson)
  // Снимок главнее: он описывает граф на момент сохранения. Общий словарь
  // подмешиваем под него — так у проекта появляются типы, которых в снимке нет,
  // но и снимок не переопределяется задним числом.
  const fileTypes: FileTypeDictionary = { ...fallback, ...(snapshot ?? {}) }

  const props = nodeProps(mainSearchNode)

  // В description уезжает список — в той же форме, в какой значение выходит из
  // узла. Пустой список это null: «типа нет», а не «выбран пустой».
  const searchTypes = normalizeSearchTypes(props.searchType)
  const searchType = searchTypes.length > 0 ? searchTypes : null

  // Раньше явных расширений: у поиска папками их нет по смыслу, и случайно
  // оставшийся в узле `searchExts` не должен превращать его обратно в поиск файлов.
  if (searchTypes.some((type) => type.toLowerCase() === FOLDER_SEARCH_TYPE)) {
    return { ok: true, foldersOnly: true, searchExts: [], searchType, fileTypes }
  }

  const explicit = normalizeExts(props.searchExts)
  if (explicit.length > 0) {
    return { ok: true, foldersOnly: false, searchExts: explicit, searchType, fileTypes }
  }

  if (searchTypes.length === 0) {
    return { ok: false, reason: "no-search-type" }
  }

  // Несколько типов — объединение расширений: граф ищет любой из выбранных.
  const searchExts = [
    ...new Set(searchTypes.flatMap((type) => normalizeExts(fileTypes[type]))),
  ]
  if (searchExts.length === 0) {
    // Тип есть, а расширений к нему нет ни в снимке, ни в общем словаре:
    // либо тип переименовали, либо из него убрали все расширения.
    return {
      ok: false,
      reason:
        Object.keys(fileTypes).length === 0
          ? "no-search-exts"
          : "unknown-search-type",
    }
  }
  return { ok: true, foldersOnly: false, searchExts, searchType, fileTypes }
}

/**
 * Контекст проекта, который получает каждый шаг — порт getDesription.ts.
 *
 * Узел description необязателен: без него обработка возможна, просто в контексте
 * не будет ни контакта, ни комментария автора.
 *
 * Значение `contact` из графа кладётся сюда как `projectContact`, а не как
 * `contact`: онлайн его перекрывает заливщик (см. buildTaskPayload). Терять его
 * при этом нельзя — граф мог заполнить владелец осознанно, и это единственное,
 * что останется, если атрибуции по элементу нет.
 */
function buildDescription(nodes: FlowNode[]): Record<string, unknown> {
  const descriptionNode = nodes.find((n) => n.id.toLowerCase() === "description")

  const prop = (id: string): unknown =>
    descriptionNode?.data?.properties?.find((p) => p.id.toLowerCase() === id)
      ?.controlProps?.value

  const projectContact = prop("contact")

  // Оси тарификации объявляет автор графа — он один знает, что получится на
  // выходе. Значение может приехать массивом: `ddm` с multiSelect отдаёт список,
  // и в старых графах свойство могло быть настроено иначе.
  const first = (raw: unknown): unknown =>
    Array.isArray(raw) ? raw[0] : raw

  // Ноды раскраски main/helpers — это не шаги обработки, в тип автоматизации
  // они не входят.
  const excluded = new Set(["main", "helpers"])
  const automationType = [
    ...new Set(
      nodes
        .filter((n) => !excluded.has(String(n.data?.colorType ?? "")))
        .map((n) => n.data?.pluginId)
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  return {
    projectContact,
    payBase: first(prop("paybase")),
    payMeter: first(prop("paymeter")),
    automationType,
    discription: descriptionNode?.data?.comment,
  }
}

/** Кто отвечает за виток — имя уедет в contact, email остаётся идентичностью. */
export type TaskContact = {
  name: string
  email: string
}

/** Откуда взялось значение contact — иначе имя владельца не отличить от находки. */
export type ContactSource = "uploader" | "graph" | "owner" | "none"

function normalizeContactName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function buildTaskPayload(input: {
  optionsJson: unknown
  /**
   * Идентификатор задачи, назначенный сайтом. Уезжает в `description.dbItemId`,
   * машина использует его вместо своего (`db_register_found`), и строка архива
   * получает `itemId = tasks.id`.
   *
   * Поэтому id генерируется ДО сборки payload, а не внутри вставки: иначе связать
   * задачу с её обработкой можно было бы только гаданием «проект + имя + время».
   * Разбор — docs/PIPELINE.md §15,
   * fs.manager.tauri/ideasAndTest/SITE_STATS_LINK_PLAN.md.
   */
  taskId: string
  projectId: string
  projectName: string
  ownerEmail: string
  /** Один элемент папки IN: файл или папка с манифестом содержимого. */
  source: TaskSource
  /** Словарь типов, которым разворачивался searchType — уедет в description. */
  fileTypes?: FileTypeDictionary
  /** ISO-время сборки: на десктопе это findTime, метка прогона. */
  collectedAt: string
  /**
   * Кто принёс элемент. Для файла — заливщик, для папки — тот, кто снял `-` и
   * запустил виток (lib/pipeline/scan.ts). null — атрибуции по элементу нет.
   */
  contact?: TaskContact | null
  /** Владелец проекта — последнее звено отката. */
  ownerContact?: TaskContact | null
  /** Все заливщики папки, если их было больше одного. */
  uploaders?: { name: string; email: string; files: number }[]
  /**
   * Оси тарификации из настройки проекта — запасной путь для графов, в которых
   * свойства ещё нет. Граф главнее (lib/billing/pay-unit.ts).
   */
  projectPayAxes?: PayAxes
  onWarn?: (message: string) => void
}): BuildTaskOutcome {
  const root = input.optionsJson
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return { ok: false, reason: "invalid-options" }
  }

  const graph = root as Graph
  const nodes = graph.nodes ?? []

  const exts = readSearchExts(graph, input.fileTypes)
  if (!exts.ok) return { ok: false, reason: exts.reason }
  const searchExts = exts.searchExts

  const steps = createProcessQueue(graph, "mainSearch", input.onWarn)
  if (steps.length === 0) {
    return { ok: false, reason: "no-main-search" }
  }

  const source = input.source
  const isFolder = isFolderSource(source)

  const description = buildDescription(nodes)

  // Приоритет: заливщик → вписанное в графе → владелец. Заливщик перекрывает
  // граф безусловно: локально там указывают не конкретного пользователя сайта, а
  // заглушку, и оставить её означало бы подписать чужой работой автора графа.
  const graphContact = normalizeContactName(description.projectContact)
  const resolved: { name: string; email: string | null; source: ContactSource } =
    input.contact
      ? { name: input.contact.name, email: input.contact.email, source: "uploader" }
      : graphContact
        ? { name: graphContact, email: null, source: "graph" }
        : input.ownerContact
          ? {
              name: input.ownerContact.name,
              email: input.ownerContact.email,
              source: "owner",
            }
          : { name: "", email: null, source: "none" }

  // contact остаётся простой строкой: его в этом виде читает десктоп и пишет в
  // processing_stats. Машинная идентичность живёт отдельным полем.
  description.contact = resolved.source === "none" ? undefined : resolved.name
  description.contactEmail = resolved.email ?? undefined
  description.contactSource = resolved.source
  if (input.uploaders && input.uploaders.length > 0) {
    description.uploaders = input.uploaders
  }

  // Сквозной идентификатор: поле уже существует в объекте обработки и означает
  // ровно это — «id этой работы в базе». Машина читает его на входе и кладёт в
  // строку архива, поэтому processing_stats.item_id = tasks.id.
  description.dbItemId = input.taskId
  description.projectId = input.projectId
  description.projectName = input.projectName
  description.ownerEmail = input.ownerEmail
  // Два поля на одно значение, и это не дубль по недосмотру. `findTime` на
  // десктопе — не таймстемп, а КОМПОНЕНТ ИМЕНИ: маска `$findTime` подставляет
  // `DD.MM-HH.mm`, и сырая ISO-строка приезжала в имя результата вместе с
  // двоеточиями, на которых потом падала заливка в OUT. Имя оставляем, потому что
  // по нему уже работают машины, а рядом кладём `collectedAt` — то же время, но с
  // именем, которое читается однозначно (docs/STORAGE_CLIENT_REQUESTS.md §14.2).
  description.findTime = input.collectedAt
  description.collectedAt = input.collectedAt
  description.infoText = `${input.ownerEmail}/${input.projectName}`
  description.curItem = source.name
  description.isFolder = isFolder
  description.folderPath = source.folderPath
  // Для папки размер — сумма по содержимому: у самой папки в хранилище его нет.
  description.size = isFolder
    ? source.children.reduce((sum, child) => sum + child.sizeBytes, 0)
    : source.sizeBytes
  // Общая конвенция, а не свойство машины — см. шапку файла.
  description.typeOfFile = exts.fileTypes
  description.searchType = exts.searchType

  // Чем тарифицируется виток. Сверяется с типом входа прямо здесь: «считаем
  // хронометраж исходника, а ищем картинки» — ошибка настройки, и увидеть её
  // надо до обработки, а не по пустому srcSec после неё.
  const payUnit = resolvePayUnitForGraph({
    graph: { base: description.payBase, meter: description.payMeter },
    project: input.projectPayAxes ?? { base: null, meter: null },
    searchType: exts.searchType?.[0] ?? null,
  })
  if (payUnit.ok) {
    description.payBase = payUnit.base
    description.payMeter = payUnit.meter
    // Количество исходников считаем СЕЙЧАС и кладём в задачу. После обработки
    // пересчитать его нечем: postProcess уносит файлы из IN, и папки на месте
    // уже нет, а списание идёт часом позже, по строке архива.
    const units = exactUnits(payUnit.base, payUnit.meter, {
      isFolder,
      sizeBytes: isFolder ? 0 : source.sizeBytes,
      children: isFolder ? source.children : undefined,
    })
    if (units != null) description.sourceUnits = units
  } else {
    // Пустые поля честнее унаследованных: машина не должна видеть оси, которые
    // сайт не признал.
    delete description.payBase
    delete description.payMeter
  }

  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    processingQueue: steps.map((s) => s.id),
    description,
  }
  for (const step of steps) {
    payload[step.id] = step
  }

  // Шаг mainSearch остаётся со своими свойствами, но его output — найденный
  // элемент: на десктопе его подставляет поиск по папке, здесь это уже известно.
  const mainStep = (payload.mainSearch ?? {}) as Record<string, unknown>
  payload.mainSearch = { ...mainStep, output: [source] }

  return { ok: true, payload: payload as TaskPayload, searchExts, payUnit }
}

/** Подходит ли файл под типы, которые ищет граф. */
export function matchesSearchExts(name: string, exts: string[]): boolean {
  const dot = name.lastIndexOf(".")
  if (dot < 0) return false
  const ext = name.slice(dot + 1).toLowerCase()
  return exts.includes(ext)
}
