import type { SocialTarget } from "./types"

/**
 * VK API — ровно те вызовы, что делает программа.
 *
 * Порт `src-tauri/src/commands/vk_auth_commands.rs` и `_publisher.ts` из
 * fs.manager.tauri. Версии API и набор прав скопированы оттуда намеренно:
 * токен, выданный программе, обязан работать на сайте, и наоборот — иначе
 * человек, перенёсший проект в облако, обнаружит, что аккаунт надо
 * подключать заново.
 *
 * Сеть здесь и только здесь: репозиторий аккаунтов (accounts.ts) про HTTP
 * ничего не знает, а роуты не знают про VK.
 */

/**
 * Kate Mobile app_id. Токен со `scope=offline` не привязан к IP, живёт до
 * ручного отзыва и переживает перезапуск — поэтому программа берёт именно его.
 *
 * Минус, о котором надо помнить: у Kate Mobile скрыты Клипы (`shortVideo`),
 * доступно только обычное видео. Для Клипов нужен client_id самого vk.com
 * (6287487), но его токен привязан к IP — а у сайта и у машины адреса разные.
 * Пока постим видео, менять это незачем.
 */
export const VK_DEFAULT_CLIENT_ID = "2685278"

/** Набор прав. Меньше нельзя: video — заливка, wall — пост, groups — цели. */
export const VK_SCOPE = "video,wall,groups,offline,photos,docs"

/** Версия API для обычных вызовов. Та же, что в программе. */
const V = "5.199"

/**
 * Адрес страницы входа.
 *
 * `redirect_uri` — страница-заглушка самого VK: она отдаёт токен во фрагменте
 * адреса. Для браузера это тупик (фрагмент чужой страницы нам не прочитать),
 * поэтому дальше человек копирует адрес руками — см. `parsePastedToken`.
 *
 * `redirectUri` можно подменить своим адресом: тогда вкладка вернётся на сайт
 * и токен прочитается сам. Требует своего приложения VK, где этот адрес
 * прописан, — поэтому параметр, а не константа.
 */
export function vkAuthorizeUrl(input?: {
  clientId?: string
  redirectUri?: string
  /** `revoke=1` — показать выбор аккаунта даже при активной сессии. */
  fresh?: boolean
}): string {
  const clientId = input?.clientId?.trim() || VK_DEFAULT_CLIENT_ID
  const redirectUri =
    input?.redirectUri?.trim() || "https://oauth.vk.com/blank.html"
  const params = new URLSearchParams({
    client_id: clientId,
    scope: VK_SCOPE,
    response_type: "token",
    redirect_uri: redirectUri,
    v: V,
  })
  if (input?.fresh) params.set("revoke", "1")
  // display=mobile НЕ добавлять: он уводит на старую форму логина, которая
  // падает по таймауту. Дефолт ведёт на VK ID, и он работает.
  return `https://oauth.vk.com/authorize?${params.toString()}`
}

/**
 * Токен из того, что человек вставил.
 *
 * Порт `parseToken` из `VkAccountDDM.tsx`: принимаем и целый адрес
 * `blank.html#access_token=…`, и сам токен. Второе — потому что люди копируют
 * по-разному, и отказать тому, кто вставил именно токен, значило бы объяснять
 * ему, что не так, вместо того чтобы просто взять.
 */
export function parsePastedToken(
  input: string,
): { token: string; userId: number } | null {
  const text = input.trim()
  if (!text) return null

  const match = text.match(/access_token=([^&\s#]+)/)
  if (match) {
    const uid = text.match(/user_id=(\d+)/)
    return { token: match[1], userId: uid ? Number.parseInt(uid[1], 10) : 0 }
  }
  // Сам токен: длинная строка без пробелов (vk1.…/vk2.…).
  if (/^\S{20,}$/.test(text)) return { token: text, userId: 0 }
  return null
}

/** Ошибка VK API — несёт `error_code`, по которому решается пауза аккаунта. */
export class VkApiError extends Error {
  readonly code: number
  readonly method: string
  readonly captchaSid?: string

  constructor(method: string, error: Record<string, unknown>) {
    super(
      `VK ${method}: ${String(error.error_msg ?? "неизвестная ошибка")} [code ${String(error.error_code)}]`,
    )
    this.name = "VkApiError"
    this.method = method
    this.code = Number(error.error_code)
    if (error.captcha_sid) this.captchaSid = String(error.captcha_sid)
  }
}

/**
 * Вызов метода VK.
 *
 * Токен уходит в ТЕЛЕ, а не в адресе. В программе он в query, и там же
 * пришлось глушить его в текстах ошибок (`without_url()`), иначе токен ложился
 * бы в лог открытым текстом. Здесь этой ловушки нет по устройству запроса.
 */
async function vkApi(
  method: string,
  params: Record<string, string | number | undefined>,
  version = V,
): Promise<unknown> {
  const body = new URLSearchParams({ v: version })
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    body.set(key, String(value))
  }

  const res = await fetch(`https://api.vk.com/method/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  })

  const text = await res.text()
  let json: Record<string, unknown>
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(
      `VK ${method}: не-JSON ответ (HTTP ${res.status}): ${text.slice(0, 200)}`,
    )
  }
  if (json.error) {
    throw new VkApiError(method, json.error as Record<string, unknown>)
  }
  return json.response
}

export type VkIdentity = {
  userId: number
  /** «Иван Петров» либо `id123`, если имени нет. */
  name: string
}

/**
 * Проверка токена через `users.get`.
 *
 * Она же даёт имя аккаунта: подписывать аккаунт числовым id значило бы
 * заставлять человека помнить, какой id чей.
 */
export async function vkValidateToken(token: string): Promise<VkIdentity> {
  const response = (await vkApi("users.get", { access_token: token })) as
    | Array<Record<string, unknown>>
    | undefined
  const user = Array.isArray(response) ? response[0] : undefined
  if (!user) throw new Error("VK users.get: пустой ответ")

  const userId = Number(user.id ?? 0)
  const full = `${String(user.first_name ?? "")} ${String(user.last_name ?? "")}`.trim()
  return { userId, name: full || (userId ? `id${userId}` : "vk account") }
}

/**
 * Сообщества, где человек администратор (`groups.get filter=admin`).
 *
 * Только админ-группы: постить можно туда, где есть право, и показывать в
 * списке остальные значило бы предлагать выбор, который потом откажет.
 */
export async function vkListGroups(token: string): Promise<SocialTarget[]> {
  const response = (await vkApi(
    "groups.get",
    { access_token: token, filter: "admin", extended: 1 },
    // Версия та же, что в программе: `extended=1` у groups.get отвечает
    // по-разному в разных версиях, и расходиться здесь незачем.
    "5.131",
  )) as { items?: Array<Record<string, unknown>> } | undefined

  const items = Array.isArray(response?.items) ? response.items : []
  return items
    .map((group) => ({
      id: String(group.id ?? ""),
      name: String(group.name ?? ""),
    }))
    .filter((target) => target.id !== "" && target.name !== "")
}

/**
 * Расшифровка кодов ошибок VK — порт `vkErrorHint` из `autoPostVK.ts`.
 *
 * Нужна не для красоты: «code 14» человеку не говорит ничего, а «VK требует
 * капчу, пости реже» говорит, что делать.
 */
export function vkErrorHint(code: number): string {
  switch (code) {
    case 5:
      return "токен невалиден или протух — подключите аккаунт заново."
    case 6:
      return "слишком много запросов в секунду — увеличьте интервал."
    case 9:
      return "flood control: слишком много однотипных постов подряд."
    case 14:
      return "VK требует капчу — публикуйте реже."
    case 15:
      return "доступ запрещён — проверьте права аккаунта."
    case 17:
      return "нужна валидация аккаунта: подтвердите вход в браузере."
    case 29:
      return "достигнут суточный лимит метода — пауза до завтра."
    case 100:
      return "неверный параметр запроса."
    case 200:
      return "нет доступа к альбому или видео."
    case 214:
      return "постинг на стену запрещён: лимит 50/сутки, права или премодерация."
    default:
      return ""
  }
}
