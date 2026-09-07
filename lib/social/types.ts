/**
 * Аккаунты площадок: типы и реестр площадок.
 *
 * Чистый модуль: без `pg`, без `node:crypto` и без чтения окружения — его
 * импортируют и серверные роуты, и экран кабинета, и разбор `options.json`.
 * Реестр один, а не по копии на слой — как у тегов прав
 * (lib/admin-capabilities.ts) и у навигации админки (nav-config.ts).
 *
 * Разбор решений — docs/SOCIAL_POSTING_PLAN.md.
 */

export const SOCIAL_PLATFORMS = ["vk", "youtube", "telegram"] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

export function isSocialPlatform(raw: unknown): raw is SocialPlatform {
  return (
    typeof raw === "string" &&
    (SOCIAL_PLATFORMS as readonly string[]).includes(raw)
  )
}

/**
 * Цель публикации: куда именно постим этим аккаунтом.
 *
 * Одна форма на все площадки — сообщество VK, канал Telegram, плейлист
 * YouTube. Разные там только `id` и то, что площадка считает «своим»: в
 * `options.json` уезжает `name`, потому что имя цели видит человек и именно
 * его показывает выпадающий список в программе (`#vkGroups`, `#tgChannels`).
 */
export type SocialTarget = {
  /** id на площадке. Для VK это id сообщества без знака. */
  id: string
  /** Имя, которое видит человек и которое уезжает в граф. */
  name: string
  /** Группа в выпадающем списке: «каналы», «чаты», «темы» у Telegram. */
  group?: string
}

/** Аккаунт, каким его видит кабинет. Секрета здесь нет никогда. */
export type SocialAccount = {
  id: string
  platform: SocialPlatform
  /** Имя аккаунта; оно же — значение в `options.json`. */
  label: string
  externalId: string
  status: "active" | "revoked"
  /** Кэш каталога целей: группы VK, каналы Telegram. */
  targets: SocialTarget[]
  /** Когда каталог целей последний раз обновляли у площадки. */
  targetsAt: string | null
  /** Когда токен последний раз ответил площадке. */
  checkedAt: string | null
  /** Чем площадка ответила при отказе. Пусто — жалоб нет. */
  lastError: string | null
  /** «••••4f21» — какой токен лежит, не доставая его. */
  secretHint: string | null
  /** Когда токен перестанет работать. `null` — бессрочный (VK с `offline`). */
  expiresAt: string | null
  /**
   * Пауза после отказа площадки: до этого момента аккаунтом не публикуем.
   *
   * При 429, флуд-контроле или капче площадка ограничивает АККАУНТ целиком, и
   * откладывать один файл бессмысленно — очередь продолжит долбить лимит
   * следующим. `null` — паузы нет.
   */
  cooldownUntil: string | null
  cooldownReason: string | null
  createdAt: string
}

/**
 * Токены `#…` из списка вариантов в графе → что это на самом деле.
 *
 * В программе их раскрывает `useResolveOptions` (у неё есть локальные учётки),
 * на сайте — этот реестр плюс сейф аккаунтов. Пока сайт их раскрыть не мог,
 * такое свойство показывалось с подписью «настраивается в программе»
 * (см. docs/PROJECT_OPTIONS_PANEL.md §3).
 *
 * `kind: "account"` — выбрать аккаунт; `kind: "target"` — выбрать цель у
 * ВЫБРАННОГО РЯДОМ аккаунта. Второе зависит от первого, поэтому контрол цели
 * ищет соседнее свойство `account` в той же ноде.
 */
export type SocialOptionToken = {
  kind: "account" | "target"
  platform: SocialPlatform
}

export const SOCIAL_OPTION_TOKENS: Record<string, SocialOptionToken> = {
  "#vkAccounts": { kind: "account", platform: "vk" },
  "#youtubeAccounts": { kind: "account", platform: "youtube" },
  "#tgAccounts": { kind: "account", platform: "telegram" },
  "#vkGroups": { kind: "target", platform: "vk" },
  "#tgChannels": { kind: "target", platform: "telegram" },
  /**
   * Источники сбора у `autoTGcollect` — тот же каталог чатов бота, что и цели
   * постинга. В программе `#tgSources` и `#tgChannels` раскрываются одной
   * функцией, и расходиться здесь незачем.
   */
  "#tgSources": { kind: "target", platform: "telegram" },
}

export function socialTokenInfo(token: string): SocialOptionToken | null {
  return SOCIAL_OPTION_TOKENS[token] ?? null
}

/** Описание площадки для интерфейса. Без секретов и без сетевых вызовов. */
export type SocialPlatformInfo = {
  slug: SocialPlatform
  /**
   * Имя площадки. НЕ переводится и потому живёт здесь, а не в словаре: это имя
   * собственное, «ВКонтакте» пишется так на любом языке интерфейса. Подписи
   * вокруг него («Сообщества», «Каналы») переводятся и лежат в словаре.
   */
  name: string
  /**
   * Умеет ли сайт публиковать этой площадкой ПРЯМО СЕЙЧАС.
   *
   * У VK адаптер есть; YouTube и Telegram подключаются позже (план, §8), но
   * аккаунт им завести можно уже — иначе к моменту адаптера окажется, что
   * заводить его негде и это ещё одна работа.
   */
  posting: boolean
}

export const SOCIAL_PLATFORM_INFO: Record<SocialPlatform, SocialPlatformInfo> = {
  vk: { slug: "vk", name: "ВКонтакте", posting: true },
  youtube: { slug: "youtube", name: "YouTube", posting: false },
  telegram: { slug: "telegram", name: "Telegram", posting: false },
}
