import { query } from "@/lib/db"
import { listWatchedProjects } from "@/lib/pipeline/repository"
import {
  isHeldBack,
  materializeCandidates,
  type Candidate,
  type InEntry,
  type SkipReason,
  type SkippedProject,
  type UnpricedProject,
} from "@/lib/pipeline/scan"
import { projectPrefix } from "@/lib/storage/keys"

/**
 * Страховочный обход папок IN.
 *
 * Вторая линия сборки задач, и нужна она из-за свойства первой. Событийный сканер
 * (lib/pipeline/scan.ts) двигает курсор независимо от того, создалась задача или
 * нет: проект был на паузе, гейт владельца выключен, options.json битый, в коде
 * ошибка — событие просмотрено, задачи нет, и второго события по этому файлу уже
 * никогда не будет. Файл остаётся лежать в IN как обработанный, хотя его никто не
 * трогал. Ровно так пропал `123.mp4` в «test 1»: mainSearch отдавал searchType
 * массивом, сканер отвечал `no-search-type` и молча шёл дальше.
 *
 * Старый десктопный перебор папок этой болезнью не страдал, потому что был
 * идемпотентен по СОСТОЯНИЮ: файл находился на каждом проходе, пока лежал в
 * папке, и удаление было единственным способом сказать «хватит». Обход
 * возвращает это свойство, но не заменяет событийную линию: событие даёт задачу
 * через секунды, обход — в худшем случае через свой интервал.
 *
 * Два обещания, на которых он держится:
 *
 * 1. Идём по каталогу (project_files), а не по R2. Вся нужная информация уже в
 *    базе, а листинг бакета на каждый проект стоил бы денег и времени и всё равно
 *    не сказал бы, кто заливал файл.
 *
 * 2. Элемент, по которому задача уже создавалась, не берём — в любом статусе,
 *    включая `done` и `failed`. Иначе обход переоткрывал бы обработанное каждые
 *    четверть часа, а «прогнать заново» — это отдельное осознанное действие, и
 *    делается оно новым событием по файлу (перезаливкой или переносом обратно в
 *    IN), а не расписанием.
 *
 * Из второго обещания следовало неприятное: упавший файл оставался лежать в IN
 * навсегда невидимым — задача по нему была, значит обход его не берёт, а второго
 * события по нему не будет. Чинится не здесь: падение помечает исходник дефисом
 * в начале имени (lib/pipeline/quarantine.ts), и «лежит в IN как обычный файл, а
 * задачи нет» перестало быть возможным состоянием — помеченный файл видно глазом.
 * Дорога назад — снять дефис: это `move`-событие, и оно заводит новую задачу.
 */

/**
 * Сколько элементов берём за один обход.
 *
 * Нужен потому, что первый обход на живой установке видит ВСЁ, что лежит в IN и
 * никогда не имело задачи, — в том числе то, что обработали десктопом до
 * появления конвейера. Без потолка это разовый залп на всю очередь. Остаток
 * доберётся следующим обходом, а число попадёт в лог и в результат, чтобы
 * усечение не выглядело как «обошли всё».
 */
const SWEEP_LIMIT = 500

export type SweepResult = {
  created: number
  /** Сколько элементов верхнего уровня в IN осмотрено. */
  scanned: number
  /** Из них уже имели задачу — обход их не трогает. */
  known: number
  /** Упёрлись в SWEEP_LIMIT: часть элементов осталась на следующий раз. */
  truncated: boolean
  skipped: SkippedProject[]
  /**
   * Проекты, по которым нечем тарифицировать. Обход видит их полнее, чем
   * событийная линия: та замечает только те, где что-то шевелилось, а обход
   * идёт по каталогу всех отслеживаемых проектов.
   */
  unpriced: UnpricedProject[]
}

type CatalogRow = {
  projectId: string
  id: string
  name: string
  isFolder: boolean
  s3Key: string | null
  sizeBytes: string
  contentHash: string | null
}

/**
 * Элементы верхнего уровня в IN у всех отслеживаемых проектов — одним запросом.
 *
 * `folder_path = 'IN'` это и есть «верхний уровень»: файл внутри папки IN/raw
 * сюда не попадёт, и правильно — единица работы это элемент верхнего уровня, а
 * содержимое папки приезжает манифестом при сборке задачи.
 */
async function readInEntries(projectIds: string[]): Promise<CatalogRow[]> {
  const result = await query<CatalogRow>(
    `SELECT project_id       AS "projectId",
            id,
            name,
            is_folder        AS "isFolder",
            s3_key           AS "s3Key",
            COALESCE(size_bytes, 0)::text AS "sizeBytes",
            content_hash     AS "contentHash"
       FROM project_files
      WHERE project_id = ANY($1::text[])
        AND folder_path = 'IN'
        AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [projectIds],
  )
  return result.rows
}

/**
 * Какие из этих элементов уже проходили через очередь.
 *
 * Спрашиваем ровно по ключам кандидатов, а не «все задачи проектов»: за месяцы
 * работы задач станет намного больше, чем элементов в IN, и тянуть их все ради
 * пересечения незачем. Индекс — tasks_source_key_idx.
 */
async function readKnownSourceKeys(
  pairs: { projectId: string; sourceKey: string }[],
): Promise<Set<string>> {
  if (pairs.length === 0) return new Set()
  const result = await query<{ projectId: string; sourceKey: string }>(
    `SELECT project_id AS "projectId", source_key AS "sourceKey"
       FROM tasks
      WHERE project_id = ANY($1::text[])
        AND source_key = ANY($2::text[])`,
    [
      [...new Set(pairs.map((p) => p.projectId))],
      [...new Set(pairs.map((p) => p.sourceKey))],
    ],
  )
  return new Set(result.rows.map((r) => `${r.projectId}:${r.sourceKey}`))
}

/**
 * Прогоняет обход и создаёт задачи по элементам IN, которых ещё не было в очереди.
 *
 * Вызывается фоновым циклом по расписанию (lib/pipeline/runner.ts) и вручную из
 * админки. Флаг слежения проверяет вызывающий: «Стоп» на странице значит, что
 * задачи не появляются вообще — ни по событию, ни обходом.
 */
export async function sweepInFolders(options?: {
  /**
   * Обойти только эти проекты. Нужно сразу после провижининга пробного набора:
   * события копирования проехали мимо курсора, пока проект стоял на паузе, и
   * второго `put` по этим файлам не будет. Обход берёт элементы IN, по которым
   * задачи никогда не было, — ровно наш случай.
   */
  projectIds?: string[]
}): Promise<SweepResult> {
  const only = options?.projectIds?.length ? new Set(options.projectIds) : null
  const watched = (await listWatchedProjects()).filter(
    (p) => !only || only.has(p.projectId),
  )
  if (watched.length === 0) {
    return {
      created: 0,
      scanned: 0,
      known: 0,
      truncated: false,
      skipped: [],
      unpriced: [],
    }
  }

  const watchedById = new Map(watched.map((p) => [p.projectId, p]))
  const rows = await readInEntries(watched.map((p) => p.projectId))

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

  const seen: {
    projectId: string
    entry: InEntry
    fileId: string | null
    sizeBytes: number
    contentHash: string | null
  }[] = []

  for (const row of rows) {
    const project = watchedById.get(row.projectId)
    if (!project) continue

    // Идентичность элемента считаем ровно так же, как событийный сканер, иначе
    // дедуп по source_key разъедется и обход задублировал бы уже созданное.
    // Для файла это его физический ключ; для папки — собранный, потому что у
    // строки-папки s3_key нет по схеме.
    //
    // А имя берём логическое, из каталога: физический сегмент ключа с uuid до
    // машины доходить не должен, оттуда собираются имена результатов
    // (docs/STORAGE_CLIENT_REQUESTS.md §14.1). Обе ветки здесь раньше расходились —
    // у папки имя было логическое, у файла нарезанное из ключа.
    const entry: InEntry | null = row.isFolder
      ? {
          name: row.name,
          key: `${projectPrefix(project.storageOwnerId, project.projectId)}IN/${row.name}`,
          isFolder: true,
        }
      : row.s3Key
        ? { name: row.name, key: row.s3Key, isFolder: false }
        : null
    if (!entry) continue

    // И папка, и файл: дефис в начале имени = «в обработку не брать» (см. isHeldBack).
    // У файла это пометка брака или неудалённого исходника, поставленная десктопом.
    if (isHeldBack(entry.name)) {
      noteSkip(project.projectId, project.name, "folder-not-ready")
      continue
    }

    seen.push({
      projectId: project.projectId,
      entry,
      fileId: row.isFolder ? null : row.id,
      sizeBytes: Number(row.sizeBytes),
      contentHash: row.contentHash,
    })
  }

  const known = await readKnownSourceKeys(
    seen.map((s) => ({ projectId: s.projectId, sourceKey: s.entry.key })),
  )
  const fresh = seen.filter(
    (s) => !known.has(`${s.projectId}:${s.entry.key}`),
  )
  const truncated = fresh.length > SWEEP_LIMIT
  const batch = truncated ? fresh.slice(0, SWEEP_LIMIT) : fresh

  // Акторов у обхода нет и быть не может: он смотрит на состояние, а не на
  // события. Цепочка contact доедет до заливщика из каталога (project_files
  // .uploaded_by), для папки — до её создателя.
  const candidates: Candidate[] = batch.map((item) => ({
    projectId: item.projectId,
    entry: item.entry,
    fileId: item.fileId,
    sizeBytes: item.sizeBytes,
    contentHash: item.contentHash,
    putActorUserId: null,
    readyActorUserId: null,
  }))

  const materialized = await materializeCandidates({
    candidates,
    watchedById,
    collectedAt: new Date().toISOString(),
  })

  if (truncated) {
    console.log(
      `[pipeline-sweep] элементов без задачи ${fresh.length}, взято ${SWEEP_LIMIT} — остаток доберётся следующим обходом`,
    )
  }

  return {
    created: materialized.created,
    scanned: seen.length,
    known: seen.length - fresh.length,
    truncated,
    skipped: [...skipped, ...materialized.skipped],
    unpriced: materialized.unpriced,
  }
}
