/**
 * Кто правит страничку на kotliar.ffworks.pro/edit.
 * Публичный сайт эту проверку не использует.
 */

export function kotliarSiteOwnerId(): string | null {
  const id = process.env.KOTLIAR_SITE_OWNER_ID?.trim()
  return id || null
}

export function kotliarSiteOwnerEmail(): string | null {
  const email = process.env.KOTLIAR_SITE_OWNER_EMAIL?.trim().toLowerCase()
  return email || null
}

export function isKotliarSiteOwner(user: {
  id: string
  email: string
  loginUserId?: string | null
}): boolean {
  const ownerId = kotliarSiteOwnerId()
  if (
    ownerId &&
    (user.id === ownerId || user.loginUserId === ownerId)
  ) {
    return true
  }
  const ownerEmail = kotliarSiteOwnerEmail()
  if (ownerEmail && user.email.trim().toLowerCase() === ownerEmail) {
    return true
  }
  return false
}

export function kotliarPublicOrigin(): string {
  const raw = process.env.KOTLIAR_SITE_PUBLIC_URL?.trim().replace(/\/+$/, "")
  if (raw) return raw
  return "https://kotliar.ffworks.pro"
}

export function kotliarPagePublicPath(slug: string): string {
  return slug ? `/${slug}` : "/"
}
