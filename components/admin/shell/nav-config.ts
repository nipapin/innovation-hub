import {
  Activity,
  BarChart3,
  Coins,
  FileQuestion,
  FolderTree,
  Gift,
  LayoutDashboard,
  LayoutGrid,
  MessagesSquare,
  Monitor,
  Plug,
  ScrollText,
  Send,
  ShieldCheck,
  Ticket,
  ToggleRight,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import type { DictKey } from "@/components/account/i18n"
import {
  hasCapability,
  type AdminCapability,
} from "@/lib/admin-capabilities"
import type { UserRole } from "@/lib/domain-types"

/**
 * НАВИГАЦИЯ АДМИНКИ — ОДИН РЕЕСТР.
 *
 * Здесь два независимых понятия, и путать их нельзя:
 *
 *   `areas`      — ГДЕ инструмент лежит и откуда до него добраться. Их может
 *                  быть несколько: «Люди» ищут и в аналитике (рядом с
 *                  посетителями), и в доступе (там их правами и распоряжаются).
 *   `capability` — КОМУ он доступен. Ровно один тег, включает суперадмин на
 *                  странице прав.
 *
 * Слей их — и перенос инструмента в другой раздел молча менял бы, кто имеет к
 * нему доступ. Разные вопросы, разные поля.
 *
 * Инструмент, до которого нельзя добраться, — плохой инструмент. Чтобы это не
 * оставалось благим пожеланием, реестр проверяется скриптом:
 * `npm run admin:check` падает, если у страницы нет записи здесь, у записи нет
 * области, или её href никуда не ведёт. Добавляя раздел, начинайте с этого
 * файла — иначе сборка вам о нём напомнит.
 */
export type AdminArea =
  | "main"
  | "insights"
  | "billing"
  | "access"
  | "pipeline"
  | "posting"
  | "chats"
  | "workspaces"

export type AdminAreaInfo = {
  key: AdminArea
  labelKey: DictKey
  descriptionKey: DictKey
  /** Хаб области. У `main` им служит сам обзор, у `pipeline` — сам конвейер. */
  href: string
  icon: LucideIcon
}

export const ADMIN_AREAS: AdminAreaInfo[] = [
  {
    // Конвейер первым: это рабочий инструмент на каждый день, а не
    // страница-документ, и открывают его чаще всей остальной админки вместе.
    key: "pipeline",
    labelKey: "adminPipeline",
    descriptionKey: "adminPipelineDesc",
    href: "/admin/pipeline",
    icon: Workflow,
  },
  {
    // Сразу за конвейером: это второй рабочий цикл установки и устроен он так
    // же — пульт, обход папок, очередь. Разница в том, что обработка гоняет
    // файлы по нашим машинам, а постинг публикует их наружу, от имени чужого
    // аккаунта. Поэтому область своя, а не закладка внутри конвейера: у них
    // разные тумблеры пуска, разные очереди и разные права.
    key: "posting",
    labelKey: "adminPosting",
    descriptionKey: "adminPostingDesc",
    href: "/admin/posting",
    icon: Send,
  },
  {
    // Третье ежедневное рабочее место, и стоит оно перед «Папками» намеренно:
    // это единственное место, где ВИДНО, что пришло сообщение. Всё остальное
    // про чат — «открой того человека, потом тот проект», то есть требует
    // заранее знать ответ на вопрос, который и задают.
    //
    // Своя область, а не закладка внутри «Папок»: значок в боковом меню носит
    // число непрочитанных, и прятать его на второй уровень значило бы прятать
    // сам сигнал. Конвейер, постинг и чаты, возможно, сойдутся потом в одну
    // область — это будет перестановка областей, а не переписывание раздела.
    key: "chats",
    labelKey: "adminChats",
    descriptionKey: "adminChatsDesc",
    href: "/admin/chats",
    icon: MessagesSquare,
  },
  {
    // Второй рабочий инструмент на каждый день, рядом с конвейером: там смотрят,
    // как идёт обработка, здесь — чьи это папки. Остальные области — документы,
    // в них заходят по поводу.
    key: "workspaces",
    labelKey: "adminGroupWorkspaces",
    descriptionKey: "adminGroupWorkspacesDesc",
    href: "/admin/workspaces",
    icon: FolderTree,
  },
  {
    key: "main",
    labelKey: "adminGroupMain",
    descriptionKey: "adminGroupMainDesc",
    href: "/admin",
    icon: LayoutDashboard,
  },
  {
    key: "insights",
    labelKey: "adminGroupInsights",
    descriptionKey: "adminGroupInsightsDesc",
    href: "/admin/insights",
    icon: BarChart3,
  },
  {
    key: "billing",
    labelKey: "adminGroupBilling",
    descriptionKey: "adminGroupBillingDesc",
    href: "/admin/billing",
    icon: Coins,
  },
  {
    key: "access",
    labelKey: "adminGroupAccess",
    descriptionKey: "adminGroupAccessDesc",
    href: "/admin/access",
    icon: ShieldCheck,
  },
]

export type AdminTool = {
  key: string
  labelKey: DictKey
  descriptionKey: DictKey
  href: string
  icon: LucideIcon
  /**
   * Где искать инструмент. Первая область — основная: она стоит в крошках и
   * подсвечивается в меню. Остальные — дополнительные входы.
   */
  areas: [AdminArea, ...AdminArea[]]
  capability?: AdminCapability
  /** Совпадение адреса точное — для корневых путей вроде `/admin`. */
  exact?: boolean
  /**
   * Инструмент и есть страница своей области: карточкой на самом себе не
   * рисуется, а в крошках не дублируется.
   *
   * Допустимо только там, где у области нет второго инструмента с ней в
   * основных — иначе список инструментов негде показать, и человек, нажав на
   * область, попадёт в первый попавшийся раздел вместо её главной страницы.
   * Это проверяет `npm run admin:check`.
   */
  isAreaHub?: boolean
}

export const ADMIN_TOOLS: AdminTool[] = [
  {
    key: "overview",
    labelKey: "adminOverview",
    descriptionKey: "adminOverviewDesc",
    href: "/admin/overview",
    icon: LayoutDashboard,
    areas: ["main"],
  },
  {
    key: "content",
    labelKey: "adminContent",
    descriptionKey: "adminContentDesc",
    href: "/admin/content",
    icon: LayoutGrid,
    areas: ["main"],
    capability: "content.manage",
  },
  {
    // Область «Главная»: это распоряжение самой установкой — что на ней вообще
    // показано, — а не инструмент аналитики или доступа.
    key: "features",
    labelKey: "adminFeatures",
    descriptionKey: "adminFeaturesDesc",
    href: "/admin/features",
    icon: ToggleRight,
    areas: ["main"],
    capability: "features.manage",
  },
  {
    key: "visitors",
    labelKey: "adminVisitors",
    descriptionKey: "adminVisitorsDesc",
    href: "/admin/visitors",
    icon: Activity,
    areas: ["insights"],
    capability: "visitors.view",
  },
  {
    key: "statistics",
    labelKey: "adminStatistics",
    descriptionKey: "adminStatsDesc",
    href: "/admin/statistics",
    icon: BarChart3,
    areas: ["insights"],
    capability: "statistics.view",
  },
  {
    // Две области намеренно. Заводят и блокируют людей — это доступ; смотрят,
    // кто вообще есть, — это аналитика рядом с посетителями. Искать будут в
    // обоих местах, и в обоих найдут.
    key: "users",
    labelKey: "adminPeople",
    descriptionKey: "adminPeopleDesc",
    href: "/admin/users",
    icon: Users,
    areas: ["access", "insights"],
    capability: "users.read",
  },
  {
    key: "roles",
    labelKey: "adminRoles",
    descriptionKey: "adminRolesDesc",
    href: "/admin/access/roles",
    icon: ShieldCheck,
    areas: ["access"],
    capability: "users.read",
  },
  {
    // Доступ выдают не только людям, но и машинам — поэтому здесь, а не в
    // конвейере: в конвейере машинами пользуются, а заводят их тут.
    key: "remote-access",
    labelKey: "adminRemoteAccess",
    descriptionKey: "adminRemoteDesc",
    href: "/admin/remote-access",
    icon: Monitor,
    areas: ["access", "pipeline"],
    capability: "pipeline.operate",
  },
  {
    key: "audit",
    labelKey: "adminAudit",
    descriptionKey: "adminAuditDesc",
    href: "/admin/audit",
    icon: ScrollText,
    areas: ["access"],
    capability: "audit.view",
  },
  {
    key: "billing-rates",
    labelKey: "adminBillingRates",
    descriptionKey: "adminBillingRatesDesc",
    href: "/admin/billing/rates",
    icon: Coins,
    areas: ["billing"],
    capability: "billing.manage",
  },
  {
    key: "billing-trial",
    labelKey: "adminBillingTrial",
    descriptionKey: "adminBillingTrialDesc",
    href: "/admin/billing/trial",
    icon: Gift,
    areas: ["billing"],
    capability: "billing.trial",
  },
  {
    key: "billing-promo",
    labelKey: "adminBillingPromo",
    descriptionKey: "adminBillingPromoDesc",
    href: "/admin/billing/promo",
    icon: Ticket,
    areas: ["billing"],
    capability: "billing.promo",
  },
  {
    // Две области намеренно. Незаполненная единица — это и деньги (нечем
    // тарифицировать), и конвейер (после включения гейта такой проект встанет).
    // Искать будут в обоих местах.
    key: "billing-unpriced",
    labelKey: "adminBillingUnpriced",
    descriptionKey: "adminBillingUnpricedDesc",
    href: "/admin/billing/unpriced",
    icon: FileQuestion,
    areas: ["billing", "pipeline"],
    capability: "billing.manage",
  },
  {
    // Две области, как у «Проектов без единицы», и по той же причине: сервис —
    // это и деньги (из него складывается себестоимость обработки), и конвейер
    // (без ключа машина не сделает шаг). Искать будут в обеих.
    key: "services",
    labelKey: "adminServices",
    descriptionKey: "adminServicesDesc",
    href: "/admin/services",
    icon: Plug,
    areas: ["billing", "pipeline"],
    capability: "services.manage",
  },
  {
    key: "pipeline",
    labelKey: "adminPipeline",
    descriptionKey: "adminPipelineDesc",
    href: "/admin/pipeline",
    icon: Workflow,
    // Обработка и постинг — два рабочих цикла ОДНОЙ области: обе следят за
    // папками, обе держат очередь, обе включаются пультом. Поэтому каждый
    // виден в колонке инструментов у обоих, и переключаться между ними можно
    // одним кликом, не возвращаясь в меню.
    //
    // Областей при этом ДВЕ, а не одна: у каждой свой значок в боковом меню —
    // это разные ежедневные рабочие места, и открывают их напрямую.
    areas: ["pipeline", "posting"],
    capability: "pipeline.operate",
    isAreaHub: true,
  },
  {
    key: "posting",
    labelKey: "adminPosting",
    descriptionKey: "adminPostingDesc",
    href: "/admin/posting",
    icon: Send,
    // См. соседа выше: те же две области, зеркально.
    areas: ["posting", "pipeline"],
    capability: "posting.operate",
    isAreaHub: true,
  },
  {
    // Область одна, в отличие от соседей. Вторым входом напрашивались «Папки»,
    // но у них своя страница занимает всю ширину и колонки инструментов на ней
    // нет — запись там была бы обещанием входа, которого не существует. Связь
    // между инструментами живёт не в меню, а в самой работе: почта владельца в
    // шапке «Чатов» ведёт на его папки.
    key: "chats",
    labelKey: "adminChats",
    descriptionKey: "adminChatsDesc",
    href: "/admin/chats",
    icon: MessagesSquare,
    areas: ["chats"],
    // Тот же тег, что у «Папок»: чат проекта — часть работы с чужим проектом,
    // и ступень здесь первая. Отвечать клиенту можно, не имея права
    // распоряжаться его проектами.
    capability: "projects.access",
    isAreaHub: true,
  },
  {
    // Две области намеренно. Своя — потому что это рабочее место, а не справка;
    // «Доступ» — потому что «чей это проект и кому он открыт» ищут там, рядом с
    // людьми и их правами.
    //
    // Тег — `projects.access`, ступень 1: страница открыта и тому, кто только
    // помогает с файлами. Распоряжение проектом (создать, удалить, передать,
    // расшарить) гасится внутри по `projects.manage`, как «Завести человека» на
    // странице людей. Разбор — docs/ADMIN_WORKSPACE_PLAN.md §3.
    key: "workspaces",
    labelKey: "adminWorkspaces",
    descriptionKey: "adminWorkspacesDesc",
    href: "/admin/workspaces",
    icon: FolderTree,
    areas: ["workspaces", "access"],
    capability: "projects.access",
    isAreaHub: true,
  },
]

export function isToolActive(tool: AdminTool, pathname: string) {
  if (tool.exact) return pathname === tool.href
  return pathname === tool.href || pathname.startsWith(`${tool.href}/`)
}

/**
 * `disabled` — адреса разделов, погашенных на установке (lib/features.ts).
 *
 * Отдельный список, а не ещё одно поле у инструмента: права отвечают на вопрос
 * «кому можно», выключатель — «есть ли это здесь вообще». Сложи их в одно поле,
 * и «раздела нет на этой площадке» стало бы неотличимо от «вам сюда нельзя».
 */
export function canSeeTool(
  tool: AdminTool,
  role: UserRole,
  capabilities: readonly AdminCapability[],
  disabled: readonly string[] = [],
): boolean {
  if (disabled.includes(tool.href)) return false
  return !tool.capability || hasCapability(role, capabilities, tool.capability)
}

/**
 * Инструменты области, доступные этому человеку.
 *
 * Недоступное не рисуется вовсе, а не гаснет с замком: серый пункт сообщает
 * «тебе сюда нельзя, но оно есть», и дальше человек идёт спрашивать. Скрытый
 * честнее — для него этого раздела просто нет. Защитой это не является:
 * настоящий отказ даёт `requireCapabilityPage` и гвард API.
 */
export function toolsInArea(
  area: AdminArea,
  role: UserRole,
  capabilities: readonly AdminCapability[],
  disabled: readonly string[] = [],
): AdminTool[] {
  return ADMIN_TOOLS.filter(
    (tool) =>
      tool.areas.includes(area) &&
      canSeeTool(tool, role, capabilities, disabled),
  )
}

/** Область видна, пока в ней остаётся хоть один доступный инструмент. */
export function visibleAreas(
  role: UserRole,
  capabilities: readonly AdminCapability[],
  disabled: readonly string[] = [],
): AdminAreaInfo[] {
  return ADMIN_AREAS.filter(
    (area) => toolsInArea(area.key, role, capabilities, disabled).length > 0,
  )
}

/**
 * Куда ведёт кнопка области в боковом меню.
 *
 * Обычно на её хаб. Но у «Конвейера» и «Автопостинга» хаб — это САМ инструмент,
 * закрытый своим тегом, а видимость области считается по любому доступному
 * инструменту внутри. Человеку с одним лишь `posting.operate` кнопка
 * «Конвейер» вела бы прямо в отказ: область он видит (в ней лежит доступный ему
 * автопостинг), а её хаб ему закрыт.
 *
 * Поэтому: хаб доступен — ведём на него; хаб закрыт — на первый доступный
 * инструмент области. Областей без инструмента-хаба (главная, доступ, деньги)
 * правило не касается: у них хаб — обычная страница со списком карточек,
 * которая сама показывает только разрешённое.
 */
export function areaHref(
  area: AdminAreaInfo,
  role: UserRole,
  capabilities: readonly AdminCapability[],
  disabled: readonly string[] = [],
): string {
  const hubTool = ADMIN_TOOLS.find(
    (tool) => tool.isAreaHub && tool.areas[0] === area.key,
  )
  if (!hubTool) return area.href

  const tools = toolsInArea(area.key, role, capabilities, disabled)
  if (tools.some((tool) => tool.href === hubTool.href)) return area.href
  return tools[0]?.href ?? area.href
}

export function isAreaActive(area: AdminAreaInfo, pathname: string) {
  if (pathname === area.href) return true
  if (area.href !== "/admin" && pathname.startsWith(`${area.href}/`)) return true
  return ADMIN_TOOLS.some(
    (tool) => tool.areas[0] === area.key && isToolActive(tool, pathname),
  )
}

export function findTool(pathname: string): AdminTool | undefined {
  // Сначала точные совпадения: `/admin` не должен перебивать `/admin/content`.
  return (
    ADMIN_TOOLS.find((tool) => tool.href === pathname) ??
    ADMIN_TOOLS.find((tool) => isToolActive(tool, pathname))
  )
}

export function findArea(key: string): AdminAreaInfo | undefined {
  return ADMIN_AREAS.find((area) => area.key === key)
}
