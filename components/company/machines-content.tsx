"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Copy, Loader2, Monitor, Plus } from "lucide-react"
import { toast } from "sonner"
import { tf, useI18n } from "@/components/account/i18n"
import { Section } from "@/components/admin/billing/fields"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

type Machine = {
  id: string
  name: string
  description: string
  status: string
  online: boolean
  currentProjectName: string | null
  createdAt: string
}

/**
 * «Машины» — свои компьютеры компании (docs/COMPANY_PIPELINE_PLAN.md §2).
 *
 * Токен показывается ОДИН раз, сразу после выдачи: в базе лежит только его
 * отпечаток, и достать его второй раз неоткуда. Поэтому он не прячется в
 * подсказку и не исчезает сам — закрыть панель можно только руками.
 */
export function CompanyMachines() {
  const { t, lang } = useI18n()
  const [machines, setMachines] = useState<Machine[]>([])
  const [ownOnly, setOwnOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState("")
  const [note, setNote] = useState("")
  /** Выданный токен ждёт, пока его сохранят. Не тост: тост уедет сам. */
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/company/machines", { cache: "no-store" })
      if (!res.ok) {
        toast.error(t.coLoadFailed)
        return
      }
      const body = (await res.json()) as {
        machines: Machine[]
        ownMachinesOnly: boolean
      }
      setMachines(body.machines)
      setOwnOnly(body.ownMachinesOnly)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/company/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: note.trim() }),
      })
      if (!res.ok) {
        toast.error(t.coSaveFailed)
        return
      }
      const body = (await res.json()) as { name: string; token: string }
      setIssued({ name: body.name, token: body.token })
      setName("")
      setNote("")
      await load()
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (machine: Machine) => {
    if (!confirm(tf(t.coMachinesRevokeConfirm, { name: machine.name }))) return
    setBusy(true)
    try {
      const res = await fetch(`/api/company/machines/${machine.id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        toast.error(t.coSaveFailed)
        return
      }
      toast.success(t.coMachinesRevoked)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const rotate = async (machine: Machine) => {
    if (!confirm(tf(t.coMachinesRotateConfirm, { name: machine.name }))) return
    setBusy(true)
    try {
      const res = await fetch(`/api/company/machines/${machine.id}`, {
        method: "POST",
      })
      if (!res.ok) {
        toast.error(t.coSaveFailed)
        return
      }
      const body = (await res.json()) as { token: string }
      setIssued({ name: machine.name, token: body.token })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const setOwnMachinesOnly = async (next: boolean) => {
    // Показываем сразу, откатываем при отказе: переключатель, думающий полсекунды
    // после нажатия, читается как «не сработало», и его жмут второй раз.
    setOwnOnly(next)
    setBusy(true)
    try {
      const res = await fetch("/api/company/machines", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownMachinesOnly: next }),
      })
      if (!res.ok) {
        setOwnOnly(!next)
        toast.error(t.coSaveFailed)
        return
      }
      toast.success(t.coMachinesPolicySaved)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      toast.success(t.coMachinesTokenCopied)
    } catch {
      // Буфер недоступен — токен и так на экране, его можно выделить.
    }
  }

  return (
    <div className="space-y-6">
      {issued ? (
        <Section title={t.coMachinesTokenTitle} description={t.coMachinesTokenHint}>
          <p className="text-sm font-medium text-foreground">{issued.name}</p>
          <code className="block break-all rounded-lg border border-primary/40 bg-primary/10 p-3 font-mono text-[13px] text-foreground">
            {issued.token}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void copy(issued.token)}>
              {copied ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {t.coMachinesTokenCopy}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setIssued(null)
                setCopied(false)
              }}
            >
              {t.coMachinesTokenDone}
            </Button>
          </div>
        </Section>
      ) : null}

      <Section title={t.coMachinesTitle} description={t.coMachinesSub}>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : machines.length === 0 ? (
          /* Без машин текст зависит от флага: «идёт на наших» и «очередь стоит»
             — противоположные исходы, и показывать первый при включённом
             запрете значило бы обещать обработку, которой не будет. */
          <p
            className={cn(
              "text-sm",
              ownOnly ? "text-amber-400" : "text-muted-foreground",
            )}
          >
            {ownOnly ? t.coMachinesEmptyHeld : t.coMachinesEmpty}
          </p>
        ) : (
          <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
            {machines.map((machine) => (
              <li
                key={machine.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <Monitor
                  className={cn(
                    "h-4 w-4 shrink-0",
                    machine.online ? "text-success" : "text-muted-foreground",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {machine.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {machine.currentProjectName ?? machine.description}
                  </span>
                </span>
                <Badge variant={machine.online ? "default" : "secondary"}>
                  {machine.online
                    ? machine.status === "busy"
                      ? t.coMachinesBusy
                      : t.coMachinesOnline
                    : t.coMachinesOffline}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(machine.createdAt).toLocaleDateString(lang)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void rotate(machine)}
                >
                  {t.coMachinesRotate}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void revoke(machine)}
                >
                  {t.coMachinesRevoke}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t.coMachinesPolicyTitle} description={t.coMachinesPolicyHint}>
        <div className="flex items-start gap-3">
          <Switch
            id="own-machines-only"
            checked={ownOnly}
            disabled={busy || loading}
            onCheckedChange={(checked) => void setOwnMachinesOnly(checked)}
          />
          <Label htmlFor="own-machines-only" className="leading-snug">
            <span className="block text-sm text-foreground">
              {t.coMachinesPolicyLabel}
            </span>
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              {ownOnly ? t.coMachinesPolicyOn : t.coMachinesPolicyOff}
            </span>
          </Label>
        </div>
      </Section>

      <Section title={t.coMachinesAdd}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="machine-name">{t.coMachinesName}</Label>
            <Input
              id="machine-name"
              value={name}
              placeholder={t.coMachinesNamePlaceholder}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="machine-note">{t.coMachinesNote}</Label>
            <Input
              id="machine-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={busy}
            />
          </div>
        </div>
        <Button onClick={() => void create()} disabled={busy || name.trim().length < 2}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          {t.coMachinesCreate}
        </Button>
      </Section>
    </div>
  )
}
