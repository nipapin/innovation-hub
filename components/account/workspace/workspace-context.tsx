"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

import {
  tf,
  useI18n,
  type Dictionary,
  type Lang,
} from "@/components/account/i18n"
import type { ExposedOptionChange } from "@/lib/options/apply"
import type { ExposedOption } from "@/lib/options/types"
import type { SkippedOption } from "@/lib/options/extract"
import {
  UploadCancelled,
  isUploadCancelled,
  uploadProjectFileDirect,
} from "@/lib/project-direct-upload"
import {
  parseSiteFormBody,
  type SiteForm,
  type SiteFormError,
} from "@/lib/tools/element/site-form"
import { readUiPref, writeUiPref } from "@/lib/ui-prefs"
import { looksLikeElement } from "./element/tree"
import {
  TRASH_RETENTION_DAYS,
  findChildByName,
  folderPathOf,
  freeNameIn,
  itemsAtPath,
  mapProject,
  pathToFolderPath,
  resolveFolderPathByName,
  resolvePath,
  resolveRevealTarget,
  siblingFiles,
} from "./format"
import { mapTrashItem, type TrashItem, type TrashSort } from "./trash-model"
import { projectCapabilities } from "./access"
import { CABINET_SOURCE } from "./source"
import type {
  ArchiveTarget,
  BottomTab,
  ChatMessage,
  Clipboard,
  ClipboardOp,
  ContextMenuKind,
  ContextMenuState,
  Density,
  DriveFile,
  InItemStatus,
  Project,
  UploadConflict,
  UploadConflictAction,
  UploadProgress,
  UploadTarget,
  ViewMode,
  WorkspaceCapabilities,
  WorkspaceSource,
} from "./types"

const DENSITY_KEY = "ffworks-ws-density"
const CHAT_POLL_INTERVAL_MS = 6000
const VIEW_KEY = "ffworks-ws-view"
const BOTTOM_TAB_KEY = "ui-ws-bottom-tab"
const DELTA_INTERVAL_MS = 4000

/**
 * Раздел списка проектов. Живёт в URL (`?tab=…`), потому что в боковом меню
 * это обычные ссылки, а не состояние страницы.
 *
 * Расшаренные — не раздел, а группа внутри «Проектов» (project-groups.tsx).
 * Старые ссылки `?tab=shared` приводят туда же: неизвестный раздел — «Проекты».
 */
export type ProjectTab = "projects" | "tools" | "archive" | "trash"

const PROJECT_TABS: ProjectTab[] = ["projects", "tools", "archive", "trash"]

function parseTab(raw: string | null): ProjectTab {
  return PROJECT_TABS.includes(raw as ProjectTab)
    ? (raw as ProjectTab)
    : "projects"
}

/**
 * Отказ «обработать заново» человеческими словами.
 *
 * Сервер отдаёт код, а не текст: подпись выбирает интерфейс, и разбирать строку
 * ради неё означало бы расхождение языков. Причины сборки задачи (`no-options`,
 * `unknown-search-type` и прочие пятнадцать) сводим в одну фразу — это кухня
 * настроек проекта, и человеку в кабинете от «неизвестный searchType» ни тепло
 * ни холодно. Кроме денег: про них сказать надо прямо.
 */
function reprocessMessage(reason: string | undefined, t: Dictionary): string {
  if (reason === "stopped") return t.reprocessStopped
  if (reason === "not-watched") return t.reprocessNotWatched
  if (reason === "not-in-in") return t.reprocessNotInIn
  if (reason === "no-source") return t.reprocessNoSource
  if (reason === "live-task") return t.reprocessLive
  if (reason === "insufficient-funds") return t.reprocessNoFunds
  return t.reprocessNoTask
}

/** Событие «список проектов изменился» — по нему шелл обновляет счётчики. */
export const PROJECTS_CHANGED_EVENT = "ffworks:projects-changed"

function notifyProjectsChanged() {
  window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT))
}

/**
 * Событие «чат прочитан» — по нему шелл пересчитывает значок раздела «Чаты».
 *
 * Нужно потому, что значок живёт выше страницы и опрашивает сервер по таймеру:
 * без сигнала число над меню ещё полминуты показывало бы сообщения, которые
 * человек читает прямо сейчас.
 */
export const CHAT_READ_EVENT = "ffworks:chat-read"

type PromptRequest = {
  title: string
  label: string
  initial: string
  confirmLabel: string
  onSubmit: (value: string) => void
}

type ConfirmRequest = {
  title: string
  description?: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
}

type WorkspaceValue = {
  t: Dictionary
  lang: Lang

  /**
   * Откуда пришли данные и что разрешено. Компоненты смотрят сюда, чтобы
   * решить, рисовать ли кнопку («создать проект» есть в кабинете и нет в
   * админке) и с какой стороны показывать сообщения чата.
   */
  source: WorkspaceSource

  // проекты
  projects: Project[]
  /** Плоский список проектов текущего раздела с учётом поиска. */
  visibleProjects: Project[]
  /** Сколько проектов в каждом разделе — для чисел в боковом меню. */
  counts: Record<ProjectTab, number>
  projectTab: ProjectTab
  setProjectTab: (tab: ProjectTab) => void
  loadingProjects: boolean
  query: string
  setQuery: (v: string) => void
  selectedId: string | null
  selected: Project | null
  /**
   * Права на выбранный проект: потолок зоны, срезанный ролью в расшаренном
   * проекте. Компоненты берут их отсюда, а не из `source.can`, иначе читателю
   * достанутся кнопки владельца.
   */
  can: WorkspaceCapabilities
  /** То же для произвольного проекта — контекстное меню строится по строке списка. */
  capabilitiesFor: (project: Project | null) => WorkspaceCapabilities
  selectProject: (id: string) => void
  clearSelection: () => void
  creating: boolean
  createProject: () => void
  renameProject: (project: Project) => void
  patchProject: (id: string, body: Record<string, unknown>) => Promise<void>
  setArchived: (project: Project, archived: boolean) => void
  deleteProject: (id: string) => void
  /**
   * Перечитать список проектов. Нужна тем, кто добавляет проекты в обход
   * рабочего места — например выдаче тестового периода: копии появляются на
   * сервере, и без перечитки человек смотрит на пустой кабинет и думает, что
   * ничего не произошло.
   */
  reloadProjects: () => Promise<void>

  // хранилище
  rootFiles: DriveFile[]
  driveAvailable: boolean
  loadingFiles: boolean
  /**
   * Перечитать список файлов. Возвращает промис, а не `void`: форма элемента
   * после переименования обязана ДОЖДАТЬСЯ нового списка — иначе она рисует
   * старый порядок поверх уже переставленных файлов.
   */
  refreshDrive: () => Promise<void>
  inFolder: DriveFile | null
  outFolder: DriveFile | null
  /**
   * Была ли по элементу папки IN задача и чем она кончилась. `null` — задачи не
   * было, элемент ещё поедет.
   *
   * Спрашивается по элементу, а не хранится в самом `DriveFile`, потому что
   * дерево приходит из каталога, а это знание — из очереди: сшивать их в один
   * узел значило бы дать файловому дереву поле, которого у файла нет.
   */
  inStatusOf: (file: DriveFile) => InItemStatus | null

  // параметры обработки, открытые клиенту (exposedToSite в options.json)
  exposedOptions: ExposedOption[]
  skippedOptions: SkippedOption[]
  /**
   * Типы файлов, которые знает обработка: снимок из графа поверх общего
   * словаря. Нужен контролу выбора файла — он проверяет расширение до заливки,
   * чтобы человек узнал о неподдерживаемом типе сразу, а не по молчащей
   * обработке.
   */
  fileTypes: Record<string, string[]>
  /**
   * Сохранение правок. null — источник не даёт адреса (админский вид):
   * панель тогда только показывает значения.
   */
  saveExposedOptions:
    | ((changes: ExposedOptionChange[]) => Promise<ExposedOption[]>)
    | null

  // навигация по дереву (полный режим)
  path: DriveFile[]
  currentItems: DriveFile[]
  currentTarget: UploadTarget
  openFolder: (f: DriveFile) => void
  goToCrumb: (index: number) => void
  goToPath: (nodes: DriveFile[]) => void
  /**
   * Куда просили перейти снаружи — цепочка папок от корня проекта.
   *
   * Отдельно от `path`, потому что общего пути на весь экран не существует: в
   * простом режиме у панелей IN и OUT свои локальные пути, на мобильном —
   * выбранная вкладка папки плюс путь внутри неё, и только в полном режиме путь
   * один. Контекст поэтому не приказывает, а сообщает: «просили открыть вот
   * это», а каждый вид укладывает цепочку в своё состояние.
   *
   * Новый объект на каждый переход — по нему виды и понимают, что просьба
   * новая, даже если папка та же.
   */
  revealPath: DriveFile[] | null
  /**
   * Файл из той же просьбы: его строка не только выделяется, но и прокручивается
   * в видимую часть списка. Рисуют файлы все виды сразу (мобильная разметка
   * висит в DOM рядом с десктопной), поэтому это признак «покажи», а не команда
   * прокрутки: сработает та копия строки, которая видна.
   */
  revealFileId: string | null
  /** «Показали» — просьба исполнена, второй раз к файлу не прыгаем. */
  consumeReveal: () => void

  // выделение файлов
  /** Всё выделенное; последний элемент — тот, что показан в превью. */
  selection: DriveFile[]
  /** Последний выделенный — источник для панели превью. */
  selectedFile: DriveFile | null
  isSelected: (id: string) => boolean
  /** Клик по элементу: с Cmd/Ctrl добавляет к выделению, без — заменяет. */
  selectFile: (file: DriveFile, additive?: boolean) => void
  /** Shift-клик: диапазон от опорного элемента до указанного включительно. */
  selectRange: (list: DriveFile[], file: DriveFile) => void
  setSelectedFile: (f: DriveFile | null) => void
  clearFileSelection: () => void

  // режимы отображения
  density: Density
  setDensity: (d: Density) => void
  view: ViewMode
  setView: (v: ViewMode) => void
  bottomTab: BottomTab
  /** `remember: false` — закладку поставила ссылка, а не человек: не запоминаем. */
  setBottomTab: (tab: BottomTab, remember?: boolean) => void

  // окно быстрого просмотра
  /** Открыто ли модальное окно превью. Показывает `selectedFile`. */
  previewOpen: boolean
  /** Открыть окно: без аргумента — для уже выделенного файла. */
  openPreview: (file?: DriveFile) => void
  closePreview: () => void
  /** Файлы той же папки — по ним листает окно превью (стрелками). */
  previewSiblings: DriveFile[]
  /** Перелистнуть превью на соседний файл: -1 — назад, +1 — вперёд. */
  stepPreview: (delta: number) => void

  // операции с файлами
  uploading: boolean
  /**
   * Что сейчас едет наверх: папка, файл, проценты. `null` — заливки нет.
   * Область файлов показывает по этому кольцо в той папке, куда льют.
   */
  uploadProgress: UploadProgress | null
  /**
   * Оборвать текущую пачку. Недокачанный файл в папке не появится, уже
   * доехавшие остаются: отменяют то, что идёт, а не то, что случилось.
   */
  cancelUpload: () => void
  createFolder: (target: UploadTarget) => void
  renameItem: (file: DriveFile) => void
  /**
   * Отправить элемент папки IN на обработку ещё раз.
   *
   * `canReprocess` отвечает, есть ли смысл показывать пункт: адрес у источника
   * может отсутствовать (админский вид), а сам элемент — лежать не верхним
   * уровнем IN, где конвейер его не увидит.
   */
  canReprocess: (file: DriveFile) => boolean
  reprocessItem: (file: DriveFile) => void
  deleteItem: (file: DriveFile) => void
  /** Удаление всего выделения одним подтверждением. */
  deleteItems: (files: DriveFile[]) => void
  downloadItem: (file: DriveFile) => void
  /**
   * Папка архивом. Диалог сначала показывает состав частей: папка проекта
   * может не уместиться в один архив, и молча отдавать первую часть нельзя.
   */
  archiveTarget: ArchiveTarget | null
  openArchiveDialog: (target: ArchiveTarget) => void
  closeArchiveDialog: () => void
  uploadFiles: (list: FileList | File[], target: UploadTarget) => Promise<void>
  /**
   * Вопрос про занятое имя: что делать с этим файлом. `null` — вопроса нет.
   * Диалог отвечает через `decide`, и до ответа заливка стоит.
   */
  conflict: UploadConflict | null
  triggerUpload: (target: UploadTarget) => void
  createTextFile: (target: UploadTarget) => void
  triggerFolderUpload: (target: UploadTarget) => void
  shareProject: (project: Project) => void
  shareTarget: Project | null
  /**
   * Передача проекта другому человеку. Сам диалог рисует зона: список людей, из
   * которых выбирают нового владельца, есть только у админского инструмента, и
   * тащить его в общий компонент значило бы дать кабинету знание о том, чего он
   * не делает.
   */
  transferProject: (project: Project) => void
  transferTarget: Project | null
  closeTransferDialog: () => void
  /** Перенос состоялся: список проектов перечитывается, выбор сбрасывается. */
  afterTransfer: () => Promise<void>
  closeShareDialog: () => void
  restoreProject: (project: Project) => void
  /** Стереть проект из корзины навсегда — вместе с файлами и объектами в R2. */
  purgeProjectForever: (project: Project) => void

  // корзина
  /**
   * Всё удалённое по всем проектам сразу. Список всегда полный, даже когда
   * человек смотрит на один проект: сузить его — дело показа, а колонке слева
   * всё равно нужно знать, у каких проектов вообще есть что-то в корзине.
   */
  trashItems: TrashItem[]
  loadingTrash: boolean
  /**
   * Живые проекты, у которых что-то лежит в корзине. В колонке это такие же
   * строки, как удалённые проекты: разница лишь в том, что в корзине не сам
   * проект, а часть его файлов, и восстанавливать целиком нечего.
   */
  trashProjects: {
    id: string
    name: string
    count: number
    /** Когда из проекта удаляли в последний раз — подпись на строке. */
    lastDeletedAt: string
    /**
     * Самое давнее удаление в этом проекте. Файлы уходили в корзину в разное
     * время, и сроки у них разные; полоска показывает ближайший — тот файл,
     * который исчезнет первым. Остальное ещё подождёт.
     */
    oldestDeletedAt: string
  }[]
  /** Строка корзины по id файла — из неё видно, что с этим файлом можно делать. */
  trashItemOf: (fileId: string) => TrashItem | null
  /** Чью корзину показываем. `null` — корень, файлы всех проектов вперемешку. */
  trashProjectId: string | null
  selectTrashProject: (id: string | null) => void
  /** Удалённое выбранного проекта — то, что рисует правая область. */
  trashScoped: TrashItem[]
  /**
   * Проект выбранного в корзине файла. По нему подсвечивается карточка слева:
   * в корне файлы лежат вперемешку, и «откуда это» — первый вопрос к строке.
   */
  trashHighlightId: string | null
  trashSort: TrashSort
  setTrashSort: (s: TrashSort) => void
  /** Разбивать корень корзины на группы по проектам. */
  groupProjects: boolean
  setGroupProjects: (v: boolean) => void
  /**
   * Режим «без папок»: все файлы поддерева одним списком, с путём под именем.
   * Не вид (`view`), а поправка к нему — сочетается и со списком, и с плиткой.
   */
  flat: boolean
  setFlat: (v: boolean) => void
  reloadTrash: () => void
  restoreTrashFile: (file: DriveFile) => void
  purgeTrashFile: (file: DriveFile) => void
  /** Очистка корзины: стирает проекты, лежащие в ней. */
  emptyTrash: () => void

  // перемещение
  /** Элементы, для которых открыт диалог выбора папки назначения. */
  moveTargets: DriveFile[] | null
  openMoveDialog: (items: DriveFile[]) => void
  closeMoveDialog: () => void
  /** Перенос внутри проекта: меняется только логический путь. */
  /**
   * Перенести в папку. Оба проекта по умолчанию — выбранный; разные `from` и
   * `to` — перенос между проектами (копия туда, оригинал в корзину).
   */
  moveItems: (
    items: DriveFile[],
    destFolderPath: string,
    projects?: { from?: string; to?: string },
  ) => Promise<void>

  // буфер обмена
  clipboard: Clipboard | null
  /** Положить выделение в буфер: «Вырезать» или «Скопировать». */
  putToClipboard: (op: ClipboardOp, items: DriveFile[]) => void
  removeFromClipboard: (id: string) => void
  clearClipboard: () => void
  /** Вставить буфер в папку: «вырезать» переносит, «копировать» ждёт бэкенд. */
  pasteClipboard: (destFolderPath: string) => void
  /** Элемент помечен «вырезать» — показываем его приглушённым. */
  isCut: (id: string) => boolean

  // контекстное меню
  menu: ContextMenuState | null
  openMenu: (
    kind: ContextMenuKind,
    event: React.MouseEvent,
    extra?: Partial<ContextMenuState>,
  ) => void
  closeMenu: () => void

  // описание и чат
  descDraft: string
  setDescDraft: (v: string) => void
  saveDescription: () => void
  messages: ChatMessage[]
  draft: string
  setDraft: (v: string) => void
  sendMessage: () => void
  openChat: (projectId: string) => void

  // диалоги
  prompt: PromptRequest | null
  setPrompt: (r: PromptRequest | null) => void
  confirm: ConfirmRequest | null
  setConfirm: (r: ConfirmRequest | null) => void

  // сборка элемента в папке IN — docs/TOOLS_FOLDER_ASSEMBLY_PLAN.md
  /**
   * Включена ли сборка на этой установке (флаг `workspace.element`).
   *
   * Приходит пропсом от страницы, а не читается здесь: состояние выключателей
   * живёт в базе, а модуль, который её читает, серверный — импортировать его в
   * клиентский компонент значило бы утащить `pg` в бандл.
   */
  elementEnabled: boolean
  /**
   * Форма сборки выбранного проекта (`options/onSiteFolderCheckForm.json`).
   *
   * `null` — проект не собирается папками: ноды `checkFolder` в графе нет либо
   * она выключена, и десктоп в этом случае файл удаляет. Нет файла — нет и
   * кнопки «Новый элемент»: собирать не по чему.
   */
  elementForm: SiteForm | null
  /** Почему форму не прочитали: чужая версия, дубли имён, битый файл. */
  elementFormError: SiteFormError | null
  /**
   * Папка, открытая в диалоге. `folder: null` — создаём новый элемент, папки
   * ещё нет. Само `null` — диалог закрыт.
   */
  elementTarget: { folder: DriveFile | null } | null
  openElementDialog: (folder?: DriveFile | null) => void
  closeElementDialog: () => void
  /**
   * Папка верхнего уровня `IN`, содержимое которой разбирается формой. По этому
   * признаку показывается иконка «Править» и пункт меню; отдельной метки в
   * хранилище нет намеренно (план §3).
   */
  isElementFolder: (file: DriveFile) => boolean
  /**
   * Лежит ли элемент внутри папки элемента — на любой глубине, включая саму
   * папку. По этому признаку прячется «Переименовать»: имена внутри держит
   * инструмент, и переименование мимо него рвёт связь слота с файлом (план §9).
   */
  isInsideElement: (file: DriveFile) => boolean

  notImplemented: () => void
}

const Ctx = createContext<WorkspaceValue | null>(null)

export function useWorkspace() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider")
  return ctx
}

/**
 * Дождаться фоновой работы хранилища: копирования, переноса между проектами.
 * Ждём ограниченно, полминуты: дольше работа доедет и без нас, просто без
 * тоста. `pending` значит «ещё идёт, а мы перестали ждать».
 */
async function waitForStorageJob(
  jobId: string,
): Promise<{ state: "done" | "failed" | "pending"; error?: string | null }> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const res = await fetch(`/api/storage/v1/jobs/${jobId}`)
    if (!res.ok) break
    const data = await res.json()
    const state = data.job?.state
    if (state === "done") return { state: "done" }
    if (state === "failed") return { state: "failed", error: data.job?.error }
  }
  return { state: "pending" }
}

async function uploadViaXhr(
  source: WorkspaceSource,
  projectId: string,
  file: File,
  target: UploadTarget,
  /** Как поступить с занятым именем: под новым именем или поверх старого. */
  resolution?: { name?: string; overwrite?: boolean },
  /** Проценты наружу и сигнал отмены — одинаково для обоих путей заливки. */
  hooks?: { onProgress?: (percent: number) => void; signal?: AbortSignal },
): Promise<void> {
  const name = resolution?.name ?? file.name
  // Через storage v1 (presign → PUT → notify) — так заливает кабинет и «Папки
  // пользователей»: эндпоинт пускает по тегу projects.access, и байты не идут
  // через Next. Остальные источники ходят на свой uploadUrl.
  if (source.directUpload) {
    await uploadProjectFileDirect({
      projectId,
      file,
      folderPath: target.folderPath ?? "",
      name: resolution?.name,
      overwrite: resolution?.overwrite,
      onProgress: hooks?.onProgress,
      signal: hooks?.signal,
    })
    return
  }
  if (hooks?.signal?.aborted) throw new UploadCancelled()
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({ fileName: name })
    if (target.parentId) qs.set("parentId", target.parentId)
    else qs.set("folderPath", target.folderPath ?? "")
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const detach = () => hooks?.signal?.removeEventListener("abort", abort)
    xhr.open("POST", source.uploadUrl(projectId, qs))
    xhr.withCredentials = true
    if (file.type) xhr.setRequestHeader("Content-Type", file.type)
    xhr.setRequestHeader("x-file-name", encodeURIComponent(name))
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && hooks?.onProgress) {
        hooks.onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      detach()
      try {
        const data = JSON.parse(xhr.responseText) as { message?: string }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
          return
        }
        reject(new Error(data.message ?? `Upload failed (${xhr.status})`))
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`))
      }
    }
    xhr.onerror = () => {
      detach()
      reject(new Error("Network error during upload."))
    }
    // Здесь байты идут через Next, а не прямо в R2, поэтому оборванный запрос
    // не оставляет за собой ничего: строку каталога пишет тот же обработчик,
    // который принимает тело, и до неё дело не дойдёт.
    xhr.onabort = () => {
      detach()
      reject(new UploadCancelled())
    }
    hooks?.signal?.addEventListener("abort", abort)
    xhr.send(file)
  })
}

export function WorkspaceProvider({
  children,
  source = CABINET_SOURCE,
  elementEnabled = false,
}: {
  children: React.ReactNode
  /**
   * Откуда брать данные и что разрешено. По умолчанию кабинет, поэтому
   * /account/projects работает как раньше; админский «Конвейер» передаёт свой.
   */
  source?: WorkspaceSource
  /**
   * Включена ли сборка элемента (флаг `workspace.element`). По умолчанию
   * выключена: значение знает только серверная страница, и зона, которая его не
   * передала, не должна получить кнопку по умолчанию.
   */
  elementEnabled?: boolean
}) {
  const { t, lang } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<UploadTarget>({ parentId: null, folderPath: "" })
  const storageCursorRef = useRef(0)

  /**
   * Словарь в ref: загрузчики берут строки отсюда, а не из замыкания.
   * Иначе смена языка меняла identity loadDrive и перезапускала эффекты —
   * дерево файлов перечитывалось на каждое переключение RU/EN.
   */
  const tRef = useRef(t)
  tRef.current = t

  /**
   * Источник тоже в ref, и по той же причине: загрузчики объявлены с пустым
   * списком зависимостей, а объект-источник может пересоздаваться на каждый
   * рендер родителя. Через ref его смена не перезапускает эффекты и не
   * перечитывает дерево файлов.
   */
  const sourceRef = useRef(source)
  sourceRef.current = source

  const [projects, setProjects] = useState<Project[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("id"),
  )

  /**
   * Вкладка списка живёт в URL (`?tab=archive`), а не в состоянии:
   * пункт «Архив» в боковом меню — обычная ссылка, и подсветка меню,
   * список проектов и кнопка «назад» остаются согласованными.
   */
  const projectTab: ProjectTab = parseTab(searchParams.get("tab"))

  const buildUrl = useCallback(
    (id: string | null, tab: ProjectTab) =>
      sourceRef.current.pageUrl({ id, tab }),
    [],
  )

  const setProjectTab = useCallback(
    (tab: ProjectTab) => {
      router.replace(buildUrl(selectedId, tab), { scroll: false })
    },
    [router, buildUrl, selectedId],
  )

  const [rootFiles, setRootFiles] = useState<DriveFile[]>([])
  /**
   * Что конвейер уже знает про элементы папки IN: id строки каталога → статус
   * последней задачи. В карте только верхний уровень IN — глубже задач не
   * бывает, — поэтому проверять путь при поиске не нужно.
   */
  const [inStatus, setInStatus] = useState<Record<string, InItemStatus>>({})
  const [exposedOptions, setExposedOptions] = useState<ExposedOption[]>([])
  /** Что автор графа открыл, а сайт нарисовать не смог — см. ExposedOptionsList. */
  const [skippedOptions, setSkippedOptions] = useState<SkippedOption[]>([])
  const [fileTypes, setFileTypes] = useState<Record<string, string[]>>({})
  const [driveAvailable, setDriveAvailable] = useState(true)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [path, setPath] = useState<DriveFile[]>([])
  /**
   * Чьё дерево сейчас лежит в `rootFiles`.
   *
   * Смена проекта и приход его дерева разнесены во времени: `selectedId`
   * меняется мгновенно, а `loadDrive` идёт по сети. Всё, что укладывает
   * внешнюю просьбу «открой вот эту папку» на дерево, обязано дождаться
   * СВОЕГО дерева — иначе просьба разбирается по чужому, не находит там ничего
   * и гаснет, а пришедшая следом загрузка ещё и сбрасывает путь в корень.
   */
  const [filesProjectId, setFilesProjectId] = useState<string | null>(null)
  const [revealPath, setRevealPath] = useState<DriveFile[] | null>(null)
  /**
   * Файл, к которому просили перейти: его мало выделить, к нему надо ещё и
   * прокрутить. В папке с сотней результатов выделенная строка за пределами
   * окна — это тот же «мы никуда не перешли».
   */
  const [revealFileId, setRevealFileId] = useState<string | null>(null)
  /**
   * Выделение — список, а не один файл: Cmd/Ctrl добавляет элементы.
   * Последний элемент считается активным и показывается в превью.
   */
  const [selection, setSelection] = useState<DriveFile[]>([])

  const selectedFile = selection.length ? selection[selection.length - 1] : null

  const setSelectedFile = useCallback((file: DriveFile | null) => {
    setSelection(file ? [file] : [])
  }, [])

  const clearFileSelection = useCallback(() => setSelection([]), [])

  const consumeReveal = useCallback(() => setRevealFileId(null), [])

  const isSelected = useCallback(
    (id: string) => selection.some((f) => f.id === id),
    [selection],
  )

  /** Опора для Shift-диапазона: последний клик без Shift. */
  const anchorRef = useRef<DriveFile | null>(null)

  const selectFile = useCallback((file: DriveFile, additive = false) => {
    anchorRef.current = file
    // Дальше человек ведёт сам — прокрутка к присланному файлу больше не нужна.
    setRevealFileId(null)
    setSelection((prev) => {
      if (!additive) return [file]
      const without = prev.filter((f) => f.id !== file.id)
      // повторный Cmd/Ctrl-клик по выделенному — снимает выделение
      return without.length === prev.length ? [...prev, file] : without
    })
  }, [])

  const selectRange = useCallback((list: DriveFile[], file: DriveFile) => {
    const anchor = anchorRef.current
    const to = list.findIndex((f) => f.id === file.id)
    const from = anchor ? list.findIndex((f) => f.id === anchor.id) : -1
    // Опоры нет или она в другой папке — ведём себя как обычный клик.
    if (from === -1 || to === -1) {
      anchorRef.current = file
      setSelection([file])
      return
    }
    const [start, end] = from <= to ? [from, to] : [to, from]
    setSelection(list.slice(start, end + 1))
  }, [])

  const [previewOpen, setPreviewOpen] = useState(false)

  const [density, setDensityState] = useState<Density>("full")
  const [view, setViewState] = useState<ViewMode>("list")
  const [bottomTab, setBottomTabState] = useState<BottomTab>("desc")

  /**
   * Выбранная закладка нижней панели переживает перезаход: открыл «Настройки» —
   * при следующем визите они и открыты, а не «Описание» по умолчанию. Запись
   * живёт в сеттере, а не в местах вызова (docs/UI_PREFS.md), — иначе часть
   * путей сохраняла бы, часть нет.
   *
   * Но запоминается ВЫБОР человека, а не то, куда его привела ссылка. Переход
   * «сразу в чат» (`?chat=1` из админских «Чатов») ставит закладку сам, и без
   * `remember: false` один такой переход навсегда открывал бы рабочую область
   * на переписке — вместе с опросом сообщений раз в шесть секунд.
   */
  const setBottomTab = useCallback((tab: BottomTab, remember = true) => {
    setBottomTabState(tab)
    if (remember) writeUiPref(BOTTOM_TAB_KEY, tab)
  }, [])

  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(
    null,
  )
  /**
   * Чем оборвать текущую пачку. В ref, а не в состоянии: контроллер живёт ровно
   * столько же, сколько цикл заливки, и перерисовывать из-за него нечего.
   */
  const uploadAbortRef = useRef<AbortController | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [clipboard, setClipboard] = useState<Clipboard | null>(null)
  const [moveTargets, setMoveTargets] = useState<DriveFile[] | null>(null)
  const [shareTarget, setShareTarget] = useState<Project | null>(null)
  const [transferTarget, setTransferTarget] = useState<Project | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [descDraft, setDescDraft] = useState("")
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const [conflict, setConflict] = useState<UploadConflict | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  const selected = projects.find((p) => p.id === selectedId) ?? null

  const capabilitiesFor = useCallback(
    (project: Project | null) => projectCapabilities(source.can, project),
    [source.can],
  )
  const can = useMemo(
    () => capabilitiesFor(selected),
    [capabilitiesFor, selected],
  )

  /**
   * Соседи по папке для перелистывания в окне превью. Считаем от id, а не от
   * текущего пути: у панелей IN / OUT и мобильного вида свои пути, а дерево одно.
   */
  const previewSiblings = useMemo(
    () => (selectedFile ? siblingFiles(rootFiles, selectedFile.id) : []),
    [rootFiles, selectedFile],
  )

  const openPreview = useCallback(
    (file?: DriveFile) => {
      const target = file ?? selectedFile
      if (!target || target.isFolder) return
      if (file) selectFile(file)
      setPreviewOpen(true)
    },
    [selectedFile, selectFile],
  )

  const closePreview = useCallback(() => setPreviewOpen(false), [])

  // Выделение сбросили (сменили проект, ушли в папку) — окну нечего показывать.
  useEffect(() => {
    if (!selectedFile || selectedFile.isFolder) setPreviewOpen(false)
  }, [selectedFile])

  const stepPreview = useCallback(
    (delta: number) => {
      if (!selectedFile || previewSiblings.length < 2) return
      const at = previewSiblings.findIndex((f) => f.id === selectedFile.id)
      if (at === -1) return
      const len = previewSiblings.length
      selectFile(previewSiblings[(at + delta + len) % len])
    },
    [selectedFile, previewSiblings, selectFile],
  )

  const notImplemented = useCallback(() => {
    toast.message(t.notImplemented)
  }, [t.notImplemented])

  // ---------- предпочтения режима ----------

  useEffect(() => {
    const d = window.localStorage.getItem(DENSITY_KEY)
    if (d === "full" || d === "simple") setDensityState(d)
    const v = window.localStorage.getItem(VIEW_KEY)
    if (v === "list" || v === "grid" || v === "columns") setViewState(v)
    const bt = readUiPref(BOTTOM_TAB_KEY)
    if (bt === "preview" || bt === "desc" || bt === "settings" || bt === "chat") {
      setBottomTabState(bt)
    }
  }, [])

  const setDensity = useCallback((d: Density) => {
    setDensityState(d)
    window.localStorage.setItem(DENSITY_KEY, d)
  }, [])

  const setView = useCallback((v: ViewMode) => {
    setViewState(v)
    window.localStorage.setItem(VIEW_KEY, v)
  }, [])

  // ---------- загрузка данных ----------

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true)
    try {
      const res = await fetch(sourceRef.current.projectsUrl())
      if (!res.ok) return
      const data = await res.json()
      setProjects(
        (data.projects ?? []).map((p: Record<string, unknown>) => mapProject(p)),
      )
      notifyProjectsChanged()
    } finally {
      setLoadingProjects(false)
    }
  }, [])

  const loadDrive = useCallback(
    async (projectId: string, keepPath = true) => {
      setLoadingFiles(true)
      try {
        const res = await fetch(sourceRef.current.driveUrl(projectId))
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          toast.error(data.message ?? "Failed")
          return
        }
        const data = await res.json()
        if (!data.available) {
          setDriveAvailable(false)
          setRootFiles([])
          setInStatus({})
          setExposedOptions([])
          setSkippedOptions([])
          setFileTypes({})
          setPath([])
          toast.error(tRef.current.driveUnavailable)
          return
        }
        setDriveAvailable(true)
        setExposedOptions(Array.isArray(data.options) ? data.options : [])
        setSkippedOptions(
          Array.isArray(data.skippedOptions) ? data.skippedOptions : [],
        )
        setFileTypes(
          data.fileTypes && typeof data.fileTypes === "object"
            ? (data.fileTypes as Record<string, string[]>)
            : {},
        )
        const files: DriveFile[] = data.files ?? []
        setRootFiles(files)
        setFilesProjectId(projectId)
        setInStatus(
          data.inStatus && typeof data.inStatus === "object"
            ? (data.inStatus as Record<string, InItemStatus>)
            : {},
        )
        setPath((prev) => (keepPath ? resolvePath(files, prev) : []))
        setSelectedFile(null)

        /*
          Курсор приезжает вместе с деревом — отдельного запроса за ним больше
          нет. Тот запрос ради одного числа поднимал весь каталог проекта
          заново, то есть каждое обновление дерева читало его дважды, и так
          каждые несколько секунд при опросе дельты.

          Откат на старый адрес остаётся на случай источника, чей роут дерева
          курсор ещё не отдаёт: без курсора опрос дельты начал бы с нуля и
          вернул бы весь журнал.
        */
        if (typeof data.cursor === "number") {
          storageCursorRef.current = data.cursor
        } else {
          const cursorRes = await fetch(
            sourceRef.current.treeCursorUrl(projectId),
          )
          if (cursorRes.ok) {
            const cursorData = await cursorRes.json()
            if (typeof cursorData.cursor === "number") {
              storageCursorRef.current = cursorData.cursor
            }
          }
        }
      } finally {
        setLoadingFiles(false)
      }
    },
    [],
  )

  const loadMessages = useCallback(async (projectId: string) => {
    const res = await fetch(sourceRef.current.chatUrl(projectId))
    if (!res.ok) return
    const data = await res.json()
    const list: ChatMessage[] = (data.messages ?? []).map(
      (m: {
        id: string
        senderType: ChatMessage["senderType"]
        body: string
        createdAt: string
      }) => ({
        id: m.id,
        senderType: m.senderType,
        body: m.body,
        createdAt:
          typeof m.createdAt === "string"
            ? m.createdAt
            : new Date(m.createdAt).toISOString(),
      }),
    )
    setMessages(list)
    // Отметка «прочитано» — своя у каждой стороны: в кабинете гаснет значок
    // пользователя, в админке — счётчик команды (раздел «Чаты» и карточка
    // проекта в «Папках»). Источник без отметки просто пропускает шаг.
    const chatReadUrl = sourceRef.current.chatReadUrl
    if (chatReadUrl) {
      void fetch(chatReadUrl(projectId), { method: "POST" })
        .then(() => {
          window.dispatchEvent(new Event(CHAT_READ_EVENT))
        })
        .catch(() => undefined)
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, unreadCount: 0 } : p)),
      )
    }
  }, [])

  // scopeKey в зависимостях обязателен: loadProjects объявлен с пустым списком
  // и берёт адреса из sourceRef, поэтому сам по себе он не пересоздаётся. Без
  // ключа смена выбранного пользователя в админке не перечитывала бы список.
  useEffect(() => {
    void loadProjects()
  }, [loadProjects, source.scopeKey])

  /**
   * Выделение читается из URL в обе стороны, включая «в URL никого».
   *
   * Пункты бокового меню («Проекты», «Расшаренные», «Архив») — обычные ссылки
   * без `id`. Пока сброса здесь не было, после них оставался открытым прежний
   * проект: раздел в меню подсвечивался новый, а рабочая область показывала
   * проект из старого — в простом режиме вместо страницы списка вообще.
   */
  useEffect(() => {
    setSelectedId(searchParams.get("id"))
  }, [searchParams])

  useEffect(() => {
    // Просьба «открыть вот это» относилась к прежнему проекту — снимаем её, а
    // не тащим в следующий: узлы там чужие, и вид всё равно их не узнает.
    setRevealPath(null)
    setRevealFileId(null)
    if (!selectedId) {
      setRootFiles([])
      setInStatus({})
      setPath([])
      setSelectedFile(null)
      setMessages([])
      setDriveAvailable(true)
      storageCursorRef.current = 0
      return
    }
    void loadDrive(selectedId, false)
  }, [selectedId, loadDrive])

  /**
   * Переход по ссылке «прямо к этому файлу»: `?path=OUT/08 August&file=clip.mp4`.
   *
   * Приходит из индикатора обработки в верхней панели — оттуда человек попадает
   * не «в проект», а в ту папку, где его файл лежит сейчас, с выделенной и
   * прокрученной к центру строкой. Ждём СВОЕГО дерева: путь в ссылке текстовый,
   * узлы с их id знает только дерево, и до его прихода в `rootFiles` лежит
   * дерево прежнего проекта. Разобранная по нему просьба не находила ничего, а
   * пришедшая следом загрузка сбрасывала путь в корень — то есть переход к
   * результату заканчивался в корне OUT, ровно там, откуда человек уходил.
   *
   * Параметры одноразовые — после применения снимаем их с адреса. Иначе
   * повторный клик по той же строке был бы переходом на тот же URL, то есть
   * ничем, а «назад» возвращало бы к выделению, которого человек уже не ждёт.
   */
  const deepLinkFolder = searchParams.get("path")
  const deepLinkFile = searchParams.get("file")
  const deepLinkDone = useRef<string | null>(null)
  useEffect(() => {
    if (deepLinkFolder === null) {
      // Ссылка отработана и снята с адреса — забываем её. Без этого отметка
      // «уже делали» переживала переход, и второй клик по той же строке
      // индикатора не делал ничего: человек оставался там, где стоял.
      deepLinkDone.current = null
      return
    }
    if (!selectedId || filesProjectId !== selectedId) return
    if (rootFiles.length === 0) return

    // Ровно один раз на ссылку. Дерево перечитывается по таймеру, и без этой
    // отметки очередное чтение возвращало бы человека в папку из адреса, откуда
    // он уже ушёл, — пока адрес не успел очиститься.
    const token = `${selectedId}\u0000${deepLinkFolder}\u0000${deepLinkFile ?? ""}`
    if (deepLinkDone.current === token) return
    deepLinkDone.current = token

    const { nodes, file } = resolveRevealTarget(
      rootFiles,
      deepLinkFolder,
      deepLinkFile,
    )
    setPath(nodes)
    setRevealPath(nodes)
    setSelection(file ? [file] : [])
    setRevealFileId(file ? file.id : null)

    router.replace(buildUrl(selectedId, projectTab), { scroll: false })
  }, [
    selectedId,
    filesProjectId,
    rootFiles,
    deepLinkFolder,
    deepLinkFile,
    router,
    buildUrl,
    projectTab,
  ])

  useEffect(() => {
    if (!selectedId || !driveAvailable) return
    const projectId = selectedId
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const since = storageCursorRef.current
          const res = await fetch(
            `/api/storage/v1/delta?projectId=${encodeURIComponent(projectId)}&since=${since}`,
          )
          if (!res.ok) return
          const data = await res.json()
          if (data.truncated) {
            await loadDrive(projectId, true)
            return
          }
          if (Array.isArray(data.changes) && data.changes.length > 0) {
            if (typeof data.cursor === "number") {
              storageCursorRef.current = data.cursor
            }
            await loadDrive(projectId, true)
          } else if (typeof data.cursor === "number") {
            storageCursorRef.current = data.cursor
          }
        } catch {
          // сетевые сбои поллинга игнорируем — следующий тик догонит
        }
      })()
    }, DELTA_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [selectedId, driveAvailable, loadDrive])

  useEffect(() => {
    if (selected) setDescDraft(selected.description ?? "")
  }, [selected])

  useEffect(() => {
    if (!selectedId || bottomTab !== "chat") return
    void loadMessages(selectedId)
    const timer = window.setInterval(() => {
      void loadMessages(selectedId)
    }, CHAT_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [selectedId, bottomTab, loadMessages])

  /**
   * Переход «сразу в чат проекта»: `?chat=1` в адресе.
   *
   * Приходит из раздела «Чаты» админки: там выбирают, кому отвечать, а
   * отвечают здесь — рядом с файлами и описанием, ради которых человек в этот
   * чат и идёт. Отдельного окна переписки поэтому нет: ссылка ведёт в тот же
   * проект, просто с открытой нужной закладкой.
   *
   * Один раз на проект, а не на каждый рендер: дальше закладки переключает
   * человек, и возвращать его в чат, пока `chat=1` висит в адресе, значило бы
   * не давать уйти в «Описание» или «Настройки».
   */
  const deepLinkChat = searchParams.get("chat")
  const chatLinkDone = useRef<string | null>(null)
  useEffect(() => {
    if (deepLinkChat !== "1") {
      chatLinkDone.current = null
      return
    }
    if (!selectedId || chatLinkDone.current === selectedId) return
    chatLinkDone.current = selectedId
    // Не запоминаем: сюда привела ссылка, а не выбор закладки.
    setBottomTab("chat", false)
  }, [deepLinkChat, selectedId])

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener("click", close)
    return () => window.removeEventListener("click", close)
  }, [])

  // ---------- проекты ----------

  const matchesQuery = useCallback(
    (p: Project) => {
      const q = query.trim().toLowerCase()
      return !q || p.name.toLowerCase().includes(q)
    },
    [query],
  )

  /**
   * Раздел проекта: архив перекрывает группу, неизвестная группа считается личной.
   * Расшаренный живёт в «Проектах» — там он отдельной группой (project-groups.tsx).
   * Проверяется до архива, как и раньше, когда у него был свой раздел.
   */
  const tabOf = useCallback((p: Project): ProjectTab => {
    if (p.deletedAt) return "trash"
    if (p.sharedWithMe) return "projects"
    if (p.isArchived) return "archive"
    if (p.groupName === "tools") return "tools"
    return "projects"
  }, [])

  const counts = useMemo(() => {
    const acc: Record<ProjectTab, number> = {
      projects: 0,
      tools: 0,
      archive: 0,
      trash: 0,
    }
    for (const p of projects) acc[tabOf(p)] += 1
    return acc
  }, [projects, tabOf])

  const visibleProjects = useMemo(() => {
    // Источник без разделов (админский «Конвейер») показывает список целиком,
    // вместе с архивными: администратору нужно видеть все проекты пользователя
    // и понимать, какие из них не обрабатываются. Порядок задаёт запрос —
    // архивные идут последними.
    if (!source.splitByTab) return projects.filter(matchesQuery)
    return projects.filter((p) => tabOf(p) === projectTab && matchesQuery(p))
  }, [projects, projectTab, tabOf, matchesQuery, source.splitByTab])

  const selectProject = useCallback(
    (id: string) => {
      setSelectedId(id)
      setPath([])
      setSelectedFile(null)
      setDraft("")
      // Выбор в колонке один: открытый проект снимает сужение корзины, иначе
      // подсвеченными остались бы сразу две строки.
      setTrashProjectId(null)
      router.replace(buildUrl(id, projectTab), { scroll: false })
    },
    [router, buildUrl, projectTab],
  )

  const clearSelection = useCallback(() => {
    setSelectedId(null)
    router.replace(buildUrl(null, projectTab), { scroll: false })
  }, [router, buildUrl, projectTab])

  const patchProject = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const res = await fetch(sourceRef.current.projectUrl(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        // Отказ биллинга — не «что-то сломалось», а объяснимое «платить нечем».
        // Общее «Failed» отправило бы человека искать ошибку там, где её нет.
        if (res.status === 409) {
          const body = (await res.json().catch(() => ({}))) as { code?: string }
          if (
            body.code === "trial-over" ||
            body.code === "no-funds" ||
            body.code === "payer-no-funds"
          ) {
            toast.error(
              body.code === "trial-over"
                ? t.trialBannerOver
                : body.code === "payer-no-funds"
                  ? t.resumePayerNoFunds
                  : t.trialBannerNoFunds,
            )
            return
          }
        }
        toast.error("Failed")
        return
      }
      const data = await res.json()
      setProjects((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, ...mapProject({ ...p, ...data.project }) } : p,
        ),
      )
      notifyProjectsChanged()
    },
    [t],
  )

  const createProject = useCallback(() => {
    if (creating) return
    setPrompt({
      title: t.newProject,
      label: t.projectNamePrompt,
      initial: tf(t.newProjectName, { number: projects.length + 1 }),
      confirmLabel: t.create,
      onSubmit: (name) => {
        void (async () => {
          setCreating(true)
          try {
            const res = await fetch(sourceRef.current.projectsUrl(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) {
              toast.error(
                typeof data?.message === "string" ? data.message : t.createFailed,
              )
              return
            }
            await loadProjects()
            selectProject(data.project.id)
          } finally {
            setCreating(false)
          }
        })()
      },
    })
  }, [creating, lang, projects.length, t, loadProjects, selectProject])

  const renameProject = useCallback(
    (project: Project) => {
      setPrompt({
        title: t.rename,
        label: t.projectNamePrompt,
        initial: project.name,
        confirmLabel: t.saveChanges,
        onSubmit: (name) => {
          if (name === project.name) return
          void patchProject(project.id, { name })
        },
      })
    },
    [t, patchProject],
  )

  /** Архивирование — отдельный флаг, группу проекта не трогаем. */
  const setArchived = useCallback(
    (project: Project, archived: boolean) => {
      void patchProject(project.id, { isArchived: archived })
    },
    [patchProject],
  )

  const deleteProject = useCallback(
    (id: string) => {
      setConfirm({
        title: t.deleteProject,
        // Удаление мягкое — и спрашивать надо ровно про то, что произойдёт.
        // Прежнее «удалить безвозвратно?» пугало сильнее, чем следует, и вдобавок
        // было неправдой: проект уезжает в корзину и оттуда возвращается.
        description: tf(t.confirmDeleteProject, { days: TRASH_RETENTION_DAYS }),
        confirmLabel: t.mDelete,
        destructive: true,
        onConfirm: () => {
          void (async () => {
            const res = await fetch(sourceRef.current.projectUrl(id), {
              method: "DELETE",
            })
            if (!res.ok) {
              toast.error("Failed")
              return
            }
            clearSelection()
            await loadProjects()
          })()
        },
      })
    },
    [t, clearSelection, loadProjects],
  )

  /**
   * Пишет правки клиента в options.json и возвращает свежий список: сервер мог
   * зажать число в границы, заданные автором графа, и показать надо то, что
   * реально сохранилось.
   */
  const saveExposedOptions = useCallback(
    async (changes: ExposedOptionChange[]): Promise<ExposedOption[]> => {
      const buildUrl = sourceRef.current.exposedOptionsUrl
      if (!buildUrl || !selectedId) throw new Error("")
      const res = await fetch(buildUrl(selectedId), {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      })
      const data = (await res.json().catch(() => null)) as {
        options?: ExposedOption[]
        message?: string
      } | null
      if (!res.ok || !data?.options) {
        throw new Error(data?.message ?? "")
      }
      setExposedOptions(data.options)
      return data.options
    },
    [selectedId],
  )

  const saveDescription = useCallback(() => {
    if (!selectedId) return
    void patchProject(selectedId, { description: descDraft }).then(() => {
      toast.success(t.saveDescription)
    })
  }, [selectedId, descDraft, patchProject, t.saveDescription])

  const openChat = useCallback(
    (projectId: string) => {
      selectProject(projectId)
      setBottomTab("chat")
      void loadMessages(projectId)
    },
    [selectProject, loadMessages],
  )

  const sendMessage = useCallback(() => {
    if (!selectedId || !draft.trim()) return
    const text = draft.trim()
    setDraft("")
    void (async () => {
      const res = await fetch(sourceRef.current.chatUrl(selectedId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) {
        toast.error("Failed")
        setDraft(text)
        return
      }
      const data = await res.json()
      const m = data.message
      setMessages((prev) => [
        ...prev,
        {
          id: m.id,
          senderType: m.senderType ?? "client",
          body: m.body ?? text,
          createdAt:
            typeof m.createdAt === "string"
              ? m.createdAt
              : new Date(m.createdAt ?? Date.now()).toISOString(),
        },
      ])
    })()
  }, [selectedId, draft])

  // ---------- дерево файлов ----------

  const currentItems = useMemo(
    () => itemsAtPath(rootFiles, path),
    [rootFiles, path],
  )

  const currentTarget = useMemo<UploadTarget>(
    () => ({
      parentId: path.length ? path[path.length - 1].id : null,
      folderPath: pathToFolderPath(path),
    }),
    [path],
  )

  const inFolder = useMemo(() => findChildByName(rootFiles, "IN"), [rootFiles])
  const outFolder = useMemo(() => findChildByName(rootFiles, "OUT"), [rootFiles])

  const openFolder = useCallback((f: DriveFile) => {
    if (!f.isFolder) return
    setPath((p) => [...p, f])
    setSelectedFile(null)
  }, [])

  const goToCrumb = useCallback((index: number) => {
    setPath((p) => (index < 0 ? [] : p.slice(0, index + 1)))
    setSelectedFile(null)
  }, [])

  const goToPath = useCallback((nodes: DriveFile[]) => {
    setPath(nodes)
    setSelectedFile(null)
  }, [])

  const refreshDrive = useCallback(async () => {
    if (selectedId) await loadDrive(selectedId, true)
  }, [selectedId, loadDrive])

  const createFolder = useCallback(
    (target: UploadTarget) => {
      if (!selectedId) return
      setPrompt({
        title: t.mNewFolder,
        label: t.folderNamePrompt,
        initial: "",
        confirmLabel: t.create,
        onSubmit: (name) => {
          void (async () => {
            const res = await fetch(sourceRef.current.folderUrl(selectedId), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, folderPath: target.folderPath }),
            })
            if (!res.ok) {
              const data = await res.json().catch(() => ({}))
              toast.error(data.message ?? "Failed")
              return
            }
            await loadDrive(selectedId, true)
          })()
        },
      })
    },
    [selectedId, t, loadDrive],
  )

  /**
   * Отметка на элементе IN: задача по нему уже была, сам он больше не поедет.
   *
   * Обратная сторона того же правила, из-за которого существует «Обработать
   * заново»: раньше «уже обработан» и «ждёт очереди» выглядели в папке
   * одинаково, и разницу нельзя было увидеть — только вспомнить.
   */
  const inStatusOf = useCallback(
    (file: DriveFile) => inStatus[file.id] ?? null,
    [inStatus],
  )

  /**
   * «Обработать заново» — поставить элемент IN в очередь ещё раз.
   *
   * Нужно потому, что обе линии сборки берут только то, по чему задачи не было
   * вообще: файл, который уже обработали (или который упал), лежит в IN и больше
   * никогда сам не поедет. Раньше единственным выходом было удалить строку
   * задачи в админке, но зона «Завершено» показывает последние полсотни — у
   * файла недельной давности этого выхода уже не было.
   */
  const canReprocess = useCallback(
    (file: DriveFile) => {
      if (!sourceRef.current.reprocessUrl) return false
      // Единица работы конвейера — элемент ВЕРХНЕГО уровня папки IN. Для файла
      // внутри IN/raw задача не собирается, и пункт меню обещал бы несбыточное.
      return folderPathOf(rootFiles, file.id) === "IN"
    },
    [rootFiles],
  )

  const reprocessItem = useCallback(
    (file: DriveFile) => {
      const build = sourceRef.current.reprocessUrl
      if (!selectedId || !build) return
      void (async () => {
        try {
          const res = await fetch(build(selectedId, file.id), { method: "POST" })
          const data = (await res.json().catch(() => null)) as {
            reason?: string
          } | null
          if (!res.ok) {
            toast.error(reprocessMessage(data?.reason, tRef.current))
            return
          }
          toast.success(tRef.current.reprocessQueued)
          // Перечитываем дерево ради отметки: задача уже в очереди, а событий в
          // хранилище от этого не появилось — сам по себе опрос delta её не
          // увидит, и значок остался бы зелёным до первого записанного файла.
          // Без await и вне catch: постановка уже удалась, и сбой перечитывания
          // не должен показать поверх успеха сообщение о несобранной задаче.
          void loadDrive(selectedId, true)
        } catch {
          toast.error(tRef.current.reprocessNoTask)
        }
      })()
    },
    [selectedId, loadDrive],
  )

  const renameItem = useCallback(
    (file: DriveFile) => {
      if (!selectedId) return
      setPrompt({
        title: t.mRename,
        label: t.renamePrompt,
        initial: file.name,
        confirmLabel: t.saveChanges,
        onSubmit: (name) => {
          if (name === file.name) return
          void (async () => {
            const res = await fetch(
              sourceRef.current.fileUrl(selectedId, file.id),
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
              },
            )
            if (!res.ok) {
              const data = await res.json().catch(() => ({}))
              toast.error(data.message ?? "Failed")
              return
            }
            await loadDrive(selectedId, true)
          })()
        },
      })
    },
    [selectedId, t, loadDrive],
  )

  const deleteItems = useCallback(
    (files: DriveFile[]) => {
      if (!selectedId || files.length === 0) return
      const description =
        files.length === 1
          ? `${t.confirmDelete} — ${files[0].name}`
          : `${t.confirmDelete} — ${files.length}`
      setConfirm({
        title: t.mDelete,
        description,
        confirmLabel: t.mDelete,
        destructive: true,
        onConfirm: () => {
          void (async () => {
            let failed = 0
            for (const file of files) {
              const res = await fetch(
                sourceRef.current.fileUrl(selectedId, file.id),
                { method: "DELETE" },
              )
              if (!res.ok) failed += 1
            }
            if (failed > 0) toast.error("Failed")
            const removed = new Set(files.map((f) => f.id))
            setSelection((prev) => prev.filter((f) => !removed.has(f.id)))
            await loadDrive(selectedId, true)
          })()
        },
      })
    },
    [selectedId, t, loadDrive],
  )

  const deleteItem = useCallback(
    (file: DriveFile) => deleteItems([file]),
    [deleteItems],
  )

  const downloadItem = useCallback(
    (file: DriveFile) => {
      if (!selectedId || file.isFolder) return
      window.open(
        sourceRef.current.fileUrl(selectedId, file.id),
        "_blank",
        "noopener",
      )
    },
    [selectedId],
  )

  const openArchiveDialog = useCallback((target: ArchiveTarget) => {
    setArchiveTarget(target)
  }, [])
  const closeArchiveDialog = useCallback(() => setArchiveTarget(null), [])

  /**
   * Спросить про занятое имя и дождаться ответа.
   *
   * Промисом, а не колбэком: заливка идёт циклом по файлам, и следующий файл
   * нельзя начинать, пока не решено, что делать с текущим. Колбэк развернул бы
   * этот цикл в машину состояний ради одного вопроса.
   */
  const askConflict = useCallback(
    (input: {
      name: string
      folderPath: string
      suggestion: string
      rest: number
    }) =>
      new Promise<{ action: UploadConflictAction; all: boolean }>((resolve) => {
        setConflict({
          ...input,
          decide: (action, all) => {
            setConflict(null)
            resolve({ action, all })
          },
        })
      }),
    [],
  )

  /**
   * Разрешение занятых имён для ОДНОЙ пачки заливки.
   *
   * Общее для загрузки файлов и папки целиком: вопрос один и тот же, а «так же с
   * остальными» обязано действовать на всю пачку. Состояние живёт в замыкании,
   * а не в компоненте, потому что оно и есть «пачка»: кончилась заливка —
   * кончился и ответ «ко всем», следующая начинает разговор заново.
   */
  const makeConflictResolver = useCallback(() => {
    /** Занятые имена по папкам: дерево спрашиваем один раз на папку. */
    const takenByFolder = new Map<string, string[]>()
    let blanket: UploadConflictAction | null = null

    const takenIn = (folderPath: string): string[] => {
      const key = folderPath.toLowerCase()
      const cached = takenByFolder.get(key)
      if (cached) return cached

      const nodes = resolveFolderPathByName(rootFiles, folderPath)
      // Папку могли создать прямо сейчас, под эту же заливку — в дереве её ещё
      // нет. Пустой путь это корень проекта, а вот ненайденный — пустая папка;
      // без этой развилки её содержимым стал бы корень со всеми его именами.
      const items =
        folderPath && nodes.length === 0 ? [] : itemsAtPath(rootFiles, nodes)
      const list = items.filter((f) => !f.isFolder).map((f) => f.name)
      takenByFolder.set(key, list)
      return list
    }

    return async (
      file: File,
      folderPath: string,
      rest: number,
    ): Promise<
      { skip: true } | { skip: false; resolution?: { name?: string; overwrite?: boolean } }
    > => {
      const taken = takenIn(folderPath)
      const clash = taken.some(
        (n) => n.toLowerCase() === file.name.toLowerCase(),
      )
      if (!clash) {
        // Имя занимаем сразу: второй одноимённый файл этой же пачки должен
        // столкнуться с первым, а не улечься поверх него.
        taken.push(file.name)
        return { skip: false }
      }

      const action =
        blanket ??
        (await (async () => {
          const answer = await askConflict({
            name: file.name,
            folderPath,
            suggestion: freeNameIn(taken, file.name),
            rest,
          })
          if (answer.all) blanket = answer.action
          return answer.action
        })())

      if (action === "skip") return { skip: true }
      if (action === "overwrite") return { skip: false, resolution: { overwrite: true } }

      const name = freeNameIn(taken, file.name)
      taken.push(name)
      return { skip: false, resolution: { name } }
    }
  }, [rootFiles, askConflict])

  const uploadFiles = useCallback(
    async (list: FileList | File[], target: UploadTarget) => {
      if (!selectedId) return
      const files = Array.from(list)
      if (!files.length) return

      /**
       * Занятое имя выясняем ДО отправки байтов, по уже загруженному дереву.
       *
       * Раньше столкновение ловил сервер (`assertNameFree`) уже после заливки:
       * человек ждал гигабайт и получал отказ, а сделать с ним ничего не мог —
       * оставалось удалить старый файл руками и залить всё заново.
       */
      const folderPath = (target.folderPath ?? "").replace(/^\/+|\/+$/g, "")
      const resolve = makeConflictResolver()

      const controller = new AbortController()
      uploadAbortRef.current = controller
      setUploading(true)
      try {
        for (const [index, file] of files.entries()) {
          if (controller.signal.aborted) break
          const verdict = await resolve(
            file,
            folderPath,
            files.length - index - 1,
          )
          if (verdict.skip) continue

          const name = verdict.resolution?.name ?? file.name
          setUploadProgress({
            folderPath,
            name,
            index: index + 1,
            total: files.length,
            percent: 0,
          })
          try {
            await uploadViaXhr(
              sourceRef.current,
              selectedId,
              file,
              target,
              verdict.resolution,
              {
                signal: controller.signal,
                onProgress: (percent) =>
                  setUploadProgress((prev) =>
                    prev ? { ...prev, percent } : prev,
                  ),
              },
            )
          } catch (err) {
            // Отмена обрывает всю пачку: человек нажал крестик, а не «пропусти
            // этот файл». Про неё молчим — он и так знает, что сделал.
            if (isUploadCancelled(err)) break
            toast.error(
              err instanceof Error ? err.message : `Upload failed: ${file.name}`,
            )
          }
        }
        if (controller.signal.aborted) toast(tRef.current.uploadCancelled)
        await loadDrive(selectedId, true)
      } finally {
        // Только если пачка ещё наша. Заливки могут наложиться — бросили файл,
        // пока едет предыдущий, — и кончившаяся первой не должна уносить с
        // экрана чужое кольцо и отбирать у второй крестик.
        if (uploadAbortRef.current === controller) {
          uploadAbortRef.current = null
          setUploadProgress(null)
        }
        setUploading(false)
      }
    },
    [selectedId, loadDrive, makeConflictResolver],
  )

  /**
   * Оборвать заливку. Молча, если её нет: крестик мог пережить последний файл
   * пачки на те миллисекунды, что кольцо ещё на экране.
   */
  const cancelUpload = useCallback(() => {
    uploadAbortRef.current?.abort()
  }, [])

  const triggerUpload = useCallback((target: UploadTarget) => {
    uploadTargetRef.current = target
    fileInputRef.current?.click()
  }, [])

  const triggerFolderUpload = useCallback((target: UploadTarget) => {
    uploadTargetRef.current = target
    folderInputRef.current?.click()
  }, [])

  const uploadFolderFiles = useCallback(
    async (list: FileList | File[], target: UploadTarget) => {
      if (!selectedId) return
      const files = Array.from(list).filter((f) => {
        const name = f.name.toLowerCase()
        return name !== ".ds_store" && name !== "thumbs.db"
      })
      if (!files.length) return
      // Кольцо стоит в той папке, куда бросили саму папку, а не в очередной
      // вложенной: человек показал одно место, и отвечать надо в нём.
      const ringPath = target.folderPath.replace(/^\/+|\/+$/g, "")
      const controller = new AbortController()
      uploadAbortRef.current = controller
      setUploading(true)
      try {
        const dirs = new Set<string>()
        for (const file of files) {
          const rel = (file as File & { webkitRelativePath?: string })
            .webkitRelativePath
          if (!rel) continue
          const parts = rel.split("/")
          parts.pop()
          if (parts.length) dirs.add(parts.join("/"))
        }
        for (const ensurePath of [...dirs].sort(
          (a, b) => a.split("/").length - b.split("/").length,
        )) {
          await fetch("/api/storage/v1/mkdir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: selectedId,
              folderPath: target.folderPath,
              ensurePath,
            }),
          })
        }
        // Тот же разговор про занятые имена, что и при заливке файлов, — он
        // здесь даже нужнее: папку роняют повторно чаще, чем отдельный файл, и
        // раньше вся пачка молча упиралась в отказы сервера по одному.
        const resolve = makeConflictResolver()

        for (const [index, file] of files.entries()) {
          if (controller.signal.aborted) break
          const rel = (file as File & { webkitRelativePath?: string })
            .webkitRelativePath
          let folderPath = target.folderPath
          if (rel) {
            const parts = rel.split("/")
            parts.pop()
            const nested = parts.join("/")
            const base = target.folderPath.replace(/^\/+|\/+$/g, "")
            folderPath = nested
              ? base
                ? `${base}/${nested}`
                : nested
              : base
          }
          folderPath = folderPath.replace(/^\/+|\/+$/g, "")

          const verdict = await resolve(
            file,
            folderPath,
            files.length - index - 1,
          )
          if (verdict.skip) continue

          setUploadProgress({
            folderPath: ringPath,
            name: verdict.resolution?.name ?? file.name,
            index: index + 1,
            total: files.length,
            percent: 0,
          })
          try {
            await uploadViaXhr(
              sourceRef.current,
              selectedId,
              file,
              { parentId: null, folderPath },
              verdict.resolution,
              {
                signal: controller.signal,
                onProgress: (percent) =>
                  setUploadProgress((prev) =>
                    prev ? { ...prev, percent } : prev,
                  ),
              },
            )
          } catch (err) {
            if (isUploadCancelled(err)) break
            toast.error(
              err instanceof Error ? err.message : `Upload failed: ${file.name}`,
            )
          }
        }
        if (controller.signal.aborted) toast(tRef.current.uploadCancelled)
        await loadDrive(selectedId, true)
      } finally {
        // Только если пачка ещё наша. Заливки могут наложиться — бросили файл,
        // пока едет предыдущий, — и кончившаяся первой не должна уносить с
        // экрана чужое кольцо и отбирать у второй крестик.
        if (uploadAbortRef.current === controller) {
          uploadAbortRef.current = null
          setUploadProgress(null)
        }
        setUploading(false)
      }
    },
    [selectedId, loadDrive, makeConflictResolver],
  )

  const createTextFile = useCallback(
    (target: UploadTarget) => {
      if (!selectedId) return
      setPrompt({
        title: t.mNewText,
        label: t.folderNamePrompt,
        initial: "untitled.txt",
        confirmLabel: t.create,
        onSubmit: (rawName) => {
          void (async () => {
            let name = rawName.trim() || "untitled.txt"
            if (!/\.(txt|md|json)$/i.test(name)) name = `${name}.txt`
            const blob = new Blob([""], { type: "text/plain" })
            const file = new File([blob], name, { type: "text/plain" })
            try {
              await uploadViaXhr(sourceRef.current, selectedId, file, target)
              await loadDrive(selectedId, true)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed")
            }
          })()
        },
      })
    },
    [selectedId, t, loadDrive],
  )

  const shareProject = useCallback((project: Project) => {
    setShareTarget(project)
  }, [])

  const closeShareDialog = useCallback(() => setShareTarget(null), [])

  const transferProject = useCallback((project: Project) => {
    setTransferTarget(project)
  }, [])

  const closeTransferDialog = useCallback(() => setTransferTarget(null), [])

  /**
   * После переноса проекта в этой области больше нет: он уехал к другому
   * человеку. Поэтому не «обновить карточку», а сбросить выбор и перечитать
   * список — иначе колонка файлов осталась бы открытой на папке, которой здесь
   * уже не место.
   */
  const afterTransfer = useCallback(async () => {
    setTransferTarget(null)
    clearSelection()
    await loadProjects()
  }, [clearSelection, loadProjects])

  const restoreProject = useCallback(
    (project: Project) => {
      void (async () => {
        const res = await fetch("/api/storage/v1/project-restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.message ?? t.restoreProjectFailed)
          return
        }
        toast.success(t.restoreProjectDone)
        await loadProjects()
        // Проект уехал из корзины в свой раздел — уводим туда и человека, если
        // он на него смотрел. Иначе рабочая область осталась бы открытой на
        // проекте, которого в колонке слева уже нет: корзина опустела, а он в
        // ней стоит.
        if (project.id === selectedId) {
          setProjectTab(tabOf({ ...project, deletedAt: null }))
        }
      })()
    },
    [
      loadProjects,
      selectedId,
      setProjectTab,
      tabOf,
      t.restoreProjectDone,
      t.restoreProjectFailed,
    ],
  )

  // ---------- корзина ----------

  const [trashItems, setTrashItems] = useState<TrashItem[]>([])
  const [loadingTrash, setLoadingTrash] = useState(false)
  const [trashProjectId, setTrashProjectId] = useState<string | null>(null)
  const [trashSort, setTrashSort] = useState<TrashSort>("date")
  const [groupProjects, setGroupProjects] = useState(true)
  const [flat, setFlat] = useState(false)

  /**
   * Корзина читается целиком, по всем проектам, и сужается уже здесь.
   *
   * У роута есть и выборка по одному проекту, но интерфейсу она не годится:
   * в ней нет имён проектов (в своей корзине проект и так известен), а колонке
   * слева нужен полный перечень тех, у кого вообще есть удалённое. Читать же
   * два списка вместо одного — это два состояния, которые разъезжаются.
   */
  const loadTrash = useCallback(async () => {
    const url = sourceRef.current.trashUrl?.(null)
    if (!url) {
      setTrashItems([])
      return
    }
    setLoadingTrash(true)
    try {
      const res = await fetch(url)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTrashItems([])
        return
      }
      const raw: unknown[] = Array.isArray(data.items) ? data.items : []
      setTrashItems(
        raw.map((item) => mapTrashItem(item as Record<string, unknown>)),
      )
    } finally {
      setLoadingTrash(false)
    }
  }, [])

  const reloadTrash = useCallback(() => {
    void loadTrash()
  }, [loadTrash])

  // Читаем, только когда на корзину смотрят: в остальное время это запрос по
  // всем проектам сразу ради данных, которые никто не покажет.
  useEffect(() => {
    if (projectTab !== "trash") return
    void loadTrash()
  }, [projectTab, loadTrash])

  const trashProjects = useMemo(() => {
    const byId = new Map<
      string,
      {
        id: string
        name: string
        count: number
        lastDeletedAt: string
        oldestDeletedAt: string
      }
    >()
    for (const item of trashItems) {
      // Удалённые проекты в этот список не идут: у них слева своя карточка, со
      // своим «Восстановить», и вторая строка про те же файлы была бы тем же
      // проектом в корзине дважды.
      if (item.projectDeleted) continue
      const found = byId.get(item.projectId)
      if (found) {
        found.count += 1
        // Список приходит от свежего к старому, но полагаться на это здесь
        // незачем: подпись обещает последнее удаление, а не первое встреченное.
        if (item.deletedAt > found.lastDeletedAt) {
          found.lastDeletedAt = item.deletedAt
        }
        if (item.deletedAt < found.oldestDeletedAt) {
          found.oldestDeletedAt = item.deletedAt
        }
      } else {
        byId.set(item.projectId, {
          id: item.projectId,
          name: item.projectName,
          count: 1,
          lastDeletedAt: item.deletedAt,
          oldestDeletedAt: item.deletedAt,
        })
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [trashItems])

  const trashScoped = useMemo(
    () =>
      trashProjectId
        ? trashItems.filter((item) => item.projectId === trashProjectId)
        : trashItems,
    [trashItems, trashProjectId],
  )

  /**
   * Выбор в колонке корзины один на всех.
   *
   * Строки в ней двух родов — удалённый проект и живой проект с удалёнными
   * файлами, — но выбирают из них по очереди, а не одновременно. Пока это были
   * два независимых состояния, подсвечивались обе строки сразу, а правая область
   * показывала ту, что выбрана проектом: клик по второй выглядел как промах.
   */
  const selectTrashProject = useCallback(
    (id: string | null) => {
      setTrashProjectId(id)
      clearSelection()
    },
    [clearSelection],
  )

  const trashHighlightId = useMemo(() => {
    if (trashProjectId) return trashProjectId
    if (!selectedFile) return null
    return (
      trashItems.find((item) => item.fileId === selectedFile.id)?.projectId ??
      null
    )
  }, [trashProjectId, selectedFile, trashItems])

  const trashItemOf = useCallback(
    (fileId: string) =>
      trashItems.find((item) => item.fileId === fileId) ?? null,
    [trashItems],
  )

  const restoreTrashFile = useCallback(
    (file: DriveFile) => {
      const item = trashItemOf(file.id)
      const url = sourceRef.current.trashRestoreUrl?.()
      if (!item || !url) return
      void (async () => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: item.projectId,
            fileId: item.fileId,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.message ?? tRef.current.restoreItemFailed)
          return
        }
        toast.success(tRef.current.restoreItemDone)
        await loadTrash()
        // Файл вернулся в живой проект. Если на него сейчас смотрят — дерево
        // должно это показать, иначе восстановленного файла в папке не видно.
        if (item.projectId === selectedId) await loadDrive(selectedId, true)
      })()
    },
    [trashItemOf, loadTrash, loadDrive, selectedId],
  )

  const purgeTrashFile = useCallback(
    (file: DriveFile) => {
      const item = trashItemOf(file.id)
      if (!item) return
      const t = tRef.current
      setConfirm({
        title: t.mPurge,
        description: tf(t.confirmPurgeItem, { name: item.name }),
        confirmLabel: t.mPurge,
        destructive: true,
        onConfirm: () => {
          void (async () => {
            const url = sourceRef.current.trashPurgeUrl?.(
              item.projectId,
              item.fileId,
            )
            if (!url) return
            const res = await fetch(url, { method: "DELETE" })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
              toast.error(data.message ?? t.purgeFailed)
              return
            }
            toast.success(t.purgeItemDone)
            await loadTrash()
          })()
        },
      })
    },
    [trashItemOf, loadTrash],
  )

  const purgeProjectForever = useCallback(
    (project: Project) => {
      const t = tRef.current
      setConfirm({
        title: t.mPurge,
        description: tf(t.confirmPurgeProject, { name: project.name }),
        confirmLabel: t.mPurge,
        destructive: true,
        onConfirm: () => {
          void (async () => {
            const url = sourceRef.current.projectPurgeUrl?.()
            if (!url) return
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectId: project.id }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
              toast.error(data.message ?? t.purgeFailed)
              return
            }
            toast.success(t.purgeProjectDone)
            // Проекта больше нет — смотреть на него нельзя даже как на
            // удалённый, поэтому сначала снимаем выбор, потом перечитываем.
            if (project.id === selectedId) clearSelection()
            await loadProjects()
            notifyProjectsChanged()
          })()
        },
      })
    },
    [selectedId, clearSelection, loadProjects],
  )

  /**
   * Очистка корзины — про проекты, а не про файлы.
   *
   * Удалённые файлы живых проектов остаются: они лежат каждый в своей корзине,
   * и «очистить» на разделе, где видны и те и другие, снесло бы заодно их. Для
   * файла есть своё «удалить навсегда», по одному.
   */
  const emptyTrash = useCallback(() => {
    const t = tRef.current
    const doomed = projects.filter((p) => p.deletedAt)
    if (doomed.length === 0) return
    setConfirm({
      title: t.emptyTrashAction,
      description: t.confirmEmptyTrash,
      confirmLabel: t.emptyTrashAction,
      destructive: true,
      onConfirm: () => {
        void (async () => {
          const url = sourceRef.current.projectPurgeUrl?.()
          if (!url) return
          let failed = 0
          for (const project of doomed) {
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectId: project.id }),
            })
            if (!res.ok) failed += 1
          }
          if (failed > 0) toast.error(t.purgeFailed)
          else toast.success(t.emptyTrashDone)
          clearSelection()
          await loadProjects()
          notifyProjectsChanged()
        })()
      },
    })
  }, [projects, clearSelection, loadProjects])

  // ---------- контекстное меню ----------

  const openMenu = useCallback(
    (
      kind: ContextMenuKind,
      event: React.MouseEvent,
      extra?: Partial<ContextMenuState>,
    ) => {
      event.preventDefault()
      event.stopPropagation()
      setMenu({
        x: Math.min(event.clientX, window.innerWidth - 248),
        y: Math.min(event.clientY, window.innerHeight - 330),
        kind,
        ...extra,
      })
    },
    [],
  )

  const closeMenu = useCallback(() => setMenu(null), [])

  // ---------- перемещение ----------

  const openMoveDialog = useCallback(
    (items: DriveFile[]) => setMoveTargets(items.length ? items : null),
    [],
  )
  const closeMoveDialog = useCallback(() => setMoveTargets(null), [])

  /**
   * Внутри проекта перенос идёт через storage v1: `/rename` меняет логический
   * путь, объект в R2 остаётся на месте (см. docs/BACKEND_PLAN.md, модель B).
   * Между проектами — `/move`: копия туда и оригинал в корзину одной работой.
   */
  const moveItems = useCallback(
    async (
      items: DriveFile[],
      destFolderPath: string,
      projects?: { from?: string; to?: string },
    ) => {
      const fromId = projects?.from ?? selectedId
      const toId = projects?.to ?? selectedId
      if (!selectedId || !fromId || !toId || items.length === 0) return

      if (fromId !== toId) {
        const url = sourceRef.current.crossProjectMoveUrl?.()
        if (!url) {
          toast.error(t.moveCrossProject)
          return
        }
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: fromId,
            fileIds: items.map((f) => f.id),
            destProjectId: toId,
            destFolderPath,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.message ?? "Move failed")
          return
        }
        setSelection([])
        setClipboard(null)
        if (res.status === 202 && data.jobId) {
          // Папку ждём в фоне: диалог и буфер отпускаем сразу, а дерево
          // перечитаем, когда работа доедет.
          toast.message(t.moveStarted)
          void waitForStorageJob(data.jobId).then(async (job) => {
            if (job.state === "done") toast.success(t.mMove)
            if (job.state === "failed") toast.error(job.error ?? "Move failed")
            await loadDrive(selectedId, true)
          })
          return
        }
        toast.success(t.mMove)
        await loadDrive(selectedId, true)
        return
      }

      let failed = 0
      for (const file of items) {
        const res = await fetch(sourceRef.current.moveUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: fromId,
            fileId: file.id,
            folderPath: destFolderPath,
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          failed += 1
          toast.error(data.message ?? `${file.name}: failed`)
        }
      }
      if (failed === 0) toast.success(t.mMove)
      setSelection([])
      setClipboard(null)
      await loadDrive(selectedId, true)
    },
    [selectedId, t.mMove, t.moveCrossProject, t.moveStarted, loadDrive],
  )

  // ---------- буфер обмена ----------

  const putToClipboard = useCallback(
    (op: ClipboardOp, items: DriveFile[]) => {
      if (!selectedId || items.length === 0) return
      setClipboard({ op, items, projectId: selectedId })
    },
    [selectedId],
  )

  const removeFromClipboard = useCallback((id: string) => {
    setClipboard((prev) => {
      if (!prev) return prev
      const items = prev.items.filter((f) => f.id !== id)
      // пустой буфер держать незачем — панель просто исчезает
      return items.length ? { ...prev, items } : null
    })
  }, [])

  const clearClipboard = useCallback(() => setClipboard(null), [])

  const pasteClipboard = useCallback(
    (destFolderPath: string) => {
      if (!clipboard || !selectedId) return
      if (clipboard.op === "cut") {
        // Буфер переживает смену проекта: вырезанное в другом проекте
        // переезжает между проектами.
        void moveItems(clipboard.items, destFolderPath, {
          from: clipboard.projectId,
          to: selectedId,
        })
        return
      }
      void (async () => {
        const res = await fetch("/api/storage/v1/copy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: clipboard.projectId,
            fileIds: clipboard.items.map((f) => f.id),
            destProjectId: selectedId,
            destFolderPath,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.message ?? "Copy failed")
          return
        }
        if (res.status === 202 && data.jobId) {
          toast.message(`Copy started (${data.jobId.slice(0, 8)}…)`)
          const job = await waitForStorageJob(data.jobId)
          if (job.state === "done") toast.success(t.clipboardPaste)
          if (job.state === "failed") toast.error(job.error ?? "Copy failed")
        } else {
          toast.success(t.clipboardPaste)
        }
        setClipboard(null)
        await loadDrive(selectedId, true)
      })()
    },
    [clipboard, selectedId, moveItems, loadDrive, t.clipboardPaste],
  )

  const isCut = useCallback(
    (id: string) =>
      clipboard?.op === "cut" && clipboard.items.some((f) => f.id === id),
    [clipboard],
  )

  // ---------- сборка элемента в папке IN ----------

  const [elementForm, setElementForm] = useState<SiteForm | null>(null)
  const [elementFormError, setElementFormError] = useState<SiteFormError | null>(
    null,
  )
  const [elementTarget, setElementTarget] = useState<{
    folder: DriveFile | null
  } | null>(null)

  /**
   * Форма сборки выбранного проекта.
   *
   * Читается сайдкаром, а не из `options.json`: там граф, и доставать форму
   * оттуда значило бы завести второго читателя модели нод, который ломается
   * молча при любой правке редактора (план §4.1).
   *
   * 404 — обычное дело, а не сбой: проект просто не собирается папками. Поэтому
   * тишина и пустая форма, без тоста.
   */
  useEffect(() => {
    if (!elementEnabled || !selectedId) {
      setElementForm(null)
      setElementFormError(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/storage/v1/sidecars?projectId=${encodeURIComponent(
            selectedId,
          )}&name=on-site-folder-check-form`,
        )
        if (!res.ok) {
          // 404 — обычное дело: проект не собирается папками. Всё остальное
          // (403, 500) кончается тем же — кнопки нет, — и раньше эти случаи
          // были неотличимы вообще ничем. Сообщение в консоли не меняет
          // поведения, но снимает главный вопрос диагностики: «его правда нет
          // или нам его не отдали?».
          if (res.status !== 404) {
            console.warn(
              "[element] assembly form not read:",
              res.status,
              res.statusText,
            )
          }
          if (!cancelled) {
            setElementForm(null)
            setElementFormError(null)
          }
          return
        }
        const data = (await res.json()) as { body?: string }
        const parsed = parseSiteFormBody(data.body ?? "")
        if (cancelled) return
        if (parsed.ok) {
          setElementForm(parsed.form)
          setElementFormError(null)
        } else {
          // Форма есть, но прочитать её нечем. Кнопку в этом случае всё равно
          // показываем: молча спрятать её значит оставить человека без
          // объяснения, почему папки больше не собираются. Объяснение он
          // получит в диалоге — там же, где и отказ открыться.
          setElementForm(null)
          setElementFormError(parsed.error)
        }
      } catch (error) {
        // Сеть отвалилась или ответ не разобрался. Молчать нельзя по той же
        // причине: снаружи это выглядит как «кнопки просто нет».
        console.warn("[element] assembly form request failed:", error)
        if (!cancelled) {
          setElementForm(null)
          setElementFormError(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [elementEnabled, selectedId])

  const isElementFolder = useCallback(
    (file: DriveFile) => {
      if (!elementEnabled || !file.isFolder) return false
      // Единица работы конвейера — элемент ВЕРХНЕГО уровня IN; глубже папок
      // элемента не бывает, и предлагать там правку нечему.
      if (folderPathOf(rootFiles, file.id) !== "IN") return false
      if (!elementForm) return false
      return looksLikeElement(elementForm.rows, file)
    },
    [elementEnabled, elementForm, rootFiles],
  )

  /**
   * Запрет переименования внутри элемента.
   *
   * Считаем по пути, а не по метке: путь `IN/-Ролик/01 Сцена` говорит, что
   * второй сегмент — папка верхнего уровня IN, и если она элемент, то всё под
   * ней тоже. Файл, лежащий ПРЯМО в `IN`, под запрет не попадает: это обычный
   * одиночный исходник, и инструмент к нему отношения не имеет.
   */
  const isInsideElement = useCallback(
    (file: DriveFile) => {
      if (!elementEnabled || !elementForm) return false
      if (isElementFolder(file)) return true
      const path = folderPathOf(rootFiles, file.id)
      if (!path) return false
      const segments = path.split("/").filter(Boolean)
      if (segments[0] !== "IN" || segments.length < 2) return false
      const top = findChildByName(rootFiles, "IN")
      const holder = (top?.children ?? []).find(
        (child) => child.isFolder && child.name === segments[1],
      )
      return holder ? isElementFolder(holder) : false
    },
    [elementEnabled, elementForm, isElementFolder, rootFiles],
  )

  const openElementDialog = useCallback((folder: DriveFile | null = null) => {
    setElementTarget({ folder })
  }, [])

  const closeElementDialog = useCallback(() => setElementTarget(null), [])

  const value: WorkspaceValue = {
    t,
    lang,
    source,
    projects,
    visibleProjects,
    counts,
    projectTab,
    setProjectTab,
    loadingProjects,
    query,
    setQuery,
    selectedId,
    selected,
    can,
    capabilitiesFor,
    selectProject,
    clearSelection,
    creating,
    createProject,
    renameProject,
    patchProject,
    setArchived,
    deleteProject,
    reloadProjects: loadProjects,
    rootFiles,
    driveAvailable,
    loadingFiles,
    refreshDrive,
    inFolder,
    outFolder,
    inStatusOf,
    elementEnabled,
    elementForm,
    elementFormError,
    elementTarget,
    openElementDialog,
    closeElementDialog,
    isElementFolder,
    isInsideElement,
    exposedOptions,
    skippedOptions,
    fileTypes,
    saveExposedOptions: source.exposedOptionsUrl ? saveExposedOptions : null,
    path,
    currentItems,
    currentTarget,
    openFolder,
    goToCrumb,
    goToPath,
    revealPath,
    revealFileId,
    consumeReveal,
    selection,
    selectedFile,
    isSelected,
    selectFile,
    selectRange,
    setSelectedFile,
    clearFileSelection,
    density,
    setDensity,
    view,
    setView,
    bottomTab,
    setBottomTab,
    previewOpen,
    openPreview,
    closePreview,
    previewSiblings,
    stepPreview,
    uploading,
    uploadProgress,
    cancelUpload,
    createFolder,
    canReprocess,
    reprocessItem,
    renameItem,
    deleteItem,
    deleteItems,
    downloadItem,
    archiveTarget,
    openArchiveDialog,
    closeArchiveDialog,
    uploadFiles,
    conflict,
    triggerUpload,
    createTextFile,
    triggerFolderUpload,
    shareProject,
    shareTarget,
    transferProject,
    transferTarget,
    closeTransferDialog,
    afterTransfer,
    closeShareDialog,
    restoreProject,
    purgeProjectForever,
    trashItems,
    loadingTrash,
    trashProjects,
    trashProjectId,
    selectTrashProject,
    trashScoped,
    trashHighlightId,
    trashItemOf,
    trashSort,
    setTrashSort,
    groupProjects,
    setGroupProjects,
    flat,
    setFlat,
    reloadTrash,
    restoreTrashFile,
    purgeTrashFile,
    emptyTrash,
    moveTargets,
    openMoveDialog,
    closeMoveDialog,
    moveItems,
    clipboard,
    putToClipboard,
    removeFromClipboard,
    clearClipboard,
    pasteClipboard,
    isCut,
    menu,
    openMenu,
    closeMenu,
    descDraft,
    setDescDraft,
    saveDescription,
    messages,
    draft,
    setDraft,
    sendMessage,
    openChat,
    prompt,
    setPrompt,
    confirm,
    setConfirm,
    notImplemented,
  }

  return (
    <Ctx.Provider value={value}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            void uploadFiles(e.target.files, uploadTargetRef.current)
          }
          e.target.value = ""
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(e) => {
          if (e.target.files) {
            void uploadFolderFiles(e.target.files, uploadTargetRef.current)
          }
          e.target.value = ""
        }}
      />
      {children}
    </Ctx.Provider>
  )
}
