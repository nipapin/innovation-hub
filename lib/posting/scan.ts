import { randomUUID } from "node:crypto"

import { query } from "@/lib/db"
import {
  matchesSearchExts,
  readFileTypesSnapshot,
  type FileTypeDictionary,
} from "@/lib/pipeline/build-task"
import { getObjectText, projectOptionsKey } from "@/lib/project-storage"
import { readFileTypeDictionary } from "@/lib/repositories/automation-settings"
import { findAccountByLabel } from "@/lib/social/accounts"
import { resolveMasks } from "./masks"
import {
  findSiblingProjectByName,
  hasJobInFlight,
  lastPublishedAt,
  listFolderCandidates,
  listPostedKeys,
  listPostingProjects,
  listQueuedKeys,
  recordScanRun,
  readPostScanState,
} from "./repository"
import { isLocalOnlyFolder, readPostRoutes, type PostRoute } from "./routes"
import { evaluateSchedule, postingTimeZone, sortCandidates } from "./schedule"

/**
 * Обход папок-источников: маршрут созрел → ставим ОДНУ задачу.
 *
 * Порт `runAutoPost` из `src/PROCESSING/autoPost/index.ts`, но разделённый
 * надвое: здесь только ВЫБОР файла и постановка задачи, сама публикация — в
 * `publish.ts`. В программе это один проход, потому что там исполнение
 * синхронное; на сервере длинная заливка не может жить внутри обхода — обход
 * ходит по всем проектам, а заливка гигабайтного файла занимает минуты.
 *
 * Обход ИДЕМПОТЕНТЕН ПО СОСТОЯНИЮ, как перебор папок в программе: он не ведёт
 * курсора и ничего не «отмечает просмотренным». Файл, который не взяли сегодня,
 * будет найден завтра — он же лежит в папке. Это принципиально отличается от
 * событийного сканера обработки, где пропуск окончательный
 * (docs/PIPELINE.md §3.1).
 *
 * По маршруту за проход ставится РОВНО ОДНА задача. Не оптимизация: темп задан
 * интервалом, и поставить в очередь десять файлов сразу значило бы опубликовать
 * их подряд, как только очередь до них дойдёт.
 */

/** Почему маршрут не дал задачу. Показывается в админке как есть. */
export type SkipReason =
  | "no-options"
  | "invalid-options"
  | "no-routes"
  | "local-folder"
  | "description-linked"
  | "no-account"
  | "account-missing"
  | "target-missing"
  | "cooldown"
  | "outside-window"
  | "interval"
  | "in-flight"
  | "no-files"
  | "platform-not-ready"

export type RouteReport = {
  projectId: string
  projectName: string
  finderId: string
  folder: string
  platform: string
  account: string
  target: string
  /** Сколько файлов ждёт публикации по этому маршруту. */
  queued: number
  /** Через сколько секунд созреет. `null` — не считается (нет файлов/окно). */
  dueIn: number | null
  skip: SkipReason | null
  /** Задача, поставленная этим проходом. */
  createdJobId: string | null
}

export type ScanResult = {
  routes: RouteReport[]
  created: number
  error: string | null
}

/** Площадки, которыми сайт уже умеет публиковать. Остальным задачи не ставим. */
const PUBLISHABLE = new Set(["vk"])

async function loadOptions(input: {
  storageOwnerId: string
  projectId: string
}): Promise<unknown | null | undefined> {
  const raw = await getObjectText(
    projectOptionsKey(input.storageOwnerId, input.projectId),
  )
  if (raw == null) return null
  try {
    return JSON.parse(raw)
  } catch {
    // undefined — «файл есть, но битый»: это другая причина пропуска, чем
    // «графа нет вовсе», и различать их в отчёте нужно.
    return undefined
  }
}

/** Расширения, которые ищет маршрут. */
function extsForRoute(
  route: PostRoute,
  optionsJson: unknown,
  shared: FileTypeDictionary,
): string[] {
  const snapshot = readFileTypesSnapshot(optionsJson) ?? {}
  const dictionary: FileTypeDictionary = { ...shared, ...snapshot }
  return dictionary[route.searchType] ?? []
}

/**
 * Цель публикации → объект для задачи.
 *
 * Имя цели резолвится в id ЗДЕСЬ, на постановке, а не при публикации: список
 * сообществ лежит в сейфе, и если сообщества с таким именем там нет, человек
 * должен узнать об этом сразу и с внятной причиной, а не через сутки по
 * упавшей задаче.
 */
function resolveTarget(
  route: PostRoute,
  targets: { id: string; name: string }[],
): { kind: "profile" } | { kind: "group"; id: string; name: string } | null {
  if (!route.target || route.target === "Profile") return { kind: "profile" }
  const found = targets.find((target) => target.name === route.target)
  return found ? { kind: "group", id: found.id, name: found.name } : null
}

/**
 * Куда именно уедет исходник после публикации.
 *
 * Считается ПРИ ПОСТАНОВКЕ, а не при публикации, и запоминается у задачи:
 *
 *   • маски (`VK_posted/$YYYY.$MM`) должны разложиться по тому месяцу, когда
 *     файл поставили в очередь, а не по тому, когда до него дошла очередь;
 *   • имя соседнего проекта резолвится в id: проект могут переименовать, пока
 *     задача ждёт, и тогда файл уехал бы не туда.
 *
 * Неразрешимое назначение НЕ отменяет публикацию — она уже настроена и ждёт
 * своего интервала, а опечатка в пути назначения к ней отношения не имеет.
 * Файл остаётся на месте, а причина едет с задачей и видна в очереди.
 */
async function resolveDestination(
  route: PostRoute,
  project: { projectId: string; ownerId: string },
  context: Parameters<typeof resolveMasks>[1],
): Promise<{
  afterPost: "keep" | "delete" | "move"
  folder: string
  projectId: string | null
  note: string | null
}> {
  const keep = { afterPost: "keep" as const, folder: "", projectId: null }

  if (route.afterPost !== "move") {
    return { afterPost: route.afterPost, folder: "", projectId: null, note: null }
  }

  const segments = resolveMasks(route.afterPostFolder, context)
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)

  // Путь, ставший пустым после раскрытия масок: переносить некуда.
  if (segments.length === 0) return { ...keep, note: null }

  if (route.afterPostUp === 0) {
    return {
      afterPost: "move",
      folder: segments.join("/"),
      projectId: project.projectId,
      note: null,
    }
  }

  // `../` — соседний проект: первый сегмент это его имя.
  const [projectName, ...rest] = segments
  const sibling = await findSiblingProjectByName({
    ownerId: project.ownerId,
    name: projectName,
  })
  if (!sibling) {
    return {
      ...keep,
      note: `after-post: project "${projectName}" not found, file left in place`,
    }
  }
  return {
    afterPost: "move",
    folder: rest.join("/"),
    projectId: sibling.projectId,
    note: null,
  }
}

export async function collectPostJobs(): Promise<ScanResult> {
  const projects = await listPostingProjects()
  const timeZone = postingTimeZone()
  const now = new Date()
  const reports: RouteReport[] = []
  let created = 0

  /** Общий словарь типов читается один раз на проход, а не на маршрут. */
  let shared: FileTypeDictionary | null = null
  const fileTypes = async () => {
    if (shared == null) shared = await readFileTypeDictionary()
    return shared
  }

  for (const project of projects) {
    const optionsJson = await loadOptions(project)
    if (optionsJson === null || optionsJson === undefined) {
      // Проект без графа — обычное дело: постинг настроен не у всех. В отчёт
      // такие не кладём, иначе он утонет в строках «тут ничего нет».
      continue
    }

    const routes = readPostRoutes(optionsJson)
    if (routes.length === 0) continue

    for (const route of routes) {
      const report: RouteReport = {
        projectId: project.projectId,
        projectName: project.name,
        finderId: route.finderId,
        folder: route.folder,
        platform: route.platform,
        account: route.account,
        target: route.target,
        queued: 0,
        dueIn: null,
        skip: null,
        createdJobId: null,
      }
      reports.push(report)

      if (!PUBLISHABLE.has(route.platform)) {
        report.skip = "platform-not-ready"
        continue
      }
      if (isLocalOnlyFolder(route.folder)) {
        report.skip = "local-folder"
        continue
      }
      if (route.descriptionLinked) {
        report.skip = "description-linked"
        continue
      }
      if (!route.account) {
        report.skip = "no-account"
        continue
      }

      const account = await findAccountByLabel({
        userId: project.ownerId,
        platform: route.platform,
        label: route.account,
      })
      if (!account) {
        report.skip = "account-missing"
        continue
      }

      const target = resolveTarget(route, account.targets)
      if (!target) {
        report.skip = "target-missing"
        continue
      }

      // Живая задача по аккаунту означает, что предыдущая публикация ещё не
      // случилась. Ставить вторую нельзя: они уедут подряд, мимо интервала.
      if (
        await hasJobInFlight({
          projectId: project.projectId,
          platform: route.platform,
          accountId: account.id,
        })
      ) {
        report.skip = "in-flight"
        continue
      }

      const exts = extsForRoute(route, optionsJson, await fileTypes())
      const all = await listFolderCandidates({
        projectId: project.projectId,
        folderPath: route.folder,
      })
      const posted = await listPostedKeys({
        projectId: project.projectId,
        platform: route.platform,
        accountId: account.id,
      })
      const queuedKeys = await listQueuedKeys({
        projectId: project.projectId,
        platform: route.platform,
        accountId: account.id,
      })

      const candidates = sortCandidates(
        all.filter(
          (file) =>
            (exts.length === 0 || matchesSearchExts(file.name, exts)) &&
            !posted.has(file.s3Key) &&
            !queuedKeys.has(file.s3Key),
        ),
        route.order,
      )
      report.queued = candidates.length
      if (candidates.length === 0) {
        report.skip = "no-files"
        continue
      }

      const verdict = evaluateSchedule({
        route,
        now,
        timeZone,
        accountId: account.id,
        cooldownUntil: account.cooldownUntil
          ? new Date(account.cooldownUntil)
          : null,
        lastPostedAt: await lastPublishedAt({
          projectId: project.projectId,
          platform: route.platform,
          accountId: account.id,
        }),
      })
      if (!verdict.due) {
        report.skip = verdict.reason
        report.dueIn = verdict.dueIn
        continue
      }

      const file = candidates[0]
      const jobId = randomUUID()
      /**
       * Маски раскрываются СЕЙЧАС и запоминаются у задачи. Пересчитывать их при
       * публикации значило бы, что `$DD.$MM` в отложенной на сутки задаче
       * покажет не тот день, а `$random()` — вообще другое значение.
       */
      const context = {
        fileName: file.name,
        projectName: project.name,
        now,
      }
      const meta = {
        // Заголовок — имя файла без расширения, ровно как `clearName` в
        // `autoPostVK.ts`. Маски в нём НЕ раскрываем: в программе их там нет, а
        // «$» в имени файла — это обычно просто «$».
        title: file.name.replace(/\.[^.]+$/, ""),
        description: resolveMasks(route.description, context),
      }

      const destination = await resolveDestination(route, project, context)

      // `DO NOTHING` ловит гонку двух обходов: частичный уникальный индекс не
      // даёт второй живой задачи по тому же файлу. Возврат id отличает вставку
      // от проигранной гонки — иначе отчёт показал бы задачу, которой нет.
      const inserted = await query<{ id: string }>(
        `INSERT INTO post_jobs
           (id, project_id, file_id, source_key, finder_id, platform,
            account_id, target, meta, after_post, after_post_folder,
            after_post_project_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          jobId,
          project.projectId,
          file.fileId,
          file.s3Key,
          route.finderId,
          route.platform,
          account.id,
          JSON.stringify(target),
          JSON.stringify({ ...meta, afterPostNote: destination.note ?? undefined }),
          destination.afterPost,
          destination.folder,
          destination.projectId,
        ],
      )
      if (inserted.rows.length === 0) {
        report.skip = "in-flight"
        continue
      }
      report.createdJobId = jobId
      created += 1
    }
  }

  return { routes: reports, created, error: null }
}

/**
 * Прогон обхода с записью состояния.
 *
 * Отдельно от `collectPostJobs`, потому что разовый прогон кнопкой и прогон по
 * расписанию должны одинаково обновлять «когда ходили в последний раз» — а вот
 * в тестах и в отчёте для админки состояние трогать не надо.
 */
export async function runPostScan(): Promise<ScanResult> {
  try {
    const result = await collectPostJobs()
    await recordScanRun({ created: result.created, error: null })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordScanRun({ created: 0, error: message.slice(0, 500) })
    return { routes: [], created: 0, error: message }
  }
}

/** Пора ли идти по расписанию. `0` в периоде — по таймеру не ходим. */
export async function isScanDue(): Promise<boolean> {
  const state = await readPostScanState()
  if (!state.isRunning) return false
  if (state.scanIntervalMin <= 0) return false
  if (!state.scannedAt) return true
  const elapsed = Date.now() - new Date(state.scannedAt).getTime()
  return elapsed >= state.scanIntervalMin * 60_000
}
