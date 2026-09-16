/**
 * Лестница: USER < ADMIN < SUPERADMIN. Сравнивать роли — через
 * lib/admin-roles.ts (`isElevated`, `roleAtLeast`), а не литералами: проверка
 * `role === "ADMIN"` отсекает суперадмина и ломает машины под его токеном.
 */
export type UserRole = "USER" | "ADMIN" | "SUPERADMIN"

export type AuthProvider = "local" | "google"

export type UserRecord = {
  id: string
  fullName: string
  /**
   * Имя для статистики обработки — им подписаны задачи, которые человек залил
   * (description.contact). NULL — берём fullName.
   */
  contactName: string | null
  email: string
  role: UserRole
  /** Аккаунт не заблокирован — к автоматизации отношения не имеет. */
  isActive: boolean
  createdAt: Date
  balanceCents: number
  driveFolderId: string | null
  mustChangePassword: boolean
  /**
   * Админский гейт конвейера (/admin/pipeline, колонка 1). Выключенный
   * пользователь снимается со слежения целиком, флаги его проектов при этом
   * не меняются. Расшаренные проекты гейтятся флагом владельца.
   */
  automationEnabled: boolean
  /**
   * Компания человека. NULL — общий раздел, то есть сайт ровно такой, каким
   * работал до компаний (docs/COMPANY_ACCOUNTS_PLAN.md §3). Пара с
   * `companyRole` держится CHECK'ом в базе: либо оба NULL, либо оба заполнены.
   */
  companyId: string | null
  companyRole: CompanyRole | null
}

export type ProjectGroupName = "personal" | "shared" | "tools" | "archive"

export type ProjectRecord = {
  id: string
  /** Alias of userId — used by the S3 workspace UI. */
  ownerId: string
  /** Alias of ownerId — used by Drive / YouGile integrations. */
  userId: string
  /**
   * Где лежат байты проекта в R2 — `projects/{storageOwnerId}/{id}/…`.
   *
   * Это НЕ владелец и не право: адрес объекта, назначенный при создании и
   * неизменный дальше. Совпадает с `ownerId` у всех проектов, кроме переданных
   * другому человеку — там владелец сменился, а ключи остались прежними,
   * потому что перенос байтов означал бы полную перезаливку зеркал на парке
   * машин. Строить ключи — отсюда; решать, кому можно, — из `ownerId` и
   * project_members. Разбор — docs/ADMIN_WORKSPACE_PLAN.md §5.
   */
  storageOwnerId: string
  name: string
  description: string
  groupName: ProjectGroupName
  isPaused: boolean
  driveFolderId: string | null
  isActive: boolean
  /** Проект в архиве: скрыт из рабочего списка, обработки по нему не запускаются. */
  isArchived: boolean
  archivedAt: Date | null
  /**
   * Почему проект стоит. NULL — остановил человек; иначе биллинг, и тумблер
   * обратно не включится, пока платить нечем (lib/billing/admission.ts).
   */
  pausedReason: "no-funds" | "trial-over" | "no-vendor-key" | "payer-no-funds" | null
  /** Soft-deleted into project trash; purged after retention. */
  deletedAt: Date | null
  /** Optional client grouping (UI hierarchy; not part of R2 keys). */
  clientId: string | null
  createdAt: Date
  updatedAt: Date
  /** YouGile group chat id, created lazily on the first chat message. */
  yougileChatId: string | null
}

export type ClientRecord = {
  id: string
  userId: string
  displayName: string
  createdAt: Date
}

export type ProjectFileRecord = {
  id: string
  projectId: string
  folderPath: string
  name: string
  isFolder: boolean
  s3Key: string | null
  sizeBytes: number
  contentType: string
  /**
   * Версия объекта в хранилище. Есть не во всех выборках: репозитории читают
   * строку без них, путь записи (lib/storage/write-path.ts) — вместе с ними,
   * потому что клиенту после заливки нужно чем-то сравнивать локальную копию с
   * облачной.
   */
  etag?: string | null
  contentHash?: string | null
  /**
   * Кто принёс файл — имя из users.contact_name / full_name. Как и etag, есть не
   * во всех выборках: заполняется там, где список строится для показа человеку
   * (listAllProjectFiles), путь записи этим полем не пользуется.
   */
  uploadedByName?: string | null
  createdAt: Date
}

export type MessageSenderRole = "user" | "team"

export type ProjectMessageRecord = {
  id: string
  projectId: string
  senderId: string | null
  senderRole: MessageSenderRole
  text: string
  createdAt: Date
  readByUser: boolean
  readByTeam: boolean
}

export type ProjectChatSenderType = "client" | "team" | "system"

export type ProjectChatMessageRecord = {
  id: string
  projectId: string
  senderType: ProjectChatSenderType
  senderUserId: string | null
  senderName: string
  body: string
  yougileMessageId: string | null
  delivered: boolean
  createdAt: Date
}

export type ProjectMediaRecord = {
  id: string
  projectId: string
  fileName: string
  mimeType: string
  sizeBytes: number | null
  driveFileId: string
  createdAt: Date
}

export type UserRecordWithPassword = UserRecord & {
  /** Null for OAuth-only accounts (e.g. Google sign-in without a password). */
  passwordHash: string | null
  authProvider: AuthProvider
  providerAccountId: string | null
  /**
   * person — обычный человек. company_wallet — служебный аккаунт кошелька
   * компании (docs/COMPANY_ACCOUNTS_PLAN.md §7.3): без пароля, вход отклоняется
   * явной проверкой в app/api/auth/signin, а не только отсутствием пароля —
   * иначе сообщение об ошибке путало бы это с OAuth-аккаунтом.
   */
  kind: UserKind
}

/** См. UserRecordWithPassword.kind. */
export type UserKind = "person" | "company_wallet"

/**
 * Роль внутри компании — вторая, независимая от users.role ось (план §4).
 * `owner` — корень раздачи прав в своей компании, аналог SUPERADMIN на сайте;
 * `admin` действует по тегам company_capabilities; `member` работает в своих
 * проектах и консоли компании не видит.
 */
export type CompanyRole = "member" | "admin" | "owner"

export type CompanyRecord = {
  id: string
  slug: string
  title: string
  walletUserId: string
  domain: string | null
  branding: Record<string, unknown>
  features: Record<string, unknown>
  isActive: boolean
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}

export type VideoRecord = {
  id: string
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  tags: string[]
  /** @deprecated Use tags[0]; kept for transitional reads */
  category: string
  isPublished: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export type IdeaRecord = {
  id: string
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  tags: string[]
  /** @deprecated Use tags[0]; kept for transitional reads */
  category: string
  isPublished: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export type TagSuggestionRecord = {
  fieldScope: string
  value: string
  usageCount: number
  createdAt: Date
  updatedAt: Date
}

export type RemoteComputerStatus = "idle" | "busy" | "error"

export type RemoteComputerRecord = {
  id: string
  name: string
  description: string
  status: RemoteComputerStatus
  currentProjectId: string | null
  currentTask: string | null
  /** UUID машины при самозаписи; у заведённых руками — null. */
  machineUuid: string | null
  lastHeartbeatAt: Date | null
  meta: Record<string, unknown>
  createdBy: string
  createdAt: Date
  revokedAt: Date | null
}

/** Heartbeat window: computer is online if last_heartbeat_at is within this many ms. */
export const REMOTE_COMPUTER_ONLINE_MS = 90_000
