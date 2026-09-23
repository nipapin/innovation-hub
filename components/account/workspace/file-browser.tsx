"use client"

import { useEffect, useRef, useState } from "react"
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Loader2,
  Plus,
  SquarePen,
  Upload,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  fileIcon,
  fileIconClass,
  fileMeta,
  flattenTree,
  itemsAtPath,
  pathToFolderPath,
  resolvePath,
} from "./format"
import type { DriveFile, InItemStatus, UploadTarget, ViewMode } from "./types"
import { UploadRing } from "./upload-ring"
import { useWorkspace } from "./workspace-context"

/** Профиль плотности: roomy — полный режим, snug — панели IN / OUT. */
type Size = "roomy" | "snug"

function targetFor(
  basePath: string | undefined,
  nodes: DriveFile[],
): UploadTarget {
  const tail = pathToFolderPath(nodes)
  return {
    parentId: nodes.length ? nodes[nodes.length - 1].id : null,
    folderPath: [basePath, tail].filter(Boolean).join("/"),
  }
}

/**
 * Держит локальный путь панели на узлах свежего дерева.
 *
 * Путь хранится узлами, а содержимое папки `itemsAtPath` берёт из `children`
 * последнего из них. Дерево же перечитывается целиком — после каждой заливки и
 * по опросу delta, — и узлы в нём каждый раз новые объекты. Пока путь не
 * пересобран, открытая подпапка показывает снимок, сделанный до перечитывания:
 * файл на сервер лёг, а в папке не появился.
 *
 * Полного режима это не касается — там путь живёт в контексте, и `loadDrive`
 * пересобирает его сам. Свои пути есть у мобильного вида и у панелей
 * упрощённого режима, им и нужен этот хук.
 */
export function useLivePath(
  root: DriveFile[],
  path: DriveFile[],
  onNavigate: (nodes: DriveFile[]) => void,
) {
  useEffect(() => {
    if (path.length === 0) return
    const next = resolvePath(root, path)
    // Сравниваем по ссылке: те же узлы — дерево не менялось, трогать нечего.
    // Без этой проверки хук зациклился бы на себе: `resolvePath` возвращает
    // новый массив на каждый вызов.
    const same =
      next.length === path.length && next.every((n, i) => n === path[i])
    if (same) return
    onNavigate(next)
  }, [root, path, onNavigate])
}

/**
 * Зона приёма перетаскиваемых файлов.
 *
 * dragenter / dragleave стреляют и на дочерних элементах, поэтому считаем глубину
 * входов — иначе подсветка мигает при движении мыши над содержимым зоны.
 * Каждая зона независима: в колоночном виде своя у каждой колонки.
 */
function useDropZone(target: UploadTarget) {
  const { can, uploadFiles } = useWorkspace()
  const canUpload = can.upload
  const [active, setActive] = useState(false)
  const depth = useRef(0)

  const handlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!canUpload) return
      if (!e.dataTransfer.types.includes("Files")) return
      e.stopPropagation()
      depth.current += 1
      setActive(true)
    },
    onDragOver: (e: React.DragEvent) => {
      if (!canUpload) return
      if (!e.dataTransfer.types.includes("Files")) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = "copy" as const
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!canUpload) return
      e.stopPropagation()
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setActive(false)
    },
    onDrop: (e: React.DragEvent) => {
      if (!canUpload) return
      e.preventDefault()
      e.stopPropagation()
      depth.current = 0
      setActive(false)
      if (e.dataTransfer.files.length) {
        void uploadFiles(e.dataTransfer.files, target)
      }
    },
  }

  return { active, handlers }
}

/**
 * Куда попадут файлы, если отпустить их здесь.
 *
 * Одна и та же подсказка во всех видах: раньше цель загрузки было видно только
 * в колоночном виде — там подсвечивалась колонка, — а в списке и плитке
 * оставалась лишь тонкая рамка вокруг области, по которой папку не назвать.
 * Не ловит указатель: иначе собственные dragenter / dragleave наложились бы на
 * счётчик глубины в зоне и подсветка замигала бы.
 */
function DropHint({ target, size }: { target: UploadTarget; size: Size }) {
  const { t } = useWorkspace()
  const segments = target.folderPath ? target.folderPath.split("/") : []
  const name = segments.length ? segments[segments.length - 1] : t.projectRoot
  const full = segments.join(" / ")

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-ws-select/[0.12] p-2">
      <span
        title={full || undefined}
        className={cn(
          "flex max-w-full flex-col items-center gap-1 rounded-xl border border-ws-select/60 bg-ws-panel/95 text-center shadow-ws-panel",
          size === "roomy" ? "px-4 py-3" : "px-3 py-2.5",
        )}
      >
        <Upload
          className={cn(
            "text-ws-select",
            size === "roomy" ? "h-5 w-5" : "h-4 w-4",
          )}
        />
        <span
          className={cn(
            "text-ws-4",
            size === "roomy" ? "text-[11.5px]" : "text-[10.5px]",
          )}
        >
          {t.dropUploadTo}
        </span>
        <span
          className={cn(
            "max-w-full truncate font-semibold text-ws-1",
            size === "roomy" ? "text-[14px]" : "text-[12.5px]",
          )}
        >
          {name}
        </span>
      </span>
    </div>
  )
}

export function Breadcrumbs({
  rootLabel,
  path,
  onNavigate,
}: {
  rootLabel: string
  path: DriveFile[]
  onNavigate: (nodes: DriveFile[]) => void
}) {
  const crumbs = [{ name: rootLabel, depth: 0 }].concat(
    path.map((n, i) => ({ name: n.name, depth: i + 1 })),
  )
  return (
    <div className="flex flex-wrap items-center gap-1">
      {crumbs.map((c, i) => (
        <span key={`${c.name}-${i}`} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onNavigate(path.slice(0, c.depth))}
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[12px] hover:bg-foreground/5",
              i === crumbs.length - 1 ? "text-ws-2" : "text-ws-4",
            )}
          >
            {c.name}
          </button>
          {i < crumbs.length - 1 ? (
            <span className="text-[12px] text-ws-5">/</span>
          ) : null}
        </span>
      ))}
    </div>
  )
}

/**
 * Отметка на элементе папки IN: задача по нему уже была.
 *
 * Нужна из-за правила, на котором держатся обе линии сборки: элемент, по
 * которому задача создавалась, не берётся больше никогда (docs/PIPELINE.md §3).
 * Обработанный файл остаётся лежать в IN рядом с только что залитым и выглядит
 * ровно так же — «почему ничего не происходит» было вопросом, на который папка
 * не отвечала, а «Обработать заново» находил только тот, кто заранее знал, что
 * файл встал.
 *
 * Значок, а не подпись: места в плитке и в узкой колонке считанные единицы, а
 * сказать нужно одно слово. Само слово — в подсказке по наведению, там же, где
 * оно понадобится.
 *
 * Отсутствие значка тоже сообщение: задачи не было, элемент ещё поедет. Поэтому
 * «ждёт очереди» ничем не помечаем — иначе значок стоял бы вообще на всём и
 * перестал бы что-либо различать.
 */
const IN_MARK: Record<
  InItemStatus,
  {
    icon: typeof CircleCheck
    tone: string
    /** Ключ подписи в словаре — она же подсказка по наведению. */
    key: "inMarkDone" | "inMarkQueued" | "inMarkRunning" | "inMarkFailed"
  }
> = {
  done: { icon: CircleCheck, tone: "text-ws-out", key: "inMarkDone" },
  running: {
    icon: Loader2,
    tone: "text-ws-accent animate-spin",
    key: "inMarkRunning",
  },
  queued: { icon: Clock, tone: "text-ws-accent", key: "inMarkQueued" },
  failed: { icon: CircleAlert, tone: "text-destructive", key: "inMarkFailed" },
}

function InMark({ file, className }: { file: DriveFile; className?: string }) {
  const { t, inStatusOf } = useWorkspace()
  const status = inStatusOf(file)
  if (!status) return null

  const { icon: Icon, tone, key } = IN_MARK[status]
  const label = t[key]
  // Обёртка, а не title на самой иконке: у <svg> это не подсказка браузера, а
  // просто неизвестный атрибут — всплывающего текста от него не будет.
  return (
    <span
      title={label}
      aria-label={label}
      className={cn("flex shrink-0 items-center", className)}
    >
      <Icon className={cn("h-[13px] w-[13px]", tone)} aria-hidden />
    </span>
  )
}

/**
 * «Править элемент» на строке папки в `IN`.
 *
 * `span`, а не `button`: строка файла сама по себе кнопка, а кнопка внутри
 * кнопки — недопустимая разметка, и браузеры разбирают её кто во что горазд.
 * Появляется по наведению на строку; то же действие есть в контекстном меню —
 * иконку при наведении находят не все.
 */
function ElementEditMark({
  file,
  className,
}: {
  file: DriveFile
  className?: string
}) {
  const { t, isElementFolder, openElementDialog, can } = useWorkspace()
  if (!can.renameItem || !isElementFolder(file)) return null

  return (
    <span
      role="button"
      tabIndex={0}
      title={t.elementEdit}
      aria-label={t.elementEdit}
      onClick={(e) => {
        e.stopPropagation()
        openElementDialog(file)
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return
        e.stopPropagation()
        e.preventDefault()
        openElementDialog(file)
      }}
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ws-4",
        "opacity-0 transition-opacity hover:bg-foreground/[0.07] hover:text-ws-1",
        "group-hover:opacity-100 focus-visible:opacity-100",
        className,
      )}
    >
      <SquarePen className="h-[15px] w-[15px]" />
    </span>
  )
}

/**
 * Можно ли добавить элемент в эту папку.
 *
 * Отдельно от самой кнопки, потому что ответ нужен ДО отрисовки списка: пустая
 * папка `IN` показывает не «папка пуста», а сразу кнопку, и решать это надо
 * там, где выбирается ветка разметки.
 *
 * Кнопка есть, только если граф работает с папками: форма приезжает из
 * `options/onSiteFolderCheckForm.json`, и нет файла — нет и кнопки, собирать не
 * по чему (план §4.1). Форму не прочитали — кнопку всё равно показываем:
 * объяснение, почему папки больше не собираются, человек получит в диалоге, а
 * не в тишине.
 */
function useCanAddElement(target: UploadTarget): boolean {
  const { elementForm, elementFormError, can } = useWorkspace()
  if (target.folderPath !== "IN") return false
  if (!can.createFolder) return false
  return Boolean(elementForm || elementFormError)
}

/**
 * «Новый элемент» — такой же ячейкой, как всё остальное в этой области.
 *
 * Вид плиткой — значит плитка, список — значит строка, колонки — строка
 * колонки. Полоса во всю ширину внизу, какой кнопка была сначала, выпадала из
 * ряда: она читалась как подпись к области, а не как ещё один элемент, который
 * можно завести. Геометрия поэтому повторяет `FileCard` и `FileRow` — вплоть до
 * скруглений и отступов, — а отличает кнопку только пунктир.
 */
function NewElementCell({
  target,
  shape,
  size = "roomy",
}: {
  target: UploadTarget
  shape: "row" | "card" | "column"
  size?: Size
}) {
  const { t, openElementDialog } = useWorkspace()
  const roomy = size === "roomy"

  const frame =
    "select-none border border-dashed border-foreground/20 text-left text-ws-3 transition-colors hover:border-foreground/40 hover:bg-foreground/[0.04] hover:text-ws-1"

  if (shape === "column") {
    return (
      <button
        type="button"
        onClick={() => openElementDialog(null)}
        className={cn(
          "mb-0.5 flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2",
          frame,
        )}
      >
        <Plus className="h-[18px] w-[18px] shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[14px]">{t.elementNew}</span>
      </button>
    )
  }

  if (shape === "card") {
    return (
      <button
        type="button"
        onClick={() => openElementDialog(null)}
        className={cn(
          frame,
          roomy
            ? "flex items-center gap-3 rounded-2xl p-[18px]"
            : "flex flex-col gap-2 rounded-[11px] p-3",
        )}
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04]",
            roomy ? "h-12 w-12" : "h-9 w-9",
          )}
        >
          <Plus className={cn(roomy ? "h-[26px] w-[26px]" : "h-5 w-5")} />
        </span>
        <span className={cn("min-w-0 truncate", roomy ? "text-[16.5px]" : "text-[13px]")}>
          {t.elementNew}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => openElementDialog(null)}
      className={cn(
        "flex w-full items-center",
        frame,
        roomy ? "gap-3.5 rounded-[14px] p-[13px]" : "gap-3 rounded-[10px] px-[11px] py-[9px]",
      )}
    >
      {roomy ? (
        <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border border-dashed border-foreground/20">
          <Plus className="h-6 w-6" />
        </span>
      ) : (
        <Plus className="h-5 w-5 shrink-0" />
      )}
      <span className={cn("min-w-0 flex-1 truncate", roomy ? "text-[16.5px]" : "text-[13.5px]")}>
        {t.elementNew}
      </span>
    </button>
  )
}

function FileRow({
  file,
  size,
  subtitle,
  onOpen,
  onPreview,
  onContext,
}: {
  file: DriveFile
  size: Size
  /** Откуда файл: путь до него в режиме «без папок», проект в корне корзины. */
  subtitle?: string | null
  onOpen: (e: React.MouseEvent) => void
  onPreview: () => void
  onContext: (e: React.MouseEvent) => void
}) {
  const { t, lang, isSelected: checkSelected, isCut, menu } = useWorkspace()
  const Icon = fileIcon(file)
  const isSelected = checkSelected(file.id)
  const isMenuTarget = menu?.kind === "file" && menu.file?.id === file.id
  const roomy = size === "roomy"

  return (
    <button
      type="button"
      data-file-id={file.id}
      onClick={onOpen}
      onDoubleClick={onPreview}
      onContextMenu={onContext}
      className={cn(
        "group flex w-full select-none items-center border text-left transition-opacity hover:bg-foreground/5",
        isCut(file.id) && "opacity-45",
        roomy
          ? "gap-3.5 rounded-[14px] p-[13px]"
          : "gap-3 rounded-[10px] px-[11px] py-[9px]",
        isMenuTarget
          ? "border-ws-accent/55 bg-ws-accent/[0.14]"
          : isSelected
            ? "border-ws-select/50 bg-ws-select/[0.16]"
            : "border-foreground/[0.07] bg-ws-control",
      )}
    >
      {roomy ? (
        <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border border-foreground/[0.08] bg-ws-control">
          <Icon className={cn("h-6 w-6", fileIconClass(file))} />
        </span>
      ) : (
        <Icon className={cn("h-5 w-5 shrink-0", fileIconClass(file))} />
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-ws-1",
            roomy ? "text-[16.5px]" : "text-[13.5px]",
          )}
        >
          {file.name}
        </span>
        {/* Путь отдельной строкой, а не приклеенным к размеру и дате: в режиме
            без папок это главное, что отличает один файл от другого, и теряться
            в хвосте служебной строки ему нельзя. */}
        {subtitle ? (
          <span
            title={subtitle}
            className={cn(
              "mt-0.5 block truncate text-ws-5",
              roomy ? "text-[12.5px]" : "text-[11px]",
            )}
          >
            {subtitle}
          </span>
        ) : null}
        <span
          className={cn(
            "mt-0.5 block text-ws-4",
            roomy ? "text-[13.5px]" : "text-[11.5px]",
          )}
        >
          {fileMeta(file, t, lang)}
        </span>
      </span>
      <ElementEditMark file={file} />
      <InMark file={file} />
      {file.isFolder ? (
        <ChevronRight
          className={cn(
            "shrink-0 text-ws-4",
            roomy ? "h-[18px] w-[18px]" : "h-4 w-4",
          )}
        />
      ) : null}
    </button>
  )
}

function FileCard({
  file,
  size,
  subtitle,
  onOpen,
  onPreview,
  onContext,
}: {
  file: DriveFile
  size: Size
  subtitle?: string | null
  onOpen: (e: React.MouseEvent) => void
  onPreview: () => void
  onContext: (e: React.MouseEvent) => void
}) {
  const { t, lang, isSelected: checkSelected, isCut, menu } = useWorkspace()
  const Icon = fileIcon(file)
  const isSelected = checkSelected(file.id)
  const isMenuTarget = menu?.kind === "file" && menu.file?.id === file.id
  const roomy = size === "roomy"

  return (
    <button
      type="button"
      data-file-id={file.id}
      onClick={onOpen}
      onDoubleClick={onPreview}
      onContextMenu={onContext}
      className={cn(
        // relative — под отметку обработки в правом верхнем углу плитки.
        "relative select-none border bg-ws-control text-left transition-opacity hover:border-foreground/[0.18]",
        isCut(file.id) && "opacity-45",
        roomy
          ? "flex items-center gap-3 rounded-2xl p-[18px]"
          : "flex flex-col gap-2 rounded-[11px] p-3",
        isMenuTarget
          ? "border-ws-accent/70"
          : isSelected
            ? "border-ws-select"
            : "border-foreground/10",
      )}
    >
      {roomy ? (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04]">
          <Icon className={cn("h-[26px] w-[26px]", fileIconClass(file))} />
        </span>
      ) : (
        <Icon className={cn("h-6 w-6", fileIconClass(file))} />
      )}
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate text-ws-1",
            roomy ? "text-[16.5px]" : "text-[13px]",
          )}
        >
          {file.name}
        </span>
        {subtitle ? (
          <span
            title={subtitle}
            className={cn(
              "mt-0.5 block truncate text-ws-5",
              roomy ? "text-[12.5px]" : "text-[11px]",
            )}
          >
            {subtitle}
          </span>
        ) : null}
        <span
          className={cn(
            "mt-0.5 block truncate text-ws-4",
            roomy ? "text-[13.5px]" : "text-[11.5px]",
          )}
        >
          {fileMeta(file, t, lang)}
        </span>
      </span>
      <InMark file={file} className="absolute right-2 top-2" />
      <ElementEditMark file={file} className="absolute right-2 bottom-2" />
    </button>
  )
}

/**
 * Одна колонка в колоночном виде — самостоятельная зона:
 * своя цель загрузки, своя подсветка при перетаскивании
 * и подсветка при открытом на ней контекстном меню.
 */
function FileColumn({
  depth,
  list,
  colTarget,
  prefix,
  path,
  size,
  emptyMessage,
  onNavigate,
}: {
  depth: number
  list: DriveFile[]
  colTarget: UploadTarget
  prefix: DriveFile[]
  path: DriveFile[]
  size: Size
  emptyMessage: string
  onNavigate: (nodes: DriveFile[]) => void
}) {
  const ws = useWorkspace()
  const { openMenu, menu, uploadProgress } = ws
  const drop = useDropZone(colTarget)
  const canAddElement = useCanAddElement(colTarget)

  // Меню открыто на этой колонке — подсвечиваем, чтобы было видно,
  // где именно произойдёт действие.
  const isMenuHere = menu?.target?.folderPath === colTarget.folderPath
  // Льют в эту колонку — кольцо заливки её.
  const ringHere = uploadProgress?.folderPath === colTarget.folderPath

  return (
    <div
      onContextMenu={(e) => openMenu("empty", e, { target: colTarget })}
      {...drop.handlers}
      className={cn(
        "relative shrink-0 border-r border-foreground/[0.07] transition-colors",
        size === "roomy" ? "w-[212px]" : "w-[190px]",
        drop.active && "outline outline-2 -outline-offset-2 outline-ws-select",
        !drop.active && isMenuHere && "bg-ws-accent/[0.07] outline outline-1 -outline-offset-1 outline-ws-accent/40",
      )}
    >
      <div className="h-full overflow-y-auto p-2">
        {list.length === 0 && !canAddElement ? (
          <p className="px-2 py-4 text-[12px] text-ws-5">{emptyMessage}</p>
        ) : (
          list.map((f) => {
            const active = f.isFolder
              ? path[depth]?.id === f.id || ws.isSelected(f.id)
              : ws.isSelected(f.id)
            const isMenuTarget = menu?.kind === "file" && menu.file?.id === f.id
            const Icon = fileIcon(f)
            return (
              <button
                key={f.id}
                type="button"
                data-file-id={f.id}
                onContextMenu={(e) =>
                  openMenu("file", e, { file: f, target: colTarget })
                }
                onDoubleClick={() => ws.openPreview(f)}
                onClick={(e) => {
                  if (e.shiftKey) {
                    ws.selectRange(list, f)
                    return
                  }
                  if (e.metaKey || e.ctrlKey) {
                    ws.selectFile(f, true)
                    return
                  }
                  if (f.isFolder) {
                    onNavigate([...prefix, f])
                  } else {
                    onNavigate(prefix)
                    ws.selectFile(f)
                  }
                }}
                className={cn(
                  "group mb-0.5 flex w-full select-none items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left transition-opacity hover:bg-foreground/5",
                  ws.isCut(f.id) && "opacity-45",
                  isMenuTarget
                    ? "bg-ws-accent/[0.18] text-ws-1 ring-1 ring-ws-accent/55"
                    : active
                      ? "bg-ws-select/[0.16] text-ws-1"
                      : "text-ws-2",
                )}
              >
                <Icon className={cn("h-[18px] w-[18px] shrink-0", fileIconClass(f))} />
                <span className="min-w-0 flex-1 truncate text-[14px]">{f.name}</span>
                <ElementEditMark file={f} />
                <InMark file={f} />
                {f.isFolder ? (
                  <ChevronRight className="h-4 w-4 shrink-0 text-ws-4" />
                ) : null}
              </button>
            )
          })
        )}
        {canAddElement ? (
          <NewElementCell target={colTarget} shape="column" size={size} />
        ) : null}
      </div>
      {drop.active ? <DropHint target={colTarget} size={size} /> : null}
      {ringHere ? <UploadRing size={size} /> : null}
    </div>
  )
}

/**
 * Прокрутка к файлу, к которому просили перейти снаружи (индикатор обработки).
 *
 * Выделения мало: в папке с сотней результатов выделенная строка оказывается
 * далеко за краем окна, и переход «к файлу» выглядит как переход «в папку».
 *
 * Ищем в DOM по `data-file-id`, а не держим ref в каждой строке: строку рисуют
 * три вида (список, плитка, колонки), и в колоночном она вообще внутри map, где
 * хук не поставить. Зато область — одна на все три.
 *
 * `offsetParent === null` — это скрытая копия разметки: мобильная и десктопная
 * висят в DOM одновременно, и та, что спрятана `display: none`, прокрутиться не
 * может. Она и просьбу не гасит — иначе видимая копия не успела бы её увидеть.
 */
function useRevealScroll(items: DriveFile[]) {
  const { revealFileId, consumeReveal } = useWorkspace()
  const areaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!revealFileId) return
    const el = areaRef.current?.querySelector<HTMLElement>(
      `[data-file-id="${CSS.escape(revealFileId)}"]`,
    )
    if (!el || el.offsetParent === null) return
    el.scrollIntoView({ block: "center", inline: "nearest" })
    consumeReveal()
  }, [revealFileId, items, consumeReveal])

  return areaRef
}

/**
 * Файловая область: список / плитка / колонки.
 * ПКМ по пустому месту открывает меню создания и загрузки,
 * файлы можно перетащить прямо в область.
 */
export function FileBrowser({
  root,
  path,
  basePath,
  view,
  size = "roomy",
  flat,
  subtitleOf,
  onNavigate,
  className,
}: {
  /** Корень поддерева, по которому ходим (проект целиком или содержимое IN / OUT). */
  root: DriveFile[]
  /** Текущий путь внутри root. */
  path: DriveFile[]
  /** Префикс логического пути к root, например "IN". */
  basePath?: string
  view: ViewMode
  size?: Size
  /**
   * Показать всё поддерево одним списком, без папок. По умолчанию — как
   * переключено в панели: режим общий для рабочей области, а не для области.
   * Корзина задаёт его явно: её корень плоский всегда.
   */
  flat?: boolean
  /** Своя подпись под именем вместо пути — корзина ставит туда проект. */
  subtitleOf?: (file: DriveFile) => string | null
  onNavigate: (nodes: DriveFile[]) => void
  className?: string
}) {
  const ws = useWorkspace()
  const {
    t,
    loadingFiles,
    driveAvailable,
    openMenu,
    menu,
    selectFile,
    clearFileSelection,
    uploadProgress,
  } = ws

  const flatMode = flat ?? ws.flat
  /**
   * В плоском режиме список — это всё поддерево разом, и путь внутри него уже
   * не при чём: заходить некуда, папок в списке нет. Поэтому и колоночный вид
   * ниже отключается — колонки и есть хождение по уровням.
   */
  const entries = flatMode ? flattenTree(itemsAtPath(root, path)) : null
  const items = entries ? entries.map((e) => e.file) : itemsAtPath(root, path)
  const relPaths = entries
    ? new Map(entries.map((e) => [e.file.id, e.relPath]))
    : null
  const subtitleFor = (f: DriveFile): string | null => {
    if (subtitleOf) return subtitleOf(f)
    if (!relPaths) return null
    // Пустой путь — файл лежит прямо в той папке, откуда режим включили. Строку
    // всё равно рисуем: без неё соседние файлы выглядят по-разному без причины.
    return relPaths.get(f.id) || t.projectRoot
  }
  const areaRef = useRevealScroll(items)
  const target = targetFor(basePath, path)
  const emptyMessage = !driveAvailable ? t.driveUnavailable : t.emptyFolder

  const drop = useDropZone(target)
  const canAddElement = useCanAddElement(target)
  // Меню открыто в этой области — подсвечиваем, чтобы было видно,
  // где произойдёт действие. Правило одинаковое для всех видов.
  const menuHere = menu?.target?.folderPath === target.folderPath
  // Льют в эту папку — значит кольцо заливки показывает эта область. Копий
  // разметки на экране несколько (колонки, панели, мобильная и десктопная),
  // и путь — единственное, чем они друг от друга отличаются.
  const ringHere = uploadProgress?.folderPath === target.folderPath

  /**
   * Cmd/Ctrl — добавить или снять один элемент, Shift — выделить диапазон.
   * Обычный клик по папке заходит внутрь, по файлу — выделяет его,
   * двойной по файлу открывает окно превью (`openPreview` игнорирует папки).
   */
  const openItem = (f: DriveFile, event: React.MouseEvent) => {
    if (event.shiftKey) {
      ws.selectRange(items, f)
      return
    }
    if (event.metaKey || event.ctrlKey) {
      selectFile(f, true)
      return
    }
    if (f.isFolder) onNavigate([...path, f])
    else selectFile(f)
  }

  const areaHighlight = drop.active
    ? "outline outline-2 -outline-offset-2 outline-ws-select"
    : menuHere
      ? "outline outline-1 -outline-offset-1 outline-ws-accent/40 bg-ws-accent/[0.05]"
      : ""

  if (view === "columns" && !flatMode) {
    return (
      <div
        ref={areaRef}
        className={cn("flex min-h-0 flex-1 overflow-x-auto", className)}
        onContextMenu={(e) => openMenu("empty", e, { target })}
      >
        {Array.from({ length: path.length + 1 }, (_, depth) => {
          const prefix = path.slice(0, depth)
          return (
            <FileColumn
              key={depth}
              depth={depth}
              list={itemsAtPath(root, prefix)}
              colTarget={targetFor(basePath, prefix)}
              prefix={prefix}
              path={path}
              size={size}
              emptyMessage={emptyMessage}
              onNavigate={onNavigate}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div
      ref={areaRef}
      className={cn(
        "relative flex min-h-0 flex-1 flex-col transition-colors",
        areaHighlight,
        className,
      )}
      onContextMenu={(e) => openMenu("empty", e, { target })}
      {...drop.handlers}
    >
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2.5"
        onClick={(e) => {
          // клик по пустому месту снимает выделение
          if (e.target === e.currentTarget) clearFileSelection()
        }}
      >
        {loadingFiles ? (
          <div className="flex justify-center py-16 text-ws-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : items.length === 0 && !canAddElement ? (
          /* Пустая папка `IN` со сборкой показывает не эту подпись, а саму
             кнопку: действие объясняет себя лучше, чем текст про него. */
          <div className="flex min-h-[140px] flex-1 items-center justify-center px-6 text-center text-[12.5px] text-ws-5">
            {emptyMessage}
          </div>
        ) : view === "grid" ? (
          <div
            className={cn(
              "grid content-start",
              size === "roomy"
                ? "grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3"
                : "grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5",
            )}
          >
            {items.map((f) => (
              <FileCard
                key={f.id}
                file={f}
                size={size}
                subtitle={subtitleFor(f)}
                onOpen={(e) => openItem(f, e)}
                onPreview={() => ws.openPreview(f)}
                onContext={(e) => openMenu("file", e, { file: f, target })}
              />
            ))}
            {canAddElement ? (
              <NewElementCell target={target} shape="card" size={size} />
            ) : null}
          </div>
        ) : (
          <div
            className={cn("flex flex-col", size === "roomy" ? "gap-2" : "gap-1.5")}
          >
            {items.map((f) => (
              <FileRow
                key={f.id}
                file={f}
                size={size}
                subtitle={subtitleFor(f)}
                onOpen={(e) => openItem(f, e)}
                onPreview={() => ws.openPreview(f)}
                onContext={(e) => openMenu("file", e, { file: f, target })}
              />
            ))}
            {canAddElement ? (
              <NewElementCell target={target} shape="row" size={size} />
            ) : null}
          </div>
        )}
      </div>
      {drop.active ? <DropHint target={target} size={size} /> : null}
      {ringHere ? <UploadRing size={size} /> : null}
    </div>
  )
}
