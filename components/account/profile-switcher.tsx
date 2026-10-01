"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Check, ChevronDown, Loader2, Shield, User } from "lucide-react"
import { toast } from "sonner"

import { CompanyMark } from "@/components/account/company-mark"
import { useI18n } from "@/components/account/i18n"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AccentPair } from "@/lib/branding"
import { cn } from "@/lib/utils"

/** Рабочее место — ответ `/api/auth/profiles`. */
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
 * Один запрос на страницу: переключатель в шапке и блок на дашборде спрашивают
 * одно и то же. Переключение перезагружает кабинет целиком, так что устаревать
 * запомненному ответу некогда.
 */
let profilesRequest: Promise<ProfileOption[] | null> | null = null

function loadProfiles(): Promise<ProfileOption[] | null> {
  profilesRequest ??= fetch("/api/auth/profiles", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { profiles?: ProfileOption[] } | null) => body?.profiles ?? null)
    .catch(() => null)
  return profilesRequest
}

/**
 * Рабочие места человека и переключение между ними —
 * docs/MULTI_COMPANY_PROFILES_PLAN.md §6.
 *
 * Выбор — полная перезагрузка кабинета, а не клиентский переход: в кабинете
 * много кэша по пользователю (списки проектов, счётчики, баланс), и частично
 * перерисованный кабинет с данными прошлого профиля хуже секунды ожидания.
 * Сервер заодно запоминает выбор — следующий вход откроет это же место (§17.6).
 */
function useWorkspaces() {
  const { t } = useI18n()
  const [profiles, setProfiles] = useState<ProfileOption[] | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadProfiles().then((list) => {
      if (!cancelled) setProfiles(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

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

  const label = (profile: ProfileOption) =>
    profile.kind === "personal" ? t.profilePersonal : (profile.title ?? "")

  return { profiles, switching, switchTo, label }
}

/** Значок рабочего места: монограмма компании в её цвете или человечек у «Личного». */
function WorkspaceMark({ profile, className }: { profile: ProfileOption; className?: string }) {
  if (profile.kind === "company" && profile.accent && profile.monogram) {
    return (
      <CompanyMark monogram={profile.monogram} accent={profile.accent} className={className} />
    )
  }
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-foreground/15 text-muted-foreground",
        className,
      )}
    >
      <User className="h-3.5 w-3.5" />
    </span>
  )
}

/**
 * Переключатель рабочих мест в шапке бокового меню.
 *
 * Стоит на месте названия: название и так показывает, где человек сейчас, —
 * компанию или установку, — и переключатель отвечает на тот же вопрос. Профиль
 * один — это просто название: выбор из одного пункта был бы обещанием выбора,
 * которого нет. Профилей несколько — под названием подпись «… · сменить»:
 * одной стрелки оказалось мало, чтобы в нём узнали кнопку.
 *
 * Кнопки «выйти из компании» нет: «Личное» — такой же пункт, как компании.
 *
 * Админка — последний пункт того же списка, под чертой. Она не рабочее место
 * (профиль не меняется, перезагрузки нет), но с точки зрения меню это тот же
 * вопрос «что сейчас в левой колонке»: пользовательские разделы или админские.
 * Держать оба набора одной лентой значило растягивать панель на два экрана.
 */
export function ProfileSwitcher({
  label,
  admin,
}: {
  label: string
  /**
   * Вход в админку: только у тех, кому есть что в ней открыть. `active` — мы в
   * ней. `switchesProfile` — ссылка идёт через смену профиля на «Личное», и
   * переход обязан быть полной загрузкой, а не клиентским.
   */
  admin?: { href: string; active: boolean; switchesProfile: boolean } | null
}) {
  const { t } = useI18n()
  const router = useRouter()
  const { profiles, switching, switchTo, label: labelOf } = useWorkspaces()
  const inAdmin = Boolean(admin?.active)

  if (!admin && (!profiles || profiles.length < 2)) {
    return (
      <span className="flex-1 whitespace-nowrap text-[16px] font-semibold text-foreground">
        {label}
      </span>
    )
  }

  const current = profiles?.find((profile) => profile.current)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t.profileSwitcher}
          aria-label={t.profileSwitcher}
          className="-mx-1 flex min-w-0 flex-1 flex-col items-start rounded-md px-1 py-0.5 text-left outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5"
        >
          <span className="flex w-full min-w-0 items-center gap-1">
            <span className="truncate text-[16px] font-semibold leading-tight text-foreground">
              {inAdmin ? t.adminPanel : label}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </span>
          <span className="truncate text-[11px] leading-tight text-muted-foreground">
            {inAdmin
              ? t.profileAdminLabel
              : current?.kind === "company"
                ? t.profileCompanyLabel
                : t.profilePersonal}
            {" · "}
            <span className="text-primary/90">{t.profileSwitchShort}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {profiles && profiles.length > 0 ? (
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
            {t.profileSwitcher}
          </DropdownMenuLabel>
        ) : null}
        {(profiles ?? []).map((profile) => (
          <DropdownMenuItem
            key={profile.id}
            onSelect={(event) => {
              // Своё же рабочее место из админки — просто возврат в кабинет:
              // профиль не меняется, перезагружать нечего.
              if (profile.current) {
                if (inAdmin) router.push("/account")
                return
              }
              // Меню остаётся открытым, пока идёт переключение: иначе
              // пропадает крутилка, и секунда до перезагрузки выглядит зависанием.
              event.preventDefault()
              void switchTo(profile)
            }}
            className="gap-2.5"
          >
            <WorkspaceMark profile={profile} />
            <span className="min-w-0 flex-1 truncate">{labelOf(profile)}</span>
            {switching === profile.id ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : profile.current ? (
              // Из админки текущий профиль отмечен приглушённо: колонка сейчас
              // показывает не его, но вернёмся мы именно в него.
              <Check
                className={cn(
                  "h-4 w-4 shrink-0",
                  inAdmin ? "text-muted-foreground/60" : "text-primary",
                )}
              />
            ) : null}
          </DropdownMenuItem>
        ))}
        {admin ? (
          <>
            {profiles && profiles.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem asChild className="gap-2.5">
              {admin.switchesProfile ? (
                <a href={admin.href}>
                  <AdminItemBody label={t.adminPanel} active={false} />
                </a>
              ) : (
                <Link href={admin.href}>
                  <AdminItemBody label={t.adminPanel} active={inAdmin} />
                </Link>
              )}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AdminItemBody({ label, active }: { label: string; active: boolean }) {
  return (
    <>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-foreground/15 text-muted-foreground">
        <Shield className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
    </>
  )
}

/**
 * «Рабочие места» на дашборде — тот же выбор, что в шапке, но на виду.
 *
 * Дашборд — первое, что человек видит после входа, и дорогу в компанию надо
 * показывать прямо здесь: переключатель в шапке, как выяснилось, сам не
 * находится. Одно рабочее место — блока нет.
 */
export function WorkspacesCard() {
  const { t } = useI18n()
  const { profiles, switching, switchTo, label } = useWorkspaces()

  if (!profiles || profiles.length < 2) return null

  return (
    <section className="rounded-[18px] border border-foreground/10 bg-card/60 p-5 md:p-6">
      <h2 className="text-[16px] font-semibold text-foreground">{t.workspacesTitle}</h2>
      <p className="mt-1 max-w-[640px] text-[13px] text-muted-foreground">
        {t.workspacesSub}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {profiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            disabled={profile.current || switching !== null}
            onClick={() => void switchTo(profile)}
            className={cn(
              "flex min-w-0 items-center gap-3 rounded-[12px] border px-4 py-3 text-left transition-colors",
              profile.current
                ? "cursor-default border-primary/40 bg-primary/10"
                : "border-foreground/10 hover:border-foreground/25 hover:bg-foreground/[0.04] disabled:opacity-60",
            )}
          >
            <WorkspaceMark profile={profile} className="h-8 w-8 text-[12px]" />
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
              {label(profile)}
            </span>
            {switching === profile.id ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <span
                className={cn(
                  "shrink-0 text-[12px]",
                  profile.current ? "text-primary" : "text-muted-foreground",
                )}
              >
                {profile.current ? t.workspaceHere : t.workspaceOpen}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}
