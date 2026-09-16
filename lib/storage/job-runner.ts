import { activateGrant } from "@/lib/billing/grants"
import { query } from "@/lib/db"
import { sweepInFolders } from "@/lib/pipeline/sweep"
import { setProjectPaused } from "@/lib/project-automation"
import {
  getObjectText,
  projectDescriptionKey,
  projectOptionsKey,
} from "@/lib/project-storage"
import { createProject, findProjectById } from "@/lib/repositories/projects"
import { buildCopyPlan, copyPlanItem, type CopyPlanItem } from "@/lib/storage/copy"
import {
  claimJob,
  finishJob,
  getJob,
  listQueuedJobs,
  requeueStaleRunningJobs,
  setJobProgress,
  type StorageJobRecord,
} from "@/lib/storage/jobs"
import {
  DESCRIPTION_FILE_NAME,
  FOLDER_STATE_FILE_NAME,
  OPTIONS_FILE_NAME,
  OPTIONS_FOLDER_NAME,
} from "@/lib/storage/keys"
import { assertMovableAcrossProjects, moveEventId } from "@/lib/storage/move"
import { writeFileDelete, writeSidecarPut } from "@/lib/storage/write-path"
import { rebuildCatalogSnapshot } from "@/lib/storage/catalog"
import { purgeDeletedProjects } from "@/lib/storage/project-trash"
import { purgeExpiredTrash } from "@/lib/storage/trash"

async function runCopyJob(job: StorageJobRecord): Promise<void> {
  const payload = job.payload as {
    sourceProjectId?: string
    destProjectId?: string
    /**
     * Куда копировать — адрес в хранилище проекта-получателя. Старое имя
     * `destOwnerId` читаем тоже: работы, поставленные в очередь до выкатки,
     * лежат в базе с ним, и уронить их переименованием поля нельзя.
     */
    destStorageOwnerId?: string
    destOwnerId?: string
    destFolderPath?: string
    fileIds?: string[]
    eventId?: string
    /** Кто запустил копирование — актора не восстановить из джоба иначе. */
    actorUserId?: string
    actorIsUploader?: boolean
  }

  const sourceProjectId = payload.sourceProjectId ?? job.projectId
  const destProjectId = payload.destProjectId ?? job.projectId
  const destStorageOwnerId = payload.destStorageOwnerId ?? payload.destOwnerId
  const destFolderPath = payload.destFolderPath ?? ""
  const fileIds = payload.fileIds ?? []

  if (
    !sourceProjectId ||
    !destProjectId ||
    !destStorageOwnerId ||
    fileIds.length === 0
  ) {
    await finishJob(job.id, {
      state: "failed",
      error: "Invalid copy job payload.",
    })
    return
  }

  const { items } = await buildCopyPlan({
    projectId: sourceProjectId,
    fileIds,
  })
  await setJobProgress(job.id, 0, items.length, { fileIds: [] })

  const folderPathMap = new Map<string, string>()
  const createdIds: string[] = []
  let done = 0

  for (const item of items) {
    const file = await copyPlanItem({
      destProjectId,
      destStorageOwnerId,
      destFolderPath,
      item,
      folderPathMap,
      eventId: payload.eventId
        ? `${payload.eventId}:${item.source.id}`
        : null,
      actor: {
        userId: payload.actorUserId ?? job.userId,
        isUploader: payload.actorIsUploader !== false,
      },
    })
    createdIds.push(file.id)
    done++
    await setJobProgress(job.id, done, items.length, { fileIds: createdIds })
  }

  await finishJob(job.id, {
    state: "done",
    done: createdIds.length,
    payload: { fileIds: createdIds },
  })
}

/**
 * Перенос между проектами (lib/storage/move.ts): копия целиком, потом
 * оригиналы в корзину.
 *
 * Отметка `copied` делит работу на две половины. Процесс перезапустят после
 * копирования — второй прогон только доудалит оригиналы и не положит вторую
 * копию рядом с первой. Перезапуск посреди копирования так не спасти: копия
 * начнётся заново, и доехавшая часть останется лишней, — зато оригинал цел.
 */
async function runMoveJob(job: StorageJobRecord): Promise<void> {
  const payload = job.payload as {
    sourceProjectId?: string
    sourceStorageOwnerId?: string
    destProjectId?: string
    destStorageOwnerId?: string
    destFolderPath?: string
    /**
     * Что переносим. Не `fileIds`, как у copy: туда по ходу пишутся id копий,
     * и второй прогон не нашёл бы, что удалять.
     */
    sourceFileIds?: string[]
    eventId?: string
    actorUserId?: string
    actorIsUploader?: boolean
    copied?: boolean
    fileIds?: string[]
  }

  const {
    sourceProjectId,
    sourceStorageOwnerId,
    destProjectId,
    destStorageOwnerId,
  } = payload
  const destFolderPath = payload.destFolderPath ?? ""
  const sourceFileIds = payload.sourceFileIds ?? []

  if (
    !sourceProjectId ||
    !sourceStorageOwnerId ||
    !destProjectId ||
    !destStorageOwnerId ||
    sourceFileIds.length === 0
  ) {
    await finishJob(job.id, {
      state: "failed",
      error: "Invalid move job payload.",
    })
    return
  }

  const actor = {
    userId: payload.actorUserId ?? job.userId,
    isUploader: payload.actorIsUploader !== false,
  }
  let createdIds = payload.fileIds ?? []

  if (!payload.copied) {
    const { items, roots } = await buildCopyPlan({
      projectId: sourceProjectId,
      fileIds: sourceFileIds,
    })
    assertMovableAcrossProjects(roots, destFolderPath)
    await setJobProgress(job.id, 0, items.length, { fileIds: [] })

    const folderPathMap = new Map<string, string>()
    createdIds = []
    for (const item of items) {
      const file = await copyPlanItem({
        destProjectId,
        destStorageOwnerId,
        destFolderPath,
        item,
        folderPathMap,
        eventId: moveEventId(payload.eventId, "copy", item.source.id),
        actor,
        keepUploader: true,
      })
      createdIds.push(file.id)
      await setJobProgress(job.id, createdIds.length, items.length, {
        fileIds: createdIds,
      })
    }
    await setJobProgress(job.id, createdIds.length, items.length, {
      copied: true,
    })
  }

  // Уже лежащий в корзине оригинал (второй прогон) writeFileDelete просто не
  // найдёт — повтор безопасен.
  for (const fileId of sourceFileIds) {
    await writeFileDelete({
      storageOwnerId: sourceStorageOwnerId,
      projectId: sourceProjectId,
      fileId,
      deletedBy: actor.userId,
      eventId: moveEventId(payload.eventId, "delete", fileId),
      actor,
    })
  }

  await finishJob(job.id, {
    state: "done",
    done: createdIds.length,
    payload: { fileIds: createdIds },
  })
}

/**
 * Что из шаблона НЕ переезжает пользователю обычным копированием.
 *
 * `OUT` — результаты админских прогонов: человек открыл бы пробный проект и
 * увидел чужие ролики как свои. `options/_stats` — чужая статистика: приёмник
 * архива засчитал бы её как работу пользователя и съел бы подарок до первого
 * запуска. `folderState.json` — пишется заново при включении обработки.
 *
 * Сама папка `options` и лежащие в ней `options.json` с `description.md` —
 * тоже здесь, но по другой причине: они не пропускаются, а едут другим путём,
 * `copyTemplateSidecars` (см. там же, почему обычное копирование их ломает).
 *
 * Исключения списком, а не маской: «не скопировалось» никогда не должно быть
 * тихим.
 */
const TEMPLATE_SKIP_ROOTS = new Set(["out"])

/** Сайдкары: у них фиксированный адрес в хранилище, а не имя файла в папке. */
const TEMPLATE_SIDECAR_NAMES = new Set([
  OPTIONS_FILE_NAME.toLowerCase(),
  DESCRIPTION_FILE_NAME.toLowerCase(),
  FOLDER_STATE_FILE_NAME.toLowerCase(),
])

function isSkippedTemplateItem(item: CopyPlanItem): boolean {
  const rel = item.relativeFolder.toLowerCase()
  const name = item.source.name.toLowerCase()
  const full = rel ? `${rel}/${name}` : name
  if (full === "options/_stats" || rel.startsWith("options/_stats")) return true
  /**
   * Папку `options` не заводим второй раз. Она уже есть: постановка проекта на
   * паузу пишет `options/folderState.json`, а запись сайдкара заводит папку под
   * него. Копирование про это не знает и, наткнувшись на занятое имя, честно
   * разрешает конфликт — заводит `options (2)` и кладёт настройки туда. Так
   * пробные проекты и получались с двумя папками, из которых «настоящая»
   * называлась «(2)».
   */
  if (item.source.isFolder && full === OPTIONS_FOLDER_NAME) return true
  if (rel === OPTIONS_FOLDER_NAME && TEMPLATE_SIDECAR_NAMES.has(name)) return true
  return false
}

/**
 * Настройки и описание шаблона — по каноническому адресу, а не копированием.
 *
 * Обычная копия кладёт файл под ключ `options/<uuid>-options.json`: так
 * устроена заливка, и для обычных файлов это правильно — одноимённые не
 * затирают друг друга. Но `options.json` сайт читает НЕ по строке каталога, а
 * по фиксированному ключу `options/options.json`
 * ([`projectOptionsKey`](../project-storage.ts)); туда же смотрит сборщик
 * задач. Скопированный обычным путём файл виден в дереве и не существует для
 * конвейера: проект пропускается с причиной `no-options`, то есть пробный
 * проект не работает вовсе.
 *
 * Поэтому читаем у шаблона и пишем в копию тем же путём, которым эти файлы
 * пишет программа, — `writeSidecarPut`: он кладёт объект по каноническому ключу
 * и заводит строку каталога.
 */
async function copyTemplateSidecars(input: {
  template: { id: string; storageOwnerId: string }
  destProjectId: string
  destStorageOwnerId: string
  actorUserId: string
}): Promise<void> {
  const sidecars = [
    {
      from: projectOptionsKey(input.template.storageOwnerId, input.template.id),
      to: projectOptionsKey(input.destStorageOwnerId, input.destProjectId),
      contentType: "application/json",
    },
    {
      from: projectDescriptionKey(
        input.template.storageOwnerId,
        input.template.id,
      ),
      to: projectDescriptionKey(input.destStorageOwnerId, input.destProjectId),
      contentType: "text/markdown; charset=utf-8",
    },
  ]

  for (const sidecar of sidecars) {
    const body = await getObjectText(sidecar.from)
    // Нет файла — нечего и переносить: описание у шаблона может отсутствовать.
    if (body == null) continue
    await writeSidecarPut({
      storageOwnerId: input.destStorageOwnerId,
      projectId: input.destProjectId,
      key: sidecar.to,
      body,
      contentType: sidecar.contentType,
      actor: { userId: input.actorUserId, isUploader: true },
    })
  }
}

/**
 * Очистить содержимое проекта перед заменой.
 *
 * Удаляем только корневые строки: `writeFileDelete` уводит в корзину и всё
 * вложенное. Папку `options` обходим НАМЕРЕННО — сайт и конвейер читают
 * сайдкары по фиксированному ключу, и `assertSidecarPlaceIsStable` такое
 * удаление отвергает с 403. Настройки и описание не удаляются, а
 * перезаписываются на месте: этим займётся `copyTemplateSidecars`, перезапись
 * содержимого сайдкара разрешена.
 *
 * Файлы уходят в корзину, а не стираются: у них 30 дней retention, и человек,
 * выбравший «заменить» по ошибке, ещё может достать своё.
 */
async function clearProjectContents(input: {
  storageOwnerId: string
  projectId: string
  actorUserId: string
}): Promise<void> {
  const rows = await query<{ id: string; name: string; isFolder: boolean }>(
    `SELECT id, name, is_folder AS "isFolder"
       FROM project_files
      WHERE project_id = $1 AND folder_path = '' AND deleted_at IS NULL`,
    [input.projectId],
  )

  for (const row of rows.rows) {
    if (row.isFolder && row.name.toLowerCase() === OPTIONS_FOLDER_NAME) continue
    await writeFileDelete({
      storageOwnerId: input.storageOwnerId,
      projectId: input.projectId,
      fileId: row.id,
      deletedBy: input.actorUserId,
      actor: { userId: input.actorUserId, isUploader: true },
    })
  }
}

async function listTemplateRoots(
  projectId: string,
): Promise<{ id: string; name: string }[]> {
  const result = await query<{ id: string; name: string }>(
    `SELECT id, name
       FROM project_files
      WHERE project_id = $1
        AND folder_path = ''
        AND deleted_at IS NULL
      ORDER BY is_folder DESC, lower(name)`,
    [projectId],
  )
  return result.rows.filter(
    (row) => !TEMPLATE_SKIP_ROOTS.has(row.name.toLowerCase()),
  )
}

/**
 * Выдача тестового периода: копии подготовленных проектов пользователю.
 *
 * Одной работой, а не тремя `copy`-джобами: включать обработку можно только
 * когда копия доехала ЦЕЛИКОМ, иначе конвейер увидит наполовину скопированную
 * папку и соберёт задачу по неполному манифесту. Одна работа знает, когда
 * «всё»; три отдельные — нет, за ними пришлось бы кому-то следить.
 */
async function runTrialProvisionJob(job: StorageJobRecord): Promise<void> {
  const payload = job.payload as {
    grantId?: string
    templateIds?: string[]
    /** Уже созданные копии — их отдаём гранту. */
    projectIds?: string[]
    /**
     * Шаблоны, с которыми уже разобрались. Второй прогон обязан их пропустить:
     * работа возвращается в очередь после перезапуска процесса, и без этого
     * списка человек получил бы вторые копии тех же проектов. Считать по длине
     * `projectIds` нельзя — пропавший шаблон копии не даёт, и счёт разъедется.
     */
    doneTemplateIds?: string[]
    /** `templateId` → имя, выбранное человеком при совпадении имён. */
    names?: Record<string, string>
    /** `templateId` → проект прошлой выдачи, который человек решил заменить. */
    replaceTargets?: Record<string, string>
  }
  const grantId = payload.grantId
  const templateIds = payload.templateIds ?? []
  const names = payload.names ?? {}
  const replaceTargets = payload.replaceTargets ?? {}

  if (!grantId || templateIds.length === 0) {
    await finishJob(job.id, {
      state: "failed",
      error: "Invalid trial provision payload.",
    })
    return
  }

  const createdIds: string[] = [...(payload.projectIds ?? [])]
  const handled = new Set(payload.doneTemplateIds ?? [])
  let done = handled.size

  for (const templateId of templateIds) {
    if (handled.has(templateId)) continue
    const template = await findProjectById(templateId)
    if (!template) {
      // Шаблон исчез из набора — второй раз его искать незачем.
      handled.add(templateId)
      done++
      await setJobProgress(job.id, done, templateIds.length, {
        doneTemplateIds: [...handled],
      })
      continue
    }

    /**
     * Куда копировать. Человек мог выбрать замену проекта прошлой выдачи — тогда
     * берём ЕГО, а не заводим новый: у проекта есть id, на который ссылаются
     * задачи, статистика и движения денег. Удалить его и создать заново значило
     * бы оставить ленту транзакций без проекта (`ON DELETE SET NULL`), а это
     * ровно то, чего избегали в П9.1, отказавшись удалять строку гранта.
     */
    const replaceTargetId = replaceTargets[templateId]
    const replaced = replaceTargetId
      ? await findProjectById(replaceTargetId)
      : null

    // Проект на паузе: копирование пишет обычные put-события в журнал, и под
    // слежением сканер начал бы делать задачи прямо в процессе.
    const project =
      replaced ??
      (await createProject({
        ownerId: job.userId,
        // Имя из диалога, если человек его задал: набор приезжает рядом со
        // старым, и различать их придётся именно по имени.
        name: names[templateId] ?? template.name,
        description: template.description,
        groupName: "personal",
      }))
    await setProjectPaused({
      projectId: project.id,
      ownerId: job.userId,
      storageOwnerId: project.storageOwnerId,
      paused: true,
      updatedBy: "trial",
    })

    // Замена: старое содержимое уезжает в корзину до копирования, иначе файлы
    // двух наборов смешались бы, а одноимённые разошлись бы как «(2)».
    if (replaced) {
      await clearProjectContents({
        storageOwnerId: replaced.storageOwnerId,
        projectId: replaced.id,
        actorUserId: job.userId,
      })
    }

    createdIds.push(project.id)

    const roots = await listTemplateRoots(templateId)
    if (roots.length > 0) {
      const { items } = await buildCopyPlan({
        projectId: templateId,
        fileIds: roots.map((r) => r.id),
      })
      const folderPathMap = new Map<string, string>()
      for (const item of items) {
        if (isSkippedTemplateItem(item)) continue
        await copyPlanItem({
          destProjectId: project.id,
          destStorageOwnerId: project.storageOwnerId,
          destFolderPath: "",
          item,
          folderPathMap,
          // Заливщиком становится тот, кто активировал период: отсюда конвейер
          // возьмёт contact, и работа подпишется им, а не автором шаблона.
          actor: { userId: job.userId, isUploader: true },
        })
      }
    }

    // Настройки и описание — своим путём, по каноническому адресу. Без них
    // копия видна в кабинете и невидима для конвейера.
    await copyTemplateSidecars({
      template: { id: templateId, storageOwnerId: template.storageOwnerId },
      destProjectId: project.id,
      destStorageOwnerId: project.storageOwnerId,
      actorUserId: job.userId,
    })

    handled.add(templateId)
    done++
    await setJobProgress(job.id, done, templateIds.length, {
      projectIds: createdIds,
      doneTemplateIds: [...handled],
    })
  }

  // Копии доехали — включаем обработку и открываем подарок к тратам.
  for (const projectId of createdIds) {
    await setProjectPaused({
      projectId,
      ownerId: job.userId,
      // Проект только что создан на этого же человека, поэтому адрес в
      // хранилище совпадает с владельцем.
      storageOwnerId: job.userId,
      paused: false,
      updatedBy: "trial",
    })
  }

  await activateGrant({ grantId, projectIds: createdIds })

  // События копирования проехали мимо курсора конвейера, пока проекты стояли на
  // паузе, и второго `put` по этим файлам не будет. Обход берёт элементы IN, по
  // которым задачи никогда не было, — иначе первый виток ждал бы расписания.
  try {
    await sweepInFolders({ projectIds: createdIds })
  } catch (error) {
    // Не сумели обойти сейчас — обойдётся по расписанию. Ронять из-за этого
    // выдачу периода незачем: проекты уже у человека и уже под слежением.
    console.error("[trial] sweep after provisioning failed", error)
  }

  await finishJob(job.id, {
    state: "done",
    done: createdIds.length,
    payload: { projectIds: createdIds },
  })
}

async function runRecatalogJob(job: StorageJobRecord): Promise<void> {
  if (!job.projectId) {
    await finishJob(job.id, { state: "failed", error: "Missing projectId." })
    return
  }
  const project = await findProjectById(job.projectId)
  if (!project) {
    await finishJob(job.id, { state: "failed", error: "Project not found." })
    return
  }
  const cursor = await rebuildCatalogSnapshot(
    project.storageOwnerId,
    project.id,
  )
  await finishJob(job.id, {
    state: "done",
    done: 1,
    payload: { cursor },
  })
}

async function runPurgeJob(job: StorageJobRecord): Promise<void> {
  const fileResult = await purgeExpiredTrash()
  const projectResult = await purgeDeletedProjects()
  await finishJob(job.id, {
    state: "done",
    done: fileResult.purged + projectResult.purged,
    payload: {
      filesPurged: fileResult.purged,
      projectsPurged: projectResult.purged,
    },
  })
}

export async function executeJob(jobId: string): Promise<StorageJobRecord | null> {
  const claimed = await claimJob(jobId)
  if (!claimed) return getJob(jobId)

  try {
    switch (claimed.kind) {
      case "copy":
        await runCopyJob(claimed)
        break
      case "recatalog":
        await runRecatalogJob(claimed)
        break
      case "trial-provision":
        await runTrialProvisionJob(claimed)
        break
      case "purge":
        await runPurgeJob(claimed)
        break
      case "move":
        await runMoveJob(claimed)
        break
      default:
        await finishJob(claimed.id, {
          state: "failed",
          error: `Unknown job kind: ${claimed.kind}`,
        })
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Job failed."
    console.error(`[storage-jobs] ${claimed.id} failed`, error)
    await finishJob(claimed.id, { state: "failed", error: message })
  }

  return getJob(jobId)
}

/** Fire-and-forget runner for HTTP 202 responses. */
export function scheduleJob(jobId: string): void {
  void executeJob(jobId).catch((error) => {
    console.error(`[storage-jobs] schedule ${jobId}`, error)
  })
}

export async function processQueuedJobs(limit = 10): Promise<{
  requeued: number
  processed: number
}> {
  const requeued = await requeueStaleRunningJobs()
  const queued = await listQueuedJobs(limit)
  let processed = 0
  for (const job of queued) {
    await executeJob(job.id)
    processed++
  }
  return { requeued, processed }
}
