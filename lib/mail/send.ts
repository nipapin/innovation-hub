import { Resend } from "resend"
import { getPublicSiteUrl } from "@/lib/public-site-url"
import { monogramFrom, readBranding } from "@/lib/branding"
import { findCompanyById } from "@/lib/repositories/companies"
import { findUserById } from "@/lib/repositories/users"
import {
  INSTALLATION_BRAND,
  companyAddedHtml,
  companyWelcomeWithPasswordHtml,
  passwordResetHtml,
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
    return await mailBrandForCompany(owner.companyId)
  } catch {
    // Оформление письма — не повод не отправить письмо.
    return INSTALLATION_BRAND
  }
}

/**
 * Подпись письма КОМПАНИИ — по ней самой, а не по тому, кто нажал кнопку
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §9.2).
 *
 * В консоль компании заходит и суперадмин сайта, а он в компании не состоит:
 * подпись по его профилю отправила бы приглашение в компанию от имени установки.
 */
export async function mailBrandForCompany(companyId: string): Promise<MailBrand> {
  try {
    const company = await findCompanyById(companyId)
    if (!company) return INSTALLATION_BRAND
    const branding = readBranding(company.branding)
    return {
      name: company.title,
      monogram: branding.monogram ?? monogramFrom(company.title),
    }
  } catch {
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

/**
 * Адрес для писем, на которые отвечать некуда и не нужно.
 *
 * Отдельно от `fromAddress()` по смыслу, а не ради красоты: приглашение и
 * доступ к проекту приходят от человека, и ответ на такое письмо — нормальная
 * реакция, поэтому они уходят с ящика, который кто-то читает. Сброс пароля
 * отвечать не предполагает вовсе, и ответ на него уехал бы в общий ящик с
 * куском переписки о доступе к аккаунту.
 *
 * Падает обратно на `RESEND_FROM`: установка, где второй ящик не заведён,
 * продолжает слать всё с одного адреса, а не спотыкается на пустой переменной.
 */
function noreplyAddress(): string {
  return process.env.RESEND_FROM_NOREPLY?.trim() || fromAddress()
}

export type MailResult =
  | { ok: true; id?: string }
  | { ok: false; error: string }

async function sendMail(input: {
  to: string
  subject: string
  html: string
  text: string
  /** Чем подписан конверт. Пусто — обычный ящик отправки. */
  from?: string
}): Promise<MailResult> {
  const resend = getResend()
  if (!resend) {
    console.warn("[mail] RESEND_API_KEY not set; skipping send to", input.to)
    return { ok: false, error: "Email is not configured." }
  }
  try {
    const result = await resend.emails.send({
      from: input.from ?? fromAddress(),
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
  /**
   * Профиль, на который выдан доступ. Страница проекта по нему сама переключит
   * профиль, если из активного проект не виден
   * (docs/MULTI_COMPANY_PROFILES_PLAN.md §9.3).
   */
  profileId?: string
}): Promise<MailResult> {
  const brand = input.brand ?? INSTALLATION_BRAND
  const site = siteBase()
  const openUrl = input.profileId
    ? `${site}/account/projects/${input.projectId}?profile=${encodeURIComponent(input.profileId)}`
    : `${site}/account/projects/${input.projectId}`
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

/**
 * Ссылка на сброс пароля.
 *
 * Подписано установкой, а не компанией человека: письмо отправляется ДО входа,
 * по одному лишь адресу, и определять компанию здесь значило бы подтверждать
 * незалогиненному отправителю, что такой аккаунт есть и где он состоит.
 */
export async function sendPasswordResetEmail(input: {
  to: string
  userName: string
  token: string
  expiresInMinutes: number
}): Promise<MailResult> {
  const site = siteBase()
  const resetUrl = `${site}/reset-password?token=${encodeURIComponent(input.token)}`
  const brand = INSTALLATION_BRAND
  const subject = `Reset your ${brand.name} password`
  const text = [
    `Hi ${input.userName},`,
    ``,
    `We received a request to reset your password.`,
    ``,
    `Choose a new password: ${resetUrl}`,
    ``,
    `This link works once and expires in ${input.expiresInMinutes} minutes.`,
    `If you didn't request a reset, you can ignore this email.`,
  ].join("\n")
  const html = passwordResetHtml({
    userName: input.userName,
    resetUrl,
    expiresInMinutes: input.expiresInMinutes,
    brand,
  })
  return sendMail({ to: input.to, subject, html, text, from: noreplyAddress() })
}

/**
 * Письмо новому сотруднику компании (план §7).
 *
 * Бренд обязателен, в отличие от проектных писем: человека зовут в конкретную
 * компанию, и подпись установки на этом письме означала бы, что его позвали
 * не туда, куда позвали.
 */
export async function sendCompanyWelcomeEmail(input: {
  to: string
  inviteeName: string
  inviterName: string
  temporaryPassword: string
  brand: MailBrand
  /**
   * Подпрофиль в компании. Вход открывает «Личное», а человека звали в
   * компанию: ссылка после входа сама переключает туда — на страницу профиля,
   * где он и сменит временный пароль (пароль один на все профили).
   */
  profileId?: string
}): Promise<MailResult> {
  const site = siteBase()
  const loginUrl = input.profileId
    ? `${site}/login?${new URLSearchParams({
        next: `/api/auth/switch-profile?${new URLSearchParams({
          to: input.profileId,
          next: "/account/profile",
        }).toString()}`,
      }).toString()}`
    : `${site}/login`
  const subject = `${input.inviterName} invited you to ${input.brand.name}`
  const text = [
    `Hi ${input.inviteeName},`,
    ``,
    `${input.inviterName} added you to ${input.brand.name}.`,
    ``,
    `Sign in: ${loginUrl}`,
    `Email: ${input.to}`,
    `Temporary password: ${input.temporaryPassword}`,
    ``,
    `You will be asked to change this password after sign-in.`,
  ].join("\n")
  const html = companyWelcomeWithPasswordHtml({
    inviteeName: input.inviteeName,
    inviterName: input.inviterName,
    email: input.to,
    temporaryPassword: input.temporaryPassword,
    loginUrl,
    brand: input.brand,
  })
  return sendMail({ to: input.to, subject, html, text })
}

/**
 * Адрес, который открывает страницу в нужном профиле человека
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §9.3).
 *
 * Идёт через роут переключения: куку профиля ставит только он. Без сессии роут
 * сам отправит на вход и вернёт сюда же.
 */
export function profileSwitchUrl(profileId: string, next: string): string {
  const params = new URLSearchParams({ to: profileId, next })
  return `${siteBase()}/api/auth/switch-profile?${params.toString()}`
}

/**
 * Письмо человеку, которого добавили в компанию, когда аккаунт у него уже есть
 * (docs/MULTI_COMPANY_PROFILES_PLAN.md §7.2).
 *
 * Бренд обязателен по той же причине, что у приветствия: человека зовут в
 * конкретную компанию. Кнопка переключает профиль сама — искать компанию в
 * переключателе ему не придётся.
 */
export async function sendCompanyAddedEmail(input: {
  to: string
  inviteeName: string
  inviterName: string
  /** Подпрофиль в этой компании — куда ведёт кнопка. */
  profileId: string
  brand: MailBrand
}): Promise<MailResult> {
  const openUrl = profileSwitchUrl(input.profileId, "/account")
  const subject = `${input.inviterName} added you to ${input.brand.name}`
  const text = [
    `Hi ${input.inviteeName},`,
    ``,
    `${input.inviterName} added you to ${input.brand.name}.`,
    `Sign in as usual — your password stays the same. The company now appears in the workspace switcher at the top of your sidebar.`,
    ``,
    `Open ${input.brand.name}: ${openUrl}`,
  ].join("\n")
  const html = companyAddedHtml({
    inviteeName: input.inviteeName,
    inviterName: input.inviterName,
    openUrl,
    brand: input.brand,
  })
  return sendMail({ to: input.to, subject, html, text })
}
