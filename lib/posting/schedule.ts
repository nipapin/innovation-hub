import { pickInterval } from "./interval"
import type { PostRoute } from "./routes"

/**
 * Гейты расписания: день недели, окно суток, интервал.
 *
 * Порт `evaluateRoute` из `src/PROCESSING/autoPost/index.ts`. Считается на
 * каждом обходе заново — состояния у гейтов нет, кроме времени последней
 * публикации, которое лежит в реестре.
 *
 * ⚠️ ТАЙМЗОНА. В программе окно считается по часам МАШИНЫ — там это часы того,
 * кто настраивал. На сервере часы UTC, и «постить с 10 до 22» превратилось бы
 * в другие часы суток. Поэтому окно считается в поясе, переданном явно, а не в
 * поясе процесса: рассинхрон TZ — одна из ловушек, на которых уже обжигались в
 * статистике (docs/SOCIAL_POSTING_PLAN.md §3.3).
 */

/**
 * Пояс, в котором считаются окно и дни недели.
 *
 * Свойства «таймзона проекта» на сайте нет вовсе, а часы процесса — это UTC на
 * сервере: оставь как есть, и «постить с 10 до 22» у человека в Москве стало бы
 * с 13 до 01. Поэтому пояс задаётся установкой, с явным умолчанием.
 *
 * Когда понадобится разный пояс у разных клиентов, это станет полем проекта —
 * но заводить его до того, как он кому-то нужен, значило бы просить человека
 * заполнить настройку, у которой один правильный ответ.
 */
export function postingTimeZone(): string {
  return process.env.POSTING_TIME_ZONE?.trim() || "Europe/Moscow"
}

/** Части даты в нужном поясе. Без библиотек: Intl умеет это сам. */
function zoned(
  now: Date,
  timeZone: string,
): { day: string; secondsOfDay: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now)

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "0"

  // `hour12: false` в некоторых движках даёт 24 вместо 00 на полночь.
  const hour = Number(get("hour")) % 24
  return {
    day: get("weekday"),
    secondsOfDay: hour * 3600 + Number(get("minute")) * 60 + Number(get("second")),
  }
}

function dayAllowed(day: string, days: string[]): boolean {
  if (days.length === 0) return true
  return days.includes(day)
}

/**
 * Окно суток в секундах от полуночи.
 *
 * `end <= start` считается «окна нет» — так же, как в программе: это либо
 * значение по умолчанию 0…86400, либо явная бессмыслица, и в обоих случаях
 * правильнее пропускать, чем не публиковать никогда.
 */
function windowAllowed(secondsOfDay: number, window: [number, number]): boolean {
  const [start, end] = window
  if (!(end > start)) return true
  return secondsOfDay >= start && secondsOfDay < end
}

export type ScheduleVerdict =
  | { due: true; dueIn: 0 }
  /** Ещё не время. `dueIn` — сколько секунд ждать; `null` — ждать нечего. */
  | { due: false; reason: "outside-window" | "interval" | "cooldown"; dueIn: number | null }

export function evaluateSchedule(input: {
  route: PostRoute
  now: Date
  timeZone: string
  /** Время последней публикации этим аккаунтом, epoch-секунды. 0 — не было. */
  lastPostedAt: number
  /** Пауза аккаунта до этого момента. */
  cooldownUntil: Date | null
  accountId: string
}): ScheduleVerdict {
  const nowSec = Math.floor(input.now.getTime() / 1000)

  if (input.cooldownUntil && input.cooldownUntil.getTime() > input.now.getTime()) {
    return {
      due: false,
      reason: "cooldown",
      dueIn: Math.ceil((input.cooldownUntil.getTime() - input.now.getTime()) / 1000),
    }
  }

  const { day, secondsOfDay } = zoned(input.now, input.timeZone)
  if (
    !dayAllowed(day, input.route.daysOfWeek) ||
    !windowAllowed(secondsOfDay, input.route.window)
  ) {
    // Сколько ждать до окна — не считаем: до него могут быть сутки и смена
    // дня недели, а обход всё равно придёт снова через свой период.
    return { due: false, reason: "outside-window", dueIn: null }
  }

  // Первую публикацию ждать не заставляем — как в программе.
  if (input.lastPostedAt === 0) return { due: true, dueIn: 0 }

  const target = pickInterval(
    input.route.interval,
    `${input.route.finderId}|${input.route.platform}|${input.accountId}|${input.lastPostedAt}`,
  )
  const waited = nowSec - input.lastPostedAt
  if (waited >= target) return { due: true, dueIn: 0 }
  return { due: false, reason: "interval", dueIn: target - waited }
}

/** Порядок выдачи файлов. Порт `sortByOrder` из программы. */
export function sortCandidates<T extends { name: string; sortTime: number }>(
  files: T[],
  order: string,
): T[] {
  const list = [...files]
  if (order === "by Name") {
    return list.sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    )
  }
  if (order === "Random") {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[list[i], list[j]] = [list[j], list[i]]
    }
    return list
  }
  const ascending = list.sort((a, b) => a.sortTime - b.sortTime)
  // `by Time (yanger)` — новые первыми; legacy `by Time` и `by Time (older)` —
  // старые первыми. Опечатка в названии осталась из программы: значение
  // приезжает из графа, и «исправив» его здесь мы перестали бы понимать графы.
  return order === "by Time (yanger)" ? ascending.reverse() : ascending
}
