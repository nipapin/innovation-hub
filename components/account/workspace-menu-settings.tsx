"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { useI18n } from "@/components/account/i18n"
import type { WorkspaceNavKey } from "@/lib/workspace-nav"

/**
 * Что показывать в боковом меню (миграция 2026-10-01-workspace-visibility.sql).
 *
 * «Личное» — одна настройка на вход, видна из любого профиля, если есть хоть
 * одна компания: без компаний скрыть его нельзя, войти было бы некуда. Пункты —
 * свои у каждого профиля.
 */
export function WorkspaceMenuSettings({
  isPersonal,
  personalHidden: initialPersonalHidden,
  firstCompanyProfileId,
  hiddenNav: initialHiddenNav,
  production,
}: {
  isPersonal: boolean
  personalHidden: boolean
  firstCompanyProfileId: string | null
  hiddenNav: WorkspaceNavKey[]
  production: boolean
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [personalHidden, setPersonalHidden] = useState(initialPersonalHidden)
  const [hiddenNav, setHiddenNav] = useState(initialHiddenNav)
  const [busy, setBusy] = useState(false)

  const items: { key: WorkspaceNavKey; label: string }[] = [
    { key: "dashboard", label: t.dashboard },
    { key: "projects", label: t.projects },
    ...(production ? [{ key: "production" as const, label: t.productionNav }] : []),
    { key: "tools", label: t.toolsTab },
    { key: "archive", label: t.archiveTab },
    { key: "trash", label: t.trashTab },
    ...(isPersonal ? [{ key: "keys" as const, label: t.keysAreaNav }] : []),
  ]
  const visibleCount = items.filter((item) => !hiddenNav.includes(item.key)).length

  const patch = async (body: { personalHidden?: boolean; hiddenNav?: WorkspaceNavKey[] }) => {
    setBusy(true)
    try {
      const res = await fetch("/api/account/workspace-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error("save")
      return true
    } catch {
      toast.error(t.menuSettingsFailed)
      return false
    } finally {
      setBusy(false)
    }
  }

  const toggleItem = async (key: WorkspaceNavKey, show: boolean) => {
    const next = show ? hiddenNav.filter((k) => k !== key) : [...hiddenNav, key]
    const prev = hiddenNav
    setHiddenNav(next)
    if (await patch({ hiddenNav: next })) router.refresh()
    else setHiddenNav(prev)
  }

  const togglePersonal = async (show: boolean) => {
    setPersonalHidden(!show)
    if (!(await patch({ personalHidden: !show }))) {
      setPersonalHidden(show)
      return
    }
    // Скрыли «Личное», сидя в нём, — уходим в компанию: оставаться в разделе,
    // которого больше нет в переключателе, странно.
    if (!show && isPersonal && firstCompanyProfileId) {
      window.location.href = `/api/auth/switch-profile?${new URLSearchParams({
        to: firstCompanyProfileId,
        next: "/account/profile",
      }).toString()}`
      return
    }
    // Не `router.refresh()`: переключатель держит список профилей до
    // перезагрузки страницы (profile-switcher.tsx).
    window.location.reload()
  }

  return (
    <section className="mt-6 rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-5 md:p-7">
      <h3 className="text-[20px] font-bold md:text-[22px]">{t.menuSettingsTitle}</h3>
      <p className="mt-1.5 text-[14px] text-muted-foreground">{t.menuSettingsSub}</p>

      <div className="mt-5 divide-y divide-foreground/[0.07]">
        {items.map((item) => {
          const visible = !hiddenNav.includes(item.key)
          return (
            <label key={item.key} className="flex items-center justify-between gap-4 py-3 text-[15px]">
              {item.label}
              <Switch
                checked={visible}
                // Последний видимый пункт не снять: пустое меню — тупик.
                disabled={busy || (visible && visibleCount <= 1)}
                onCheckedChange={(checked) => void toggleItem(item.key, checked)}
              />
            </label>
          )
        })}
      </div>

      {firstCompanyProfileId ? (
        <div className="mt-5 border-t border-foreground/10 pt-5">
          <label className="flex items-center justify-between gap-4 text-[15px] font-medium">
            {t.menuSettingsPersonal}
            <Switch
              checked={!personalHidden}
              disabled={busy}
              onCheckedChange={(checked) => void togglePersonal(checked)}
            />
          </label>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{t.menuSettingsPersonalHint}</p>
        </div>
      ) : null}
    </section>
  )
}
