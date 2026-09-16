import { randomUUID } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { findUserById, isUserInCompany } from "@/lib/repositories/users"
import {
  findActiveRemoteComputerByTokenHash,
} from "@/lib/repositories/remote-computers"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  findCompanyProject,
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
  /**
   * Компания машины парка (`remote_computers.company_id`). NULL — наша машина.
   * Заполнено — она стоит у клиента и видит только проекты его людей
   * (docs/COMPANY_PIPELINE_PLAN.md §1).
   */
  machineCompanyId: string | null
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
 * ДОКУДА ДОТЯГИВАЕТСЯ АКТОР. Одно место на все проверки доступа к чужому.
 *
 * Размеченное объединение, а не булев «может ли всё»: ступеней стало три, и
 * булев ответ на трёхзначный вопрос — это молчаливое «нет» там, где верный
 * ответ «только своей компании». Тип заставляет каждое место разобрать все
 * варианты: пропущенный `company` не соберётся, а не отработает тихо.
 *
 * Порядок внутри значим и не менялся: **сначала машина, потом тег**. Программу
 * мы в правах не ограничиваем — доступ к чужим проектам и есть её работа;
 * спроси мы у неё тег, которого у неё нет и быть не может, встал бы весь парк.
 * Человеку же одной админской роли мало: нужен `projects.access`.
 *
 * Особенно это важно там, где ветки человека и машины НЕ разделены —
 * requireOwnedProjectAccess, project-catalog.ts, project-mutations.ts.
 */
export type ReachScope =
  /** Вся площадка: наша машина парка или человек с тегом `projects.access`. */
  | { kind: "all" }
  /**
   * Проекты людей ОДНОЙ компании — машина, стоящая у клиента
   * (docs/COMPANY_PIPELINE_PLAN.md §2). Рамка ложится на владельца проекта, как
   * и вся остальная изоляция компании.
   */
  | { kind: "company"; companyId: string }
  /** Только свои: обычный человек и машина под токеном обычного пользователя. */
  | { kind: "own"; userId: string }

export function reachScope(auth: StorageApiAuth): ReachScope {
  if (isMachineAuth(auth)) {
    // Компания важнее роли: токен машины компании выдаёт её админ, и роль
    // регистрировавшего человека к её полномочиям отношения не имеет.
    if (auth.machineCompanyId) {
      return { kind: "company", companyId: auth.machineCompanyId }
    }
    return isElevated(auth.role)
      ? { kind: "all" }
      : { kind: "own", userId: auth.userId }
  }
  return hasCapability(auth.role, auth.capabilities, "projects.access")
    ? { kind: "all" }
    : { kind: "own", userId: auth.userId }
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

/**
 * Проект в рамке актора — или null, если она его не покрывает.
 *
 * Одно место на все три входа (`requireProjectAccess`,
 * `requireOwnedProjectAccess` и машинная ветка первого): рамка считается один
 * раз и одинаково, а не переписывается в каждом по памяти.
 */
async function findProjectInScope(
  auth: StorageApiAuth,
  projectId: string,
): Promise<Awaited<ReturnType<typeof findProjectById>>> {
  const scope = reachScope(auth)
  switch (scope.kind) {
    case "all":
      return findProjectById(projectId)
    case "company":
      return findCompanyProject(projectId, scope.companyId)
    case "own":
      return findOwnedProject(projectId, scope.userId)
  }
}

/**
 * Достаёт ли актор до вещей ЭТОГО владельца.
 *
 * Для мест, где проверяется не проект, а что-то при человеке: клиент, работа
 * копирования, задание. Там нет объекта, который можно было бы поискать в рамке,
 * — есть только владелец, и вопрос ровно про него.
 */
export async function ownerInScope(
  auth: StorageApiAuth,
  ownerId: string,
): Promise<boolean> {
  const scope = reachScope(auth)
  switch (scope.kind) {
    case "all":
      return true
    case "company":
      return isUserInCompany(ownerId, scope.companyId)
    case "own":
      return ownerId === scope.userId
  }
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
    /**
     * Роль остаётся ADMIN — у НАШЕЙ машины. Для машины компании она ничего не
     * решает: `reachScope` смотрит на `machineCompanyId` раньше роли, и вся
     * площадка ей не открывается (COMPANY_PIPELINE_PLAN.md §1).
     */
    role: "ADMIN",
    machineTokenId: null,
    computerId: row.id,
    machineCompanyId: row.companyId,
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
    // Токен пользователя (`mch_`) компанию не несёт: он и так скоуплен
    // владельцем, а машины компании выдаются как `rc_` в её консоли.
    machineCompanyId: null,
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
    // Браузерная сессия — это человек, а не машина: поле про принадлежность
    // ЖЕЛЕЗА, и к человеку из компании отношения не имеет.
    machineCompanyId: null,
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
    const project = await findProjectInScope(auth, projectId)
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

  if (reachScope(auth).kind === "all") {
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
  const project = await findProjectInScope(auth, projectId)
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
