import { SITE_NAME, SITE_MONOGRAM } from "@/lib/site"

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export { escapeHtml }

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export type ShareRole = "viewer" | "editor" | "full"

function roleCopy(role: ShareRole): { label: string; hint: string } {
  if (role === "full") {
    return {
      label: "Full access",
      hint: "You can open and change this project, share it with other people, and move it to the archive.",
    }
  }
  if (role === "editor") {
    return {
      label: "Editor",
      hint: "You can open this project, view files, and make changes.",
    }
  }
  return {
    label: "Viewer",
    hint: "You can open this project and view its files.",
  }
}

/** Экспортируется для писем: label и hint там нужны и в тексте, и в бейдже. */
export { roleCopy as shareRoleCopy }

function wrapEmail(inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${SITE_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:#0b0f17;padding:22px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background:#1a2433;border-radius:9px;color:#8ec8ff;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.4px;">${SITE_MONOGRAM}</td>
                  <td style="padding-left:12px;color:#e8eef6;font-family:${FONT};font-size:16px;font-weight:600;letter-spacing:-0.2px;">${SITE_NAME}</td>
                </tr>
              </table>
            </td>
          </tr>
          ${inner}
          <tr>
            <td style="padding:0 32px 28px;font-family:${FONT};font-size:12px;line-height:18px;color:#8b93a7;">
              You’re receiving this because someone shared a project with you on ${SITE_NAME}.
              If you weren’t expecting this, you can ignore the email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function ctaButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
    <tr>
      <td align="center" style="background:#2176f3;border-radius:10px;">
        <a href="${href}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-family:${FONT};font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`
}

function roleBadge(role: ShareRole): string {
  const { label, hint } = roleCopy(role)
  const bg = role === "full" ? "#fef4e6" : role === "editor" ? "#ecfdf3" : "#eef4ff"
  const fg = role === "full" ? "#9a5b00" : role === "editor" ? "#137333" : "#1a56db"
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;background:${bg};border-radius:12px;">
    <tr>
      <td style="padding:14px 16px;">
        <div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${fg};">${escapeHtml(label)}</div>
        <div style="margin-top:4px;font-family:${FONT};font-size:13px;line-height:19px;color:#334155;">${escapeHtml(hint)}</div>
      </td>
    </tr>
  </table>`
}

export function projectAccessGrantedHtml(input: {
  inviteeName: string
  projectName: string
  role: ShareRole
  inviterName: string
  openUrl: string
}): string {
  const inner = `<tr>
    <td style="padding:32px 32px 8px;font-family:${FONT};color:#0f172a;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;color:#64748b;">Project shared with you</p>
      <h1 style="margin:0 0 20px;font-size:24px;line-height:30px;font-weight:700;letter-spacing:-0.4px;">${escapeHtml(input.projectName)}</h1>
      <p style="margin:0;font-size:16px;line-height:24px;color:#334155;">Hi ${escapeHtml(input.inviteeName)},</p>
      <p style="margin:12px 0 0;font-size:16px;line-height:24px;color:#334155;"><strong style="color:#0f172a;">${escapeHtml(input.inviterName)}</strong> shared this project with you.</p>
      ${roleBadge(input.role)}
      ${ctaButton(input.openUrl, "Open project")}
    </td>
  </tr>`
  return wrapEmail(inner)
}

export function projectInviteWithPasswordHtml(input: {
  inviteeName: string
  projectName: string
  role: ShareRole
  inviterName: string
  email: string
  temporaryPassword: string
  loginUrl: string
}): string {
  const inner = `<tr>
    <td style="padding:32px 32px 8px;font-family:${FONT};color:#0f172a;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;color:#64748b;">You’re invited</p>
      <h1 style="margin:0 0 20px;font-size:24px;line-height:30px;font-weight:700;letter-spacing:-0.4px;">${escapeHtml(input.projectName)}</h1>
      <p style="margin:0;font-size:16px;line-height:24px;color:#334155;">Hi ${escapeHtml(input.inviteeName)},</p>
      <p style="margin:12px 0 0;font-size:16px;line-height:24px;color:#334155;"><strong style="color:#0f172a;">${escapeHtml(input.inviterName)}</strong> invited you to ${SITE_NAME} and shared this project.</p>
      ${roleBadge(input.role)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 4px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
        <tr>
          <td style="padding:16px;">
            <div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#64748b;">Sign-in details</div>
            <p style="margin:10px 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:#334155;">Email<br/><strong style="color:#0f172a;">${escapeHtml(input.email)}</strong></p>
            <p style="margin:12px 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:#334155;">Temporary password<br/><code style="display:inline-block;margin-top:4px;padding:6px 10px;background:#0b0f17;color:#e8eef6;border-radius:8px;font-size:14px;letter-spacing:0.3px;">${escapeHtml(input.temporaryPassword)}</code></p>
            <p style="margin:12px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:#64748b;">You’ll be asked to change this password after sign-in.</p>
          </td>
        </tr>
      </table>
      ${ctaButton(input.loginUrl, `Sign in to ${SITE_NAME}`)}
    </td>
  </tr>`
  return wrapEmail(inner)
}
