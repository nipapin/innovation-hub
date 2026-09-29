/**
 * Кто правит страничку. Один аккаунт, заданный окружением — не фича для всех.
 */

export function kotliarSiteOwnerId(): string | null {
  const id = process.env.KOTLIAR_SITE_OWNER_ID?.trim()
  return id || null
}

export function isKotliarSiteOwner(userId: string): boolean {
  const owner = kotliarSiteOwnerId()
  return owner !== null && owner === userId
}

export function kotliarPublicOrigin(): string {
  const raw = process.env.KOTLIAR_SITE_PUBLIC_URL?.trim().replace(/\/+$/, "")
  if (raw) return raw
  return "https://kotliar.ffworks.pro"
}

export function kotliarPagePublicPath(slug: string): string {
  return slug ? `/${slug}` : "/"
}
