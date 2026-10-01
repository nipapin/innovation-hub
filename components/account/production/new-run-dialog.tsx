"use client"

import { useEffect, useState } from "react"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/account/i18n"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type Launchable = { id: string; name: string; version: number; description: string }

/**
 * «Новый ролик» — docs/PRODUCTION_PLAN.md §9.2, решение 2026-09-30.
 *
 * Сначала пайплайн (теги, выбрать можно один) — под ним его описание из ноды
 * «Старт», подсказка, что здесь происходит; затем название ролика. Кнопку
 * видно всем, но активна она у тех, кому есть что запускать.
 */
export function NewRunButton({ onLaunched }: { onLaunched?: (runId: string) => void }) {
  const { t } = useI18n()
  const [pipelines, setPipelines] = useState<Launchable[] | null>(null)
  const [open, setOpen] = useState(false)
  const [pipelineId, setPipelineId] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void fetch("/api/production/runs/launchable", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { pipelines: [] }))
      .then((body: { pipelines: Launchable[] }) => {
        if (alive) setPipelines(body.pipelines)
      })
    return () => {
      alive = false
    }
  }, [])

  const canLaunch = (pipelines?.length ?? 0) > 0

  const pick = (p: Launchable) => setPipelineId(p.id)
  const chosen = pipelines?.find((p) => p.id === pipelineId)

  const openDialog = () => {
    setOpen(true)
    if (pipelines?.length === 1) pick(pipelines[0])
  }

  const launch = async () => {
    if (!pipelineId || !name.trim()) return
    setBusy(true)
    try {
      const res = await fetch("/api/production/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineId, name: name.trim(), tzOffsetMin: new Date().getTimezoneOffset() }),
      })
      const body = (await res.json().catch(() => ({}))) as { runId?: string; code?: string }
      if (!res.ok || !body.runId) {
        toast.error(
          body.code === "name-taken"
            ? t.productionRunNameTaken
            : body.code === "bad-path"
              ? t.productionRunBadName
              : body.code === "storage"
                ? t.productionEdStorage
                : t.productionRunFailed,
        )
        return
      }
      toast.success(t.productionRunLaunched)
      setOpen(false)
      setName("")
      setPipelineId("")
      onLaunched?.(body.runId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={!canLaunch}
        onClick={openDialog}
        title={canLaunch ? undefined : t.productionRunNothing}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] bg-ws-action px-3 text-[13px] font-medium text-primary-foreground hover:bg-ws-action-hover disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        {t.productionNewRun}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.productionNewRun}</DialogTitle>
            <DialogDescription>{t.productionRunDialogHint}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-[13px] text-ws-2">{t.productionPipelines}</p>
              <div className="flex flex-wrap gap-1.5">
                {(pipelines ?? []).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick(p)}
                    aria-pressed={p.id === pipelineId}
                    className={cn(
                      "h-8 rounded-full border px-3 text-[13px] transition-colors",
                      p.id === pipelineId
                        ? "border-ws-action bg-ws-action text-primary-foreground"
                        : "border-foreground/10 bg-ws-control text-ws-2 hover:bg-ws-hover",
                    )}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              {chosen?.description ? (
                <p className="whitespace-pre-line rounded-[9px] bg-ws-well px-3 py-2 text-[12.5px] leading-relaxed text-ws-3">
                  {chosen.description}
                </p>
              ) : null}
            </div>
            <label className="block space-y-1.5 text-[13px] text-ws-2">
              {t.productionRunName}
              <input
                value={name}
                disabled={!pipelineId}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void launch()}
                placeholder={pipelineId ? t.productionRunNamePlaceholder : t.productionRunPickFirst}
                className="h-9 w-full rounded-[9px] border border-foreground/10 bg-ws-control px-3 text-[13.5px] text-ws-1 outline-none placeholder:text-ws-5 disabled:opacity-60"
              />
            </label>
          </div>
          <DialogFooter>
            <button
              type="button"
              disabled={busy || !pipelineId || !name.trim()}
              onClick={() => void launch()}
              className="flex h-9 items-center gap-1.5 rounded-[9px] bg-ws-action px-4 text-[13.5px] font-medium text-primary-foreground hover:bg-ws-action-hover disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t.productionRunLaunch}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
