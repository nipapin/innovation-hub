import { randomUUID } from "node:crypto"
import { admitItem, setPausedReason, type PauseReason } from "@/lib/billing/admission"
import {
  checkAccounts,
  collectRequirements,
  isBlocking,
  type GateProblem,
} from "@/lib/vault/gate"
import { estimateItem } from "@/lib/billing/estimate"
import { getFunds, holdReserve, type Funds } from "@/lib/billing/funds"
import type { PayUnitProblem } from "@/lib/billing/pay-unit"
import { readBillingSettings } from "@/lib/billing/settings"
import { query, withTransaction } from "@/lib/db"
import { setProjectPaused } from "@/lib/project-automation"
import {
  buildTaskPayload,
  matchesSearchExts,
  readSearchExts,
  type FileTypeDictionary,
  type TaskSource,
  type TaskSourceEntry,
} from "@/lib/pipeline/build-task"
import {
  listWatchedProjects,
  type WatchedProject,
} from "@/lib/pipeline/repository"
import { getObjectText, projectOptionsKey } from "@/lib/project-storage"
import { projectPrefix } from "@/lib/storage/keys"
import { readFileTypeDictionary } from "@/lib/repositories/automation-settings"
import {
  listContactIdentities,
  type ContactIdentity,
} from "@/lib/repositories/users"

/**
 * Сканер конвейера — событийная линия сборки задач.
 *
 * Watcher'ов и листинга бакета нет. Любая запись в хранилище уже журналируется в
 * storage_changes (lib/storage/write-path.ts#journal) — и загрузка из браузера,
 * и notify от машины, и mkdir/rename/delete. Журнал сквозной и упорядочен
 * монотонным seq, поэтому «что нового появилось в IN» — это выборка по
 * seq > last_seq, а не сравнение состояний.
 *
 * Из этого следует важное свойство: ни одно событие не теряется и ни одно не
 * обрабатывается дважды, пока курсор двигается только после успешной обработки
 * пачки.
 *
 * И следует ограничение, из-за которого рядом живёт вторая линия
 * (lib/pipeline/sweep.ts): курсор двигается независимо от того, создалась задача
 * или нет. Пропуск по любой причине — пауза проекта, битый options.json, ошибка
 * в коде — окончательный, потому что второго события по этому файлу не будет.
 * Обход каталога добирает такие элементы по расписанию.
 *
 * Единица работы — ОДИН элемент верхнего уровня в папке IN: файл или папка.
 * Папка обрабатывается целиком, в один результат, и даёт ровно одну задачу — а не
 * по задаче на каждый файл внутри. Правило готовности папки описано в
 * fs.manager.tauri/ideasAndTest/PIPELINE_BACKEND_REQUESTS.md §2.
 */

/** Сколько событий берём за один проход. Хвост дочитается следующим вызовом. */
const BATCH_LIMIT = 2000

export type SkipReason =
  | "no-options"
  | "invalid-options"
  | "no-main-search"
  | "no-search-type"
  | "unknown-search-type"
  | "no-search-exts"
  | "folder-not-ready"
  | "empty-folder"
  | "no-match"
  | "already-queued"
  /** Денег не хватает на этот элемент (docs/BILLING_AND_TRIAL_PLAN.md, П13). */
  | "insufficient-funds"
  /** Тарифицировать нечем: оси не объявлены, пара не считается, не тот вход. */
  | "no-pay-unit"
  | "unsupported-pay-pair"
  | "pay-unit-mismatch"
  /** Нет учётки внешнего сервиса, которую требует граф (VENDOR_SERVICES, С4). */
  | "no-vendor-account"

export type SkippedProject = {
  projectId: string
  projectName: string
  reason: SkipReason
}

export type CollectResult = {
  created: number
  scannedEvents: number
  cursor: number
  skipped: SkippedProject[]
  /**
   * Проекты, по которым нечем тарифицировать. Это НЕ пропуск: пока гейт денег
   * выключен, задача всё равно создаётся. Список нужен, чтобы незаполненные оси
   * обнаружились до включения гейта, а не в момент, когда конвейер встанет
   * целиком (docs/BILLING_AND_TRIAL_PLAN.md, В4).
   */
  unpriced: UnpricedProject[]
}

export type UnpricedProject = {
  projectId: string
  projectName: string
  reason: PayUnitProblem
}

type ChangeRow = {
  seq: string
  projectId: string
  key: string
  op: "put" | "delete" | "move"
  size: string | null
  contentHash: string | null
  /** Кто совершил запись; null у событий до появления атрибуции и у reindex. */
  actorUserId: string | null
  payload: {
    fileId?: string
    name?: string
    folderPath?: string
    isFolder?: boolean
    from?: { folderPath?: string; name?: string }
    to?: { folderPath?: string; name?: string }
  } | null
}

async function readCursor(): Promise<number> {
  const result = await query<{ lastSeq: string }>(
    `SELECT last_seq::text AS "lastSeq"
       FROM automation_scan_state
      WHERE id = 'singleton'`,
  )
  return result.rows[0] ? Number(result.rows[0].lastSeq) : 0
}

/**
 * Двигает курсор. `scanned_at` здесь НЕ трогаем: он значит «когда цикл проверял
 * последний раз», и пишет его recordTickResult на каждом тике. Курсор двигается
 * только при новых событиях, поэтому отсюда это поле замерзало на моменте
 * последней загрузки файла — см. комментарий в state.ts#recordTickResult.
 */
async function writeCursor(seq: number): Promise<void> {
  await query(
    `UPDATE automation_scan_state
        SET last_seq = $1,
            updated_at = NOW()
      WHERE id = 'singleton'`,
    [seq],
  )
}

/**
 * Папка, которую ещё наполняют.
 *
 * Конвенция десктопа с самого начала (findFilesForSingleFolder.ts,
 * processItem.ts): пока в начале имени стоит `-`, папка не готова. Пользователь
 * докладывает в неё файлы сколько нужно, снял `-` — папка укомплектована.
 *
 * Правило только для ПАПОК, и вызывать это надо под проверкой `isFolder`. У файла
 * задерживать нечего: он готов в тот момент, когда байты доехали, а дефис в начале
 * имени — просто дефис в имени. Раньше проверка стояла на всех элементах, но для
 * файлов не срабатывала случайно: имя нарезалось из физического ключа, а тот
 * начинается с uuid. После перехода на логические имена
 * (docs/STORAGE_CLIENT_REQUESTS.md §14.1) она бы начала отсекать файлы.
 */
export function isHeldBack(name: string): boolean {
  return name.startsWith("-")
}

/** Лежит ли логический путь внутри IN — сама папка или что-то в ней. */
export function isInsideIn(folderPath: string): boolean {
  const clean = folderPath.replace(/^\/+|\/+$/g, "")
  return clean === "IN" || clean.startsWith("IN/")
}

/** Элемент верхнего уровня в IN, к которому относится событие. */
export type InEntry = {
  /** Имя элемента: `clip.mp4` или `myfolder`. */
  name: string
  /** Логический ключ элемента — он же source_key задачи и ключ дедупа. */
  key: string
  isFolder: boolean
}

/**
 * К какому элементу IN относится ключ события.
 *
 * `IN/clip.mp4`            → файл `clip.mp4`
 * `IN/myfolder/a.mp4`      → папка `myfolder` (не файл внутри!)
 * `IN/myfolder/sub/b.mp4`  → папка `myfolder`
 *
 * Вложенность именно сворачивается к верхнему уровню: файл внутри папки — часть
 * её витка, а не отдельный виток. Иначе одна папка с десятью файлами дала бы
 * десять задач, каждая со своим финальным результатом.
 */
export function resolveInEntry(
  key: string,
  storageOwnerId: string,
  projectId: string,
): InEntry | null {
  const prefix = projectPrefix(storageOwnerId, projectId)
  if (!key.startsWith(prefix)) return null
  const rest = key.slice(prefix.length)
  if (!rest.startsWith("IN/")) return null

  const tail = rest.slice("IN/".length)
  if (!tail) return null

  const slash = tail.indexOf("/")
  const name = slash < 0 ? tail : tail.slice(0, slash)
  if (!name) return null

  return {
    name,
    key: `${prefix}IN/${name}`,
    isFolder: slash >= 0,
  }
}

/**
 * Содержимое папки одним запросом к каталогу, а не листингом R2.
 *
 * Перечисляем в момент, когда папка признана готовой: с этого момента её
 * содержимое заморожено (см. isHeldBack), поэтому манифест не устареет к моменту,
 * когда машина возьмёт задачу. Ровно этого требует DISTRIBUTED_QUEUE_PLAN:
 * оркестратор обходит дерево один раз, машина не переобходит хранилище по сети.
 */
async function readFolderManifest(input: {
  projectId: string
  folderPath: string
}): Promise<TaskSourceEntry[]> {
  const result = await query<{
    id: string
    name: string
    folderPath: string
    s3Key: string | null
    sizeBytes: string
    contentHash: string | null
  }>(
    `SELECT id,
            name,
            folder_path   AS "folderPath",
            s3_key        AS "s3Key",
            size_bytes::text AS "sizeBytes",
            content_hash  AS "contentHash"
       FROM project_files
      WHERE project_id = $1
        AND is_folder = FALSE
        AND deleted_at IS NULL
        AND (folder_path = $2 OR folder_path LIKE $2 || '/%')
      ORDER BY folder_path, name`,
    [input.projectId, input.folderPath],
  )

  return result.rows
    .filter((row) => row.s3Key != null)
    .map((row) => ({
      fileId: row.id,
      s3Key: row.s3Key as string,
      name: row.name,
      folderPath: row.folderPath,
      sizeBytes: Number(row.sizeBytes),
      contentHash: row.contentHash,
    }))
}

/**
 * Кто заливал файлы внутри папки, с количеством файлов на человека.
 *
 * Нужно для двух разных вещей сразу: `uploaders` в описании задачи (папку могли
 * наполнять втроём — статистике полезно видеть всех) и преобладающий заливщик как
 * последнее звено отката, когда актора события готовности не сохранилось.
 */
async function readFolderUploaders(input: {
  projectId: string
  folderPath: string
}): Promise<{ userId: string; files: number }[]> {
  const result = await query<{ userId: string; files: string }>(
    `SELECT uploaded_by AS "userId", COUNT(*)::text AS files
       FROM project_files
      WHERE project_id = $1
        AND is_folder = FALSE
        AND deleted_at IS NULL
        AND uploaded_by IS NOT NULL
        AND (folder_path = $2 OR folder_path LIKE $2 || '/%')
      GROUP BY uploaded_by
      ORDER BY COUNT(*) DESC, uploaded_by ASC`,
    [input.projectId, input.folderPath],
  )
  return result.rows.map((row) => ({
    userId: row.userId,
    files: Number(row.files),
  }))
}

/** Создатель папки верхнего уровня в IN. */
async function readFolderCreator(input: {
  projectId: string
  name: string
}): Promise<string | null> {
  const result = await query<{ uploadedBy: string | null }>(
    `SELECT uploaded_by AS "uploadedBy"
       FROM project_files
      WHERE project_id = $1
        AND is_folder = TRUE
        AND folder_path = 'IN'
        AND name = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    [input.projectId, input.name],
  )
  return result.rows[0]?.uploadedBy ?? null
}

/**
 * Заливщики файлов-кандидатов одним запросом.
 *
 * Именно `uploaded_by`, а не актор события: для файла contact — это тот, кто
 * принёс байты, а последним событием по нему может быть переименование, сделанное
 * другим человеком.
 */
async function readFileUploaders(
  fileIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(fileIds)]
  if (unique.length === 0) return new Map()
  const result = await query<{ id: string; uploadedBy: string | null }>(
    `SELECT id, uploaded_by AS "uploadedBy"
       FROM project_files
      WHERE id = ANY($1::text[])`,
    [unique],
  )
  const map = new Map<string, string>()
  for (const row of result.rows) {
    if (row.uploadedBy) map.set(row.id, row.uploadedBy)
  }
  return map
}

/**
 * Кандидат на задачу: элемент IN, к которому свелись события пачки.
 *
 * Его же собирает страховочный обход каталога (lib/pipeline/sweep.ts) — там
 * акторов нет вообще, оба поля приходят null, и цепочка отката доходит до
 * заливщика из каталога.
 */
export type Candidate = {
  projectId: string
  entry: InEntry
  /** Данные последнего события по этому элементу — для файла это его размер и хеш. */
  fileId: string | null
  sizeBytes: number
  contentHash: string | null
  /** Актор последнего put — кто принёс байты. */
  putActorUserId: string | null
  /**
   * Актор move по самому элементу — кто снял `-`, то есть запустил виток. Для
   * папки это и есть contact: файлы внутрь могли класть разные люди, а «готово,
   * обрабатывай» сказал один.
   */
  readyActorUserId: string | null
}

/**
 * Собирает задачи по новым элементам в папках IN отслеживаемых проектов.
 *
 * Задачи только складываются в очередь; выдаёт их машинам claimTask
 * (lib/pipeline/queue.ts).
 */
export async function collectTasks(): Promise<CollectResult> {
  const since = await readCursor()
  const watched = await listWatchedProjects()
  const watchedById = new Map(watched.map((p) => [p.projectId, p]))

  const changes = await query<ChangeRow>(
    `SELECT seq::text,
            project_id AS "projectId",
            key,
            op,
            size::text,
            content_hash AS "contentHash",
            actor_user_id AS "actorUserId",
            payload
       FROM storage_changes
      WHERE seq > $1
      ORDER BY seq ASC
      LIMIT $2`,
    [since, BATCH_LIMIT],
  )

  const scannedEvents = changes.rows.length
  const cursor =
    scannedEvents > 0
      ? Number(changes.rows[changes.rows.length - 1]!.seq)
      : since

  const collectedAt = new Date().toISOString()
  const skipped: SkippedProject[] = []
  const seenSkips = new Set<string>()
  const noteSkip = (
    projectId: string,
    projectName: string,
    reason: SkipReason,
  ) => {
    const dedupKey = `${projectId}:${reason}`
    if (seenSkips.has(dedupKey)) return
    seenSkips.add(dedupKey)
    skipped.push({ projectId, projectName, reason })
  }

  // ── Фаза 1: события → уникальные элементы IN ────────────────────────────────
  //
  // Сворачиваем пачку до кандидатов заранее, а не полагаемся на уникальный
  // индекс при вставке: десять файлов, залитых в одну папку, — это один элемент,
  // и манифест по нему надо строить один раз, а не десять с откатом на конфликте.
  const candidates = new Map<string, Candidate>()

  for (const change of changes.rows) {
    // delete не создаёт работы. А вот move — создаёт: снятие `-` с имени папки
    // приезжает именно как move, и раньше это событие выбрасывалось вместе с
    // остальными, из-за чего готовая папка так и не попадала в очередь.
    if (change.op === "delete") continue

    /**
     * Но move, уводящий элемент ЗА пределы IN, — это удаление с точки зрения
     * конвейера, и работы оно не создаёт.
     *
     * Проверять приходится по payload, а не по ключу: ключ в журнале физический
     * и остаётся прежним (`.../IN/{uuid}-имя.mp4`) даже после того, как файл
     * логически переехал в другую папку — переименование каталога объектов в R2
     * не двигает. То есть `resolveInEntry` по такому событию честно ответит
     * «элемент в IN», хотя в IN его уже нет.
     *
     * Без этой проверки перенос упавшего исходника в папку ошибок
     * (lib/pipeline/quarantine.ts) сам бы и заводил по нему новую задачу:
     * уникальный индекс не помеха, он держится только на живых статусах, а
     * старая задача упала. Карантин отменял бы сам себя.
     */
    if (change.op === "move") {
      const to = change.payload?.to?.folderPath ?? change.payload?.folderPath
      if (typeof to === "string" && !isInsideIn(to)) continue
    }

    const project = watchedById.get(change.projectId)
    if (!project) continue

    const entry = resolveInEntry(
      change.key,
      project.storageOwnerId,
      project.projectId,
    )
    if (!entry) continue

    /**
     * Имя элемента — ЛОГИЧЕСКОЕ, то есть то, которое видит человек.
     *
     * `resolveInEntry` нарезает имя из ключа, а ключ физический: presign минтит
     * `{uuid}-{имя}`. Это имя уезжает в `description.curItem`, а на машине из него
     * собираются имена результатов (маски `$curItemName`, `$clearName`) — и в OUT
     * приезжал файл с uuid в названии. Технические имена хранилища до машины
     * доходить не должны: `s3Key` — идентичность, `name` — то, что видит человек
     * (docs/STORAGE_CLIENT_REQUESTS.md §14.1). Логическое имя лежит в payload
     * события, второй раз за ним ходить не нужно.
     *
     * У папки имя и так логическое: это сегмент пути, а не имя объекта.
     */
    const logicalName =
      !entry.isFolder && typeof change.payload?.name === "string"
        ? change.payload.name
        : entry.name

    // После move ключ в журнале — старый (переименование каталога физических
    // объектов не двигает), поэтому имя берём из payload.to.
    const renamedTo = change.op === "move" ? change.payload?.to?.name : undefined
    const renamedFolder = entry.isFolder || change.payload?.isFolder === true
    const effective: InEntry = renamedTo
      ? {
          name: renamedTo,
          // Ключ — идентичность элемента и ключ дедупа, и она физическая. У файла
          // переименование её не меняет: объект в R2 остаётся на прежнем ключе,
          // поэтому берём ключ события, а не собираем из нового имени — иначе в
          // задачу уехал бы ключ, которого в бакете нет. У папки физического
          // объекта нет вовсе, её ключ логический и следует за именем.
          key: renamedFolder
            ? entry.key.slice(0, entry.key.lastIndexOf("/") + 1) + renamedTo
            : entry.key,
          // Переименовали саму папку — событие пришло по ней, а не по потомку.
          isFolder: renamedFolder,
        }
      : { ...entry, name: logicalName }

    // Только для папки: у файла дефис в начале имени ничего не значит.
    if (effective.isFolder && isHeldBack(effective.name)) {
      noteSkip(project.projectId, project.name, "folder-not-ready")
      continue
    }

    const dedupKey = `${project.projectId}:${effective.key}`
    const previous = candidates.get(dedupKey)
    // Акторы накапливаются, остальное перезаписывается последним событием: put и
    // move по одному элементу приезжают в одной пачке, и «кто принёс» с «кто
    // запустил» — разные ответы, которые оба нужны.
    candidates.set(dedupKey, {
      projectId: project.projectId,
      entry: effective,
      fileId: effective.isFolder ? null : (change.payload?.fileId ?? null),
      sizeBytes: change.size ? Number(change.size) : 0,
      contentHash: change.contentHash,
      putActorUserId:
        (change.op === "put" ? change.actorUserId : null) ??
        previous?.putActorUserId ??
        null,
      // Событием готовности считается переименование САМОГО элемента: `entry`
      // из resolveInEntry помечен isFolder, только если ключ события указывал
      // внутрь папки, а переименование файла внутри — не «обрабатывай».
      readyActorUserId:
        (renamedTo && !entry.isFolder ? change.actorUserId : null) ??
        previous?.readyActorUserId ??
        null,
    })
  }

  // ── Фаза 2: кандидаты → задачи ──────────────────────────────────────────────
  const materialized = await materializeCandidates({
    candidates: [...candidates.values()],
    watchedById,
    collectedAt,
  })
  skipped.push(...materialized.skipped)

  // Курсор двигаем последним: упади что-то выше — пачка перечитается,
  // а дубли отсечёт уникальный индекс по (project_id, source_key).
  if (cursor !== since) await writeCursor(cursor)

  return {
    created: materialized.created,
    scannedEvents,
    cursor,
    skipped,
    unpriced: materialized.unpriced,
  }
}

/**
 * Кандидаты → задачи. Вторая половина сборки, общая с обходом каталога.
 *
 * Отдельной функцией, потому что источников кандидатов два и они принципиально
 * разные: журнал (событие → элемент) и каталог (состояние → элемент). А вот всё
 * дальнейшее у них обязано совпадать до буквы — options.json, расширения,
 * манифест папки, цепочка contact, дедуп по source_key. Разъедься эти две
 * половины, и задача из обхода отличалась бы от задачи из события по тому же
 * файлу; машина бы этого не заметила, а статистика разошлась.
 */
export async function materializeCandidates(input: {
  candidates: Candidate[]
  watchedById: Map<string, WatchedProject>
  /** ISO-время прогона: на десктопе это findTime, метка всей пачки. */
  collectedAt: string
}): Promise<{
  created: number
  skipped: SkippedProject[]
  unpriced: UnpricedProject[]
}> {
  const { watchedById, collectedAt } = input

  const skipped: SkippedProject[] = []
  const unpriced: UnpricedProject[] = []
  const seenUnpriced = new Set<string>()
  const noteUnpriced = (
    projectId: string,
    projectName: string,
    reason: PayUnitProblem,
  ) => {
    if (seenUnpriced.has(projectId)) return
    seenUnpriced.add(projectId)
    unpriced.push({ projectId, projectName, reason })
  }
  const seenSkips = new Set<string>()
  const noteSkip = (
    projectId: string,
    projectName: string,
    reason: SkipReason,
  ) => {
    const dedupKey = `${projectId}:${reason}`
    if (seenSkips.has(dedupKey)) return
    seenSkips.add(dedupKey)
    skipped.push({ projectId, projectName, reason })
  }

  /**
   * Кто залил файлы-кандидаты — одним запросом на всю пачку, а не по файлу.
   */
  const fileUploaders = await readFileUploaders(
    input.candidates
      .filter((c) => !c.entry.isFolder && c.fileId)
      .map((c) => c.fileId as string),
  )

  /**
   * Имена для contact: кэш на проход, потому что в пачке обычно два-три человека
   * на десятки элементов.
   */
  const identityCache = new Map<string, ContactIdentity | null>()
  const loadIdentities = async (
    ids: (string | null)[],
  ): Promise<Map<string, ContactIdentity>> => {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))]
    const missing = wanted.filter((id) => !identityCache.has(id))
    if (missing.length > 0) {
      const fetched = await listContactIdentities(missing)
      for (const id of missing) identityCache.set(id, fetched.get(id) ?? null)
    }
    const out = new Map<string, ContactIdentity>()
    for (const id of wanted) {
      const identity = identityCache.get(id)
      if (identity) out.set(id, identity)
    }
    return out
  }

  /** options.json читается один раз на проект, а не на каждое событие. */
  const optionsCache = new Map<string, unknown | null>()
  /**
   * Гейт учёток считается один раз на проект: граф у всех файлов проекта общий,
   * а материализация идёт по каждому файлу. Проверять по файлу значило бы
   * дёргать сейф десятки раз ради одного и того же ответа.
   */
  const gateCache = new Map<string, GateProblem[]>()
  /**
   * Общий словарь типов читается лениво и один раз на проход: он нужен только
   * как запасной путь для проектов без снимка fileTypes в графе.
   */
  let sharedFileTypes: FileTypeDictionary | null = null
  const fileTypeFallback = async (): Promise<FileTypeDictionary> => {
    if (sharedFileTypes == null) sharedFileTypes = await readFileTypeDictionary()
    return sharedFileTypes
  }

  /**
   * Тарифы читаются один раз на проход, деньги — один раз на кошелёк: в пачке
   * обычно десятки элементов и два-три человека, и запрос на каждый элемент был
   * бы самой дорогой частью сборки.
   *
   * Ключ кэша — кошелёк, а не владелец: за нескольких людей может платить один
   * (docs/COMPANY_ACCOUNTS_PLAN.md §7), и своя копия остатка у каждого из них
   * разрешила бы потратить его несколько раз. Допущенная задача вычитается из
   * этой копии сразу (`holdReserve`) — по той же причине.
   */
  const { settings } = await readBillingSettings()
  const fundsCache = new Map<string, Funds>()
  const fundsOf = async (walletUserId: string): Promise<Funds> => {
    const cached = fundsCache.get(walletUserId)
    if (cached) return cached
    const funds = await getFunds(walletUserId)
    fundsCache.set(walletUserId, funds)
    return funds
  }

  let created = 0

  for (const candidate of input.candidates) {
    const project = watchedById.get(candidate.projectId)
    if (!project) continue

    if (!optionsCache.has(project.projectId)) {
      const raw = await getObjectText(
        projectOptionsKey(project.storageOwnerId, project.projectId),
      )
      if (raw == null) {
        optionsCache.set(project.projectId, null)
      } else {
        try {
          optionsCache.set(project.projectId, JSON.parse(raw))
        } catch {
          optionsCache.set(project.projectId, undefined)
        }
      }
    }

    const optionsJson = optionsCache.get(project.projectId)
    if (optionsJson === null) {
      noteSkip(project.projectId, project.name, "no-options")
      continue
    }
    if (optionsJson === undefined) {
      noteSkip(project.projectId, project.name, "invalid-options")
      continue
    }

    // Типы проверяем до сборки очереди: обходить граф для элемента, который всё
    // равно не подойдёт, незачем.
    const exts = readSearchExts(optionsJson, await fileTypeFallback())
    if (!exts.ok) {
      noteSkip(project.projectId, project.name, exts.reason)
      continue
    }

    /**
     * Учётки внешних сервисов — до постановки в очередь (пункт 5 запроса
     * клиента). Задача без ключа, попавшая в очередь, обойдёт весь парк и умрёт
     * как «превышены попытки», хотя причина была известна здесь.
     *
     * Пустой список проблем — штатный случай: граф без свойств учётки ничего не
     * требует, и гейт его не трогает.
     */
    let gate = gateCache.get(project.projectId)
    if (gate === undefined) {
      gate = await checkAccounts({
        requirements: collectRequirements(optionsJson),
        ownerId: project.ownerId,
      })
      gateCache.set(project.projectId, gate)
      // Предупреждения в журнал, а не в отказ: поле открыто клиенту, но
      // указывает на нашу учётку — работать будет, деньги поедут наши.
      for (const problem of gate.filter((p) => !isBlocking(p))) {
        console.warn(
          `[pipeline] ${project.projectId}: ${problem.code} ${problem.service}`,
        )
      }
    }
    const blocked = gate.filter(isBlocking)
    if (blocked.length > 0) {
      noteSkip(project.projectId, project.name, "no-vendor-account")
      await pauseForBilling(project, "no-vendor-key")
      continue
    }

    const entry = candidate.entry
    let source: TaskSource
    /** Кому принадлежит виток: он уедет в description.contact. */
    let uploaderUserId: string | null = null
    /** Все, кто наполнял папку, — для statistics по многолюдным виткам. */
    let folderUploaders: { userId: string; files: number }[] = []

    if (entry.isFolder) {
      const folderPath = `IN/${entry.name}`
      const children = await readFolderManifest({
        projectId: project.projectId,
        folderPath,
      })
      // Пустая папка дала бы задачу, которая гарантированно упадёт на машине.
      if (children.length === 0) {
        noteSkip(project.projectId, project.name, "empty-folder")
        continue
      }
      // Расширения проверяем по содержимому: сама папка расширения не имеет, но
      // папка без ни одного подходящего файла — не источник для этого графа.
      if (!children.some((child) => matchesSearchExts(child.name, exts.searchExts))) {
        noteSkip(project.projectId, project.name, "no-match")
        continue
      }
      // Цепочка отката для папки: снявший `-` → создатель папки → тот, кто залил
      // в неё больше всех файлов. Первое звено — главное: «обрабатывай» сказал он.
      folderUploaders = await readFolderUploaders({
        projectId: project.projectId,
        folderPath,
      })
      uploaderUserId =
        candidate.readyActorUserId ??
        (await readFolderCreator({
          projectId: project.projectId,
          name: entry.name,
        })) ??
        folderUploaders[0]?.userId ??
        null

      source = {
        fileId: null,
        s3Key: entry.key,
        name: entry.name,
        folderPath: "IN",
        sizeBytes: 0,
        contentHash: null,
        isFolder: true,
        children,
      }
    } else {
      if (!matchesSearchExts(entry.name, exts.searchExts)) {
        noteSkip(project.projectId, project.name, "no-match")
        continue
      }
      // Для файла contact — тот, кто принёс байты. uploaded_by главнее актора
      // события: последним событием могло быть переименование чужой рукой.
      uploaderUserId =
        (candidate.fileId ? fileUploaders.get(candidate.fileId) : null) ??
        candidate.putActorUserId ??
        null

      source = {
        fileId: candidate.fileId,
        s3Key: entry.key,
        name: entry.name,
        folderPath: "IN",
        sizeBytes: candidate.sizeBytes,
        contentHash: candidate.contentHash,
      }
    }

    const identities = await loadIdentities([
      uploaderUserId,
      project.ownerId,
      ...folderUploaders.map((u) => u.userId),
    ])
    const uploaderIdentity = uploaderUserId
      ? (identities.get(uploaderUserId) ?? null)
      : null

    // Id задачи назначается ДО сборки payload: он уезжает в description.dbItemId,
    // и по нему строка архива, которую напишет машина, склеивается с этой задачей
    // (docs/PIPELINE.md §15). Сгенерировать его внутри вставки нельзя — payload к
    // тому моменту уже собран.
    const taskId = randomUUID()

    const built = buildTaskPayload({
      optionsJson,
      taskId,
      projectId: project.projectId,
      projectName: project.name,
      ownerEmail: project.ownerEmail,
      source,
      fileTypes: await fileTypeFallback(),
      collectedAt,
      contact: uploaderIdentity,
      ownerContact: identities.get(project.ownerId) ?? null,
      projectPayAxes: { base: project.payBase, meter: project.payMeter },
      // Один человек в списке ничего не добавляет к contact — только шум.
      uploaders:
        folderUploaders.length > 1
          ? folderUploaders.flatMap((u) => {
              const identity = identities.get(u.userId)
              return identity
                ? [{ name: identity.name, email: identity.email, files: u.files }]
                : []
            })
          : undefined,
    })

    if (!built.ok) {
      noteSkip(project.projectId, project.name, built.reason)
      continue
    }

    // Единица не разрешилась — задачу всё равно создаём. Отказ включится вместе
    // с гейтом денег; до тех пор молча останавливать конвейер было бы хуже, чем
    // обработать бесплатно и показать проблему списком.
    if (!built.payUnit.ok) {
      noteUnpriced(project.projectId, project.name, built.payUnit.reason)
    }

    /**
     * Резерв под задачу. Кошелёк выбирается ОДИН раз, здесь, и до конца
     * обработки не меняется.
     *
     * Отказа по деньгам тут пока нет: гейт включается отдельно и рубильником
     * (docs/BILLING_AND_TRIAL_PLAN.md, П13). До тех пор резерв только
     * записывается — чтобы к моменту включения цифры уже были верными, а не
     * начинали копиться с нуля.
     */
    const estimateCents = built.payUnit.ok
      ? (
          await estimateItem({
            projectId: project.projectId,
            base: built.payUnit.base,
            meter: built.payUnit.meter,
            pair: built.payUnit.pair,
            item: {
              isFolder: entry.isFolder,
              sizeBytes: candidate.sizeBytes,
              children:
                entry.isFolder && "children" in source ? source.children : undefined,
            },
            settings,
            projectEstimateUnits: project.estimateUnits,
          })
        ).cents
      : 0

    const funds = await fundsOf(project.payerId)
    const admission = admitItem({
      ownerId: project.ownerId,
      projectId: project.projectId,
      pair: built.payUnit.ok ? built.payUnit.pair : null,
      meter: built.payUnit.ok ? built.payUnit.meter : null,
      payUnitProblem: built.payUnit.ok ? null : built.payUnit.reason,
      estimateCents,
      funds,
      ownerBillingExempt: project.ownerBillingExempt,
      ownerHasPayer: project.ownerHasPayer,
    })

    if (!admission.ok) {
      noteSkip(project.projectId, project.name, admission.reason)
      if (admission.pauseReason) {
        await pauseForBilling(project, admission.pauseReason)
      }
      continue
    }

    const inserted = await insertTask({
      id: taskId,
      projectId: project.projectId,
      sourceFileId: entry.isFolder ? null : candidate.fileId,
      sourceKey: entry.key,
      payload: built.payload,
      estimateCents: admission.estimateCents,
      payWallet: admission.wallet,
      payGrantId: admission.grantId,
    })
    if (inserted) {
      created += 1
      holdReserve(funds, admission)
    } else {
      noteSkip(project.projectId, project.name, "already-queued")
    }
  }

  return { created, skipped, unpriced }
}

/**
 * Остановить проект, когда платить больше нечем.
 *
 * Пауза пишется только через `setProjectPaused`: он владеет и сайдкаром
 * `options/folderState.json`, и колонкой `is_paused`, и кладёт событие в
 * журнал, чтобы машина узнала. Причина — отдельно: без неё остановка
 * неотличима от той, что сделал сам пользователь, и тумблер нечем удержать.
 *
 * Ошибку глотаем: не сумели записать паузу — задача всё равно не создана, а
 * ронять из-за этого весь проход по остальным проектам незачем. Следующий
 * проход попробует снова.
 */
async function pauseForBilling(
  project: WatchedProject,
  reason: PauseReason,
): Promise<void> {
  try {
    await setProjectPaused({
      projectId: project.projectId,
      ownerId: project.ownerId,
      storageOwnerId: project.storageOwnerId,
      paused: true,
      updatedBy: "billing",
    })
    await setPausedReason(project.projectId, reason)
  } catch (error) {
    console.error(
      `[billing] не удалось остановить проект ${project.projectId}`,
      error,
    )
  }
}

/**
 * Ставит задачу в очередь. false — по этому элементу задача уже живая.
 *
 * Дедуп держит уникальный индекс tasks_active_source_idx, а не проверка перед
 * вставкой: повторные события по одному элементу приходят пачкой, и проверка
 * «нет ли уже» между чтением и вставкой ничего не гарантирует.
 */
async function insertTask(input: {
  /** Уже лежит в payload как description.dbItemId — второй раз генерировать нельзя. */
  id: string
  projectId: string
  sourceFileId: string | null
  sourceKey: string
  payload: unknown
  /** Резерв: сколько и из какого кошелька. Ноль — тарифицировать нечем. */
  estimateCents: number
  payWallet: "own" | "gift" | null
  payGrantId: string | null
}): Promise<boolean> {
  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO tasks (
         id, project_id, source_file_id, source_key, payload,
         estimate_cents, pay_wallet, pay_grant_id
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        input.id,
        input.projectId,
        input.sourceFileId,
        input.sourceKey,
        JSON.stringify(input.payload),
        Math.max(0, Math.round(input.estimateCents)),
        input.payWallet,
        input.payGrantId,
      ],
    )
    return result.rowCount === 1
  })
}
