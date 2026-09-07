"use client"

import { useCallback, useEffect, useState } from "react"

import type { PlatformOption } from "./connect-dialog"
import type { SocialAccount } from "@/lib/social/types"

/**
 * Аккаунты площадок — один запрос на всю страницу.
 *
 * Хук общий у страницы аккаунтов и у контролов во вкладке настроек проекта, а
 * контролов на вкладке бывает несколько сразу: у ноды Poster это пара
 * «аккаунт + цель», и нод-постеров в графе может быть две. Отдельный запрос на
 * каждый контрол означал бы четыре одинаковых ответа и, что хуже, четыре
 * независимых состояния: подключил аккаунт в одном списке — в соседнем его
 * ещё нет.
 *
 * Поэтому маленький общий кэш на модуль: ответ один, подписчиков много,
 * обновление доезжает до всех.
 */

export type SocialData = {
  accounts: SocialAccount[]
  platforms: PlatformOption[]
  vaultReady: boolean
  /**
   * Список аккаунтов не прочитался (например, миграции ещё не применены).
   * Каталог площадок при этом приезжает целым — он статический.
   *
   * Отдельно от `error`, который значит «запрос не дошёл вовсе»: пустой список
   * из-за сломанной базы и пустой список потому, что аккаунтов нет, — разные
   * вещи, и человеку надо сказать, какая из них.
   */
  accountsError: string | null
}

const EMPTY: SocialData = {
  accounts: [],
  platforms: [],
  vaultReady: true,
  accountsError: null,
}

let cache: SocialData | null = null
let inflight: Promise<SocialData> | null = null
const listeners = new Set<(data: SocialData) => void>()

async function fetchData(): Promise<SocialData> {
  const res = await fetch("/api/account/social-accounts", { cache: "no-store" })
  if (!res.ok) throw new Error(String(res.status))
  return (await res.json()) as SocialData
}

function publish(data: SocialData) {
  cache = data
  for (const listener of listeners) listener(data)
}

/** Сбросить кэш и перечитать. Возвращает свежие данные. */
export async function reloadSocialAccounts(): Promise<SocialData> {
  inflight = fetchData()
  try {
    const data = await inflight
    publish(data)
    return data
  } finally {
    inflight = null
  }
}

export function useSocialAccounts() {
  const [data, setData] = useState<SocialData | null>(cache)
  const [error, setError] = useState(false)

  useEffect(() => {
    listeners.add(setData)
    // Уже летящий запрос переиспользуем: несколько контролов, смонтированных
    // в одном такте, не должны спрашивать одно и то же четыре раза.
    if (cache === null) {
      void (inflight ?? reloadSocialAccounts())
        .then(setData)
        .catch(() => setError(true))
    }
    return () => {
      listeners.delete(setData)
    }
  }, [])

  const reload = useCallback(async () => {
    try {
      await reloadSocialAccounts()
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

  return {
    /** `null` пока не загрузилось: список и «списка нет» надо различать. */
    data,
    /** То же, но без null — когда пустой список рисуется так же, как ошибка. */
    value: data ?? EMPTY,
    loading: data === null && !error,
    error,
    reload,
  }
}
