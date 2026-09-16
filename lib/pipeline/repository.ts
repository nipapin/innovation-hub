import { query } from "@/lib/db"
import { REMOTE_COMPUTER_ONLINE_MS, type ProjectRecord } from "@/lib/domain-types"
import { TEAM_UNREAD_COUNT_SQL } from "@/lib/repositories/project-chat"
import { companyAutomationSql } from "@/lib/company-features"

/**
 * Запросы «Конвейера» — админского вида на обработку всех проектов сайта.
 *
 * Ключевое отличие от кабинетных запросов: здесь нет владельческого скоупинга,
 * зато есть гейт пользователя (users.automation_enabled) и признаки, по которым
 * проект попадает или не попадает под слежение.
 */

export type PipelineUser = {
  id: string
  fullName: string
  email: string
  automationEnabled: boolean
  /** Аккаунт не заблокирован. Заблокированного не обрабатываем независимо от гейта. */
  isActive: boolean
  projectCount: number
  /** Не на паузе и не в архиве — то есть под слежением, если гейт включён. */
  watchedCount: number
  archivedCount: number
  /** Последняя активность в хранилище по любому проекту пользователя. */
  lastActivityAt: Date | null
  /** NULL — общий раздел. По ним «Папки» разбиваются на области. */
  companyId: string | null
  companyTitle: string | null
}

/**
 * Кто участвует в обработке — колонка 1 «Папок».
 *
 * Служебные кошельки компаний (`kind = 'company_wallet'`) исключены: это не
 * люди, а счета. Войти ими нельзя, папок у них нет и не будет, а в списке они
 * выглядели как двое сотрудников общего раздела, у которых почему-то ноль
 * проектов. Та же причина, по которой их не показывает консоль компании.
 */
export async function listPipelineUsers(): Promise<PipelineUser[]> {
  const result = await query<PipelineUser>(
    `SELECT u.id,
            COALESCE(u.full_name, '')        AS "fullName",
            u.email,
            COALESCE(u.automation_enabled, FALSE) AS "automationEnabled",
            u.is_active                     AS "isActive",
            COALESCE(p.total, 0)::int       AS "projectCount",
            COALESCE(p.watched, 0)::int     AS "watchedCount",
            COALESCE(p.archived, 0)::int    AS "archivedCount",
            p.last_activity                 AS "lastActivityAt",
            u.company_id                    AS "companyId",
            c.title                         AS "companyTitle"
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       LEFT JOIN (
         SELECT user_id,
                COUNT(*) AS total,
                COUNT(*) FILTER (
                  WHERE COALESCE(is_paused, FALSE) = FALSE
                    AND COALESCE(is_archived, FALSE) = FALSE
                ) AS watched,
                COUNT(*) FILTER (WHERE COALESCE(is_archived, FALSE)) AS archived,
                MAX(updated_at) AS last_activity
           FROM projects
          -- Корзина в счётчиках колонки 1 не участвует: иначе число проектов
          -- не сойдётся со списком в колонке 2, который их уже не показывает.
          WHERE deleted_at IS NULL
          GROUP BY user_id
       ) p ON p.user_id = u.id
      WHERE u.kind = 'person'
      -- Общий раздел первым, компании по названию — тот же порядок, что на
      -- пульте конвейера. Две страницы про одно и то же не должны читаться
      -- по-разному. Внутри области — как было: сначала включённые.
      ORDER BY u.company_id IS NOT NULL,
               lower(COALESCE(c.title, '')),
               COALESCE(u.automation_enabled, FALSE) DESC,
               COALESCE(p.total, 0) DESC,
               u.email ASC`,
  )
  return result.rows
}

export type PipelineProject = ProjectRecord & {
  /** Гейт владельца — проект не следится, даже если сам не на паузе. */
  ownerAutomationEnabled: boolean
  ownerEmail: string
  /**
   * Сообщения клиента, которых команда ещё не видела.
   *
   * Считается ровно так же, как число на значке раздела «Чаты», — одним
   * выражением из lib/repositories/project-chat.ts: два счётчика по одной
   * переписке обязаны сходиться. Гасит его и ответ (в админке или в YouGile),
   * и просто открытый чат в «Папках».
   */
  unreadCount: number
  /** Скольким людям расшарен проект, не считая владельца. */
  memberCount: number
}

/**
 * Проекты одного пользователя для колонки 2, включая архивные: админ должен
 * видеть их и понимать, что они не обрабатываются.
 *
 * А вот удалённые (`deleted_at`) — не включая. Архив и корзина здесь разные
 * вещи: архивный проект живой, его можно открыть и вернуть в работу, а
 * удалённый уже недоступен всему остальному — `findProjectById` его не отдаёт,
 * и карточка в списке открывалась бы с «Project not found».
 */
export async function listPipelineProjectsByOwner(
  ownerId: string,
): Promise<PipelineProject[]> {
  const result = await query<PipelineProject>(
    `SELECT p.id,
            p.user_id AS "ownerId",
            p.user_id AS "userId",
            COALESCE(p.storage_owner_id, p.user_id) AS "storageOwnerId",
            p.name,
            COALESCE(p.description, '') AS description,
            COALESCE(p.group_name, 'personal') AS "groupName",
            COALESCE(p.is_paused, FALSE) AS "isPaused",
            p.drive_folder_id AS "driveFolderId",
            NOT COALESCE(p.is_paused, FALSE) AS "isActive",
            COALESCE(p.is_archived, FALSE) AS "isArchived",
            p.archived_at AS "archivedAt",
            p.client_id AS "clientId",
            p.created_at AS "createdAt",
            p.updated_at AS "updatedAt",
            p.yougile_chat_id AS "yougileChatId",
            COALESCE(u.automation_enabled, FALSE) AS "ownerAutomationEnabled",
            u.email AS "ownerEmail",
            ${TEAM_UNREAD_COUNT_SQL} AS "unreadCount",
            -- Расшаренность показываем числом, но НЕ раскрываем, кому именно:
            -- проект принадлежит владельцу, а с кем он им делится — не вопрос
            -- конвейера. Владельца из счёта исключаем, чтобы число означало
            -- «скольким расшарили» (см. countProjectMembers).
            COALESCE((
              SELECT COUNT(*)::int
                FROM project_members pm
               WHERE pm.project_id = p.id
                 AND pm.user_id <> p.user_id
            ), 0) AS "memberCount"
       FROM projects p
       JOIN users u ON u.id = p.user_id
      WHERE p.user_id = $1
        AND p.deleted_at IS NULL
      ORDER BY COALESCE(p.is_archived, FALSE),
               p.created_at DESC`,
    [ownerId],
  )
  return result.rows
}

export type WatchedProject = {
  projectId: string
  ownerId: string
  /** Префикс проекта в R2. У переданного проекта не равен `ownerId` — см. ProjectRecord. */
  storageOwnerId: string
  ownerEmail: string
  name: string
  /**
   * Оси тарификации из настройки проекта — запасной путь для графов, в которых
   * свойства ещё нет (lib/billing/pay-unit.ts). Граф главнее, поэтому здесь
   * почти всегда null.
   */
  payBase: string | null
  payMeter: string | null
  /** Ожидаемое количество единиц на элемент, если админ его задал. */
  estimateUnits: number | null
  /**
   * Владелец освобождён от оплаты. Признак у пользователя, а не проверка роли:
   * роль могут выдать тому, кому бесплатная обработка не полагается, а
   * освобождение иногда нужно и не-админу.
   */
  ownerBillingExempt: boolean
  /**
   * Чей кошелёк платит за работу в проекте: плательщик владельца или сам
   * владелец (docs/COMPANY_ACCOUNTS_PLAN.md §7). По нему конвейер читает деньги.
   */
  payerId: string
  /**
   * За владельца платит другой. Нужен для причины остановки: деньги кончились
   * не у него, и «пополните баланс» послало бы его туда, где он бессилен.
   */
  ownerHasPayer: boolean
}

/**
 * Проекты, за которыми конвейер следит прямо сейчас.
 *
 * Четыре условия, и все четыре — решение разных людей: гейт на человеке и гейт
 * на компании ставит админ, паузу пользователь, архив тоже пользователь. Пятое —
 * не решение, а свойство: шаблоны пробного набора исключены всегда. Наличие
 * options.json здесь не проверяется: это поход в объектное хранилище, и сканер
 * делает его сам, уже зная, что по проекту есть новые события.
 *
 * Гейт компании (docs/COMPANY_PIPELINE_PLAN.md §5) — одно условие в этом самом
 * запросе, а не свой курсор скана и не свой фоновый цикл на компанию. Курсор на
 * компанию означал бы N проходов по одному журналу `storage_changes` и N
 * состояний, которые можно рассинхронизировать; цикл на компанию превратил бы
 * один процесс в N. Пропущенное при этом не теряется: его добирает обход
 * каталога (sweep.ts), ровно как при паузе проекта сегодня.
 *
 * Корзина отсекается отдельно от паузы и архива: объекты удалённого проекта
 * лежат в R2 до истечения срока хранения, и без этого условия сканер ещё
 * неделями собирал бы по ним задачи — с оплатой за работу, результат которой
 * владельцу уже негде посмотреть.
 */
export async function listWatchedProjects(): Promise<WatchedProject[]> {
  const result = await query<WatchedProject>(
    `SELECT p.id AS "projectId",
            p.user_id AS "ownerId",
            COALESCE(p.storage_owner_id, p.user_id) AS "storageOwnerId",
            u.email AS "ownerEmail",
            p.name,
            p.pay_base  AS "payBase",
            p.pay_meter AS "payMeter",
            p.estimate_units::float8 AS "estimateUnits",
            COALESCE(u.billing_exempt, FALSE) AS "ownerBillingExempt",
            COALESCE(u.payer_user_id, u.id) AS "payerId",
            (u.payer_user_id IS NOT NULL) AS "ownerHasPayer"
       FROM projects p
       JOIN users u ON u.id = p.user_id
      WHERE u.is_active
        AND COALESCE(u.automation_enabled, FALSE)
        AND p.deleted_at IS NULL
        AND COALESCE(p.is_paused, FALSE) = FALSE
        AND COALESCE(p.is_archived, FALSE) = FALSE
        -- Шаблон пробного набора не обрабатывает сам себя: иначе его _stats
        -- уедут в статистику как чужая работа, а копии пользователей получат
        -- уже наполненный OUT.
        AND COALESCE(p.is_template, FALSE) = FALSE
        -- Гейт компании — рядом с гейтом человека, а не вместо него: работа идёт,
        -- когда открыты оба. Тот же кусок стоит в обходе на постинг, поэтому он
        -- общий: разойтись этим двум условиям нельзя.
        AND ${companyAutomationSql("u")}`,
  )
  return result.rows
}

/**
 * Строка пульта: одна область конвейера — общий раздел или компания.
 *
 * `companyId: null` — общий раздел, то есть все, кто не в компании. Это не
 * «остальные»: до появления компаний так работала вся установка, и строка про
 * неё на пульте первая.
 */
export type PipelineArea = {
  /** NULL — общий раздел. */
  companyId: string | null
  title: string
  /**
   * Слежение по области.
   *
   * У компании — её выключатель (§5). У общего раздела выключателя НЕТ: там
   * гейт стоит на каждом человеке отдельно, и одного ответа «да/нет» на всю
   * область не существует. Поэтому `null`, а не выдуманное `true`: тумблер,
   * показывающий состояние, которого нет, врал бы при первом же взгляде.
   */
  automationEnabled: boolean | null
  /** Людей с открытым гейтом и всего людей — чем живёт строка общего раздела. */
  peopleWatched: number
  peopleTotal: number
  queued: number
  running: number
  /**
   * Ошибки ЗА СУТКИ, а не за всё время.
   *
   * Пожизненный счётчик на пульте бесполезен: он растёт и никогда не убывает,
   * поэтому через месяц красным горят все строки сразу и отличить сегодняшнюю
   * поломку от прошлогодней нельзя. Пульт отвечает на вопрос «что не так
   * СЕЙЧАС».
   */
  failedDay: number
  /** Своих машин у компании. У общего раздела — наших, ничьих. */
  machines: number
  machinesOnline: number
}

/**
 * Все области конвейера одной таблицей — docs/COMPANY_PIPELINE_PLAN.md §6.
 *
 * Смысл страницы в том, чтобы НЕ ходить по компаниям: она отвечает «где что
 * стоит» одним взглядом, а не после обхода десяти консолей.
 *
 * Компании берутся из `companies`, а не из задач: компания без единой задачи
 * обязана быть на пульте строкой с нулями. Появляйся строка от задач, только что
 * заведённая компания выглядела бы как несуществующая — и именно в тот момент,
 * когда за ней надо следить внимательнее всего.
 */
export async function listPipelineAreas(): Promise<PipelineArea[]> {
  const result = await query<PipelineArea>(
    `WITH areas AS (
       SELECT c.id AS company_id, c.title
         FROM companies c
       UNION ALL
       -- Общий раздел: строки в companies у него нет и не будет, поэтому он
       -- приписывается здесь. Названия у него тоже нет — рисует его интерфейс,
       -- на своём языке.
       SELECT NULL, NULL
     ),
     people AS (
       SELECT u.company_id,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE COALESCE(u.automation_enabled, FALSE)
                                 AND u.is_active)::int AS watched
         FROM users u
        -- Служебный кошелёк компании — не человек: он не входит, не работает и
        -- в «людей области» попадать не должен (COMPANY_ACCOUNTS_PLAN §7.3).
        WHERE u.kind = 'person'
        GROUP BY u.company_id
     ),
     work AS (
       SELECT u.company_id,
              COUNT(*) FILTER (WHERE t.status = 'queued')::int AS queued,
              COUNT(*) FILTER (WHERE t.status IN ('claimed', 'running'))::int AS running,
              COUNT(*) FILTER (
                WHERE t.status = 'failed'
                  AND t.updated_at > NOW() - interval '1 day'
              )::int AS failed_day
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         JOIN users u ON u.id = p.user_id
        GROUP BY u.company_id
     ),
     iron AS (
       SELECT rc.company_id,
              COUNT(*)::int AS machines,
              COUNT(*) FILTER (
                WHERE rc.last_heartbeat_at > NOW() - ($1 || ' milliseconds')::interval
              )::int AS online
         FROM remote_computers rc
        WHERE rc.revoked_at IS NULL
        GROUP BY rc.company_id
     )
     SELECT a.company_id AS "companyId",
            a.title,
            -- Тот же кусок, что стоит гейтом в listWatchedProjects: лампочка на
            -- пульте обязана означать ровно то, что делает конвейер. Свой,
            -- «эквивалентный» предикат здесь однажды разошёлся бы с настоящим, и
            -- пульт показывал бы работу там, где её нет.
            CASE
              WHEN a.company_id IS NULL THEN NULL
              ELSE ${companyAutomationSql("a")}
            END AS "automationEnabled",
            COALESCE(pe.watched, 0) AS "peopleWatched",
            COALESCE(pe.total, 0) AS "peopleTotal",
            COALESCE(w.queued, 0) AS "queued",
            COALESCE(w.running, 0) AS "running",
            COALESCE(w.failed_day, 0) AS "failedDay",
            COALESCE(i.machines, 0) AS "machines",
            COALESCE(i.online, 0) AS "machinesOnline"
       FROM areas a
       LEFT JOIN people pe ON pe.company_id IS NOT DISTINCT FROM a.company_id
       LEFT JOIN work   w  ON w.company_id  IS NOT DISTINCT FROM a.company_id
       LEFT JOIN iron   i  ON i.company_id  IS NOT DISTINCT FROM a.company_id
      -- Общий раздел первым, компании по названию: пульт читают сверху вниз, и
      -- порядок строк не должен меняться от того, у кого сегодня больше задач.
      ORDER BY a.company_id IS NOT NULL, a.title`,
    [String(REMOTE_COMPUTER_ONLINE_MS)],
  )
  return result.rows
}
