"use client"

import { useEffect, useState } from "react"
import { Check, ChevronDown, Loader2, User } from "lucide-react"
import { toast } from "sonner"

import { CompanyMark } from "@/components/account/company-mark"
import { useI18n } from "@/components/account/i18n"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AccentPair } from "@/lib/branding"

/** Пункт переключателя — ответ `/api/auth/profiles`. */
type ProfileOption = {
  id: string
  kind: "personal" | "company"
  /** У «Личного» названия нет: его переводит интерфейс. */
  title: string | null
  monogram: string | null
  accent: AccentPair | null
  current: boolean
}

/**
 * Переключатель рабочих мест — docs/MULTI_COMPANY_PROFILES_PLAN.md §6.
 *
 * Стоит на месте названия в шапке бокового меню: название и так показывает,
 * где человек сейчас — компанию или установку, — и переключатель отвечает на
 * тот же вопрос. Профиль один — это просто название, без стрелки: выбор из
 * одного пункта был бы обещанием выбора, которого нет.
 *
 * Выбор — полная перезагрузка кабинета, а не клиентский переход: в кабинете
 * много кэша по пользователю (списки проектов, счётчики, баланс), и частично
 * перерисованный кабинет с данными прошлого профиля хуже секунды ожидания.
 *
 * Кнопки «выйти из компании» нет: «Личное» — такой же пункт, как компании.
 */
export function ProfileSwitcher({ label }: { label: string }) {
  const { t } = useI18n()
  const [profiles, setProfiles] = useState<ProfileOption[] | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/profiles", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { profiles?: ProfileOption[] } | null) => {
        if (!cancelled && body?.profiles) setProfiles(body.profiles)
      })
      .catch(() => {
        // Не узнали профили — остаётся название, как у человека с одним.
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!profiles || profiles.length < 2) {
    return (
      <span className="flex-1 whitespace-nowrap text-[16px] font-semibold text-foreground">
        {label}
      </span>
    )
  }

  const switchTo = async (profile: ProfileOption) => {
    if (profile.current || switching) return
    setSwitching(profile.id)
    try {
      const res = await fetch("/api/auth/switch-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: profile.id }),
      })
      if (!res.ok) {
        toast.error(t.profileSwitchFailed)
        setSwitching(null)
        return
      }
      window.location.assign("/account")
    } catch {
      toast.error(t.profileSwitchFailed)
      setSwitching(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t.profileSwitcher}
          aria-label={t.profileSwitcher}
          className="-mx-1 flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-foreground/5"
        >
          <span className="truncate text-[16px] font-semibold text-foreground">
            {label}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          {t.profileSwitcher}
        </DropdownMenuLabel>
        {profiles.map((profile) => (
          <DropdownMenuItem
            key={profile.id}
            onSelect={(event) => {
              // Меню остаётся открытым, пока идёт переключение: иначе
              // пропадает крутилка, и секунда до перезагрузки выглядит зависанием.
              event.preventDefault()
              void switchTo(profile)
            }}
            className="gap-2.5"
          >
            {profile.kind === "company" && profile.accent && profile.monogram ? (
              <CompanyMark monogram={profile.monogram} accent={profile.accent} />
            ) : (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-foreground/15 text-muted-foreground">
                <User className="h-3.5 w-3.5" />
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">
              {profile.kind === "personal" ? t.profilePersonal : profile.title}
            </span>
            {switching === profile.id ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : profile.current ? (
              <Check className="h-4 w-4 shrink-0 text-primary" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
