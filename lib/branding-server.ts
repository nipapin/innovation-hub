import { cache } from "react"
import { cookies, headers } from "next/headers"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import {
  DEFAULT_ACCENT,
  monogramFrom,
  readBranding,
  type AccentValue,
} from "@/lib/branding"
import { SITE_MONOGRAM, SITE_NAME } from "@/lib/site"
import { findCompanyByDomain, findCompanyById } from "@/lib/repositories/companies"
import { findUserById } from "@/lib/repositories/users"

/** Что показывать в шапках и каким акцентом красить. */
export type ResolvedBranding = {
  name: string
  monogram: string
  accent: AccentValue
  logoUrl: string | null
  /** NULL — установка, а не компания. Нужно, чтобы не красить лишнего. */
  companyId: string | null
}

const INSTALLATION: ResolvedBranding = {
  name: SITE_NAME,
  monogram: SITE_MONOGRAM,
  accent: DEFAULT_ACCENT,
  logoUrl: null,
  companyId: null,
}

/**
 * Оформление для этого запроса — docs/THEMING_PLAN.md §6.4.
 *
 * Порядок намеренно такой:
 *
 *   1. компания вошедшего — после входа человек видит СВОЁ, а не то, по какому
 *      адресу он пришёл;
 *   2. компания домена — это про страницу входа, где вошедшего ещё нет;
 *   3. установка.
 *
 * Обёрнуто в `React.cache`: layout и метаданные спрашивают порознь, а платим за
 * рендер один раз.
 *
 * Ошибки базы гасятся: оформление — не то, ради чего стоит ронять страницу. Без
 * компаний в базе (миграция не применена) сайт просто выглядит как своя
 * установка, чем он и был до них.
 */
export const resolveBranding = cache(async (): Promise<ResolvedBranding> => {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value

    if (token) {
      const session = await verifySessionToken(token)
      if (session?.userId) {
        const user = await findUserById(session.userId)
        if (user?.companyId) {
          const company = await findCompanyById(user.companyId)
          if (company) return fromCompany(company)
        }
        // Вошёл, компании нет — установка. По домену НЕ резолвим: человек из
        // общего раздела, открывший адрес компании, увидел бы чужой бренд над
        // своими проектами.
        return INSTALLATION
      }
    }

    const host = (await headers()).get("host")?.split(":")[0]?.toLowerCase()
    if (host) {
      const company = await findCompanyByDomain(host)
      if (company) return fromCompany(company)
    }
  } catch {
    // Не нашли — значит установка.
  }
  return INSTALLATION
})

function fromCompany(company: {
  id: string
  title: string
  branding: Record<string, unknown>
}): ResolvedBranding {
  const branding = readBranding(company.branding)
  return {
    name: company.title,
    monogram: branding.monogram ?? monogramFrom(company.title),
    accent: branding.accent,
    logoUrl: branding.logoUrl,
    companyId: company.id,
  }
}
