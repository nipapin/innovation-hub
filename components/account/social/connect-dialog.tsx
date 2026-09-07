"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ExternalLink, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { vkAuthorizeUrl } from "@/lib/social/vk"
import type { SocialAccount, SocialPlatform } from "@/lib/social/types"

/**
 * Подключение аккаунта площадки.
 *
 * Вкладка со входом открывается САМА, как только известна площадка: лишний клик
 * по кнопке между «хочу подключить» и «вошёл» не решает ничего — человек всё
 * равно идёт входить. Так же ведёт себя программа: «Add New Account» сразу
 * открывает окно логина, а не предлагает открыть его ещё раз.
 *
 * Кнопка при этом остаётся и никуда не девается: браузер имеет право заблокировать
 * открытие вкладки, а человек — закрыть её случайно. Она же обязана работать,
 * когда список аккаунтов не прочитался: адрес входа статический и от базы не
 * зависит (см. GET /api/account/social-accounts).
 *
 * Повторяет вторую ветку `VkAccountDDM.tsx` из программы — ту, что там названа
 * «Вставить токен вручную». Первая ветка (окно логина, которое само ловит
 * токен) в браузер не переносится: после входа вкладка стоит на домене
 * площадки, и прочитать её адрес со своей страницы запрещает политика
 * источников, а токен вдобавок лежит во фрагменте, который на сервер вообще не
 * уходит. Разбор и что даст своё приложение VK — docs/SOCIAL_POSTING_PLAN.md
 * §5.1.1.
 *
 * Диалог общий для двух мест: страницы аккаунтов в кабинете и выпадающего
 * списка в настройках проекта. Второе важнее первого — человек выбирает
 * аккаунт там, где настраивает постинг, и уходить за ним на другую страницу,
 * теряя несохранённые правки, он не должен.
 */

export type PlatformOption = {
  slug: SocialPlatform
  name: string
  connectable: boolean
  posting: boolean
  authUrl: string | null
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  platforms: PlatformOption[]
  /** С какой площадки открыть. Задан — выбор площадки не показываем. */
  platform?: SocialPlatform
  onConnected: (account: SocialAccount) => void
}

export function ConnectAccountDialog({
  open,
  onOpenChange,
  platforms,
  platform,
  onConnected,
}: Props) {
  const { t } = useI18n()
  const [slug, setSlug] = useState<SocialPlatform | "">(platform ?? "")
  const [raw, setRaw] = useState("")
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  /** Браузер не дал открыть вкладку. Тогда кнопка — единственный путь. */
  const [loginBlocked, setLoginBlocked] = useState(false)
  /** Для какой площадки вкладку уже открывали: повторно не дёргаем. */
  const openedFor = useRef<string | null>(null)

  // Каждое открытие начинается с чистой формы: вставленный токен — последнее,
  // что стоит оставлять лежать в состоянии закрытого диалога.
  useEffect(() => {
    if (!open) return
    setSlug(platform ?? "")
    setRaw("")
    setLabel("")
    setError("")
    setLoginBlocked(false)
    openedFor.current = null
  }, [open, platform])

  const current = platforms.find((item) => item.slug === slug) ?? null

  /**
   * Адрес входа. Обычно приходит с сервера вместе с каталогом площадок; когда
   * каталог не приехал, берём его сами — модуль VK чистый и в браузере
   * работает. Иначе сломанная база забирала бы и вход тоже.
   */
  const authUrl =
    current?.authUrl ?? (slug === "vk" ? vkAuthorizeUrl() : null)
  /** Подключать нечего, пока площадка не выбрана; неподключаемую тоже не даём. */
  const connectable = current ? current.connectable : slug !== ""

  const openLogin = useCallback(() => {
    if (!authUrl) return
    const tab = window.open(authUrl, "_blank", "noopener,noreferrer")
    setLoginBlocked(tab === null)
  }, [authUrl])

  // Открываем вкладку, как только площадка известна. Это происходит внутри
  // окна пользовательской активации (диалог открыли кликом), поэтому блокировщик
  // обычно пропускает; если нет — говорим об этом и оставляем кнопку.
  useEffect(() => {
    if (!open || !authUrl || openedFor.current === slug) return
    openedFor.current = slug
    openLogin()
  }, [open, slug, authUrl, openLogin])

  const hint =
    slug === "telegram"
      ? t.socialPasteTelegram
      : slug === "vk"
        ? t.socialPasteVk
        : ""

  const submit = async () => {
    if (!slug || !raw.trim()) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/account/social-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: slug,
          raw: raw.trim(),
          label: label.trim() || undefined,
        }),
      })
      const body = (await res.json()) as {
        account?: SocialAccount
        replaced?: boolean
        code?: string
        message?: string
      }

      if (!res.ok || !body.account) {
        // Отказ площадки показываем её же словами: «User authorization failed»
        // говорит человеку больше, чем наш пересказ, а перевести его нам нечем.
        setError(
          body.code === "invalid-input"
            ? t.socialErrParse
            : body.code === "vault"
              ? t.socialErrVault
              : `${t.socialErrRejected}: ${body.message ?? res.status}`,
        )
        return
      }

      toast.success(body.replaced ? t.socialReplacedToast : t.socialConnected)
      onConnected(body.account)
      onOpenChange(false)
    } catch {
      setError(t.socialErrLoad)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.socialConnectTitle}</DialogTitle>
          <DialogDescription className="whitespace-pre-line">
            {hint}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {platform ? null : (
            <div className="space-y-1.5">
              <Label>{t.socialPlatform}</Label>
              <Select
                value={slug}
                onValueChange={(next) => setSlug(next as SocialPlatform)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.socialPlatform} />
                </SelectTrigger>
                <SelectContent>
                  {platforms.map((item) => (
                    <SelectItem
                      key={item.slug}
                      value={item.slug}
                      // Неподключаемую площадку показываем, но выбрать нельзя:
                      // спрятать её значило бы ответить «такой площадки нет» на
                      // вопрос «а когда будет YouTube».
                      disabled={!item.connectable}
                    >
                      {item.name}
                      {item.connectable ? "" : ` — ${t.socialSoon}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {current && !current.posting ? (
            <p className="rounded-md border border-border/60 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
              {t.socialNoPosting}
            </p>
          ) : null}

          {authUrl ? (
            <div className="space-y-1.5">
              <Button
                type="button"
                variant={loginBlocked ? "default" : "outline"}
                size="sm"
                onClick={openLogin}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {loginBlocked ? t.socialOpenLogin : t.socialOpenLoginAgain}
              </Button>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                {loginBlocked ? t.socialLoginBlocked : t.socialLoginOpened}
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="social-raw">{t.socialPaste}</Label>
            <Textarea
              id="social-raw"
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              rows={3}
              className="font-mono text-[12px]"
              autoFocus
              disabled={!slug || !connectable}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="social-label">{t.socialLabelField}</Label>
            <Input
              id="social-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              disabled={!slug || !connectable}
            />
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {t.socialLabelHint}
            </p>
          </div>

          {error ? (
            <p className="text-[12.5px] leading-relaxed text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            disabled={busy || !slug || !raw.trim() || !connectable}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t.socialSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
