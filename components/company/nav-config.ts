import {
  BarChart3,
  Monitor,
  KeyRound,
  ScrollText,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import type { DictKey } from "@/components/account/i18n"
import {
  hasCompanyCapability,
  type CompanyCapability,
} from "@/lib/company-capabilities"
import { setAllows } from "@/lib/company-features"
import type { CompanyRole } from "@/lib/domain-types"

/**
 * Разделы консоли компании — docs/COMPANY_ACCOUNTS_PLAN.md §6.4.
 *
 * Устроено так же, как реестр админки (components/admin/shell/nav-config.ts), и
 * по той же причине: два независимых понятия, которые нельзя путать.
 *
 *   `areas`      — ГДЕ раздел лежит и откуда до него добраться. Их может быть
 *                  несколько: журнал ищут и в статистике (это цифры о работе
 *                  компании), и в доступах (это проверка того, кто чем
 *                  распорядился).
 *   `capability` — КОМУ он доступен. Ровно один тег, у журнала — `null`.
 *
 * Слей их — и перенос раздела в другую область молча менял бы, кто имеет к нему
 * доступ.
 *
 * ПОЧЕМУ ОБЛАСТИ ПОЯВИЛИСЬ. Раньше список был плоским, и вся консоль висела в
 * боковом меню одним пунктом «Компания» — то есть владелец компании видел у себя
 * ровно один вход туда, где у нас на основном сайте развёрнутое меню. Уровень
 * областей возвращает консоли ту же форму: в меню — области, во второй колонке —
 * разделы той области, где человек сейчас находится.
 */
export type CompanyArea = "statistics" | "people" | "access" | "wallet"

export type CompanyAreaInfo = {
  key: CompanyArea
  labelKey: DictKey
  descriptionKey: DictKey
  /**
   * Куда ведёт область, когда доступны все её разделы. Настоящий адрес считает
   * `companyAreaHref`: у компании нет страниц-хабов со списком карточек, как в
   * админке, поэтому область всегда открывает свой первый ДОСТУПНЫЙ раздел.
   * Иначе «Доступы» вели бы в ключи сервисов человеку, у которого есть только
   * машины, — то есть прямо в отказ.
   */
  href: string
  icon: LucideIcon
}

export const COMPANY_AREAS: CompanyAreaInfo[] = [
  {
    key: "statistics",
    labelKey: "coAreaStatistics",
    descriptionKey: "coAreaStatisticsDesc",
    href: "/company/statistics",
    icon: BarChart3,
  },
  {
    key: "people",
    labelKey: "coAreaPeople",
    descriptionKey: "coAreaPeopleDesc",
    href: "/company/people",
    icon: Users,
  },
  {
    key: "access",
    labelKey: "coAreaAccess",
    descriptionKey: "coAreaAccessDesc",
    href: "/company/keys",
    icon: ShieldCheck,
  },
  {
    // Последней и отдельно: кошелёк — это не распоряжение компанией, а её
    // деньги, и включают его не всем. Пустая область не рисуется сама собой —
    // `visibleCompanyAreas` считает видимость по разделам внутри, а раздел
    // «Кошелёк» закрыт и тегом, и проданным набором.
    key: "wallet",
    labelKey: "coAreaWallet",
    descriptionKey: "coAreaWalletDesc",
    href: "/company/wallet",
    icon: Wallet,
  },
]

/**
 * `capability: null` — журнал: он виден всем админам компании (§6.4). Это не
 * «доступно всем» по умолчанию, а названное решение: запреты без журнала
 * бессмысленны наполовину, и прятать его от того, кого им же и проверяют,
 * значило бы оставить компанию без единственного способа разобраться.
 */
export type CompanyTool = {
  key: string
  labelKey: DictKey
  descriptionKey: DictKey
  href: string
  icon: LucideIcon
  /**
   * Где искать раздел. Первая область — основная: по ней раздел подсвечивает
   * меню. Остальные — дополнительные входы.
   */
  areas: [CompanyArea, ...CompanyArea[]]
  capability: CompanyCapability | null
  exact?: boolean
}

export const COMPANY_TOOLS: CompanyTool[] = [
  {
    key: "statistics",
    labelKey: "coStatistics",
    descriptionKey: "coStatisticsDesc",
    href: "/company/statistics",
    icon: BarChart3,
    areas: ["statistics"],
    capability: "statistics.view",
  },
  {
    // Две области намеренно. Основная — статистика: чаще всего журнал открывают,
    // чтобы понять, почему цифры такие. Вторая — доступы: там раздают права, и
    // проверять, чем распорядились, идут туда же.
    key: "audit",
    labelKey: "coAudit",
    descriptionKey: "coAuditDesc",
    href: "/company/audit",
    icon: ScrollText,
    areas: ["statistics", "access"],
    capability: null,
  },
  {
    key: "people",
    labelKey: "coPeople",
    descriptionKey: "coPeopleDesc",
    href: "/company/people",
    icon: Users,
    areas: ["people"],
    capability: "people.manage",
  },
  {
    // Права — в «Доступах», а не рядом с людьми: «Персонал» отвечает на вопрос
    // «кто у нас работает», а раздача прав — это распоряжение доступом, того же
    // порядка, что ключи и машины рядом.
    key: "roles",
    labelKey: "coRoles",
    descriptionKey: "coRolesDesc",
    href: "/company/roles",
    icon: ShieldCheck,
    areas: ["access"],
    capability: "roles.manage",
  },
  {
    key: "keys",
    labelKey: "coKeys",
    descriptionKey: "coKeysDesc",
    href: "/company/keys",
    icon: KeyRound,
    areas: ["access"],
    capability: "keys.manage",
  },
  {
    // Доступ выдают не только людям, но и машинам — поэтому здесь: обработкой
    // машины пользуются, а заводят их тут.
    key: "machines",
    labelKey: "coMachines",
    descriptionKey: "coMachinesDesc",
    href: "/company/machines",
    icon: Monitor,
    areas: ["access"],
    capability: "machines.manage",
  },
  {
    key: "wallet",
    labelKey: "coWallet",
    descriptionKey: "coWalletDesc",
    href: "/company/wallet",
    icon: Wallet,
    areas: ["wallet"],
    capability: "wallet.manage",
  },
]

/**
 * Что видно этому человеку.
 *
 * Недоступное не рисуется вовсе, а не гаснет с замком — как и в нашей админке.
 * Защитой это не является: настоящий отказ даёт гейт (lib/company-auth.ts).
 */
export function visibleCompanyTools(
  role: CompanyRole,
  capabilities: readonly CompanyCapability[],
  /**
   * Набор разделов, проданный компании (COMPANY_SETUP_PANEL_PLAN §2). `null` —
   * набор не задан, видно всё, что открывают теги. Вторая ось поверх первой:
   * тег отвечает «кому внутри компании», набор — «что этой компании продано».
   */
  sections: string[] | null = null,
): CompanyTool[] {
  return COMPANY_TOOLS.filter(
    (tool) =>
      setAllows(sections, tool.key) &&
      (tool.capability === null ||
        hasCompanyCapability(role, capabilities, tool.capability)),
  )
}

/** Разделы области, доступные этому человеку. */
export function companyToolsInArea(
  area: CompanyArea,
  role: CompanyRole,
  capabilities: readonly CompanyCapability[],
  sections: string[] | null = null,
): CompanyTool[] {
  return visibleCompanyTools(role, capabilities, sections).filter((tool) =>
    tool.areas.includes(area),
  )
}

/** Область видна, пока в ней остаётся хоть один доступный раздел. */
export function visibleCompanyAreas(
  role: CompanyRole,
  capabilities: readonly CompanyCapability[],
  sections: string[] | null = null,
): CompanyAreaInfo[] {
  return COMPANY_AREAS.filter(
    (area) => companyToolsInArea(area.key, role, capabilities, sections).length > 0,
  )
}

/**
 * Куда ведёт кнопка области.
 *
 * Всегда на первый ДОСТУПНЫЙ раздел внутри, а не на объявленный `href`: областей
 * со своей страницей-хабом у компании нет, и человеку, которому из «Доступов»
 * открыты одни машины, кнопка вела бы в ключи сервисов — то есть в редирект из
 * `requireCompanyPage`.
 */
export function companyAreaHref(
  area: CompanyAreaInfo,
  role: CompanyRole,
  capabilities: readonly CompanyCapability[],
  sections: string[] | null = null,
): string {
  const tools = companyToolsInArea(area.key, role, capabilities, sections)
  return tools[0]?.href ?? area.href
}

export function isCompanyToolActive(tool: CompanyTool, pathname: string): boolean {
  if (tool.exact) return pathname === tool.href
  return pathname === tool.href || pathname.startsWith(`${tool.href}/`)
}

/**
 * Область, в которой человек сейчас находится. Считается по ОСНОВНОЙ области
 * открытого раздела: журнал лежит в двух, но подсвечивать обе значило бы
 * сообщать, что он в двух местах сразу.
 */
export function findCompanyArea(pathname: string): CompanyAreaInfo | undefined {
  const tool =
    COMPANY_TOOLS.find((item) => item.href === pathname) ??
    COMPANY_TOOLS.find((item) => isCompanyToolActive(item, pathname))
  if (!tool) return undefined
  return COMPANY_AREAS.find((area) => area.key === tool.areas[0])
}

export function isCompanyAreaActive(
  area: CompanyAreaInfo,
  pathname: string,
): boolean {
  return findCompanyArea(pathname)?.key === area.key
}
