"use client"

import { useCallback, useEffect, useState } from "react"
import { Gift, X } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/account/i18n"
import {
  TrialDialogs,
  useTrialFlow,
  type TrialState,
} from "@/components/account/trial-flow"
import { cn } from "@/lib/utils"
import { useWorkspace } from "./workspace-context"

/**
 * «Тестовый период» в разделе проектов — там, где человек и решает, чем занять
 * пустой кабинет.
 *
 * Условия открываются ПРЯМО ЗДЕСЬ. Раньше кнопка уводила на дашборд и диалог
 * всплывал уже там: человек, нажавший её из своих проектов, оказывался на
 * другой странице, а вернуться потом должен был сам. Машинерия при этом не
 * задвоилась — выдача одна на оба места
 * ([trial-flow.tsx](../trial-flow.tsx)), здесь только кнопка.
 *
 * Показывается ТОЛЬКО при `status === "available"`. Период, который уже выдали
 * и не сбрасывали, даёт любой другой статус — и кнопки тогда нет вовсе, а не
 * «нажмите, вам откажут»: предложить подарок, которого не будет, хуже, чем
 * промолчать.
 *
 * Закрыть её можно крестиком. Отказ помнит браузер, а не аккаунт: это скрытие
 * предложения, а не настройка, и платить за него колонкой в базе не стоит.
 * Обратная сторона честная — в другом браузере кнопка появится снова.
 */

/**
 * Ключ отказа хранит, от КАКОГО предложения человек отказался, а не «отказался
 * вообще». Ключ — дата обновления набора: сменился набор, сменился ключ, и
 * кнопка возвращается. Человек, не захотевший прошлые проекты, должен получить
 * возможность взглянуть на новые и решить заново.
 */
const DISMISS_KEY = "ffworks-trial-cta-dismissed"

type Props = {
  /**
   * `page` — ряд с «Новым проектом» на витрине, высота под него.
   * `empty` — приглашение на пустом месте, где проект не выбран.
   */
  size: "page" | "empty"
  className?: string
}

export function TrialCta({ size, className }: Props) {
  const [trial, setTrial] = useState<TrialState | undefined>(undefined)
  const [offerKey, setOfferKey] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(true)
  const { t } = useI18n()
  const { reloadProjects } = useWorkspace()

  /**
   * Перечитываем И состояние периода, И список проектов. Второе обязательно:
   * копии приезжают в обход рабочего места, и без перечитки человек смотрит на
   * прежний пустой кабинет — ровно то, что выглядит как «ничего не произошло».
   */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/account/trial", { cache: "no-store" })
      if (res.ok) {
        const body = (await res.json()) as {
          trial?: TrialState
          offerKey?: string
        }
        setTrial(body.trial)
        if (body.trial?.status === "available") {
          const key = body.offerKey ?? "initial"
          setOfferKey(key)
          setDismissed(readDismissed() === key)
        }
      }
    } catch {
      // Предложение, а не функция: молчим и не показываем ничего.
    }
    await reloadProjects()
  }, [reloadProjects])

  const flow = useTrialFlow({ status: trial?.status, onChanged: refresh })

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Период уже берут — кнопке здесь больше делать нечего. Диалоги остаются в
  // дереве: в них теперь идёт ход копирования, и исчезнуть вместе с кнопкой
  // они не должны.
  if (offerKey === null || dismissed || trial?.status !== "available") {
    return <TrialDialogs flow={flow} trial={trial} />
  }

  const hide = () => {
    setDismissed(true)
    writeDismissed(offerKey)
    // Говорим, куда кнопка делась. Молча исчезнувшее предложение человек потом
    // ищет и не находит — а период никуда не девается, он остаётся в дашборде.
    toast.success(t.trialCtaHidden)
  }

  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        type="button"
        onClick={() => flow.setOpen(true)}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 font-medium text-primary hover:bg-primary/20",
          size === "page"
            ? "h-[52px] px-[22px] text-[15px]"
            : "h-10 rounded-[10px] px-5 text-[14px]",
        )}
      >
        <Gift className={size === "page" ? "h-5 w-5" : "h-[18px] w-[18px]"} />
        {t.trialActivate}
      </button>

      {/* Крестик в углу, как у всплывающих окон. Отдельной кнопкой поверх, а не
          внутри первой: вложенная кнопка — недопустимая разметка, и промах по
          ней открыл бы условия вместо скрытия. */}
      <button
        type="button"
        onClick={hide}
        aria-label={t.trialCtaHide}
        title={t.trialCtaHide}
        className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-primary/30 bg-background text-primary/70 hover:text-primary"
      >
        <X className="h-3 w-3" />
      </button>

      <TrialDialogs flow={flow} trial={trial} />
    </span>
  )
}

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISS_KEY)
  } catch {
    // Приватный режим и заблокированное хранилище: отказ просто не запомнится.
    return null
  }
}

function writeDismissed(key: string): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, key)
  } catch {
    // См. выше: кнопка вернётся при следующем заходе, и это лучше падения.
  }
}
