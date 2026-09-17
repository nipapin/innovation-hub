export type LocaleText = { ru: string; en: string }

export type ActionPropDoc = {
  name: string
  type: string
  required: boolean
  notes: LocaleText
}

export type ActionGroup = "computer" | "storage" | "settings" | "queue" | "vault"

export type ActionDoc = {
  action: string
  group: ActionGroup
  summary: LocaleText
  description: LocaleText
  props: ActionPropDoc[]
  exampleProps: Record<string, unknown>
  exampleResponse: unknown
}

export const MACHINE_API_PATH = "/api/v1"

export const MACHINE_API_ACTIONS: ActionDoc[] = [
  {
    action: "me",
    group: "computer",
    summary: {
      ru: "Идентичность и текущее состояние компьютера.",
      en: "Identity and current state of this computer.",
    },
    description: {
      ru: "Возвращает карточку компьютера: статус, online, текущий проект. props можно опустить или передать {}.",
      en: "Returns this computer’s card: status, online, current project. Omit props or send {}.",
    },
    props: [],
    exampleProps: {},
    exampleResponse: {
      id: "uuid",
      name: "render-box-1",
      description: "",
      status: "idle",
      online: true,
      currentProjectId: null,
      currentTask: null,
      lastHeartbeatAt: "2026-08-13T10:00:00.000Z",
      meta: {},
      createdAt: "2026-08-10T10:00:00.000Z",
    },
  },
  {
    action: "heartbeat",
    group: "computer",
    summary: {
      ru: "Присутствие и статус работы. Обновляет lastHeartbeatAt.",
      en: "Presence and work status. Updates lastHeartbeatAt.",
    },
    description: {
      ru: "Шлите каждые 20–30 секунд. Пустые props = только heartbeat. online = сигнал не старше 90 секунд.",
      en: "Send every 20–30 seconds. Empty props = heartbeat only. online = last signal within 90 seconds.",
    },
    props: [
      {
        name: "status",
        type: '"idle" | "busy" | "error"',
        required: false,
        notes: {
          ru: "Состояние агента.",
          en: "Agent state.",
        },
      },
      {
        name: "currentProjectId",
        type: "string | null",
        required: false,
        notes: {
          ru: "null сбрасывает проект; иначе проект должен существовать.",
          en: "null clears the project; otherwise the project must exist.",
        },
      },
      {
        name: "currentTask",
        type: "string | null",
        required: false,
        notes: {
          ru: "Короткая метка операции, до 500 символов.",
          en: "Short operation label, up to 500 characters.",
        },
      },
      {
        name: "meta",
        type: "object",
        required: false,
        notes: {
          ru: "Произвольный JSON; если передано — заменяет предыдущий meta целиком.",
          en: "Arbitrary JSON; when sent, replaces previous meta entirely.",
        },
      },
    ],
    exampleProps: {
      status: "busy",
      currentProjectId: "project-uuid",
      currentTask: "export-preview",
      meta: { progress: 0.4 },
    },
    exampleResponse: {
      id: "uuid",
      name: "render-box-1",
      status: "busy",
      online: true,
      currentProjectId: "project-uuid",
      currentTask: "export-preview",
      lastHeartbeatAt: "2026-08-13T10:00:30.000Z",
      meta: { progress: 0.4 },
    },
  },
  {
    action: "capabilities",
    group: "storage",
    summary: {
      ru: "Флаги возможностей API.",
      en: "API feature flags.",
    },
    description: {
      ru: "Чтобы клиент не хардкодил поддерживаемые операции.",
      en: "So the client does not hardcode supported operations.",
    },
    props: [],
    exampleProps: {},
    exampleResponse: {
      apiVersion: 1,
      protocol: 2,
      multipart: false,
      rename: true,
      move: true,
      copy: false,
      sharing: false,
      clients: true,
      originMtime: true,
      contentHash: true,
      trash: true,
    },
  },
  {
    action: "projects",
    group: "storage",
    summary: {
      ru: "Каталог клиентов и проектов.",
      en: "Clients and projects catalog.",
    },
    description: {
      ru: "Токен компьютера из админки видит все проекты (как ADMIN).",
      en: "An admin-issued computer token sees all projects (same as ADMIN).",
    },
    props: [],
    exampleProps: {},
    exampleResponse: {
      users: [
        {
          id: "uuid",
          email: "anya@studio.example",
          fullName: "Аня Смирнова",
        },
      ],
      clients: [{ id: "uuid", displayName: "Megafon" }],
      projects: [
        {
          id: "uuid",
          name: "Ads Q3",
          clientId: "uuid",
          userId: "uuid",
          ownerEmail: "anya@studio.example",
          groupName: "personal",
          isActive: true,
          isPaused: false,
          isArchived: false,
          archivedAt: null,
          updatedAt: "2026-08-13T12:00:00.000Z",
        },
      ],
    },
  },
  {
    action: "createProject",
    group: "storage",
    summary: {
      ru: "Создать проект в папке владельца токена.",
      en: "Create a project in the token owner's folder.",
    },
    description: {
      ru: "Токен, привязанный к одному проекту, создать новый не может (403).",
      en: "A token scoped to one project cannot create another (403).",
    },
    props: [
      {
        name: "name",
        type: "string",
        required: true,
        notes: { ru: "1–120 символов.", en: "1–120 characters." },
      },
      {
        name: "clientId",
        type: "string | null",
        required: false,
        notes: { ru: "Клиент владельца.", en: "Must belong to the owner." },
      },
    ],
    exampleProps: { name: "Ads Q3", clientId: null },
    exampleResponse: {
      project: {
        id: "uuid",
        name: "Ads Q3",
        userId: "uuid",
        ownerEmail: "anya@studio.example",
        isArchived: false,
        isPaused: false,
      },
    },
  },
  {
    action: "projectRename",
    group: "storage",
    summary: {
      ru: "Переименовать проект. Ключи в бакете не меняются.",
      en: "Rename a project. Object keys do not change.",
    },
    description: {
      ru: "Имя живёт в Postgres. Клиент перечитывает его следующим projects.",
      en: "The name lives in Postgres. Clients pick it up on the next projects call.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "name",
        type: "string",
        required: true,
        notes: { ru: "Новое имя, 1–120 символов.", en: "New name, 1–120 characters." },
      },
    ],
    exampleProps: { projectId: "project-uuid", name: "Kotliar" },
    exampleResponse: { project: { id: "project-uuid", name: "Kotliar" } },
  },
  {
    action: "projectState",
    group: "storage",
    summary: {
      ru: "Пауза или архивация проекта.",
      en: "Pause or archive a project.",
    },
    description: {
      ru: "paused и archived независимы. Архивный проект обработчик не трогает.",
      en: "paused and archived are independent. Workers must skip archived projects.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "paused",
        type: "boolean",
        required: false,
        notes: { ru: "Пауза обработки.", en: "Pause processing." },
      },
      {
        name: "archived",
        type: "boolean",
        required: false,
        notes: {
          ru: "В архив / из архива. Нужно хотя бы одно из paused/archived.",
          en: "Archive / unarchive. At least one of paused/archived is required.",
        },
      },
    ],
    exampleProps: { projectId: "project-uuid", archived: true },
    exampleResponse: {
      project: { id: "project-uuid", isArchived: true, isPaused: false },
    },
  },
  {
    action: "tree",
    group: "storage",
    summary: {
      ru: "Полное дерево файлов проекта из кэша.",
      en: "Full project file tree from cache.",
    },
    description: {
      ru: "Bootstrap / полная синхронизация. cursor — последний seq журнала; дальше используйте delta.",
      en: "Bootstrap / full sync. cursor is the latest journal seq; then use delta.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "prefix",
        type: "string",
        required: false,
        notes: {
          ru: "Логический путь папки. Пустая строка = весь проект.",
          en: "Logical folder path. Empty string = whole project.",
        },
      },
    ],
    exampleProps: { projectId: "project-uuid", prefix: "IN" },
    exampleResponse: {
      entries: [
        {
          id: "uuid",
          projectId: "project-uuid",
          folderPath: "IN",
          name: "clip.mov",
          isFolder: false,
          s3Key: "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
          sizeBytes: 1234567,
          contentType: "video/quicktime",
        },
      ],
      cursor: 1842,
    },
  },
  {
    action: "delta",
    group: "storage",
    summary: {
      ru: "Инкрементальные изменения после cursor.",
      en: "Incremental changes after a cursor.",
    },
    description: {
      ru: "Если truncated: true — локальный индекс устарел, запросите tree заново. До 5000 событий за раз.",
      en: "If truncated is true, the local index is stale — call tree again. Up to 5000 events per call.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "since",
        type: "number",
        required: false,
        notes: {
          ru: "Cursor с прошлого ответа. По умолчанию 0.",
          en: "Cursor from the previous response. Default 0.",
        },
      },
    ],
    exampleProps: { projectId: "project-uuid", since: 1842 },
    exampleResponse: {
      changes: [
        {
          seq: 1843,
          op: "put",
          key: "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
          projectId: "project-uuid",
          name: "clip.mov",
          folderPath: "IN",
          isFolder: false,
          size: 1234567,
          etag: "abc123",
          contentHash: null,
          eventTime: 1722930000,
          fileId: "uuid",
          contentType: "video/quicktime",
        },
      ],
      cursor: 1843,
      truncated: false,
    },
  },
  {
    action: "presign",
    group: "storage",
    summary: {
      ru: "Короткоживущий signed URL. Байты идут напрямую в R2.",
      en: "Short-lived signed URL. Bytes go directly to R2.",
    },
    description: {
      ru: "PUT: загрузка. GET: скачивание. После успешного PUT вызовите notify.",
      en: "PUT: upload. GET: download. After a successful PUT, call notify.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "method",
        type: '"PUT" | "GET"',
        required: true,
        notes: { ru: "PUT — загрузка, GET — скачивание.", en: "PUT upload, GET download." },
      },
      {
        name: "folderPath",
        type: "string",
        required: false,
        notes: {
          ru: "Для PUT при генерации нового ключа. По умолчанию \"\".",
          en: "For PUT when generating a new key. Default \"\".",
        },
      },
      {
        name: "fileName",
        type: "string",
        required: false,
        notes: {
          ru: "Нужен для PUT. Имя санитизируется на сервере.",
          en: "Required for PUT. Sanitized server-side.",
        },
      },
      {
        name: "contentType",
        type: "string",
        required: false,
        notes: {
          ru: "Для PUT. Должен пройти политику загрузок.",
          en: "For PUT. Must pass the upload policy.",
        },
      },
      {
        name: "s3Key",
        type: "string",
        required: false,
        notes: {
          ru: "Обязателен для GET. Для PUT — переиспользовать существующий ключ.",
          en: "Required for GET. For PUT — reuse an existing key.",
        },
      },
      {
        name: "ttlSec",
        type: "number",
        required: false,
        notes: {
          ru: "60–86400, по умолчанию 3600.",
          en: "60–86400, default 3600.",
        },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      method: "PUT",
      folderPath: "IN",
      fileName: "clip.mov",
      contentType: "video/quicktime",
    },
    exampleResponse: {
      url: "https://…",
      method: "PUT",
      s3Key: "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
      fileName: "clip.mov",
      folderPath: "IN",
      contentType: "video/quicktime",
      expiresIn: 3600,
    },
  },
  {
    action: "notify",
    group: "storage",
    summary: {
      ru: "Подтвердить объект после presigned PUT.",
      en: "Confirm an object after a presigned PUT.",
    },
    description: {
      ru: "Сервер делает HEAD в R2, пишет project_files и journal. Поля тела перекрывают metadata объекта.",
      en: "Server HEADs R2, upserts project_files and the journal. Body fields override object metadata.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "s3Key",
        type: "string",
        required: true,
        notes: { ru: "Ключ из ответа presign.", en: "Key from the presign response." },
      },
      {
        name: "fileName",
        type: "string",
        required: true,
        notes: { ru: "Имя файла.", en: "File name." },
      },
      {
        name: "folderPath",
        type: "string",
        required: false,
        notes: { ru: "По умолчанию \"\".", en: "Default \"\"." },
      },
      {
        name: "sizeBytes",
        type: "number",
        required: false,
        notes: { ru: "Размер в байтах.", en: "Size in bytes." },
      },
      {
        name: "contentType",
        type: "string",
        required: false,
        notes: { ru: "MIME-тип.", en: "MIME type." },
      },
      {
        name: "originMtime",
        type: "number",
        required: false,
        notes: {
          ru: "Unix seconds — mtime на исходной машине.",
          en: "Unix seconds — mtime on the source machine.",
        },
      },
      {
        name: "contentHash",
        type: "string",
        required: false,
        notes: { ru: "Например sha256 hex.", en: "e.g. sha256 hex." },
      },
      {
        name: "eventId",
        type: "string",
        required: false,
        notes: { ru: "Идемпотентность / дедуп.", en: "Idempotency / dedup." },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      s3Key: "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
      folderPath: "IN",
      fileName: "clip.mov",
      sizeBytes: 1234567,
      contentType: "video/quicktime",
    },
    exampleResponse: {
      file: {
        id: "uuid",
        projectId: "project-uuid",
        folderPath: "IN",
        name: "clip.mov",
        isFolder: false,
        s3Key: "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
        sizeBytes: 1234567,
        contentType: "video/quicktime",
      },
    },
  },
  {
    action: "mkdir",
    group: "storage",
    summary: {
      ru: "Создать папку в кэше (без объекта в R2).",
      en: "Create a folder row in the cache (no R2 object).",
    },
    description: {
      ru: "Имя options зарезервировано (403). Папки логические.",
      en: "The name options is reserved (403). Folders are logical.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "name",
        type: "string",
        required: true,
        notes: {
          ru: "1–180 символов, без / и \\.",
          en: "1–180 chars, no / or \\.",
        },
      },
      {
        name: "folderPath",
        type: "string",
        required: false,
        notes: { ru: "Родительский путь, по умолчанию \"\".", en: "Parent path, default \"\"." },
      },
      {
        name: "eventId",
        type: "string",
        required: false,
        notes: { ru: "Идемпотентность.", en: "Idempotency." },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      name: "IN",
      folderPath: "",
    },
    exampleResponse: {
      file: {
        id: "uuid",
        projectId: "project-uuid",
        folderPath: "",
        name: "IN",
        isFolder: true,
        s3Key: null,
        sizeBytes: 0,
      },
    },
  },
  {
    action: "rename",
    group: "storage",
    summary: {
      ru: "Переименовать или переместить файл/папку (s3Key не меняется).",
      en: "Rename or move a file/folder (s3Key does not change).",
    },
    description: {
      ru: "Нужно хотя бы одно из name / folderPath. Коллизия имени → 409.",
      en: "Provide at least one of name / folderPath. Name collision → 409.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "fileId",
        type: "string",
        required: true,
        notes: { ru: "ID файла или папки.", en: "File or folder id." },
      },
      {
        name: "name",
        type: "string",
        required: false,
        notes: { ru: "Новое имя.", en: "New name." },
      },
      {
        name: "folderPath",
        type: "string",
        required: false,
        notes: { ru: "Новый родительский путь.", en: "New parent path." },
      },
      {
        name: "eventId",
        type: "string",
        required: false,
        notes: { ru: "Идемпотентность.", en: "Idempotency." },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      fileId: "file-uuid",
      name: "clip-final.mov",
    },
    exampleResponse: {
      file: {
        id: "file-uuid",
        name: "clip-final.mov",
        folderPath: "IN",
      },
    },
  },
  {
    action: "deleteObject",
    group: "storage",
    summary: {
      ru: "Удалить файл или папку (каскадно).",
      en: "Delete a file or folder (cascade).",
    },
    description: {
      ru: "Удаляет объекты R2 для файлов и пишет journal. Папка options → 403.",
      en: "Removes R2 objects for files and journals deletes. options folder → 403.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "fileId",
        type: "string",
        required: true,
        notes: { ru: "ID файла или папки.", en: "File or folder id." },
      },
      {
        name: "eventId",
        type: "string",
        required: false,
        notes: { ru: "Идемпотентность.", en: "Idempotency." },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      fileId: "file-uuid",
    },
    exampleResponse: {
      ok: true,
      deletedS3Keys: ["projects/{userId}/{projectId}/IN/{uuid}-clip.mov"],
    },
  },
  {
    action: "reindex",
    group: "storage",
    summary: {
      ru: "Полный LIST R2 vs кэш Postgres.",
      en: "Full LIST of R2 vs Postgres cache.",
    },
    description: {
      ru: "Вставляет / обновляет / удаляет строки кэша. До 120 секунд. Пропускает options/* и project-meta.json.",
      en: "Inserts / updates / removes cache rows. Up to 120 seconds. Skips options/* and project-meta.json.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
    ],
    exampleProps: { projectId: "project-uuid" },
    exampleResponse: {
      ok: true,
      scanned: 120,
      inserted: 3,
      updated: 1,
      removed: 0,
    },
  },
  {
    action: "getSidecar",
    group: "storage",
    summary: {
      ru: "Прочитать automation JSON из R2.",
      en: "Read automation JSON from R2.",
    },
    description: {
      ru: "folder-state или options. 404 если объекта нет.",
      en: "folder-state or options. 404 if the object is missing.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "name",
        type: '"folder-state" | "options"',
        required: true,
        notes: { ru: "Какой sidecar читать.", en: "Which sidecar to read." },
      },
    ],
    exampleProps: { projectId: "project-uuid", name: "folder-state" },
    exampleResponse: {
      key: "projects/{userId}/{projectId}/options/folderState.json",
      body: "{ … }",
    },
  },
  {
    action: "putSidecar",
    group: "storage",
    summary: {
      ru: "Обновить sidecar. Тип задаётся полем kind.",
      en: "Update a sidecar. Discriminated by kind.",
    },
    description: {
      ru: "kind: folder-state (вкл/выкл автоматизацию), options (patch exposedToSite), raw (заменить тело целиком).",
      en: "kind: folder-state (toggle automation), options (patch exposedToSite), raw (replace entire body).",
    },
    props: [
      {
        name: "kind",
        type: '"folder-state" | "options" | "raw"',
        required: true,
        notes: { ru: "Вариант обновления.", en: "Update variant." },
      },
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "enabled",
        type: "boolean",
        required: false,
        notes: {
          ru: "Для kind=folder-state.",
          en: "For kind=folder-state.",
        },
      },
      {
        name: "changes",
        type: "{ path: string[], value }[]",
        required: false,
        notes: {
          ru: "Для kind=options. path ведёт в controlProps свойства; value — bool/число/строка/список строк/пара чисел.",
          en: "For kind=options. path points at the property's controlProps; value is a bool, number, string, list of strings or pair of numbers.",
        },
      },
      {
        name: "sidecar",
        type: '"folder-state" | "options"',
        required: false,
        notes: { ru: "Для kind=raw.", en: "For kind=raw." },
      },
      {
        name: "body",
        type: "string",
        required: false,
        notes: { ru: "Для kind=raw — JSON-строка.", en: "For kind=raw — JSON string." },
      },
      {
        name: "ifMatch",
        type: "string",
        required: false,
        notes: { ru: "Для kind=raw — условная запись по ETag.", en: "For kind=raw — conditional write by ETag." },
      },
    ],
    exampleProps: {
      kind: "folder-state",
      projectId: "project-uuid",
      enabled: true,
    },
    exampleResponse: {
      folderState: { enabled: true },
    },
  },
  {
    action: "deleteProject",
    group: "storage",
    summary: {
      ru: "Мягкое удаление проекта в корзину.",
      en: "Soft-delete a project into trash.",
    },
    description: {
      ru: "Проект уезжает в корзину на 30 дней, объекты в R2 сразу не удаляются — вернуть можно через restoreProject. Токену, привязанному к проекту, откажут: 403.",
      en: "The project goes to trash for 30 days; R2 objects are not deleted immediately — restoreProject brings it back. A project-scoped token is refused with 403.",
    },
    props: [
      {
        name: "projectId",
        type: "string (uuid)",
        required: true,
        notes: { ru: "Проект.", en: "Project." },
      },
    ],
    exampleProps: { projectId: "project-uuid" },
    exampleResponse: { ok: true },
  },
  {
    action: "restoreProject",
    group: "storage",
    summary: {
      ru: "Вернуть проект из корзины.",
      en: "Restore a project from trash.",
    },
    description: {
      ru: "Обратная операция к deleteProject, пока не истекли 30 дней.",
      en: "The inverse of deleteProject, while the 30 days have not expired.",
    },
    props: [
      {
        name: "projectId",
        type: "string (uuid)",
        required: true,
        notes: { ru: "Проект в корзине.", en: "Project in trash." },
      },
    ],
    exampleProps: { projectId: "project-uuid" },
    exampleResponse: {
      project: { id: "project-uuid", name: "Project", isArchived: false },
    },
  },
  {
    action: "copy",
    group: "storage",
    summary: {
      ru: "Копирование файлов и папок на стороне сервера.",
      en: "Server-side copy of files and folders.",
    },
    description: {
      ru: "Байты не ходят через клиента: копирование делает сам R2. Один файл копируется сразу и возвращает 200 с файлом; папка или пачка — это 202 с jobId, прогресс смотрите через getJob. Совпавшие имена получают суффикс « (2)», « (3)». Копирование между проектами разрешено, если есть чтение источника и запись в приёмник.",
      en: "Bytes never pass through the client: R2 does the copy. A single file copies inline and returns 200 with the file; a folder or batch returns 202 with a jobId — poll getJob for progress. Colliding names get a “ (2)”, “ (3)” suffix. Cross-project copy is allowed when you can read the source and write the destination.",
    },
    props: [
      {
        name: "projectId",
        type: "string (uuid)",
        required: true,
        notes: { ru: "Проект-источник.", en: "Source project." },
      },
      {
        name: "fileIds",
        type: "string[] (uuid)",
        required: true,
        notes: {
          ru: "Что копировать: файлы и/или папки, от 1 до 500 корней.",
          en: "What to copy: files and/or folders, 1 to 500 roots.",
        },
      },
      {
        name: "destProjectId",
        type: "string (uuid)",
        required: false,
        notes: {
          ru: "По умолчанию тот же проект.",
          en: "Defaults to the same project.",
        },
      },
      {
        name: "destFolderPath",
        type: "string",
        required: false,
        notes: {
          ru: "Логическая папка приёмника; по умолчанию корень.",
          en: "Logical destination folder; root by default.",
        },
      },
      {
        name: "eventId",
        type: "string",
        required: false,
        notes: {
          ru: "Ключ идемпотентности: повтор с тем же значением не создаст вторую копию.",
          en: "Idempotency key: a retry with the same value will not create a second copy.",
        },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      fileIds: ["file-uuid"],
      destFolderPath: "OUT",
    },
    exampleResponse: {
      files: [{ id: "new-file-uuid", name: "clip_01.mp4", folderPath: "OUT" }],
      fileIds: ["new-file-uuid"],
    },
  },
  {
    action: "getJob",
    group: "storage",
    summary: {
      ru: "Прогресс длительной операции хранилища.",
      en: "Progress of a long-running storage job.",
    },
    description: {
      ru: "Для задач, вернувших jobId: copy, move, purge, recatalog. Чужую задачу видит только ADMIN; остальным она отвечает 404, а не 403 — существование чужой задачи не подтверждается.",
      en: "For operations that returned a jobId: copy, move, purge, recatalog. Only ADMIN sees someone else’s job; others get 404 rather than 403 — the existence of another user’s job is not confirmed.",
    },
    props: [
      {
        name: "jobId",
        type: "string (uuid)",
        required: true,
        notes: {
          ru: "Из ответа 202 операции.",
          en: "From the operation’s 202 response.",
        },
      },
    ],
    exampleProps: { jobId: "job-uuid" },
    exampleResponse: {
      job: {
        id: "job-uuid",
        kind: "copy",
        state: "running",
        total: 12,
        done: 4,
        error: null,
        projectId: "project-uuid",
        payload: { fileIds: ["file-uuid"] },
        createdAt: "2026-08-13T10:00:00.000Z",
        updatedAt: "2026-08-13T10:00:30.000Z",
      },
    },
  },
  {
    action: "multipartCreate",
    group: "storage",
    summary: {
      ru: "Начать многочастную загрузку.",
      en: "Start a multipart upload.",
    },
    description: {
      ru: "Для объектов больше ~5 ГиБ и для докачки. Полный цикл: multipartCreate → multipartPresignPart на каждую часть → PUT частей напрямую в R2 → multipartComplete. Прерванную загрузку закрывает multipartAbort, иначе части остаются висеть в R2.",
      en: "For objects larger than ~5 GiB and for resumable uploads. Full cycle: multipartCreate → multipartPresignPart per part → PUT parts straight to R2 → multipartComplete. An interrupted upload is closed by multipartAbort, otherwise the parts linger in R2.",
    },
    props: [
      {
        name: "projectId",
        type: "string (uuid)",
        required: true,
        notes: { ru: "Проект.", en: "Project." },
      },
      {
        name: "fileName",
        type: "string",
        required: true,
        notes: { ru: "Имя файла.", en: "File name." },
      },
      {
        name: "folderPath",
        type: "string",
        required: false,
        notes: {
          ru: "Логическая папка; по умолчанию корень.",
          en: "Logical folder; root by default.",
        },
      },
      {
        name: "contentType",
        type: "string",
        required: false,
        notes: {
          ru: "По умолчанию application/octet-stream.",
          en: "Defaults to application/octet-stream.",
        },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      folderPath: "IN",
      fileName: "master.mov",
    },
    exampleResponse: {
      uploadId: "upload-id",
      s3Key: "projects/owner/project/IN/master.mov",
      fileName: "master.mov",
      folderPath: "IN",
      contentType: "video/quicktime",
    },
  },
  {
    action: "multipartPresignPart",
    group: "storage",
    summary: {
      ru: "Signed URL на одну часть.",
      en: "Signed URL for one part.",
    },
    description: {
      ru: "Берётся на каждую часть отдельно. Части нумеруются с 1, максимум 10000. Ссылка живёт минуты — запрашивайте её перед самой отправкой части, а не пачкой заранее.",
      en: "Requested per part. Parts are numbered from 1, up to 10000. The URL lives for minutes — request it right before sending the part, not for all parts up front.",
    },
    props: [
      {
        name: "projectId",
        type: "string (uuid)",
        required: true,
        notes: { ru: "Проект.", en: "Project." },
      },
      {
        name: "s3Key",
        type: "string",
        required: true,
        notes: {
          ru: "Из ответа multipartCreate.",
          en: "From the multipartCreate response.",
        },
      },
      {
        name: "uploadId",
        type: "string",
        required: true,
        notes: {
          ru: "Из ответа multipartCreate.",
          en: "From the multipartCreate response.",
        },
      },
      {
        name: "partNumber",
        type: "number",
        required: true,
        notes: { ru: "От 1 до 10000.", en: "From 1 to 10000." },
      },
      {
        name: "ttlSec",
        type: "number",
        required: false,
        notes: {
          ru: "Время жизни ссылки, 60…86400 секунд.",
          en: "URL lifetime, 60…86400 seconds.",
        },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      s3Key: "projects/owner/project/IN/master.mov",
      uploadId: "upload-id",
      partNumber: 1,
    },
    exampleResponse: {
      url: "https://…",
      method: "PUT",
      partNumber: 1,
      expiresIn: 900,
    },
  },
  {
    action: "multipartComplete",
    group: "storage",
    summary: {
      ru: "Собрать части в объект и занести в каталог.",
      en: "Assemble the parts and register the object.",
    },
    description: {
      ru: "ETag каждой части возвращает сам R2 в ответе на PUT — их надо сохранить и передать сюда все, по порядку. После сборки каталог обновляется так же, как после notify.",
      en: "R2 returns each part’s ETag in the PUT response — keep them and pass them all here, in order. After assembly the catalog is updated exactly as it is after notify.",
    },
    props: [
      {
        name: "projectId",
        type: "string (uuid)",
        required: true,
        notes: { ru: "Проект.", en: "Project." },
      },
      {
        name: "s3Key",
        type: "string",
        required: true,
        notes: {
          ru: "Из ответа multipartCreate.",
          en: "From the multipartCreate response.",
        },
      },
      {
        name: "uploadId",
        type: "string",
        required: true,
        notes: {
          ru: "Из ответа multipartCreate.",
          en: "From the multipartCreate response.",
        },
      },
      {
        name: "fileName",
        type: "string",
        required: true,
        notes: { ru: "Имя файла.", en: "File name." },
      },
      {
        name: "parts",
        type: "{ partNumber, etag }[]",
        required: true,
        notes: {
          ru: "Все части с их ETag, минимум одна.",
          en: "Every part with its ETag, at least one.",
        },
      },
      {
        name: "folderPath",
        type: "string",
        required: false,
        notes: {
          ru: "Логическая папка; по умолчанию корень.",
          en: "Logical folder; root by default.",
        },
      },
      {
        name: "contentType",
        type: "string",
        required: false,
        notes: { ru: "MIME-тип.", en: "MIME type." },
      },
      {
        name: "sizeBytes",
        type: "number",
        required: false,
        notes: { ru: "Размер файла.", en: "File size." },
      },
      {
        name: "contentHash",
        type: "string",
        required: false,
        notes: {
          ru: "Хеш содержимого для дедупа и сверки.",
          en: "Content hash for dedup and verification.",
        },
      },
      {
        name: "originMtime",
        type: "number",
        required: false,
        notes: {
          ru: "Время изменения на исходной машине, unix-секунды.",
          en: "Modification time on the source machine, unix seconds.",
        },
      },
      {
        name: "eventId",
        type: "string",
        required: false,
        notes: {
          ru: "Ключ идемпотентности.",
          en: "Idempotency key.",
        },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      s3Key: "projects/owner/project/IN/master.mov",
      uploadId: "upload-id",
      folderPath: "IN",
      fileName: "master.mov",
      parts: [{ partNumber: 1, etag: '"abc123"' }],
      sizeBytes: 8_589_934_592,
    },
    exampleResponse: {
      file: { id: "file-uuid", name: "master.mov", folderPath: "IN" },
      fileIds: ["file-uuid"],
    },
  },
  {
    action: "multipartAbort",
    group: "storage",
    summary: {
      ru: "Отменить незавершённую многочастную загрузку.",
      en: "Abort an unfinished multipart upload.",
    },
    description: {
      ru: "Зовите при любом обрыве, который не собираетесь докачивать: без этого залитые части остаются в R2 и продолжают занимать место, не будучи видимым файлом.",
      en: "Call it on any interruption you do not intend to resume: without it the uploaded parts stay in R2 and keep taking up space without being a visible file.",
    },
    props: [
      {
        name: "projectId",
        type: "string (uuid)",
        required: true,
        notes: { ru: "Проект.", en: "Project." },
      },
      {
        name: "s3Key",
        type: "string",
        required: true,
        notes: {
          ru: "Из ответа multipartCreate.",
          en: "From the multipartCreate response.",
        },
      },
      {
        name: "uploadId",
        type: "string",
        required: true,
        notes: {
          ru: "Из ответа multipartCreate.",
          en: "From the multipartCreate response.",
        },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      s3Key: "projects/owner/project/IN/master.mov",
      uploadId: "upload-id",
    },
    exampleResponse: { ok: true },
  },
  {
    action: "machinePing",
    group: "queue",
    summary: {
      ru: "«Я на связи» — без запроса задачи.",
      en: "“I am online” — without asking for a task.",
    },
    description: {
      ru: "Звать на своём пульсе независимо от того, включён ли воркер. Без этого состояние «машина включена, но воркер выключен» сайту не видно вовсе: от токена `mch_` он слышит машину только когда та зовёт очередь. В админке от этого зависят два отдельных индикатора — «на связи» и «воркер следит», а не один на оба состояния.",
      en: "Call it on your own pulse regardless of whether the worker is on. Without it the state “machine up, worker off” is invisible to the site: with an `mch_` token it only hears the machine when it asks for a task. Two separate indicators in the admin UI depend on this — “online” and “worker polling” — rather than one covering both.",
    },
    props: [
      {
        name: "machineUuid",
        type: "string",
        required: false,
        notes: {
          ru: "Обязателен для токена `mch_…`: им сайт опознаёт машину и заводит её сам.",
          en: "Required for an `mch_…` token: the site identifies and registers the machine by it.",
        },
      },
      {
        name: "hostname",
        type: "string",
        required: false,
        notes: {
          ru: "Подпись для админки; обновляется на каждом обращении.",
          en: "Label for the admin UI; refreshed on every call.",
        },
      },
    ],
    exampleProps: { machineUuid: "b1e2…", hostname: "render-box-1" },
    exampleResponse: { ok: true },
  },
  {
    action: "claimTask",
    group: "queue",
    summary: {
      ru: "Атомарно забрать следующую задачу из очереди.",
      en: "Atomically take the next task from the queue.",
    },
    description: {
      ru: "Модель pull: сайт не рассылает задачи, машина сама приходит за следующей. Судья при захвате — запрос в БД (FOR UPDATE SKIP LOCKED), поэтому из десяти машин, дёрнувших claim одновременно, задачу получит ровно одна. Пустая очередь — это `task: null`, штатный ответ, а не ошибка. Аренда 15 минут, продлевается каждым taskProgress; не продлил — задача вернётся в очередь. Видимость наследует роль токена: админский видит общую очередь, обычный — только проекты своего владельца.",
      en: "Pull model: the site does not dispatch tasks, the machine comes for the next one itself. The claim is arbitrated by the database query (FOR UPDATE SKIP LOCKED), so out of ten machines calling claim at once exactly one gets the task. An empty queue is `task: null` — a normal answer, not an error. The lease lasts 15 minutes and is extended by every taskProgress; stop reporting and the task returns to the queue. Visibility follows the token's role: an admin token sees the shared queue, a regular one only its owner's projects.",
    },
    props: [
      {
        name: "machineUuid",
        type: "string",
        required: false,
        notes: {
          ru: "UUID машины из её настроек. Обязателен для токена `mch_…`, у которого нет привязанного компьютера — по нему сайт заводит машину сам.",
          en: "The machine's UUID from its own settings. Required for an `mch_…` token, which has no bound computer — the site registers the machine by it.",
        },
      },
      {
        name: "hostname",
        type: "string",
        required: false,
        notes: {
          ru: "Человекочитаемая подпись для админки; обновляется при каждом обращении.",
          en: "Human-readable label for the admin UI; refreshed on every call.",
        },
      },
      {
        name: "capabilities",
        type: "string[]",
        required: false,
        notes: {
          ru: "На будущее: теги вроде ffmpeg / ae под гибридный роутинг. Сейчас не влияет на выдачу.",
          en: "Reserved: tags such as ffmpeg / ae for hybrid routing. Currently does not affect dispatch.",
        },
      },
    ],
    exampleProps: { machineUuid: "b1e2…", hostname: "render-box-1" },
    exampleResponse: {
      task: {
        id: "task-uuid",
        projectId: "project-uuid",
        projectName: "Project",
        ownerEmail: "client@example.com",
        payload: { schemaVersion: 1, processingQueue: ["mainSearch"] },
        attempts: 1,
        maxAttempts: 3,
        leaseExpiresAt: "2026-08-14T10:15:00.000Z",
      },
    },
  },
  {
    action: "taskProgress",
    group: "queue",
    summary: {
      ru: "Двинуть шаг и продлить аренду.",
      en: "Advance a step and extend the lease.",
    },
    description: {
      ru: "Первый отчёт переводит задачу из claimed в running. Каждый отчёт продлевает аренду на 15 минут, поэтому долгий шаг обязан отчитываться — иначе задачу вернут в очередь как брошенную. Строки прогресса не удаляются ни при успехе, ни при падении: это история шагов, по которой на сайте видно, что прошло нормально и на каком шаге всё встало. Сайт чистит их сам по возрасту. Отсюда уговор: перед taskFailed отчитайтесь по упавшему шагу status: \"error\" со своим message. taskFailed несёт один текст на всю задачу и не говорит, где именно сломалось.",
      en: "The first report moves the task from claimed to running. Every report extends the lease by 15 minutes, so a long step must keep reporting — otherwise the task is returned to the queue as abandoned. Progress rows are not deleted on success or on failure: they are the history of steps that shows the site what went through and where it stopped. The site evicts them by age on its own. Hence the convention: before taskFailed, report the broken step with status: \"error\" and your own message. taskFailed carries one text for the whole task and does not say where it broke.",
    },
    props: [
      {
        name: "taskId",
        type: "string (uuid)",
        required: true,
        notes: { ru: "Из ответа claimTask.", en: "From the claimTask response." },
      },
      {
        name: "stepId",
        type: "string",
        required: true,
        notes: {
          ru: "id шага из processingQueue.",
          en: "Step id from processingQueue.",
        },
      },
      {
        name: "status",
        type: '"running" | "done" | "error"',
        required: true,
        notes: { ru: "Состояние шага.", en: "Step state." },
      },
      {
        name: "message",
        type: "string | null",
        required: false,
        notes: { ru: "Короткая заметка к шагу.", en: "Short note for the step." },
      },
    ],
    exampleProps: {
      taskId: "task-uuid",
      stepId: "convert_01",
      status: "running",
      message: "ffmpeg 40%",
    },
    exampleResponse: { ok: true },
  },
  {
    action: "taskDone",
    group: "queue",
    summary: { ru: "Задача выполнена.", en: "Task finished." },
    description: {
      ru: "Идемпотентно по taskId: повторный заход (машина упала между заливкой и отчётом, задачу перезабрали и она прошла второй раз) отвечает ok, а не ошибкой. В распределённой системе «ровно один раз» не бывает, поэтому повтор сделан безвредным. Итог — outFiles и totalCost — ДОБАВЛЯЕТСЯ к payload, а не заменяет его: из payload берутся оси тарификации и цепочка шагов, и без них задача не списывается и показывается в очереди без шагов.",
      en: "Idempotent by taskId: a repeat call (the machine died between upload and report, the task was re-claimed and ran twice) answers ok rather than failing. “Exactly once” does not exist in a distributed system, so the repeat is made harmless. The outcome — outFiles and totalCost — is MERGED into the payload rather than replacing it: the billing axes and the chain of steps live there, and without them the task is never charged and shows no steps in the queue.",
    },
    props: [
      {
        name: "taskId",
        type: "string (uuid)",
        required: true,
        notes: { ru: "Из ответа claimTask.", en: "From the claimTask response." },
      },
      {
        name: "outFiles",
        type: "string[]",
        required: false,
        notes: {
          ru: "Логические пути результатов внутри проекта.",
          en: "Logical paths of the results inside the project.",
        },
      },
      {
        name: "totalCost",
        type: "number",
        required: false,
        notes: { ru: "Итоговая цена прогона.", en: "Total cost of the run." },
      },
    ],
    exampleProps: {
      taskId: "task-uuid",
      outFiles: ["OUT/clip_01.mp4"],
      totalCost: 0.09,
    },
    exampleResponse: { ok: true },
  },
  {
    action: "taskFailed",
    group: "queue",
    summary: { ru: "Задача упала.", en: "Task failed." },
    description: {
      ru: "В отличие от taskDone, payload **сохраняется**: без него нельзя ни переретраить задачу, ни разобраться в причине. Состояние терминальное — назад в очередь эта задача сама не вернётся. Сайт при этом уносит исходник из папки IN в папку ошибок проекта `errors (MM.DD-HH.mm)` — то же имя, что даёт ей десктоп-клиент: пока файл лежит в IN, он для конвейера невидим (обход берёт только элементы, по которым задачи не было), и его отсутствие в очереди нельзя объяснить, не заглянув в базу. Перед этим вызовом отчитайтесь по упавшему шагу через taskProgress со status: \"error\" — иначе на сайте не видно, где именно сломалось.",
      en: "Unlike taskDone, the payload is **kept**: without it the task can neither be retried nor investigated. The state is terminal — this task will not return to the queue by itself. The site also moves the source out of IN into the project's `errors (MM.DD-HH.mm)` folder — the same name the desktop client gives it: while the file sits in IN it is invisible to the pipeline (the sweep only takes elements that never had a task), and its absence from the queue cannot be explained without opening the database. Before this call, report the broken step via taskProgress with status: \"error\" — otherwise the site cannot show where it broke.",
    },
    props: [
      {
        name: "taskId",
        type: "string (uuid)",
        required: true,
        notes: { ru: "Из ответа claimTask.", en: "From the claimTask response." },
      },
      {
        name: "error",
        type: "string",
        required: true,
        notes: { ru: "Причина падения.", en: "Failure reason." },
      },
    ],
    exampleProps: { taskId: "task-uuid", error: "ffmpeg exit 1" },
    exampleResponse: { ok: true },
  },
  {
    action: "releaseTask",
    group: "queue",
    summary: {
      ru: "Вернуть задачу в очередь при аварийной остановке.",
      en: "Return a task to the queue on emergency stop.",
    },
    description: {
      ru: "У машины две кнопки стопа, и это разные операции. Мягкая доводит текущую задачу до конца и отчитывается обычным taskDone. Аварийная убивает процессы сейчас — и тогда нужен releaseTask, иначе задача пятнадцать минут числится взятой и никто её не подхватит. Попытка не считается: оператор остановил осознанно, это не провал обработки.",
      en: "The machine has two stop buttons, and they are different operations. The soft one finishes the current task and reports via the usual taskDone. The emergency one kills processes immediately — and then releaseTask is needed, otherwise the task stays claimed for fifteen minutes and nobody picks it up. The attempt is not counted: the operator stopped deliberately, this is not a processing failure.",
    },
    props: [
      {
        name: "taskId",
        type: "string (uuid)",
        required: true,
        notes: { ru: "Из ответа claimTask.", en: "From the claimTask response." },
      },
    ],
    exampleProps: { taskId: "task-uuid" },
    exampleResponse: { ok: true },
  },
  {
    action: "getSettings",
    group: "settings",
    summary: {
      ru: "Общие словари: типы файлов, цвета, маски путей.",
      en: "Shared dictionaries: file types, colors, path masks.",
    },
    description: {
      ru: "Словари общие на всю установку, а не на проект. Ответ всегда содержит revision — сравнивайте его с локальным, чтобы понять, нужно ли обновляться. То же значение приходит в поле settingsRevision ответа GET /api/storage/v1/delta, поэтому отдельный поллинг не нужен.",
      en: "Dictionaries are installation-wide, not per project. The response always carries a revision — compare it with your local one to decide whether to refresh. The same value arrives as settingsRevision in GET /api/storage/v1/delta, so no separate polling is needed.",
    },
    props: [
      {
        name: "domains",
        type: '("fileType" | "nodeType" | "dataType" | "pathPattern")[]',
        required: false,
        notes: {
          ru: "Без него вернутся все домены.",
          en: "Omit to get every domain.",
        },
      },
    ],
    exampleProps: { domains: ["fileType"] },
    exampleResponse: {
      revision: 42,
      domains: {
        fileType: [
          {
            name: "video",
            path: ["avi", "mov", "mp4", "mkv"],
            color: "#0a84fe",
            isDefault: true,
          },
        ],
      },
    },
  },
  {
    action: "putSettings",
    group: "settings",
    summary: {
      ru: "Запись словарей с проверкой ревизии.",
      en: "Write dictionaries with revision check.",
    },
    description: {
      ru: "Домены, не перечисленные в domains, не трогаются — можно послать только fileType, не зная остальных. Порядок записей значим: расширение, попавшее в два типа, достаётся верхнему. Если baseRevision устарела, ответ 409 содержит текущий документ целиком — слейте его со своим и повторите. Пути к программам и папкам материалов машинно-локальные, их доменов здесь нет вовсе.",
      en: "Domains absent from `domains` are left untouched — you can send fileType alone without knowing the rest. Entry order matters: an extension listed in two types belongs to the upper one. If baseRevision is stale, the 409 response carries the whole current document — merge it with yours and retry. Program and material-folder paths are machine-local and have no domain here.",
    },
    props: [
      {
        name: "baseRevision",
        type: "number",
        required: true,
        notes: {
          ru: "Ревизия, на которой основаны правки. Не совпала — 409.",
          en: "Revision your edits are based on. Mismatch — 409.",
        },
      },
      {
        name: "domains",
        type: "Record<domain, { name, path?, color?, isDefault? }[]>",
        required: true,
        notes: {
          ru: "Ключ записи — name. Расширения приводятся к нижнему регистру, ведущая точка отбрасывается.",
          en: "Entries are keyed by name. Extensions are lowercased and a leading dot is stripped.",
        },
      },
    ],
    exampleProps: {
      baseRevision: 42,
      domains: {
        fileType: [
          {
            name: "video",
            path: ["avi", "mov", "mp4", "mkv", "webm"],
            color: "#0a84fe",
            isDefault: true,
          },
        ],
      },
    },
    exampleResponse: {
      revision: 43,
      domains: {
        fileType: [
          {
            name: "video",
            path: ["avi", "mov", "mp4", "mkv", "webm"],
            color: "#0a84fe",
            isDefault: true,
          },
        ],
      },
    },
  },
  {
    action: "vendorKeys",
    group: "vault",
    summary: {
      ru: "Ключи внешних сервисов для этой машины.",
      en: "External service keys for this machine.",
    },
    description: {
      ru:
        "Спрашивайте ПЕРЕД задачей и только по тем сервисам, которые ей нужны. " +
        "В known передайте версии, которые уже лежат в локальном сейфе: совпало — " +
        "сервис попадёт в fresh, и ключ не поедет по сети. Копию храните " +
        "шифрованной и не дольше ttlSec. Сверяйте vaultRevision с тем, что " +
        "приходит в ответе на heartbeat: разошлось — спросите ключи заново. " +
        "Приезжают ВСЕ наши учётки по запрошенным сервисам плюс, если назван " +
        "taskId, учётка владельца задачи — чужие клиентские никогда. Какую взять, " +
        "решает метка в настройках проекта.",
      en:
        "Ask BEFORE a task and only for the services it needs. Pass the versions " +
        "already in your local vault via known: on a match the service comes back " +
        "in fresh and no key travels. Store the copy encrypted and no longer than " +
        "ttlSec. Compare vaultRevision with the one returned by heartbeat: if they " +
        "differ, ask for keys again. You receive ALL our accounts for the requested " +
        "services plus, when taskId is given, the task owner's own — never another " +
        "client's. Which one to use is decided by the label in the project settings.",
    },
    props: [
      {
        name: "services",
        type: "string[]",
        required: true,
        notes: {
          ru: "Слаги сервисов текущих задач, до 50. Весь сейф не запрашивается.",
          en: "Slugs for the current tasks’ services, up to 50. Never the whole vault.",
        },
      },
      {
        name: "known",
        type: "Record<string, { account, version }>",
        required: false,
        notes: {
          ru:
            "Что лежит в локальном сейфе. Ключ — \"слаг/метка\": " +
            "{ \"eleven-labs/main\": { account: \"main\", version: 7 } }. По одному " +
            "сервису учёток теперь несколько, и без метки в ключе вторая затёрла " +
            "бы первую. Голый слаг тоже принимается — для одной учётки.",
          en:
            "What the local vault holds. The key is \"slug/label\": " +
            "{ \"eleven-labs/main\": { account: \"main\", version: 7 } }. A service " +
            "now has several accounts, and without the label the second would " +
            "overwrite the first. A bare slug is still accepted for a single one.",
        },
      },
      {
        name: "taskId",
        type: "uuid",
        required: false,
        notes: {
          ru:
            "Под какую задачу. По ней сайт выдаёт учётку ВЛАДЕЛЬЦА задачи: проект " +
            "клиента на воркере парка работает его ключом, а не нашим.",
          en:
            "Which task the keys are for. The site resolves the task OWNER’s " +
            "account: a client project on a fleet worker runs on their key, not ours.",
        },
      },
    ],
    exampleProps: {
      services: ["eleven-labs"],
      known: { "eleven-labs/main": { account: "main", version: 6 } },
      taskId: "0f5c…",
    },
    exampleResponse: {
      keys: [
        {
          slug: "eleven-labs",
          account: "test",
          version: 2,
          fields: { apiKey: "sk_…" },
          ttlSec: 21600,
        },
      ],
      fresh: [{ slug: "eleven-labs", account: "main" }],
      unavailable: [],
      services: [
        {
          slug: "eleven-labs",
          baseUrl: "https://api.elevenlabs.io",
          accounts: [
            { label: "main", owner: "platform", hasSecret: true },
            { label: "test", owner: "platform", hasSecret: true },
          ],
          secretFields: [{ key: "apiKey", label: "", secret: true }],
        },
      ],
      vaultRevision: 42,
    },
  },
  {
    action: "vendorUsage",
    group: "vault",
    summary: {
      ru: "Потребление внешнего сервиса по задаче. Единицы, не деньги.",
      en: "External service usage for a task. Units, not money.",
    },
    description: {
      ru:
        "Шлите СРАЗУ после ответа вендора, не дожидаясь taskDone: деньги у вендора " +
        "уже списаны, и упади машина следом — расход всё равно должен быть учтён. " +
        "Цену не присылайте: её знает сайт, и считает он сам. Повтор по той же " +
        "тройке (задача, сервис, мера) расход не удваивает. Локальный прогон " +
        "шлите без taskId, но с runId: такие строки в списание не идут, а в " +
        "суточную сверку идут — у вендора деньги списались. Ответ разбирайте: " +
        "unpriced и noRate означают, что строка НЕ записана.",
      en:
        "Send RIGHT AFTER the vendor responds, without waiting for taskDone: the " +
        "vendor has already been paid, and if the machine dies next the spending " +
        "must still be accounted for. Do not send a price: the site knows it and " +
        "computes the money itself. Repeating the same (task, service, unit) does " +
        "not double the spending. Send a local run without taskId but with runId: " +
        "such rows are never billed, yet they do count towards the daily " +
        "reconciliation — the vendor was paid. Read the response: unpriced and " +
        "noRate mean the row was NOT recorded.",
    },
    props: [
      {
        name: "taskId",
        type: "uuid",
        required: false,
        notes: {
          ru:
            "Задача из claimTask. Не шлите для локального прогона — тогда нужен " +
            "runId. Ровно одно из двух.",
          en:
            "The task from claimTask. Omit for a local run — then runId is " +
            "required. Exactly one of the two.",
        },
      },
      {
        name: "runId",
        type: "string",
        required: false,
        notes: {
          ru:
            "Идентификатор локального прогона, которым он дедуплицируется: отчёт " +
            "может уехать дважды при обрыве связи. Нужен ровно тогда, когда нет " +
            "taskId.",
          en:
            "Identifier of a local run, used to deduplicate it: the report may be " +
            "sent twice after a dropped connection. Required exactly when taskId " +
            "is absent.",
        },
      },
      {
        name: "entries",
        type: "{ service, unit, units, account? }[]",
        required: true,
        notes: {
          ru:
            "unit: token | char | sec | image | run. units — сколько израсходовано. " +
            "account — метка учётки из выдачи ключей: по ней мы поймём, чей это " +
            "расход, наш или клиента.",
          en:
            "unit: token | char | sec | image | run. units — how much was consumed. " +
            "account — the label from the key issue, so we can tell whose spending " +
            "it is, ours or the client’s.",
        },
      },
    ],
    exampleProps: {
      taskId: "0f5c…",
      entries: [
        { service: "eleven-labs", unit: "char", units: 8140, account: "main" },
      ],
    },
    exampleResponse: {
      recorded: 1,
      duplicate: 0,
      unknown: [],
      unpriced: [],
      noRate: [],
    },
  },
  {
    action: "vendorIncident",
    group: "vault",
    summary: {
      ru: "Сбой в контуре ключей: код и слаг сервиса, не текст.",
      en: "A failure in the key contour: a code and a service slug, not text.",
    },
    description: {
      ru:
        "Шлите, когда работа сорвалась из-за внешнего сервиса: ключ протух в " +
        "момент вызова, вендор отказал, у клиента кончились деньги. Коды " +
        "key-missing, key-rejected и owner-out-of-funds считаются блокирующими: " +
        "другие машины тоже не справятся, поэтому сайт закроет задачу (если " +
        "прислали taskId) и погасит проект (если прислали projectId). " +
        "vendor-refused и quota-exceeded так не гасят: первое бывает разовым " +
        "сбоем, второе проходит со сменой суток — по ним просто запись в журнал. " +
        "Разбирайте ответ: taskClosed говорит, ждать ли повтора по этой задаче.",
      en:
        "Send this when work broke because of an external service: the key " +
        "expired mid-call, the vendor refused, the client ran out of money. The " +
        "codes key-missing, key-rejected and owner-out-of-funds count as " +
        "blocking: other machines will fail too, so the site closes the task (if " +
        "taskId is given) and pauses the project (if projectId is given). " +
        "vendor-refused and quota-exceeded do not: the first can be a one-off, " +
        "the second clears at midnight — those are journal entries only. Read the " +
        "response: taskClosed tells you whether to expect a retry of this task.",
    },
    props: [
      {
        name: "code",
        type: "string",
        required: true,
        notes: {
          ru:
            "key-missing | key-rejected | vendor-refused | owner-out-of-funds | " +
            "quota-exceeded. Список закрытый: состояние проекта показываем и мы, " +
            "и вы, и разбирать текст ради значка — гарантированное расхождение.",
          en:
            "key-missing | key-rejected | vendor-refused | owner-out-of-funds | " +
            "quota-exceeded. A closed list: both sides render project state, and " +
            "parsing free text for a badge is a guaranteed divergence.",
        },
      },
      {
        name: "service",
        type: "string",
        required: true,
        notes: { ru: "Слаг сервиса.", en: "The service slug." },
      },
      {
        name: "account",
        type: "string",
        required: false,
        notes: {
          ru: "Метка учётки, если ключ уже был получен.",
          en: "The account label, when a key had already been issued.",
        },
      },
      {
        name: "taskId",
        type: "uuid",
        required: false,
        notes: {
          ru:
            "Задача, на которой сорвалось. При блокирующем коде сайт закроет её " +
            "и НЕ спишет попытку — причина не в машине.",
          en:
            "The task it broke on. On a blocking code the site closes it and does " +
            "NOT spend an attempt — the machine is not at fault.",
        },
      },
      {
        name: "projectId",
        type: "string",
        required: false,
        notes: {
          ru: "Проект. При блокирующем коде встанет на паузу с причиной no-vendor-key.",
          en: "The project. On a blocking code it is paused with reason no-vendor-key.",
        },
      },
      {
        name: "detail",
        type: "string",
        required: false,
        notes: {
          ru: "Ответ вендора одной строкой — для человека. Решения по нему не принимаются.",
          en: "The vendor’s reply in one line, for a human. No decisions are made from it.",
        },
      },
    ],
    exampleProps: {
      code: "key-rejected",
      service: "eleven-labs",
      account: "main",
      taskId: "0f5c…",
      projectId: "prj_…",
    },
    exampleResponse: {
      recorded: true,
      blocking: true,
      taskClosed: true,
      paused: true,
    },
  },
]

export const MACHINE_API_ERRORS: {
  status: number
  meaning: LocaleText
}[] = [
  {
    status: 400,
    meaning: {
      ru: "Невалидный JSON, неизвестный action или неверные props.",
      en: "Invalid JSON, unknown action, or invalid props.",
    },
  },
  {
    status: 401,
    meaning: {
      ru: "Нет токена или токен неверный / отозван.",
      en: "Missing token, or token is invalid / revoked.",
    },
  },
  {
    status: 403,
    meaning: {
      ru: "Аккаунт создателя неактивен, либо операция запрещена (например reserved name).",
      en: "Creator account inactive, or the operation is forbidden (e.g. reserved name).",
    },
  },
  {
    status: 404,
    meaning: {
      ru: "Компьютер, проект или файл не найден.",
      en: "Computer, project, or file not found.",
    },
  },
  {
    status: 409,
    meaning: {
      ru: "Конфликт: дубликат имени, нет объекта в R2, ETag. У putSettings — устаревшая baseRevision; тело содержит текущий документ.",
      en: "Conflict: duplicate name, missing R2 object, ETag. For putSettings — stale baseRevision; the body carries the current document.",
    },
  },
  {
    status: 503,
    meaning: {
      ru: "Хранилище не настроено или сбой R2 / reindex.",
      en: "Storage not configured, or R2 / reindex failure.",
    },
  },
]
