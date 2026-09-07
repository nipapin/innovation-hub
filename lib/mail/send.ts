import { SITE_NAME } from "@/lib/site"
import { Resend } from "resend"
import { getPublicSiteUrl } from "@/lib/public-site-url"
import {
  projectAccessGrantedHtml,
  projectInviteWithPasswordHtml,
  shareRoleCopy,
  type ShareRole,
} from "@/lib/mail/templates"

function siteBase(): string {
  return getPublicSiteUrl() ?? "https://ffworks.pro"
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
}): Promise<MailResult> {
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
}): Promise<MailResult> {
  const site = siteBase()
  const loginUrl = `${site}/login`
  const role = shareRoleCopy(input.role)
  const subject = `${input.inviterName} invited you to “${input.projectName}”`
  const text = [
    `Hi ${input.inviteeName},`,
    ``,
    `${input.inviterName} invited you to ${SITE_NAME} and shared “${input.projectName}” as ${role.label}.`,
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
  })
  return sendMail({ to: input.to, subject, html, text })
}
