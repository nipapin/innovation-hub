import type { DriveFile } from "./types"

/**
 * Удалённый файл — строка корзины, как её отдаёт `/api/storage/v1/trash`.
 * Серверная форма — `TrashItem` в lib/storage/trash.ts.
 */
export type TrashItem = {
  fileId: string
  name: string
  /** Путь папки, В КОТОРОЙ файл лежал, от корня проекта. Пусто — корень. */
  folderPath: string
  isFolder: boolean
  deletedAt: string
  sizeBytes: number
  contentType: string
  projectId: string
  /** Пусто в выборке по одному проекту — там проект и так известен. */
  projectName: string
  /**
   * Файл оказался в корзине вместе со всем проектом. Своей пометки удаления у
   * него нет: вернуть или стереть его отдельно нельзя, только вместе с проектом.
   */
  projectDeleted: boolean
}

/** Чем сортировать корзину. */
export type TrashSort = "date" | "name" | "size"

export function mapTrashItem(raw: Record<string, unknown>): TrashItem {
  return {
    fileId: String(raw.fileId ?? ""),
    name: String(raw.name ?? ""),
    folderPath: String(raw.folderPath ?? ""),
    isFolder: Boolean(raw.isFolder),
    deletedAt:
      typeof raw.deletedAt === "string"
        ? raw.deletedAt
        : new Date(String(raw.deletedAt)).toISOString(),
    sizeBytes: Number(raw.sizeBytes ?? 0),
    contentType: String(raw.contentType ?? ""),
    projectId: String(raw.projectId ?? ""),
    projectName: String(raw.projectName ?? ""),
    projectDeleted: Boolean(raw.projectDeleted),
  }
}

/** Строка корзины в виде узла дерева — тогда её рисует обычная файловая область. */
export function toDriveFile(item: TrashItem): DriveFile {
  return {
    id: item.fileId,
    name: item.name,
    mimeType: item.contentType,
    isFolder: item.isFolder,
    sizeBytes: item.isFolder ? null : item.sizeBytes,
    modifiedAt: item.deletedAt,
    createdAt: item.deletedAt,
    children: item.isFolder ? [] : undefined,
  }
}

/**
 * Дерево удалённых файлов ОДНОГО проекта — ровно той формы, что была в проекте.
 *
 * Это и есть «создавать такую же структуру, как в проекте, откуда их удалили»:
 * структуру не надо воссоздавать, она никуда не девалась. Строка каталога после
 * удаления хранит свой `folder_path` нетронутым, поэтому дерево здесь не
 * строится заново, а просто разворачивается обратно из путей.
 *
 * Папки-посредники, которых в корзине нет (удалили файл из живой папки),
 * добавляются пустышками с id вида `dir:путь`: без них файл из `IN/raw` было бы
 * некуда положить. Пустышка не строка каталога — восстановить или стереть её
 * нельзя, и меню на ней поэтому ничего не предлагает.
 */
export function buildTrashTree(items: TrashItem[]): DriveFile[] {
  const root: DriveFile[] = []
  const folders = new Map<string, DriveFile>()

  /** Папка по пути, создавая недостающие звенья сверху вниз. */
  const folderAt = (path: string): DriveFile[] => {
    if (!path) return root
    const existing = folders.get(path)
    if (existing) return existing.children as DriveFile[]

    const at = path.lastIndexOf("/")
    const parentPath = at === -1 ? "" : path.slice(0, at)
    const name = at === -1 ? path : path.slice(at + 1)
    const node: DriveFile = {
      id: `dir:${path}`,
      name,
      mimeType: "",
      isFolder: true,
      sizeBytes: null,
      modifiedAt: null,
      createdAt: null,
      children: [],
    }
    folders.set(path, node)
    folderAt(parentPath).push(node)
    return node.children as DriveFile[]
  }

  // Сначала сами удалённые папки: так их узлы попадут в карту настоящими
  // строками каталога, а не пустышками, и восстановить их будет можно.
  for (const item of items) {
    if (!item.isFolder) continue
    const path = item.folderPath ? `${item.folderPath}/${item.name}` : item.name
    if (folders.has(path)) continue
    const node = toDriveFile(item)
    node.children = []
    folders.set(path, node)
    folderAt(item.folderPath).push(node)
  }

  for (const item of items) {
    if (item.isFolder) continue
    folderAt(item.folderPath).push(toDriveFile(item))
  }

  return root
}

/**
 * Корень корзины — всё удалённое одним списком, без папок.
 *
 * Сами удалённые папки отсюда выпадают: их содержимое и так лежит в этом же
 * списке отдельными строками, и папка рядом с ним была бы тем же самым второй
 * раз. Куда каждая строка относится, говорит подпись под именем, а не вложение.
 */
export function flatTrashFiles(items: TrashItem[]): DriveFile[] {
  return items.filter((item) => !item.isFolder).map(toDriveFile)
}

/** Подпись под именем в корне корзины: проект и путь, откуда файл удалён. */
export function trashSubtitle(item: TrashItem): string {
  return [item.projectName, item.folderPath].filter(Boolean).join(" / ")
}

/** Тот же порядок, но по всему дереву: вложенные папки сортируются тоже. */
export function sortTrashTree(
  files: DriveFile[],
  sort: TrashSort,
  lang: string,
): DriveFile[] {
  return sortTrashFiles(files, sort, lang).map((file) =>
    file.isFolder && file.children
      ? { ...file, children: sortTrashTree(file.children, sort, lang) }
      : file,
  )
}

/** Пустышка, дорисованная ради структуры: настоящей строки каталога за ней нет. */
export function isSyntheticFolder(file: DriveFile): boolean {
  return file.id.startsWith("dir:")
}

/**
 * Порядок строк корзины.
 *
 * По умолчанию — по дате удаления, сверху недавнее: в корзину заходят за тем,
 * что выбросили только что. Имя сравниваем без учёта регистра и по правилам
 * языка, иначе «Яблоко» и «яблоко» разъезжаются в разные концы списка.
 */
export function sortTrashFiles(
  files: DriveFile[],
  sort: TrashSort,
  lang: string,
): DriveFile[] {
  const collator = new Intl.Collator(lang === "ru" ? "ru" : "en", {
    numeric: true,
    sensitivity: "base",
  })
  const sized = (f: DriveFile) => f.sizeBytes ?? 0
  const when = (f: DriveFile) =>
    f.modifiedAt ? new Date(f.modifiedAt).getTime() : 0

  return [...files].sort((a, b) => {
    // Папки всегда выше файлов: порядок меняет способ сравнения, а не то, что
    // папка — это папка. Иначе при сортировке по размеру они уходили бы вниз
    // все разом, потому что собственного размера у них нет.
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    switch (sort) {
      case "name":
        return collator.compare(a.name, b.name)
      case "size":
        return sized(b) - sized(a)
      default:
        return when(b) - when(a)
    }
  })
}
