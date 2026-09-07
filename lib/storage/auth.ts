import { randomUUID } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { findUserById } from "@/lib/repositories/users"
import {
  findActiveRemoteComputerByTokenHash,
} from "@/lib/repositories/remote-computers"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  findOwnedProject,
  findProjectById,
} from "@/lib/repositories/projects"
import {
  resolveProjectAccess as resolveSiteProjectAccess,
  roleAtLeast,
  type ProjectAccessRole,
} from "@/lib/project-access"
import { hashMachineToken, type StorageActor } from "@/lib/storage/write-path"
import type { UserRole } from "@/lib/domain-types"
import { isElevated, isSuperAdmin } from "@/lib/admin-roles"
import {
  hasCapability,
  type AdminCapability,
} from "@/lib/admin-capabilities"
import { listCapabilitiesFor } from "@/lib/repositories/admin-capabilities"

export type StorageApiAuth = {
  userId: string
  email: string
  role: UserRole
  machineTokenId: string | null
  computerId: string | null
  scopedProjectId: string | null
  /**
   * Теги актора. У машин всегда пусто и не спрашивается: программа авторизуется
   * протоколом, а не тегами (docs/ADMIN_ROLES_PLAN.md §7).
   */
  capabilities: AdminCapability[]
}

/** Машина парка или десктоп под токеном, а не браузерная сессия. */
export function isMachineAuth(auth: StorageApiAuth): boolean {
  return auth.machineTokenId != null || auth.computerId != null
}

/**
 * Может ли актор дотянуться до ЛЮБОГО проекта, а не только до своих.
 *
 * Одна функция на все места, где раньше стояло `auth.role === "ADMIN"`, и
 * порядок в ней значим: **сначала машина, потом тег**. Программу мы в правах не
 * ограничиваем — доступ к чужим проектам и есть её работа; спроси мы у неё тег,
 * которого у неё нет и быть не может, встал бы весь парк. Человеку же одной
 * админской роли мало: нужен `projects.access`.
 *
 * Особенно это важно там, где ветки человека и машины НЕ разделены —
 * requireOwnedProjectAccess, project-catalog.ts, project-mutations.ts: туда
 * нельзя поставить голую проверку тега.
 */
export function canReachAnyProject(auth: StorageApiAuth): boolean {
  if (isMachineAuth(auth)) return isElevated(auth.role)
  return hasCapability(auth.role, auth.capabilities, "projects.access")
}

/**
 * Актор записи из авторизации запроса.
 *
 * Машина парка (`rc_`) заливщиком не считается: она возвращает результаты в
 * проект, а `uploaded_by` отвечает на вопрос «кто принёс исходник». Её `userId` —
 * это `remote_computers.created_by`, то есть админ, регистрировавший компьютер, и
 * переносить на него contact задачи было бы прямым искажением.
 */
export function actorFromAuth(auth: StorageApiAuth): StorageActor {
  return { userId: auth.userId, isUploader: auth.computerId == null }
}

export type { ProjectAccessRole } from "@/lib/project-access"

export type StorageProjectAccess = {
  projectId: string
  ownerId: string
  /**
   * Первый сегмент ключа проекта в R2 (`projects.storage_owner_id`). У
   * переданного другому человеку проекта не равен `ownerId`: владение
   * переехало, байты остались. Ключи строить отсюда, права проверять по
   * `ownerId` и `accessRole` — docs/ADMIN_WORKSPACE_PLAN.md §5.
   */
  storageOwnerId: string
  accessRole: ProjectAccessRole
}

function unauthorized(message = "Unauthorized.") {
  return NextResponse.json({ message }, { status: 401 })
}

/**
 * Доступ пользователя сайта: владелец, участник или ничего. Машинные токены
 * сюда не ходят — расшаривание на них не распространяется.
 *
 * Лестница ролей и матрица прав — в lib/project-access.ts. Здесь только
 * переходник к прежней форме ответа, на которую смотрит машинный протокол.
 */
export async function resolveProjectAccess(
  projectId: string,
  userId: string,
): Promise<
  { role: ProjectAccessRole; ownerId: string; storageOwnerId: string } | null
> {
  const access = await resolveSiteProjectAccess(projectId, userId)
  if (!access) return null
  return {
    role: access.role,
    ownerId: access.project.userId,
    storageOwnerId: access.project.storageOwnerId,
  }
}

async function authFromRemoteComputerToken(
  token: string,
): Promise<(StorageApiAuth & { computerName: string }) | null> {
  if (!token.startsWith("rc_")) return null
  const tokenHash = hashMachineToken(token)
  const row = await findActiveRemoteComputerByTokenHash(tokenHash)
  if (!row || !row.isActive) return null

  return {
    userId: row.createdBy,
    email: row.email,
    role: "ADMIN",
    machineTokenId: null,
    computerId: row.id,
    scopedProjectId: null,
    capabilities: [],
    computerName: row.name,
  }
}

async function authFromMachineToken(
  token: string,
): Promise<(StorageApiAuth & { scopedProjectId: string | null }) | null> {
  const tokenHash = hashMachineToken(token)
  const result = await query<{
    id: string
    userId: string
    projectId: string | null
    email: string
    role: UserRole
    isActive: boolean
  }>(
    `SELECT mt.id,
            mt.user_id AS "userId",
            mt.project_id AS "projectId",
            u.email,
            u.role,
            u.is_active AS "isActive"
       FROM machine_tokens mt
       JOIN users u ON u.id = mt.user_id
      WHERE mt.token_hash = $1
        AND mt.revoked_at IS NULL`,
    [tokenHash],
  )
  const row = result.rows[0]
  if (!row || !row.isActive) return null

  await query(`UPDATE machine_tokens SET last_used_at = NOW() WHERE id = $1`, [
    row.id,
  ])

  return {
    userId: row.userId,
    email: row.email,
    role: row.role,
    machineTokenId: row.id,
    computerId: null,
    scopedProjectId: row.projectId,
    capabilities: [],
  }
}

async function authFromSession(
  request: NextRequest,
): Promise<StorageApiAuth | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  const session = await verifySessionToken(token)
  if (!session?.userId) return null
  const user = await findUserById(session.userId)
  if (!user || !user.isActive) return null
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    machineTokenId: null,
    computerId: null,
    scopedProjectId: null,
    // Суперадмину теги не проверяются (hasCapability отвечает по роли), поэтому
    // и запрашивать их незачем — иначе каждый его запрос к хранилищу платил бы
    // лишним обращением к базе ни за чем.
    capabilities:
      isElevated(user.role) && !isSuperAdmin(user.role)
        ? await listCapabilitiesFor(user.id)
        : [],
  }
}

/** Session cookie, `Authorization: Bearer mch_…`, or `Bearer rc_…`. */
export async function requireStorageApi(
  request: NextRequest,
): Promise<StorageApiAuth | NextResponse> {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim()
    if (token.startsWith("rc_")) {
      const computer = await authFromRemoteComputerToken(token)
      if (!computer) return unauthorized("Invalid computer token.")
      return computer
    }
    const machine = await authFromMachineToken(token)
    if (!machine) return unauthorized("Invalid machine token.")
    return machine
  }

  const session = await authFromSession(request)
  if (!session) return unauthorized()
  return session
}

/** Authenticate a raw `rc_…` token from the machine API body. */
export async function authenticateComputerToken(
  token: string,
): Promise<StorageApiAuth | null> {
  const computer = await authFromRemoteComputerToken(token.trim())
  if (!computer?.computerId) return null
  return computer
}

/**
 * Проверка доступа для машинного протокола: сессия, `mch_…` или `rc_…`.
 *
 * Одноимённая функция есть и в lib/project-access.ts — та для роутов кабинета,
 * принимает `userId` и про машинные токены не знает. Отличие по существу:
 * здесь недостаточная роль тоже отвечает 404, а не 403, — контракт
 * `/api/storage/v1/*` менять нельзя.
 */
export async function requireProjectAccess(
  auth: StorageApiAuth,
  projectId: string,
  minimum: ProjectAccessRole = "viewer",
): Promise<NextResponse | StorageProjectAccess> {
  if (
    auth.scopedProjectId != null &&
    auth.scopedProjectId !== projectId
  ) {
    return NextResponse.json(
      { message: "Machine token is scoped to another project." },
      { status: 403 },
    )
  }

  // Machine / computer tokens: ownership only (no sharing).
  if (auth.machineTokenId || auth.computerId) {
    const project =
      canReachAnyProject(auth)
        ? await findProjectById(projectId)
        : await findOwnedProject(projectId, auth.userId)
    if (!project) {
      return NextResponse.json({ message: "Project not found." }, { status: 404 })
    }
    return {
      projectId: project.id,
      ownerId: project.ownerId,
      storageOwnerId: project.storageOwnerId,
      accessRole: "owner",
    }
  }

  if (canReachAnyProject(auth)) {
    // Без `includeDeleted`, как и у машин: тег `projects.access` открывает
    // чужие папки, но не корзину — распоряжаться удалённым проектом нечего.
    // Не найден — не отвечаем 404 сразу, а падаем в общий разбор ниже: свой
    // собственный удалённый проект администратор должен видеть в своём же
    // кабинете на тех же правах, что и все, — читателем.
    const project = await findProjectById(projectId)
    if (project) {
      return {
        projectId: project.id,
        ownerId: project.ownerId,
        storageOwnerId: project.storageOwnerId,
        accessRole: "owner",
      }
    }
  }

  const resolved = await resolveProjectAccess(projectId, auth.userId)
  if (!resolved || !roleAtLeast(resolved.role, minimum)) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  return {
    projectId,
    ownerId: resolved.ownerId,
    storageOwnerId: resolved.storageOwnerId,
    accessRole: resolved.role,
  }
}

/** File writes: editor+ on the site; ownership for machine tokens. */
export async function requireEditableProjectAccess(
  auth: StorageApiAuth,
  projectId: string,
): Promise<NextResponse | StorageProjectAccess> {
  return requireProjectAccess(auth, projectId, "editor")
}

export async function requireOwnedProjectAccess(
  auth: StorageApiAuth,
  projectId: string,
): Promise<NextResponse | StorageProjectAccess> {
  if (
    auth.scopedProjectId != null &&
    auth.scopedProjectId !== projectId
  ) {
    return NextResponse.json(
      { message: "Machine token is scoped to another project." },
      { status: 403 },
    )
  }
  const project =
    canReachAnyProject(auth)
      ? await findProjectById(projectId)
      : await findOwnedProject(projectId, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  return {
    projectId: project.id,
    ownerId: project.ownerId,
    storageOwnerId: project.storageOwnerId,
    accessRole: "owner",
  }
}

export async function createMachineToken(input: {
  userId: string
  name: string
  projectId?: string | null
  rawToken: string
}): Promise<{ id: string; token: string }> {
  const id = randomUUID()
  const tokenHash = hashMachineToken(input.rawToken)
  await query(
    `INSERT INTO machine_tokens (id, user_id, project_id, name, token_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, input.userId, input.projectId ?? null, input.name, tokenHash],
  )
  return { id, token: input.rawToken }
}

export async function listMachineTokens(userId: string) {
  const result = await query<{
    id: string
    name: string
    projectId: string | null
    createdAt: Date
    lastUsedAt: Date | null
  }>(
    `SELECT id, name, project_id AS "projectId", created_at AS "createdAt", last_used_at AS "lastUsedAt"
       FROM machine_tokens
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [userId],
  )
  return result.rows
}

/**
 * Отзывает токен и вместе с ним — машины, которые под ним ходили.
 *
 * Второе обязательно: машина существует в списке только как «кто обращался этим
 * токеном». Оставить её после отзыва означало бы показывать парк машин, которого
 * больше нет — ходить она всё равно не сможет, авторизация откажет.
 *
 * Машины помечаются отозванными, а не удаляются: та же машина по своему UUID
 * спокойно заведётся заново под новым токеном (частичный уникальный индекс
 * считает только неотозванные), а история останется.
 *
 * `ownerId` — владелец, которому токен обязан принадлежать, или `null` для
 * админского отзыва. Проверка владения зашита в тот же UPDATE, а не сделана
 * отдельным SELECT: между чтением и записью токен успел бы сменить состояние.
 */
async function revokeTokenRow(
  tokenId: string,
  ownerId: string | null,
): Promise<boolean> {
  const result = ownerId
    ? await query(
        `UPDATE machine_tokens SET revoked_at = NOW()
          WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [tokenId, ownerId],
      )
    : await query(
        `UPDATE machine_tokens SET revoked_at = NOW()
          WHERE id = $1 AND revoked_at IS NULL`,
        [tokenId],
      )
  if ((result.rowCount ?? 0) === 0) return false

  const { revokeComputersByToken } = await import(
    "@/lib/repositories/remote-computers"
  )
  await revokeComputersByToken(tokenId)
  return true
}

/** Отзыв владельцем: чужой токен этим путём не снять. */
export async function revokeMachineToken(userId: string, tokenId: string) {
  await revokeTokenRow(tokenId, userId)
}

/**
 * Отзыв админом, без проверки владельца.
 *
 * Страница «Удалённый доступ» показывает токены всех аккаунтов — парк машин это
 * установка целиком, а не собственность одного человека. Значит и снимать токен
 * надо там же: стоп-кран, до которого нельзя дотянуться, стоп-краном не
 * является, а входить под чужим аккаунтом ради одной кнопки — не путь.
 */
export async function revokeMachineTokenById(tokenId: string): Promise<boolean> {
  return revokeTokenRow(tokenId, null)
}

/** Токен с владельцем — чтобы роут отличил «нет такого» от «уже отозван». */
export async function findMachineTokenById(tokenId: string) {
  const result = await query<{
    id: string
    userId: string
    name: string
    ownerEmail: string
    revokedAt: Date | null
  }>(
    `SELECT mt.id,
            mt.user_id AS "userId",
            mt.name,
            u.email AS "ownerEmail",
            mt.revoked_at AS "revokedAt"
       FROM machine_tokens mt
       JOIN users u ON u.id = mt.user_id
      WHERE mt.id = $1`,
    [tokenId],
  )
  return result.rows[0] ?? null
}
