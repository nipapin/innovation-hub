import { Resend } from "resend"
import { getPublicSiteUrl } from "@/lib/public-site-url"
import { monogramFrom, readBranding } from "@/lib/branding"
import { findCompanyById } from "@/lib/repositories/companies"
import { findUserById } from "@/lib/repositories/users"
import {
  INSTALLATION_BRAND,
  projectAccessGrantedHtml,
  projectInviteWithPasswordHtml,
  shareRoleCopy,
  type MailBrand,
  type ShareRole,
} from "@/lib/mail/templates"

function siteBase(): string {
  return getPublicSiteUrl() ?? "https://ffworks.pro"
}

/**
 * Чьим именем подписывать письмо о проекте — компанией его ВЛАДЕЛЬЦА.
 *
 * Не приглашающего: звать может админ сайта по тегу, и тогда письмо ушло бы за
 * нашей подписью в чужое рабочее место. Не приглашаемого: он может быть из
 * другой компании или вовсе с улицы, и подпись его собственной площадкой ничего
 * ему не объясняет.
 *
 * Живёт здесь, а не в `lib/branding-server.ts`: там резолвер про ТЕКУЩИЙ запрос
 * (кто смотрит), а тут про конкретного человека, и сессии при отправке письма
 * может не быть вовсе — например, из фоновой задачи.
 */
export async function mailBrandForOwner(ownerId: string): Promise<MailBrand> {
  try {
    const owner = await findUserById(ownerId)
    if (!owner?.companyId) return INSTALLATION_BRAND
    const company = await findCompanyById(owner.companyId)
    if (!company) return INSTALLATION_BRAND
    const branding = readBranding(company.branding)
    return {
      name: company.title,
      monogram: branding.monogram ?? monogramFrom(company.title),
    }
  } catch {
    // Оформление письма — не повод не отправить письмо.
    return INSTALLATION_BRAND
  }
}

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) return null
  return new Resend(key)
}

function fromAddress(): string {
  return (
    process.env.RESEND_FROM?.trim() ||
    "InnoHub <onboarding@resend.dev>"
  )
}

export type MailResult =
  | { ok: true; id?: string }
  | { ok: false; error: string }

async function sendMail(input: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<MailResult> {
  const resend = getResend()
  if (!resend) {
    console.warn("[mail] RESEND_API_KEY not set; skipping send to", input.to)
    return { ok: false, error: "Email is not configured." }
  }
  try {
    const result = await resend.emails.send({
      from: fromAddress(),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    })
    if (result.error) {
      console.error("[mail] send failed", result.error)
      return { ok: false, error: result.error.message }
    }
    return { ok: true, id: result.data?.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Send failed."
    console.error("[mail] send failed", error)
    return { ok: false, error: message }
  }
}

export async function sendProjectAccessGrantedEmail(input: {
  to: string
  inviteeName: string
  projectName: string
  projectId: string
  role: ShareRole
  inviterName: string
  /** Чьим именем подписано письмо. Пусто — установка. */
  brand?: MailBrand
}): Promise<MailResult> {
  const brand = input.brand ?? INSTALLATION_BRAND
  const site = siteBase()
  const openUrl = `${site}/account/projects/${input.projectId}`
  const role = shareRoleCopy(input.role)
  const subject = `${input.inviterName} shared “${input.projectName}” with you`
  const text = [
    `Hi ${input.inviteeName},`,
    ``,
    `${input.inviterName} shared the project “${input.projectName}” with you as ${role.label}.`,
    role.hint,
    ``,
    `Open the project: ${openUrl}`,
  ].join("\n")
  const html = projectAccessGrantedHtml({
    inviteeName: input.inviteeName,
    projectName: input.projectName,
    role: input.role,
    inviterName: input.inviterName,
    openUrl,
    brand,
  })
  return sendMail({ to: input.to, subject, html, text })
}

export async function sendProjectInviteWithPasswordEmail(input: {
  to: string
  inviteeName: string
  projectName: string
  role: ShareRole
  inviterName: string
  temporaryPassword: string
  /** Чьим именем подписано письмо. Пусто — установка. */
  brand?: MailBrand
}): Promise<MailResult> {
  const brand = input.brand ?? INSTALLATION_BRAND
  const site = siteBase()
  const loginUrl = `${site}/login`
  const role = shareRoleCopy(input.role)
  const subject = `${input.inviterName} invited you to “${input.projectName}”`
  const text = [
    `Hi ${input.inviteeName},`,
    ``,
    `${input.inviterName} invited you to ${brand.name} and shared “${input.projectName}” as ${role.label}.`,
    role.hint,
    ``,
    `Sign in: ${loginUrl}`,
    `Email: ${input.to}`,
    `Temporary password: ${input.temporaryPassword}`,
    ``,
    `You will be asked to change this password after sign-in.`,
  ].join("\n")
  const html = projectInviteWithPasswordHtml({
    inviteeName: input.inviteeName,
    projectName: input.projectName,
    role: input.role,
    inviterName: input.inviterName,
    email: input.to,
    temporaryPassword: input.temporaryPassword,
    loginUrl,
    brand,
  })
  return sendMail({ to: input.to, subject, html, text })
}
