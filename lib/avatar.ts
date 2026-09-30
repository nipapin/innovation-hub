import { appMediaProxyPathForKey, publicObjectUrlForKey } from "@/lib/s3-config"

/** Аватары лежат под входом: удалить все объекты человека можно префиксом. */
export function avatarObjectPrefix(loginUserId: string): string {
  return `avatars/${loginUserId}/`
}

/** Ключ из запроса или базы — действительно аватар этого входа. */
export function isOwnAvatarObject(key: string, loginUserId: string): boolean {
  return key.startsWith(avatarObjectPrefix(loginUserId)) && !key.includes("..")
}

export function avatarUrlForKey(key: string | null): string | null {
  if (!key) return null
  return publicObjectUrlForKey(key) ?? appMediaProxyPathForKey(key)
}
