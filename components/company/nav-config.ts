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
import type { CompanyRole } from "@/lib/domain-types"

/**
 * Разделы консоли компании — docs/COMPANY_ACCOUNTS_PLAN.md §6.4.
 *
 * Плоский список, без областей: разделов шесть, и уровень группировки здесь был
 * бы лишним этажом. Наша админка разложена по областям потому, что инструментов
 * там девятнадцать.
 *
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
  capability: CompanyCapability | null
  exact?: boolean
}

export const COMPANY_TOOLS: CompanyTool[] = [
  {
    key: "people",
    labelKey: "coPeople",
    descriptionKey: "coPeopleDesc",
    href: "/company/people",
    icon: Users,
    capability: "people.manage",
  },
  {
    key: "roles",
    labelKey: "coRoles",
    descriptionKey: "coRolesDesc",
    href: "/company/roles",
    icon: ShieldCheck,
    capability: "roles.manage",
  },
  {
    key: "wallet",
    labelKey: "coWallet",
    descriptionKey: "coWalletDesc",
    href: "/company/wallet",
    icon: Wallet,
    capability: "wallet.manage",
  },
  {
    key: "statistics",
    labelKey: "coStatistics",
    descriptionKey: "coStatisticsDesc",
    href: "/company/statistics",
    icon: BarChart3,
    capability: "statistics.view",
  },
  {
    key: "machines",
    labelKey: "coMachines",
    descriptionKey: "coMachinesDesc",
    href: "/company/machines",
    icon: Monitor,
    capability: "machines.manage",
  },
  {
    key: "keys",
    labelKey: "coKeys",
    descriptionKey: "coKeysDesc",
    href: "/company/keys",
    icon: KeyRound,
    capability: "keys.manage",
  },
  {
    key: "audit",
    labelKey: "coAudit",
    descriptionKey: "coAuditDesc",
    href: "/company/audit",
    icon: ScrollText,
    capability: null,
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
): CompanyTool[] {
  return COMPANY_TOOLS.filter(
    (tool) =>
      tool.capability === null ||
      hasCompanyCapability(role, capabilities, tool.capability),
  )
}

export function isCompanyToolActive(tool: CompanyTool, pathname: string): boolean {
  if (tool.exact) return pathname === tool.href
  return pathname === tool.href || pathname.startsWith(`${tool.href}/`)
}
