import { query } from "@/lib/db"
import type { ProjectRecord } from "@/lib/domain-types"
import { TEAM_UNREAD_COUNT_SQL } from "@/lib/repositories/project-chat"

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
}

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
            p.last_activity                 AS "lastActivityAt"
       FROM users u
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
      ORDER BY COALESCE(u.automation_enabled, FALSE) DESC,
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
}

/**
 * Проекты, за которыми конвейер следит прямо сейчас.
 *
 * Три условия, и все три — решение разных людей: гейт ставит админ, паузу
 * пользователь, архив тоже пользователь. Четвёртое — не решение, а свойство:
 * шаблоны пробного набора исключены всегда. Наличие options.json здесь не
 * проверяется: это поход в объектное хранилище, и сканер делает его сам, уже
 * зная, что по проекту есть новые события.
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
            COALESCE(u.billing_exempt, FALSE) AS "ownerBillingExempt"
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
        AND COALESCE(p.is_template, FALSE) = FALSE`,
  )
  return result.rows
}
