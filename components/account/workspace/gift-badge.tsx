"use client"

import { Gift } from "lucide-react"

import { formatBalance, tf, useI18n } from "@/components/account/i18n"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { ProjectGift } from "./types"

/**
 * Значок «за этот проект платим не вы».
 *
 * Тестовый период и акция помечаются ОДНИМ значком: для человека в списке это
 * один и тот же факт — работа здесь идёт на подаренные деньги. Разница между
 * ними важна ровно в подсказке, где вещь называется своим именем.
 *
 * Маленький и без числа рядом. Крупная метка на карточке спорила бы с именем
 * проекта, а срок, выведенный на видное место, читался бы как обратный отсчёт
 * до конца работы — притом что чаще подарок кончается по деньгам, а не по
 * календарю. Поэтому наружу — только «здесь подарок», а сколько осталось —
 * по наведению, когда человек сам спросил.
 */

/** Сколько дней осталось. `null` — подарок бессрочный. */
function daysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null
  const end = new Date(expiresAt).getTime()
  if (Number.isNaN(end)) return null
  // Округляем вверх и не опускаемся ниже нуля: «осталось −2 дн.» не объясняет
  // ничего, а закрытием просроченного подарка занимается биллинг, и до этого
  // момента проект ещё работает.
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000))
}

export function GiftBadge({
  gift,
  size = "md",
  className,
}: {
  gift: ProjectGift
  /** `md` — рядом с круглой иконкой карточки, `sm` — в строке списка. */
  size?: "sm" | "md"
  className?: string
}) {
  const { t, lang } = useI18n()

  const days = daysLeft(gift.expiresAt)
  const lines = [
    gift.kind === "trial" ? t.giftTrial : t.giftPromo,
    days == null
      ? t.giftNoExpiry
      : days === 0
        ? t.giftLastDay
        : tf(t.giftDaysLeft, { days }),
    // Остаток — второй конец подарка, и без него подсказка обещала бы дни,
    // которые не на что прожить.
    tf(t.giftLeftMoney, { amount: formatBalance(gift.remainingCents, lang) }),
  ]

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            // Не кнопка: нажимать не на что, а внутри карточки-кнопки вложенная
            // кнопка ломала бы её собственный клик.
            role="img"
            aria-label={lines.join(", ")}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "flex items-center justify-center rounded-full border border-amber-400/45 bg-amber-400/[0.18] text-amber-300 backdrop-blur-sm",
              size === "md" ? "h-[23px] w-[23px]" : "h-[17px] w-[17px]",
              className,
            )}
          >
            <Gift className={size === "md" ? "h-[13px] w-[13px]" : "h-[10px] w-[10px]"} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[12.5px] leading-relaxed">
          {lines.join(" · ")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Значок, приклеенный к правому нижнему углу круглой иконки карточки.
 *
 * Отдельная обёртка, потому что позиционирование требует `relative` на самой
 * иконке: без неё значок уехал бы к углу всей карточки, а связь «подарок
 * относится к этому проекту» держится именно на близости к его иконке.
 */
export function GiftCorner({
  gift,
  /** Цвет подложки под значком — цвет карточки, на которой он лежит. */
  ringClass = "ring-ws-panel",
}: {
  gift: ProjectGift
  ringClass?: string
}) {
  return (
    <GiftBadge
      gift={gift}
      className={cn("absolute -bottom-1 -right-1 ring-2", ringClass)}
    />
  )
}
