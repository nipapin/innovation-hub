"use client"

import { useState } from "react"
import {
  AlertTriangle,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { tf, useI18n } from "@/components/account/i18n"
import { ConnectAccountDialog } from "@/components/account/social/connect-dialog"
import { useSocialAccounts } from "@/components/account/social/use-social-accounts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  SOCIAL_PLATFORM_INFO,
  type SocialAccount,
} from "@/lib/social/types"

/**
 * «Аккаунты площадок» — то, чем сайт публикует ролики от имени человека.
 *
 * Аккаунт ОДИН НА ВСЕ ЕГО ПРОЕКТЫ: подключил однажды — работает везде. Поэтому
 * экран отдельный, а не поле внутри проекта: иначе замена протухшего токена
 * превращалась бы в «найди тот проект, где я его вводил». Ровно та же логика,
 * что у «Ключей сервисов» по соседству.
 *
 * ⚠️ Токен наружу не отдаётся никогда — даже владельцу. Видно `••••4f21` и
 * даты; заменить можно, посмотреть нельзя.
 */

/** Подпись целей у площадки: сообщества, каналы. */
const TARGETS_LABEL = {
  vk: "socialTargetsVk",
  telegram: "socialTargetsTelegram",
  youtube: "socialTargetsYoutube",
} as const

const TARGETS_EMPTY = {
  vk: "socialTargetsEmptyVk",
  telegram: "socialTargetsEmptyTelegram",
  youtube: "socialTargetsEmptyYoutube",
} as const

export function SocialAccountsPage() {
  const { t, lang } = useI18n()
  const { value, loading, error, reload } = useSocialAccounts()
  const [connectOpen, setConnectOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })

  const refresh = async (account: SocialAccount) => {
    setBusyId(account.id)
    try {
      const res = await fetch(
        `/api/account/social-accounts/${account.id}/targets`,
        { method: "POST" },
      )
      const body = (await res.json()) as { message?: string }
      if (!res.ok) throw new Error(body.message ?? String(res.status))
      toast.success(t.socialRefreshed)
      await reload()
    } catch (cause) {
      toast.error(
        `${t.socialErrRejected}: ${cause instanceof Error ? cause.message : ""}`,
      )
      // Перечитываем и на отказе: сервер записал причину в аккаунт, и она
      // должна оказаться на карточке, а не только в исчезающем тосте.
      await reload()
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (account: SocialAccount) => {
    if (!window.confirm(t.socialRemoveConfirm)) return
    setBusyId(account.id)
    try {
      const res = await fetch(`/api/account/social-accounts/${account.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error(String(res.status))
      toast.success(t.socialRemoved)
      await reload()
    } catch {
      toast.error(t.socialErrLoad)
    } finally {
      setBusyId(null)
    }
  }

  const rename = async (account: SocialAccount) => {
    const label = renameDraft.trim()
    if (!label || label === account.label) {
      setRenamingId(null)
      return
    }
    setBusyId(account.id)
    try {
      const res = await fetch(`/api/account/social-accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast.success(t.socialRenamed)
      setRenamingId(null)
      await reload()
    } catch {
      toast.error(t.socialErrLoad)
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">{t.socialTitle}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t.socialSub}
        </p>
      </header>

      {error ? (
        <p className="rounded-lg border border-destructive/40 px-4 py-3 text-sm text-destructive">
          {t.socialErrLoad}
        </p>
      ) : null}

      {/* Список не прочитался — это не «аккаунтов нет». Пустой экран без
          объяснения отправил бы человека подключать аккаунт заново поверх уже
          подключённого. */}
      {value.accountsError ? (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/40 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {tf(t.socialErrAccounts, { message: value.accountsError })}
        </p>
      ) : null}

      {/* Сейф не настроен — говорим об этом до формы, а не после заполненной. */}
      {value.vaultReady ? null : (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 px-4 py-3 text-sm text-amber-200/90">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t.socialVaultOff}
        </p>
      )}

      {value.accounts.length === 0 ? (
        <p className="rounded-lg border border-border/60 px-4 py-6 text-sm text-muted-foreground">
          {t.socialEmpty}
        </p>
      ) : (
        <div className="space-y-2">
          {value.accounts.map((account) => {
            const platform = SOCIAL_PLATFORM_INFO[account.platform]
            const busy = busyId === account.id
            return (
              <div
                key={account.id}
                className="space-y-2 rounded-lg border border-border/60 px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="text-sm font-medium">{platform.name}</span>

                  {renamingId === account.id ? (
                    <span className="flex items-center gap-1.5">
                      <Input
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        className="h-7 w-48 text-[13px]"
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void rename(account)}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  ) : (
                    <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {account.label}
                    </span>
                  )}

                  {account.secretHint ? (
                    <span className="font-mono text-sm">
                      {account.secretHint}
                    </span>
                  ) : null}

                  {account.checkedAt ? (
                    <span className="text-xs text-muted-foreground">
                      {tf(t.socialCheckedAt, { date: date(account.checkedAt) })}
                    </span>
                  ) : null}

                  <div className="ml-auto flex gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void refresh(account)}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      {t.socialRefresh}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setRenamingId(account.id)
                        setRenameDraft(account.label)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void remove(account)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Имя уезжает в граф — предупреждаем ровно там, где его правят. */}
                {renamingId === account.id ? (
                  <p className="text-[11.5px] leading-relaxed text-amber-200/80">
                    {t.socialLabelWarn}
                  </p>
                ) : null}

                {/* Отказ площадки виден на карточке, а не только в тосте: токен
                    протухает молча, и узнать об этом надо здесь. */}
                {account.lastError ? (
                  <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-destructive">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {t.socialTokenBad}: {account.lastError}
                    </span>
                  </p>
                ) : null}

                <div className="text-[12.5px] leading-relaxed text-muted-foreground">
                  <span className="text-ws-3">
                    {t[TARGETS_LABEL[account.platform]]}
                  </span>
                  {account.targets.length === 0 ? (
                    <span className="ml-2">
                      {t[TARGETS_EMPTY[account.platform]]}
                    </span>
                  ) : (
                    <span className="ml-2">
                      {account.targets.map((target) => target.name).join(" · ")}
                    </span>
                  )}
                  {account.targetsAt ? (
                    <span className="ml-2 text-ws-4">
                      ({tf(t.socialTargetsAt, { date: date(account.targetsAt) })})
                    </span>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Button
        type="button"
        size="sm"
        disabled={!value.vaultReady}
        onClick={() => setConnectOpen(true)}
      >
        <Plus className="h-4 w-4" />
        {t.socialConnect}
      </Button>

      <ConnectAccountDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        platforms={value.platforms}
        onConnected={() => void reload()}
      />
    </div>
  )
}
