import {
  parsePastedToken,
  vkAuthorizeUrl,
  vkListGroups,
  vkValidateToken,
} from "./vk"
import { tgListChats, tgValidateToken } from "./telegram"
import type { SocialPlatform, SocialTarget } from "./types"

/**
 * Адаптеры площадок: всё, что у них РАЗНОЕ, живёт здесь и только здесь.
 *
 * Остальной код — сейф, роуты, экран кабинета, планировщик — про площадки не
 * знает ничего и работает через этот интерфейс. Добавление площадки должно
 * быть одной записью в реестре, а не правкой десяти файлов: именно так это
 * сделано в программе (`POSTER_PLATFORM` в `src/PROCESSING/autoPost/posters.ts`
 * — одна строка на площадку), и расходиться с ней незачем.
 */

/**
 * Секрет аккаунта: объект полей, а не строка.
 *
 * У VK это `{ accessToken }`, у Telegram — `{ botToken }`, у YouTube будет
 * `{ clientId, clientSecret, refreshToken }`. Шифруется целиком (см. миграцию
 * 2026-09-07-social-accounts.sql).
 */
export type SocialSecret = Record<string, string>

/** Что площадка рассказала о себе при проверке токена. */
export type SocialIdentity = {
  /** id на площадке. Пусто — площадка его не сообщает. */
  externalId: string
  /** Имя, под которым аккаунт будет виден и записан в граф. */
  name: string
  /** Когда токен перестанет работать. `undefined` — бессрочный. */
  expiresAt?: Date
}

export type PlatformAdapter = {
  slug: SocialPlatform
  /**
   * Можно ли подключить аккаунт этой площадки прямо сейчас.
   *
   * `false` не значит «нет кнопки»: площадка видна на экране, но с подписью,
   * что подключение ещё не сделано. Прятать её значило бы отвечать «такой
   * площадки нет» на вопрос «когда будет YouTube».
   */
  connectable: boolean
  /**
   * Адрес страницы входа для кнопки «Открыть вход». `null` — входить некуда,
   * секрет человек берёт в другом месте (у Telegram — у @BotFather).
   */
  authUrl(redirectUri?: string): string | null
  /** Разобрать вставленное человеком в секрет. `null` — не разобралось. */
  parse(input: string): SocialSecret | null
  /** Проверить секрет у площадки. Бросает, если он не работает. */
  validate(secret: SocialSecret): Promise<SocialIdentity>
  /** Каталог целей публикации: сообщества, каналы. */
  listTargets(secret: SocialSecret): Promise<SocialTarget[]>
}

const vk: PlatformAdapter = {
  slug: "vk",
  connectable: true,
  authUrl: (redirectUri) => vkAuthorizeUrl({ redirectUri }),
  parse: (input) => {
    const parsed = parsePastedToken(input)
    return parsed ? { accessToken: parsed.token } : null
  },
  validate: async (secret) => {
    const user = await vkValidateToken(secret.accessToken)
    return {
      externalId: user.userId ? String(user.userId) : "",
      name: user.name,
      // Со `scope=offline` токен бессрочный. Придумывать ему срок нельзя:
      // рабочий аккаунт однажды сам себя погасил бы.
      expiresAt: undefined,
    }
  },
  listTargets: (secret) => vkListGroups(secret.accessToken),
}

const telegram: PlatformAdapter = {
  slug: "telegram",
  connectable: true,
  // Токен бота выдаёт @BotFather в самом Telegram — страницы входа нет.
  authUrl: () => null,
  parse: (input) => {
    const text = input.trim()
    // Формат токена бота: `<id>:<секрет>`. Проверяем форму, чтобы отличить
    // опечатку от токена ещё до похода в сеть.
    return /^\d+:[A-Za-z0-9_-]{20,}$/.test(text) ? { botToken: text } : null
  },
  validate: async (secret) => {
    const bot = await tgValidateToken(secret.botToken)
    return { externalId: String(bot.id), name: bot.name }
  },
  listTargets: (secret) => tgListChats(secret.botToken),
}

/**
 * YouTube — модель B (BYO credentials): API-клиентом выступает сам человек, со
 * своим проектом в Google Cloud, своей квотой и своим audit
 * (docs/SOCIAL_POSTING_PLAN.md §5.2). Это отдельный кусок работы: OAuth-обмен,
 * refresh, resumable-загрузка. Пока подключения нет — и лучше сказать это
 * прямо, чем принять токен, которым нечем воспользоваться.
 */
const youtube: PlatformAdapter = {
  slug: "youtube",
  connectable: false,
  authUrl: () => null,
  parse: () => null,
  validate: async () => {
    throw new Error("YouTube connection is not implemented yet.")
  },
  listTargets: async () => [],
}

export const PLATFORM_ADAPTERS: Record<SocialPlatform, PlatformAdapter> = {
  vk,
  telegram,
  youtube,
}

export function platformAdapter(platform: SocialPlatform): PlatformAdapter {
  return PLATFORM_ADAPTERS[platform]
}
