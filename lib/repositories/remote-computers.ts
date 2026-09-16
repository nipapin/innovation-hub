import { randomBytes, randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import {
  REMOTE_COMPUTER_ONLINE_MS,
  type RemoteComputerRecord,
  type RemoteComputerStatus,
} from "@/lib/domain-types"
import { hashMachineToken } from "@/lib/storage/write-path"

const COMPUTER_FIELDS = `
  rc.id,
  rc.name,
  rc.description,
  rc.status,
  rc.current_project_id AS "currentProjectId",
  rc.current_task AS "currentTask",
  rc.machine_uuid AS "machineUuid",
  rc.last_heartbeat_at AS "lastHeartbeatAt",
  rc.meta,
  rc.created_by AS "createdBy",
  rc.created_at AS "createdAt",
  rc.revoked_at AS "revokedAt"
`

export type RemoteComputerListItem = RemoteComputerRecord & {
  online: boolean
  currentProjectName: string | null
}

export type RemoteComputerAuthRow = {
  id: string
  name: string
  createdBy: string
  email: string
  isActive: boolean
  /** NULL — наша машина. Заполнено — машина компании, см. COMPANY_PIPELINE_PLAN.md §2. */
  companyId: string | null
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}

function mapRecord(row: RemoteComputerRecord): RemoteComputerRecord {
  return {
    ...row,
    meta: parseMeta(row.meta),
  }
}

export function isRemoteComputerOnline(
  lastHeartbeatAt: Date | null,
  revokedAt: Date | null = null,
): boolean {
  if (revokedAt) return false
  if (!lastHeartbeatAt) return false
  return Date.now() - lastHeartbeatAt.getTime() <= REMOTE_COMPUTER_ONLINE_MS
}

export function generateRemoteComputerToken(): string {
  return `rc_${randomBytes(32).toString("base64url")}`
}

export async function listRemoteComputers(): Promise<RemoteComputerListItem[]> {
  const result = await query<
    RemoteComputerRecord & { currentProjectName: string | null }
  >(
    `SELECT ${COMPUTER_FIELDS},
            p.name AS "currentProjectName"
       FROM remote_computers rc
  LEFT JOIN projects p ON p.id = rc.current_project_id
      WHERE rc.revoked_at IS NULL
      ORDER BY rc.created_at DESC`,
  )
  return result.rows.map((row) => {
    const record = mapRecord(row)
    return {
      ...record,
      currentProjectName: row.currentProjectName,
      online: isRemoteComputerOnline(record.lastHeartbeatAt, record.revokedAt),
    }
  })
}

export async function findRemoteComputerById(
  id: string,
): Promise<RemoteComputerRecord | null> {
  const result = await query<RemoteComputerRecord>(
    `SELECT ${COMPUTER_FIELDS}
       FROM remote_computers rc
      WHERE rc.id = $1`,
    [id],
  )
  const row = result.rows[0]
  return row ? mapRecord(row) : null
}

export async function findActiveRemoteComputerByTokenHash(
  tokenHash: string,
): Promise<RemoteComputerAuthRow | null> {
  const result = await query<RemoteComputerAuthRow>(
    `SELECT rc.id,
            rc.name,
            rc.created_by AS "createdBy",
            rc.company_id AS "companyId",
            u.email,
            u.is_active AS "isActive"
       FROM remote_computers rc
       JOIN users u ON u.id = rc.created_by
      WHERE rc.token_hash = $1
        AND rc.revoked_at IS NULL`,
    [tokenHash],
  )
  return result.rows[0] ?? null
}

export async function createRemoteComputer(input: {
  name: string
  description?: string
  createdBy: string
  rawToken: string
  /**
   * Компания машины. NULL — наша, как было всегда. Заполнено — она стоит у
   * клиента и видит только его проекты (docs/COMPANY_PIPELINE_PLAN.md §2).
   */
  companyId?: string | null
}): Promise<{ id: string; token: string; name: string }> {
  const id = randomUUID()
  const tokenHash = hashMachineToken(input.rawToken)
  await query(
    `INSERT INTO remote_computers (id, name, description, token_hash, created_by, company_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      input.name,
      input.description?.trim() ?? "",
      tokenHash,
      input.createdBy,
      input.companyId ?? null,
    ],
  )
  return { id, token: input.rawToken, name: input.name }
}

/**
 * Находит машину по её UUID или заводит новую.
 *
 * Заводить компьютер в админке руками не нужно: машина приходит со своим UUID,
 * сгенерированным один раз при первом запуске, и сайт создаёт строку сам
 * (PIPELINE_BACKEND_REQUESTS.md §4).
 *
 * Почему UUID, а не hostname: дефолтные имена маков совпадают сплошь и рядом, и
 * на совпадении ломается не очередь, а архив статистики — две машины начнут
 * писать в один объект, а в объектном хранилище нет дописывания в конец, заливка
 * перезаписывает объект целиком и строки затрутся тихо. Hostname остаётся
 * человекочитаемой подписью в `name` и обновляется на каждом обращении: машину
 * могли переименовать.
 *
 * `token_hash` у самозаписанной машины синтетический: она ходит своим `mch_`
 * токеном, а не выданным `rc_`, и подобрать этот хеш нечем — он не хеш токена.
 * В него подмешан id строки, а не только UUID: на колонке стоит UNIQUE, и после
 * смены токена отозванная строка продолжала бы держать прежнее значение — вставка
 * упиралась бы в конфликт, и машина не смогла бы завестись заново.
 */
export async function ensureRemoteComputerByUuid(input: {
  machineUuid: string
  hostname?: string | null
  /** Владелец токена, которым пришла машина. */
  userId: string
  /**
   * Каким `mch_`-токеном машина зашла. Без этого нельзя ответить на вопрос «кто
   * подключён по этому токену», а модель такого токена — «один токен, много
   * машин». У `rc_`-компьютеров null: там токен свой у каждого.
   */
  registeredTokenId?: string | null
}): Promise<{ id: string; name: string; created: boolean }> {
  const uuid = input.machineUuid.trim()
  const label = input.hostname?.trim() || `machine-${uuid.slice(0, 8)}`

  const existing = await query<{ id: string }>(
    `SELECT id FROM remote_computers
      WHERE machine_uuid = $1 AND revoked_at IS NULL`,
    [uuid],
  )
  if (existing.rows[0]) {
    const row = existing.rows[0]
    // Hostname обновляем на каждом обращении: машину могли переименовать.
    // Токен тоже — машина могла перейти на новый, и показывать её под старым
    // означало бы врать о том, кто чем ходит.
    await query(
      `UPDATE remote_computers
          SET name = COALESCE($2, name),
              registered_token_id = COALESCE($3, registered_token_id)
        WHERE id = $1`,
      [row.id, input.hostname?.trim() ? label : null, input.registeredTokenId ?? null],
    )
    return { id: row.id, name: label, created: false }
  }

  const id = randomUUID()
  const inserted = await query<{ id: string }>(
    `INSERT INTO remote_computers
       (id, name, description, token_hash, machine_uuid, registered_token_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      id,
      label,
      "Заведена автоматически при первом обращении машины.",
      `self:${uuid}:${id}`,
      uuid,
      input.registeredTokenId ?? null,
      input.userId,
    ],
  )

  // Ноль строк — параллельная самозапись той же машины успела раньше.
  if (inserted.rows.length === 0) {
    const race = await query<{ id: string; name: string }>(
      `SELECT id, name FROM remote_computers
        WHERE machine_uuid = $1 AND revoked_at IS NULL`,
      [uuid],
    )
    const row = race.rows[0]
    if (!row) throw new Error(`Failed to register machine ${uuid}.`)
    return { id: row.id, name: row.name, created: false }
  }

  return { id, name: label, created: true }
}

/**
 * Дописывает идентичность машины на существующую строку компьютера.
 *
 * Для токена `rc_` строка уже есть — заводить по UUID вторую нельзя: одна машина
 * числилась бы дважды. UUID тут нужен только чтобы имя файла статистики на сайте
 * совпало с тем, что машина пишет у себя.
 */
export async function recordComputerIdentity(input: {
  computerId: string
  machineUuid: string
  hostname?: string | null
}): Promise<void> {
  await query(
    `UPDATE remote_computers
        SET machine_uuid = $2,
            name = COALESCE($3, name)
      WHERE id = $1`,
    [input.computerId, input.machineUuid.trim(), input.hostname?.trim() || null],
  )
}

/**
 * Сколько машина считается «на связи» / «воркер опрашивает очередь».
 *
 * Окна разные и это осознанно. Контакт может быть редким (пинг на пульсе
 * синхронизации), а опрос очереди идёт каждые несколько секунд, пока воркер
 * включён — поэтому «воркер работает» гаснет быстрее, чем «машина на связи»,
 * и выключенный воркер виден почти сразу.
 */
export const MACHINE_SEEN_MS = 90_000
export const MACHINE_CLAIMING_MS = 45_000

/**
 * Отмечает контакт машины.
 *
 * `claimed` — обращение было именно за задачей, то есть на машине запущен воркер.
 * Любое обращение двигает и `last_seen_at`: если машина спросила задачу, она
 * заведомо на связи, и требовать отдельного пинга было бы лишним.
 */
export async function touchMachineContact(input: {
  computerId: string
  claimed?: boolean
}): Promise<void> {
  await query(
    `UPDATE remote_computers
        SET last_seen_at = NOW(),
            last_claim_at = CASE WHEN $2 THEN NOW() ELSE last_claim_at END
      WHERE id = $1`,
    [input.computerId, input.claimed === true],
  )
}

/**
 * Гасит машины, зарегистрированные отозванным токеном.
 *
 * Токен сменили — машины под ним отваливаются и должны завестись заново уже под
 * новым. Технически они и так перестанут ходить (авторизация откажет), но
 * оставлять их в списке нельзя: выглядело бы как живой парк машин, которого нет.
 *
 * Строку помечаем `revoked_at`, а не удаляем: частичный уникальный индекс по
 * `machine_uuid` учитывает только неотозванные, поэтому та же машина спокойно
 * заведётся под новым токеном, а история старой останется.
 */
export async function revokeComputersByToken(tokenId: string): Promise<number> {
  const result = await query(
    `UPDATE remote_computers
        SET revoked_at = NOW()
      WHERE registered_token_id = $1 AND revoked_at IS NULL`,
    [tokenId],
  )
  return result.rowCount ?? 0
}

/**
 * Состояние воркера на машине. Четыре состояния, а не флаг: «выключен» и «включён,
 * но задач нет» — разные вещи, и по одному индикатору их не различить.
 */
export type WorkerState = "off" | "searching" | "processing" | "error"

export type TokenMachine = {
  id: string
  /** Ключ машины. null у компьютеров, заведённых руками до появления UUID. */
  machineUuid: string | null
  /** Hostname — подпись для человека. */
  name: string
  /** Стучится на сайт: любое обращение по API не дольше MACHINE_SEEN_MS назад. */
  seen: boolean
  worker: WorkerState
  lastSeenAt: string | null
  lastClaimAt: string | null
  currentTaskId: string | null
  currentProjectName: string | null
}

/**
 * Токен доступа как его видит человек: «я завёл токен, назвал его и скопировал в
 * машину». Под токеном — машины, которые им обращались.
 *
 * Двух видов, потому что и механизма два, но для пользователя это одно и то же
 * понятие, поэтому в UI они в одном списке:
 *
 * - `computer` — токен `rc_`, выданный кнопкой «Подключить компьютер». Одна машина
 *   на токен по устройству: сам компьютер и есть эта машина.
 * - `machine` — токен `mch_`, которым ходит десктоп. Под ним сколько угодно машин,
 *   каждая опознаётся своим UUID.
 */
export type AccessToken = {
  kind: "computer" | "machine"
  id: string
  name: string
  ownerEmail: string
  /** Токен, привязанный к одному проекту: остальные ему не видны. */
  projectId: string | null
  createdAt: string
  machines: TokenMachine[]
  /**
   * Выпустить новое значение взамен старого умеет только токен компьютера: у
   * `mch_` мы храним один хеш и показать замену нам нечем. Отзыв есть у обоих.
   */
  canRotate: boolean
}

function deriveWorkerState(input: {
  status: RemoteComputerStatus
  claiming: boolean
  currentTaskId: string | null
}): WorkerState {
  if (input.status === "error") return "error"
  if (!input.claiming) return "off"
  return input.currentTaskId ? "processing" : "searching"
}

/**
 * Все токены доступа с машинами под ними — для страницы «Удалённый доступ».
 *
 * Админский обзор: показываем токены всех пользователей, потому что парк машин это
 * установка целиком, а не собственность одного аккаунта.
 */
export async function listAccessTokens(): Promise<AccessToken[]> {
  const now = Date.now()
  const fresh = (value: Date | null, windowMs: number) =>
    value != null && now - value.getTime() <= windowMs

  const computers = await query<{
    id: string
    name: string
    ownerEmail: string
    status: RemoteComputerStatus
    machineUuid: string | null
    registeredTokenId: string | null
    lastSeenAt: Date | null
    lastClaimAt: Date | null
    lastHeartbeatAt: Date | null
    currentTaskId: string | null
    currentProjectName: string | null
    createdAt: Date
  }>(
    `SELECT rc.id,
            rc.name,
            u.email AS "ownerEmail",
            rc.status,
            rc.machine_uuid AS "machineUuid",
            rc.registered_token_id AS "registeredTokenId",
            rc.last_seen_at AS "lastSeenAt",
            rc.last_claim_at AS "lastClaimAt",
            rc.last_heartbeat_at AS "lastHeartbeatAt",
            rc.current_task_id AS "currentTaskId",
            p.name AS "currentProjectName",
            rc.created_at AS "createdAt"
       FROM remote_computers rc
       JOIN users u ON u.id = rc.created_by
  LEFT JOIN projects p ON p.id = rc.current_project_id
      WHERE rc.revoked_at IS NULL
      ORDER BY rc.created_at`,
  )

  const toMachine = (row: (typeof computers.rows)[number]): TokenMachine => {
    const claiming = fresh(row.lastClaimAt, MACHINE_CLAIMING_MS)
    return {
      id: row.id,
      machineUuid: row.machineUuid,
      name: row.name,
      // Компьютеры с токеном `rc_` отмечаются heartbeat'ом, десктоп — обращениями
      // к очереди и пингом. Живым считаем по любому из следов.
      seen:
        fresh(row.lastSeenAt, MACHINE_SEEN_MS) ||
        fresh(row.lastHeartbeatAt, MACHINE_SEEN_MS),
      worker: deriveWorkerState({
        status: row.status,
        claiming,
        currentTaskId: row.currentTaskId,
      }),
      lastSeenAt: (row.lastSeenAt ?? row.lastHeartbeatAt)?.toISOString() ?? null,
      lastClaimAt: row.lastClaimAt?.toISOString() ?? null,
      currentTaskId: row.currentTaskId,
      currentProjectName: row.currentProjectName,
    }
  }

  // Токены mch_: под каждым сколько угодно машин.
  const tokens = await query<{
    id: string
    name: string
    ownerEmail: string
    projectId: string | null
    createdAt: Date
  }>(
    `SELECT mt.id, mt.name, u.email AS "ownerEmail",
            mt.project_id AS "projectId", mt.created_at AS "createdAt"
       FROM machine_tokens mt
       JOIN users u ON u.id = mt.user_id
      WHERE mt.revoked_at IS NULL
      ORDER BY mt.created_at DESC`,
  )

  const byToken = new Map<string, TokenMachine[]>()
  for (const row of computers.rows) {
    if (!row.registeredTokenId) continue
    const list = byToken.get(row.registeredTokenId) ?? []
    list.push(toMachine(row))
    byToken.set(row.registeredTokenId, list)
  }

  const machineTokens: AccessToken[] = tokens.rows.map((token) => ({
    kind: "machine",
    id: token.id,
    name: token.name,
    ownerEmail: token.ownerEmail,
    projectId: token.projectId,
    createdAt: token.createdAt.toISOString(),
    machines: byToken.get(token.id) ?? [],
    canRotate: false,
  }))

  // Токены rc_: сам компьютер и есть единственная машина под своим токеном.
  const computerTokens: AccessToken[] = computers.rows
    .filter((row) => row.registeredTokenId == null)
    .map((row) => ({
      kind: "computer",
      id: row.id,
      name: row.name,
      ownerEmail: row.ownerEmail,
      projectId: null,
      createdAt: row.createdAt.toISOString(),
      machines: [toMachine(row)],
      canRotate: true,
    }))

  return [...computerTokens, ...machineTokens]
}

export async function updateRemoteComputer(
  id: string,
  patch: { name?: string; description?: string },
): Promise<RemoteComputerRecord | null> {
  const existing = await findRemoteComputerById(id)
  if (!existing || existing.revokedAt) return null

  const name = patch.name?.trim() ?? existing.name
  const description =
    patch.description !== undefined
      ? patch.description.trim()
      : existing.description

  await query(
    `UPDATE remote_computers
        SET name = $2, description = $3
      WHERE id = $1 AND revoked_at IS NULL`,
    [id, name, description],
  )
  return findRemoteComputerById(id)
}

export async function revokeRemoteComputer(id: string): Promise<boolean> {
  const result = await query(
    `UPDATE remote_computers
        SET revoked_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL`,
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

export async function rotateRemoteComputerToken(
  id: string,
  rawToken: string,
): Promise<boolean> {
  const tokenHash = hashMachineToken(rawToken)
  const result = await query(
    `UPDATE remote_computers
        SET token_hash = $2
      WHERE id = $1 AND revoked_at IS NULL`,
    [id, tokenHash],
  )
  return (result.rowCount ?? 0) > 0
}

export async function heartbeatRemoteComputer(
  id: string,
  input: {
    status?: RemoteComputerStatus
    currentProjectId?: string | null
    currentTask?: string | null
    meta?: Record<string, unknown>
  },
): Promise<RemoteComputerRecord | null> {
  const existing = await findRemoteComputerById(id)
  if (!existing || existing.revokedAt) return null

  const status = input.status ?? existing.status
  const currentProjectId =
    input.currentProjectId !== undefined
      ? input.currentProjectId
      : existing.currentProjectId
  const currentTask =
    input.currentTask !== undefined ? input.currentTask : existing.currentTask
  const meta = input.meta !== undefined ? input.meta : existing.meta

  await query(
    `UPDATE remote_computers
        SET status = $2,
            current_project_id = $3,
            current_task = $4,
            meta = $5::jsonb,
            last_heartbeat_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL`,
    [
      id,
      status,
      currentProjectId,
      currentTask,
      JSON.stringify(meta ?? {}),
    ],
  )
  return findRemoteComputerById(id)
}

export function toRemoteComputerPublic(
  record: RemoteComputerRecord,
): RemoteComputerListItem & { online: boolean } {
  return {
    ...record,
    currentProjectName: null,
    online: isRemoteComputerOnline(record.lastHeartbeatAt, record.revokedAt),
  }
}
