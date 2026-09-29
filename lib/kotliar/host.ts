/**
 * Хост публичной странички Ивана.
 *
 * Чистый модуль: его читает `proxy.ts` в edge-рантайме, поэтому здесь нельзя
 * трогать базу, Node-API и `process.env` по вычисляемому ключу.
 */

export const KOTLIAR_HOSTS = new Set(["kotliar.ffworks.pro", "kotliar.localhost"])

export function hostnameOf(headers: Headers): string {
  const raw = headers.get("x-forwarded-host") ?? headers.get("host") ?? ""
  return raw.split(",")[0]?.split(":")[0]?.trim().toLowerCase() ?? ""
}

export function isKotliarHost(host: string): boolean {
  return KOTLIAR_HOSTS.has(host)
}

export function isKotliarRequest(headers: Headers): boolean {
  return isKotliarHost(hostnameOf(headers))
}
