"use client"

import { useState } from "react"

import { tf, useI18n } from "@/components/account/i18n"
import { ConnectAccountDialog } from "@/components/account/social/connect-dialog"
import { useSocialAccounts } from "@/components/account/social/use-social-accounts"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ExposedOption, ExposedOptionValue } from "@/lib/options/types"
import type { SocialAccount } from "@/lib/social/types"

/**
 * Аккаунт площадки и цель публикации во вкладке настроек проекта.
 *
 * Это те самые два свойства, которые до сих пор показывались с подписью
 * «настраивается в программе»: в графе у них стоит токен (`#vkAccounts`,
 * `#vkGroups`, `#tgChannels`), а варианты знала только программа — у неё были
 * локальные учётки. С переездом аккаунтов в сейф сайта варианты появились и
 * здесь (docs/SOCIAL_POSTING_PLAN.md §4).
 *
 * Устройство повторяет программу (`VkAccountDDM.tsx` + `useResolveOptions.ts`):
 * список аккаунтов, пункт «подключить» прямо в списке, а цели тянутся по
 * ВЫБРАННОМУ РЯДОМ аккаунту — из соседнего свойства той же ноды.
 */

type SocialControlProps = {
  option: ExposedOption
  value: ExposedOptionValue
  disabled: boolean
  onChange: (value: ExposedOptionValue) => void
  /**
   * Значения соседей по ноде: `id свойства` → значение из черновика.
   *
   * Нужны ровно одному контролу — цели: без выбранного аккаунта список
   * сообществ показывать не из чего.
   */
  siblings: Record<string, ExposedOptionValue>
}

/** Пункт-действие. Начинается с `#`, потому что имя аккаунта так начаться не может. */
const ADD_NEW = "#add-account"

/**
 * `ddm` держит строку, `autocomplete` — список строк. Контрол один, поэтому
 * приводим к строке на входе и возвращаем в исходной форме на выходе.
 */
function asText(value: ExposedOptionValue): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    const first = value[0]
    return typeof first === "string" ? first : ""
  }
  return ""
}

function toOptionValue(
  option: ExposedOption,
  text: string,
): ExposedOptionValue {
  return option.control === "autocomplete" ? (text ? [text] : []) : text
}

export function SocialAccountControl(props: SocialControlProps) {
  const { option, value, disabled, onChange } = props
  const { t } = useI18n()
  const { value: data, loading, reload } = useSocialAccounts()
  const [connectOpen, setConnectOpen] = useState(false)

  const platform = option.social!.platform
  const accounts = data.accounts.filter(
    (account) => account.platform === platform,
  )
  const current = asText(value)
  /**
   * Имя, которого больше нет в списке: аккаунт убрали, а в графе он остался.
   * Показываем отдельным пунктом — иначе поле молча опустело бы, и человек не
   * понял бы, почему публикация встала. Тот же приём, что у ключей вендоров.
   */
  const orphan =
    current !== "" && !accounts.some((account) => account.label === current)

  const pick = (next: string) => {
    if (next === ADD_NEW) {
      // Следующим тактом, а не сразу: выпадающий список в этот момент ещё
      // закрывается и возвращает себе фокус, и модалка, открытая в том же
      // такте, тут же его теряет.
      setTimeout(() => setConnectOpen(true), 0)
      return
    }
    onChange(toOptionValue(option, next))
  }

  const applyConnected = (account: SocialAccount) => {
    void reload()
    onChange(toOptionValue(option, account.label))
  }

  return (
    <>
      <Select
        value={current}
        disabled={disabled || loading}
        onValueChange={pick}
      >
        <SelectTrigger className="h-8 text-[13px]">
          <SelectValue placeholder={t.optionsSocialPick} />
        </SelectTrigger>
        <SelectContent>
          {orphan ? (
            <SelectItem value={current}>
              {current} — {t.optionsSocialMissing}
            </SelectItem>
          ) : null}
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.label}>
              {account.label}
            </SelectItem>
          ))}
          {accounts.length > 0 ? <SelectSeparator /> : null}
          {/* Подключение прямо отсюда: уходить за аккаунтом на другую
              страницу значило бы потерять несохранённые правки вкладки. */}
          <SelectItem value={ADD_NEW}>{t.optionsSocialAdd}</SelectItem>
        </SelectContent>
      </Select>

      {/* Причина пустого списка — под самим списком. Молча пустой выпадающий
          список читается как «аккаунтов нет», и человек идёт подключать
          второй поверх уже подключённого. */}
      {data.accountsError ? (
        <p className="mt-1 text-[11px] leading-snug text-destructive">
          {tf(t.socialErrAccounts, { message: data.accountsError })}
        </p>
      ) : null}

      <ConnectAccountDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        platforms={data.platforms}
        platform={platform}
        onConnected={applyConnected}
      />
    </>
  )
}

export function SocialTargetControl(props: SocialControlProps) {
  const { option, value, disabled, onChange, siblings } = props
  const { t } = useI18n()
  const { value: data, loading } = useSocialAccounts()

  const platform = option.social!.platform
  /**
   * Аккаунт берём из соседнего свойства `account` той же ноды — ровно как это
   * делает программа (`useResolveOptions`, ветка `#vkGroups`). Имя свойства
   * задано нодой Poster и одинаково у всех площадок.
   */
  const accountLabel = asText(siblings.account ?? "")
  const account = data.accounts.find(
    (item) => item.platform === platform && item.label === accountLabel,
  )

  const current = asText(value)
  /**
   * Статические варианты из графа остаются: у VK это «Profile» — своя стена, и
   * никакого сообщества за ней не стоит. Дальше идут цели из сейфа.
   */
  const statics = option.options
  const targets = account?.targets ?? []
  const known = new Set([...statics, ...targets.map((target) => target.name)])
  const orphan = current !== "" && !known.has(current)

  const placeholder = !accountLabel
    ? t.optionsSocialNeedAccount
    : targets.length === 0 && statics.length === 0
      ? t.optionsSocialNoTargets
      : t.optionsSocialTargetPick

  return (
    <Select
      value={current}
      // Без выбранного аккаунта выбирать не из чего, и это видно по подписи, а
      // не по пустому открывшемуся списку.
      disabled={disabled || loading || !accountLabel}
      onValueChange={(next) => onChange(toOptionValue(option, next))}
    >
      <SelectTrigger className="h-8 text-[13px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {orphan ? (
          <SelectItem value={current}>
            {current} — {t.optionsSocialMissing}
          </SelectItem>
        ) : null}
        {statics.map((name) => (
          <SelectItem key={`static:${name}`} value={name}>
            {name}
          </SelectItem>
        ))}
        {statics.length > 0 && targets.length > 0 ? <SelectSeparator /> : null}
        {targets.map((target) => (
          <SelectItem key={target.id} value={target.name}>
            {target.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Контрол по токену площадки. `null` — свойство не про площадки. */
export function socialControlFor(option: ExposedOption) {
  if (!option.social) return null
  return option.social.kind === "account"
    ? SocialAccountControl
    : SocialTargetControl
}
