export type DriveFile = {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  sizeBytes: number | null
  modifiedAt: string | null
  createdAt: string | null
  /** Кто залил файл на сайт; null — файл появился до появления атрибуции. */
  uploadedByName?: string | null
  children?: DriveFile[]
}

/**
 * Состояние обработки элемента верхнего уровня папки IN.
 *
 * `null` (элемента нет в карте) значит «задачи по нему не было» — то есть он
 * ещё поедет. Всё остальное значит, что задача была, и сам по себе он больше
 * не поедет никогда: обе линии сборки берут только то, по чему задачи не
 * существовало вовсе (docs/PIPELINE.md §3). Словарь совпадает с серверным —
 * lib/pipeline/in-status.ts.
 */
export type InItemStatus = "queued" | "running" | "done" | "failed"

export type ProjectGroupName = "personal" | "shared" | "tools" | "archive"

export type Project = {
  id: string
  name: string
  description: string
  groupName: ProjectGroupName
  isPaused: boolean
  isActive?: boolean
  /**
   * Почему проект стоит: `null` — остановил человек, иначе биллинг. Тумблер в
   * этом случае обратно не включается, пока платить нечем.
   */
  pausedReason?: "no-funds" | "trial-over" | "no-vendor-key" | null
  /** В архиве: скрыт из рабочего списка, обработки по нему не идут. */
  isArchived: boolean
  /** Soft-deleted project (cabinet trash tab). */
  deletedAt: string | null
  /** Shared with the current user (not owned). */
  sharedWithMe: boolean
  /**
   * Роль в расшаренном проекте: читатель, редактор или полный доступ.
   * null — проект свой, права владельца. Матрица — lib/project-access.ts,
   * её клиентская половина — ./access.ts.
   */
  memberRole?: "viewer" | "editor" | "full" | null
  driveFolderId: string | null
  createdAt: string
  updatedAt: string
  unreadCount: number
  /**
   * Скольким людям расшарен проект, не считая владельца. 0 — не расшарен.
   * Считается по project_members (функция расшаривания из upstream/main).
   */
  memberCount: number
}

export type ChatMessage = {
  id: string
  senderType: "client" | "team" | "system"
  body: string
  createdAt: string
}

/** Как отрисовываются файлы внутри области. */
export type ViewMode = "list" | "grid" | "columns"

/** Режим рабочей области: полный (3 колонки) или упрощённый (IN / OUT). */
export type Density = "full" | "simple"

/**
 * Закладки нижней панели. `preview` относится к выбранному файлу, остальные —
 * к проекту: превью переехало сюда из правой колонки, где вертикальное видео
 * занимало полосу во всю высоту и почти ничего не показывало.
 */
export type BottomTab = "preview" | "desc" | "settings" | "chat"

/** Куда загружать файлы / создавать папку. */
export type UploadTarget = {
  parentId: string | null
  /** Логический путь от корня проекта, например "IN/raw". */
  folderPath: string
}

/**
 * Что архивируем: папку из контекстного меню (`folderId`) или текущую папку
 * рабочей области (`folderPath`, пустая строка — корень проекта). Второй
 * вариант нужен потому, что у корня проекта строки в каталоге нет.
 */
export type ArchiveTarget = {
  folderId: string | null
  folderPath: string
  /** Имя для заголовка диалога. */
  name: string
}

/**
 * Что делать с файлом, имя которого в папке уже занято.
 *
 * `overwrite` — тот же объект и та же строка каталога: у файла остаётся история,
 * а конвейер видит `put` и собирает задачу заново. `rename` — сохранить оба,
 * новый ляжет как `clip (2).mp4`. `skip` — не заливать этот.
 *
 * Отдельного «удалить старый» нет намеренно: человек хочет того же, что даёт
 * `overwrite`, но платит за это идентичностью файла — ссылками на него,
 * авторством и связью с прежними задачами.
 */
export type UploadConflictAction = "overwrite" | "rename" | "skip"

export type UploadConflict = {
  /** Имя, которое занято. */
  name: string
  /** Куда льём — для строки «в папке …». Пусто — корень проекта. */
  folderPath: string
  /** Под каким именем ляжет при выборе «сохранить оба». */
  suggestion: string
  /** Сколько файлов ещё осталось: при одном предлагать «ко всем» незачем. */
  rest: number
  decide: (action: UploadConflictAction, all: boolean) => void
}

/** Что делаем с содержимым буфера при вставке. */
export type ClipboardOp = "copy" | "cut"

export type Clipboard = {
  op: ClipboardOp
  items: DriveFile[]
  /** Откуда взяли — понадобится при вставке. */
  projectId: string
}

/** Что рабочей области разрешено делать с данными. */
/**
 * Что позволено в рабочей области.
 *
 * Два слоя. Источник задаёт потолок зоны: кабинет разрешает работу с файлами,
 * админский «Конвейер» — почти ничего, кроме описания. Роль в расшаренном
 * проекте срезает этот потолок до своего: см. projectCapabilities в ./access.ts,
 * и брать `source.can` напрямую для действий над проектом больше нельзя.
 */
export type WorkspaceCapabilities = {
  createProject: boolean
  deleteProject: boolean
  renameProject: boolean
  archiveProject: boolean
  /** Расшарить проект, сменить роль участника, снять доступ. */
  shareProject: boolean
  /**
   * Передать проект другому человеку: у прежнего владельца он исчезает, у
   * нового появляется. В кабинете такого действия нет — там владелец один и
   * менять его некому; включает его только админская зона.
   */
  transferProject: boolean
  upload: boolean
  createFolder: boolean
  renameItem: boolean
  deleteItem: boolean
  move: boolean
  /** Параметры обработки и тумблер слежения. */
  writeSettings: boolean
  /** Писать в чат проекта. Читателю расшаренного проекта — нельзя. */
  writeChat: boolean
  /**
   * Править развёрнутое описание проекта (options/description.md). В кабинете
   * его читают, а пишет команда: адрес `descriptionMdUrl` там отдаёт только GET.
   */
  editDescription: boolean
}

/**
 * Откуда рабочая область берёт данные и что ей позволено.
 *
 * Компоненты рабочей области одни и те же в кабинете и в админском
 * «Конвейере», различаются только адреса и права: кабинет видит проекты одного
 * пользователя без служебной папки options, админка — все проекты выбранного
 * пользователя целиком. Поэтому серверная часть вынесена в один объект, а не
 * растащена по компонентам: в провайдере ровно одно место, которое знает про
 * эндпоинты.
 */
export type WorkspaceSource = {
  /**
   * Что именно показывает источник. Меняется — список проектов перечитывается.
   *
   * Нужен потому, что загрузчики в провайдере объявлены с пустым списком
   * зависимостей и берут источник из ref: без явного ключа смена выбранного
   * пользователя в админке не перезапускала бы загрузку, и колонка проектов
   * оставалась пустой. В кабинете область одна и ключ постоянный.
   */
  scopeKey: string
  /**
   * Делить ли проекты по разделам из URL (?tab=projects|shared|tools|archive).
   *
   * В кабинете да — разделы это пункты бокового меню. В админке нет: такого
   * меню там не существует, поэтому список показывается целиком, вместе с
   * архивными, а архив помечается на карточке.
   */
  splitByTab: boolean
  /**
   * Адрес самой страницы рабочей области — для router.replace при выборе
   * проекта и для «открыть в новом окне». В кабинете это /account/projects,
   * в админке /admin/pipeline с выбранным пользователем в query.
   */
  pageUrl: (params: { id: string | null; tab: string }) => string
  /** Список проектов рабочей области. */
  projectsUrl: () => string
  /** Дерево файлов + состояние автоматизации одного проекта. */
  driveUrl: (projectId: string) => string
  /** Курсор журнала изменений: с него начинается опрос delta. */
  treeCursorUrl: (projectId: string) => string
  /** Один проект: PATCH — изменить, DELETE — удалить. */
  projectUrl: (projectId: string) => string
  /** Папки проекта: POST — создать вложенную. */
  folderUrl: (projectId: string) => string
  /** Элемент дерева: PATCH — переименовать, DELETE — удалить, GET — скачать. */
  fileUrl: (projectId: string, fileId: string) => string
  /** Загрузка файла: отдельным XHR, чтобы был прогресс. */
  uploadUrl: (projectId: string, params: URLSearchParams) => string
  /** Перемещение элемента между папками. */
  moveUrl: () => string
  /**
   * Архив папки: `archivePlanUrl` — состав частей, `archivePartUrl` — сама
   * часть потоком. У обеих зон адреса совпадают: это /api/storage/v1, он
   * принимает сессию и пускает ADMIN в любой проект (lib/storage/auth.ts).
   */
  archivePlanUrl: (params: URLSearchParams) => string
  archivePartUrl: (params: URLSearchParams) => string
  /**
   * Параметры обработки из options.json: PATCH — сохранить правки клиента.
   * Необязательный — без него панель настроек показывает значения, но не даёт
   * их менять. Так в админском «Конвейере»: там своя роль и свой путь записи
   * (docs/PROJECT_OPTIONS_PANEL.md §2), а этот эндпоинт — клиентский.
   */
  exposedOptionsUrl?: (projectId: string) => string
  /**
   * «Обработать заново» для элемента папки IN. Пусто — пункта в меню нет.
   *
   * Отдельным адресом, а не флагом в `can`: у админского источника проекты
   * чужие, и решение, показывать ли там эту кнопку, принимается вместе с
   * решением, каким роутом её обслуживать.
   */
  reprocessUrl?: (projectId: string, fileId: string) => string
  /**
   * Развёрнутое описание проекта — options/description.md. Наличие адреса
   * включает панель описания: GET есть в обеих зонах, а PUT принимает только
   * админский роут — за это отвечает право `can.editDescription`.
   */
  descriptionMdUrl?: (projectId: string) => string
  chatUrl: (projectId: string) => string
  /**
   * Отметка «прочитано». Необязательная: в админке её нет, потому что в
   * project_chat_messages отметки со стороны команды не существует — есть только
   * chat_last_read_at владельца.
   */
  chatReadUrl?: (projectId: string) => string
  /**
   * Кто «я» в чате. В кабинете сообщения пользователя — 'client', в админке
   * это тот же чат с другой стороны, поэтому 'team': свои сообщения справа,
   * пользовательские слева.
   */
  chatPerspective: "client" | "team"
  /**
   * Смена владельца проекта. Необязательный: без адреса действие недоступно,
   * сколько бы прав ни давала зона.
   */
  transferUrl?: (projectId: string) => string
  /** Показывать служебную папку options (в кабинете она скрыта). */
  showServiceFolders: boolean
  /**
   * Заливать байты мимо Next: presign → PUT в R2 → notify.
   *
   * Раньше этот выбор делался по `scopeKey === "cabinet"` прямо в загрузчике —
   * то есть новая зона получала прокси через Next просто потому, что называлась
   * иначе. Признак у источника, а не имя: адрес `uploadUrl` при этом всё равно
   * обязателен по контракту, но не используется.
   */
  directUpload?: boolean
  can: WorkspaceCapabilities
}

export type ContextMenuKind = "file" | "empty" | "project"

export type ContextMenuState = {
  x: number
  y: number
  kind: ContextMenuKind
  file?: DriveFile
  project?: Project
  target?: UploadTarget
}
