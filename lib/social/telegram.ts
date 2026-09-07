import type { SocialTarget } from "./types"

/**
 * Telegram Bot API — проверка токена бота и каталог его чатов.
 *
 * Публикация ботом: бот должен быть админом канала. Каталог каналов Bot API
 * **не перечисляет** — метода «покажи, где я админ» у него нет. Поэтому
 * каталог наполняется из `getUpdates`: там видно чаты, в которых бот что-то
 * получал. Так же это устроено в программе (`buildTgGroupedList` в
 * `useResolveOptions.ts`), и расходиться незачем.
 *
 * ⚠️ Публикация Telegram на сайте ещё не сделана (docs/SOCIAL_POSTING_PLAN.md
 * §8): облачный Bot API режет загрузку на 50 МБ, и снимается это только
 * локальным `telegram-bot-api --local` на хосте. Подключить аккаунт можно уже
 * сейчас — заводить его к моменту адаптера было бы отдельной работой.
 */

const API = "https://api.telegram.org"

type TgResponse<T> = { ok: boolean; result?: T; description?: string }

async function tgApi<T>(
  token: string,
  method: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    body.set(key, String(value))
  }

  // Токен бота лежит в ПУТИ — так устроен Bot API, выбора нет. Поэтому в
  // текстах ошибок ниже адрес не упоминается: иначе токен уехал бы в логи.
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  })

  let json: TgResponse<T>
  try {
    json = (await res.json()) as TgResponse<T>
  } catch {
    throw new Error(`Telegram ${method}: не-JSON ответ (HTTP ${res.status})`)
  }
  if (!json.ok) {
    throw new Error(
      `Telegram ${method}: ${json.description ?? `HTTP ${res.status}`}`,
    )
  }
  return json.result as T
}

export type TgBot = {
  id: number
  /** `@username` бота либо его имя — то, под чем аккаунт будет виден. */
  name: string
}

export async function tgValidateToken(token: string): Promise<TgBot> {
  const me = await tgApi<{
    id: number
    username?: string
    first_name?: string
  }>(token, "getMe")
  return {
    id: me.id,
    name: me.username ? `@${me.username}` : (me.first_name ?? `bot${me.id}`),
  }
}

/**
 * Чаты, которые бот видел.
 *
 * `getUpdates` отдаёт только свежую очередь обновлений (и та живёт сутки),
 * поэтому пустой ответ — это НЕ «бот нигде не админ». Обычный случай: бота
 * добавили в канал и с тех пор ничего не постили. Отсюда правило экрана:
 * пустой каталог не выдаётся за ошибку, а сопровождается подсказкой
 * «напишите что-нибудь в канал и обновите список».
 */
export async function tgListChats(token: string): Promise<SocialTarget[]> {
  const updates = await tgApi<Array<Record<string, unknown>>>(
    token,
    "getUpdates",
    { limit: 100 },
  )

  const seen = new Map<string, SocialTarget>()
  for (const update of updates) {
    for (const key of [
      "message",
      "channel_post",
      "edited_message",
      "edited_channel_post",
      "my_chat_member",
    ]) {
      const chat = (update[key] as { chat?: Record<string, unknown> } | undefined)
        ?.chat
      if (!chat) continue

      const id = String(chat.id ?? "")
      if (!id || seen.has(id)) continue

      const type = String(chat.type ?? "")
      // Личку в цели не берём: постить в переписку с ботом незачем, а список
      // она засоряет ровно теми чатами, где бота просто попробовали.
      if (type === "private") continue

      const name =
        (chat.title as string | undefined) ||
        (chat.username ? `@${String(chat.username)}` : id)
      seen.set(id, {
        id,
        name,
        group: type === "channel" ? "каналы" : "чаты",
      })
    }
  }
  return [...seen.values()]
}
