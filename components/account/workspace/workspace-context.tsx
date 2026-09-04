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
import { uploadProjectFileDirect } from "@/lib/project-direct-upload"
import {
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
  UploadTarget,
  ViewMode,
  WorkspaceCapabilities,
  WorkspaceSource,
} from "./types"

const DENSITY_KEY = "ffworks-ws-density"
const CHAT_POLL_INTERVAL_MS = 6000
const VIEW_KEY = "ffworks-ws-view"
const DELTA_INTERVAL_MS = 4000

/**
 * Раздел списка проектов. Живёт в URL (`?tab=…`), потому что в боковом меню
 * это обычные ссылки, а не состояние страницы.
 */
export type ProjectTab = "projects" | "shared" | "tools" | "archive" | "trash"

const PROJECT_TABS: ProjectTab[] = [
  "projects",
  "shared",
  "tools",
  "archive",
  "trash",
]

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

  // хранилище
  rootFiles: DriveFile[]
  driveAvailable: boolean
  loadingFiles: boolean
  refreshDrive: () => void
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
  setBottomTab: (tab: BottomTab) => void

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

  // перемещение
  /** Элементы, для которых открыт диалог выбора папки назначения. */
  moveTargets: DriveFile[] | null
  openMoveDialog: (items: DriveFile[]) => void
  closeMoveDialog: () => void
  /** Перенос внутри проекта: меняется только логический путь. */
  moveItems: (items: DriveFile[], destFolderPath: string) => Promise<void>

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

  notImplemented: () => void
}

const Ctx = createContext<WorkspaceValue | null>(null)

export function useWorkspace() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider")
  return ctx
}

async function uploadViaXhr(
  source: WorkspaceSource,
  projectId: string,
  file: File,
  target: UploadTarget,
  /** Как поступить с занятым именем: под новым именем или поверх старого. */
  resolution?: { name?: string; overwrite?: boolean },
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
    })
    return
  }
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({ fileName: name })
    if (target.parentId) qs.set("parentId", target.parentId)
    else qs.set("folderPath", target.folderPath ?? "")
    const xhr = new XMLHttpRequest()
    xhr.open("POST", source.uploadUrl(projectId, qs))
    xhr.withCredentials = true
    if (file.type) xhr.setRequestHeader("Content-Type", file.type)
    xhr.setRequestHeader("x-file-name", encodeURIComponent(name))
    xhr.onload = () => {
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
    xhr.onerror = () => reject(new Error("Network error during upload."))
    xhr.send(file)
  })
}

export function WorkspaceProvider({
  children,
  source = CABINET_SOURCE,
}: {
  children: React.ReactNode
  /**
   * Откуда брать данные и что разрешено. По умолчанию кабинет, поэтому
   * /account/projects работает как раньше; админский «Конвейер» передаёт свой.
   */
  source?: WorkspaceSource
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
  const [bottomTab, setBottomTab] = useState<BottomTab>("desc")

  const [uploading, setUploading] = useState(false)
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
          setPath([])
          toast.error(tRef.current.driveUnavailable)
          return
        }
        setDriveAvailable(true)
        setExposedOptions(Array.isArray(data.options) ? data.options : [])
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

        const cursorRes = await fetch(sourceRef.current.treeCursorUrl(projectId))
        if (cursorRes.ok) {
          const cursorData = await cursorRes.json()
          if (typeof cursorData.cursor === "number") {
            storageCursorRef.current = cursorData.cursor
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
    // Отметка «прочитано» есть только у пользователя: со стороны команды такого
    // признака в схеме нет, поэтому в админке шаг просто пропускается.
    const chatReadUrl = sourceRef.current.chatReadUrl
    if (chatReadUrl) {
      void fetch(chatReadUrl(projectId), { method: "POST" }).catch(
        () => undefined,
      )
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
   * Разделы в боковом меню плоские, поэтому группировки внутри списка больше нет.
   */
  const tabOf = useCallback((p: Project): ProjectTab => {
    if (p.deletedAt) return "trash"
    if (p.sharedWithMe) return "shared"
    if (p.isArchived) return "archive"
    if (p.groupName === "tools") return "tools"
    return "projects"
  }, [])

  const counts = useMemo(() => {
    const acc: Record<ProjectTab, number> = {
      projects: 0,
      shared: 0,
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
          if (body.code === "trial-over" || body.code === "no-funds") {
            toast.error(
              body.code === "trial-over"
                ? t.trialBannerOver
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
        description: t.confirmDeleteProject,
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

  const refreshDrive = useCallback(() => {
    if (selectedId) void loadDrive(selectedId, true)
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

      setUploading(true)
      try {
        for (const [index, file] of files.entries()) {
          const verdict = await resolve(
            file,
            folderPath,
            files.length - index - 1,
          )
          if (verdict.skip) continue

          try {
            await uploadViaXhr(
              sourceRef.current,
              selectedId,
              file,
              target,
              verdict.resolution,
            )
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : `Upload failed: ${file.name}`,
            )
          }
        }
        await loadDrive(selectedId, true)
      } finally {
        setUploading(false)
      }
    },
    [selectedId, loadDrive, makeConflictResolver],
  )

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

          try {
            await uploadViaXhr(
              sourceRef.current,
              selectedId,
              file,
              { parentId: null, folderPath },
              verdict.resolution,
            )
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : `Upload failed: ${file.name}`,
            )
          }
        }
        await loadDrive(selectedId, true)
      } finally {
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
          toast.error(data.message ?? "Restore failed")
          return
        }
        toast.success(t.mUnarchive)
        await loadProjects()
      })()
    },
    [loadProjects, t.mUnarchive],
  )

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
   * Перенос идёт через storage v1: `/rename` меняет логический путь,
   * объект в R2 остаётся на месте (см. docs/BACKEND_PLAN.md, модель B).
   */
  const moveItems = useCallback(
    async (items: DriveFile[], destFolderPath: string) => {
      if (!selectedId || items.length === 0) return
      let failed = 0
      for (const file of items) {
        const res = await fetch(sourceRef.current.moveUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: selectedId,
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
    [selectedId, t.mMove, loadDrive],
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
        void moveItems(clipboard.items, destFolderPath)
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
          // Poll briefly then refresh.
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 1000))
            const jobRes = await fetch(`/api/storage/v1/jobs/${data.jobId}`)
            if (!jobRes.ok) break
            const jobData = await jobRes.json()
            const state = jobData.job?.state
            if (state === "done") {
              toast.success(t.clipboardPaste)
              break
            }
            if (state === "failed") {
              toast.error(jobData.job?.error ?? "Copy failed")
              break
            }
          }
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
    rootFiles,
    driveAvailable,
    loadingFiles,
    refreshDrive,
    inFolder,
    outFolder,
    inStatusOf,
    exposedOptions,
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
