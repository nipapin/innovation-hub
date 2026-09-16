"use client"

import { useRef, useState } from "react"
import { Check, Loader2, TriangleAlert, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { useI18n, tf } from "@/components/account/i18n"
import { Section } from "@/components/admin/billing/fields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ACCENT_KEYS,
  ACCENT_PRESETS,
  accentPair,
  isAccentKey,
  monogramFrom,
  type AccentValue,
} from "@/lib/branding"
import {
  accentContrast,
  hslToToken,
  nearestReadable,
  parseHex,
  rgbToHsl,
  tokenToHex,
  MIN_CONTRAST,
} from "@/lib/color-contrast"
import { cn } from "@/lib/utils"

export type BrandingDraft = {
  accent: AccentValue
  monogram: string | null
  logoUrl: string | null
  logoKey: string | null
  domain: string | null
}

/**
 * «Оформление компании» — акцент, значок, логотип, домен.
 *
 * Цвет свободный, читаемость нет: акцент — это фон кнопки, а текст на ней
 * задаёт тема. Отношение контраста считается прямо в поле, тем же кодом, что
 * проверяет сервер (lib/color-contrast.ts), и рядом лежит кнопка «подобрать» —
 * она двигает светлоту, оставляя тон, потому что человек выбирал СВОЙ цвет, а
 * не любой проходящий.
 */
export function CompanyBrandingPanel({
  companyId,
  companyTitle,
  initial,
  onSaved,
}: {
  companyId: string
  companyTitle: string
  initial: BrandingDraft
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [accent, setAccent] = useState<AccentValue>(initial.accent)
  const [monogram, setMonogram] = useState(initial.monogram ?? "")
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? "")
  const [domain, setDomain] = useState(initial.domain ?? "")
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /**
   * Выбранный файл ждёт сохранения ЗДЕСЬ, а не в хранилище.
   *
   * Раньше он уходил в R2 сразу при выборе, и человек, передумавший нажимать
   * «Сохранить», оставлял там объект, на который никто не ссылается. Теперь
   * загрузка — часть сохранения, поэтому осиротеть нечему: не сохранил — ничего
   * и не создалось.
   *
   * Предпросмотр берётся из самого файла (`URL.createObjectURL`), сети не
   * требует и виден мгновенно.
   */
  const [pending, setPending] = useState<{ file: File; preview: string } | null>(
    null,
  )

  const pair = accentPair(accent)
  const custom = !isAccentKey(accent)

  const setCustomSide = (theme: "light" | "dark", hex: string) => {
    const rgb = parseHex(hex)
    if (!rgb) return
    const token = hslToToken(rgbToHsl(rgb))
    setAccent({ ...pair, [theme]: token })
  }

  const contrast = {
    light: accentContrast(pair.light, "light"),
    dark: accentContrast(pair.dark, "dark"),
  }
  const readable = contrast.light >= MIN_CONTRAST && contrast.dark >= MIN_CONTRAST

  const pickFile = (file: File) => {
    if (pending) URL.revokeObjectURL(pending.preview)
    setPending({ file, preview: URL.createObjectURL(file) })
    if (fileRef.current) fileRef.current.value = ""
  }

  const clearLogo = () => {
    if (pending) URL.revokeObjectURL(pending.preview)
    setPending(null)
    setLogoUrl("")
  }

  /** Залить отложенный файл. Возвращает адрес и ключ либо null при неудаче. */
  const uploadPending = async (
    file: File,
  ): Promise<{ publicUrl: string; key: string } | null> => {
    const presign = await fetch(`/api/admin/companies/${companyId}/logo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, contentType: file.type }),
    })
    if (!presign.ok) {
      const body = (await presign.json().catch(() => ({}))) as { code?: string }
      toast.error(
        body.code === "unsupported-type" ? t.brandLogoType : t.brandLogoFailed,
      )
      return null
    }
    const { uploadUrl, publicUrl, key } = (await presign.json()) as {
      uploadUrl: string
      publicUrl: string
      key: string
    }
    const put = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    })
    if (!put.ok) {
      toast.error(t.brandLogoFailed)
      return null
    }
    return { publicUrl, key }
  }

  const save = async () => {
    setBusy(true)
    try {
      let nextUrl = logoUrl
      let nextKey = pending ? null : initial.logoKey
      if (pending) {
        const uploaded = await uploadPending(pending.file)
        if (!uploaded) return
        nextUrl = uploaded.publicUrl
        nextKey = uploaded.key
      }

      const res = await fetch(`/api/admin/companies/${companyId}/branding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accent,
          monogram,
          logoUrl: nextUrl,
          logoKey: nextKey,
          domain,
        }),
      })

      if (!res.ok) {
        // Файл уже в хранилище, а ссылаться на него теперь некому — сносим, иначе
        // он останется висеть навсегда. Лучшее усилие: не вышло снести — не повод
        // показывать вторую ошибку поверх первой.
        if (pending && nextKey) {
          void fetch(`/api/admin/companies/${companyId}/logo`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: nextKey }),
          }).catch(() => {})
        }
        const body = (await res.json().catch(() => ({}))) as { code?: string }
        toast.error(
          body.code === "domain-taken"
            ? t.brandDomainTaken
            : body.code === "low-contrast"
              ? t.brandContrastFail
              : t.coSaveFailed,
        )
        return
      }

      if (pending) URL.revokeObjectURL(pending.preview)
      setPending(null)
      setLogoUrl(nextUrl)
      toast.success(t.coSaved)
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={t.brandTitle} description={t.brandSub}>
      <div className="space-y-2">
        <Label>{t.brandAccent}</Label>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setAccent(key)}
              disabled={busy}
              aria-pressed={accent === key}
              title={key}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border p-1.5 transition-colors",
                accent === key
                  ? "border-primary ring-1 ring-primary"
                  : "border-border/60 hover:border-primary/40",
              )}
            >
              <span
                className="h-6 w-6 rounded-md"
                style={{ background: `hsl(${ACCENT_PRESETS[key].light})` }}
              />
              <span
                className="h-6 w-6 rounded-md"
                style={{ background: `hsl(${ACCENT_PRESETS[key].dark})` }}
              />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAccent({ ...pair })}
            disabled={busy}
            aria-pressed={custom}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm transition-colors",
              custom
                ? "border-primary ring-1 ring-primary"
                : "border-border/60 hover:border-primary/40",
            )}
          >
            {t.brandCustom}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">{t.brandAccentHint}</p>
      </div>

      {custom ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {(["light", "dark"] as const).map((theme) => (
            <CustomSide
              key={theme}
              theme={theme}
              token={pair[theme]}
              ratio={contrast[theme]}
              disabled={busy}
              onChange={(hex) => setCustomSide(theme, hex)}
              onFix={() => {
                const fixed = nearestReadable(pair[theme], theme)
                if (fixed) setAccent({ ...pair, [theme]: fixed })
                else toast.error(t.brandContrastHopeless)
              }}
            />
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="brand-monogram">{t.brandMonogram}</Label>
          <Input
            id="brand-monogram"
            maxLength={2}
            value={monogram}
            placeholder={monogramFrom(companyTitle)}
            onChange={(event) => setMonogram(event.target.value.toUpperCase())}
            disabled={busy}
          />
          <p className="text-[11px] text-muted-foreground">{t.brandMonogramHint}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="brand-domain">{t.brandDomain}</Label>
          <Input
            id="brand-domain"
            value={domain}
            placeholder="acme.example.com"
            onChange={(event) => setDomain(event.target.value.trim().toLowerCase())}
            disabled={busy}
          />
          <p className="text-[11px] text-muted-foreground">{t.brandDomainHint}</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t.brandLogo}</Label>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-surface-2 text-sm font-bold text-primary">
            {pending || logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pending ? pending.preview : logoUrl}
                alt=""
                className="h-full w-full object-contain"
              />
            ) : (
              monogram || monogramFrom(companyTitle)
            )}
          </span>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) pickFile(file)
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            {t.brandLogoUpload}
          </Button>
          {pending || logoUrl ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={clearLogo}>
              <X className="mr-2 h-4 w-4" />
              {t.brandLogoClear}
            </Button>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {pending ? t.brandLogoPending : t.brandLogoHint}
        </p>
      </div>

      <Button onClick={() => void save()} disabled={busy || !readable}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {t.saveChanges}
      </Button>
    </Section>
  )
}

/** Одна сторона пары: цвет, образец кнопки и отношение контраста. */
function CustomSide({
  theme,
  token,
  ratio,
  disabled,
  onChange,
  onFix,
}: {
  theme: "light" | "dark"
  token: string
  ratio: number
  disabled: boolean
  onChange: (hex: string) => void
  onFix: () => void
}) {
  const { t } = useI18n()
  const hex = tokenToHex(token)
  const ok = ratio >= MIN_CONTRAST

  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
      <Label htmlFor={`accent-${theme}`}>
        {theme === "light" ? t.brandForLight : t.brandForDark}
      </Label>

      <div className="flex items-center gap-2">
        <input
          id={`accent-${theme}`}
          type="color"
          value={hex}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border border-border/60 bg-transparent p-0.5"
        />
        <Input
          value={hex}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 font-mono text-sm"
        />
      </div>

      {/* Образец ровно того, ради чего проверка: подпись на кнопке. */}
      <div
        className="flex h-9 items-center justify-center rounded-md text-[13px] font-medium"
        style={{
          background: `hsl(${token})`,
          color: theme === "light" ? "#ffffff" : "hsl(224 44% 11%)",
        }}
      >
        {t.brandSample}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "flex items-center gap-1.5 text-[11px]",
            ok ? "text-success" : "text-destructive",
          )}
        >
          {ok ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <TriangleAlert className="h-3.5 w-3.5" />
          )}
          {tf(ok ? t.brandContrastOk : t.brandContrastLow, {
            ratio: ratio.toFixed(2),
            min: MIN_CONTRAST.toFixed(1),
          })}
        </span>
        {ok ? null : (
          <button
            type="button"
            onClick={onFix}
            disabled={disabled}
            className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
          >
            {t.brandContrastFix}
          </button>
        )}
      </div>
    </div>
  )
}
