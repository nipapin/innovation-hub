"use client"

import { useEffect, useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { cn } from "@/lib/utils"
import { tf } from "@/components/account/i18n"
import { useWorkspace } from "./workspace-context"

/** Диалоги ввода имени и подтверждения — замена нативным prompt() / confirm(). */
export function WorkspaceDialogs() {
  const { t, prompt, setPrompt, confirm, setConfirm, conflict } = useWorkspace()
  const [value, setValue] = useState("")
  /** «Так же с остальными» — сбрасывается на каждый новый вопрос. */
  const [applyAll, setApplyAll] = useState(false)
  useEffect(() => {
    if (conflict) setApplyAll(false)
  }, [conflict])

  useEffect(() => {
    if (prompt) setValue(prompt.initial)
  }, [prompt])

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed || !prompt) return
    prompt.onSubmit(trimmed)
    setPrompt(null)
  }

  return (
    <>
      <Dialog open={!!prompt} onOpenChange={(open) => !open && setPrompt(null)}>
        {/* Описания нет — что вводить, говорит подпись у поля. См. ui/dialog.tsx. */}
        <DialogContent
          aria-describedby={undefined}
          className="border-border/60 bg-ws-raised sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle className="text-[16px] font-semibold text-ws-1">
              {prompt?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ws-prompt" className="text-[12px] text-ws-3">
              {prompt?.label}
            </Label>
            <Input
              id="ws-prompt"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  submit()
                }
              }}
              className="h-10 rounded-[9px] border-foreground/10 bg-ws-control text-[14px] text-ws-1 focus-visible:border-ws-select focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="text-ws-2"
              onClick={() => setPrompt(null)}
            >
              {t.cancel}
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={!value.trim()}
              className="bg-ws-action text-white hover:bg-ws-action-hover"
            >
              {prompt?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent
          // Описание у подтверждения необязательное (ConfirmRequest#description);
          // когда его нет — отказываемся от него явно, как в ui/dialog.tsx.
          {...(confirm?.description
            ? {}
            : { "aria-describedby": undefined })}
          className="border-border/60 bg-ws-raised"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-ws-1">
              {confirm?.title}
            </AlertDialogTitle>
            {confirm?.description ? (
              <AlertDialogDescription className="text-ws-3">
                {confirm.description}
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-foreground/10 bg-transparent text-ws-2 hover:bg-foreground/5 hover:text-ws-1">
              {t.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirm?.onConfirm()}
              className={cn(
                confirm?.destructive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-ws-action text-white hover:bg-ws-action-hover",
              )}
            >
              {confirm?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        Занятое имя при заливке. Спрашиваем до отправки байтов, поэтому окно
        обычное, а не подтверждение: у вопроса три ответа, а не «да / нет».
        Закрытие крестиком равно «пропустить» — молча оборвать очередь заливки
        хуже, чем не залить один файл.
      */}
      <Dialog
        open={!!conflict}
        onOpenChange={(open) => {
          if (!open) conflict?.decide("skip", false)
        }}
      >
        <DialogContent className="border-border/60 bg-ws-raised sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[15px] text-ws-1">
              {t.conflictTitle}
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed text-ws-3">
              {conflict
                ? tf(t.conflictBody, {
                    name: conflict.name,
                    where: conflict.folderPath
                      ? tf(t.conflictInFolder, { folder: conflict.folderPath })
                      : t.conflictInRoot,
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5 text-[12px] text-ws-4">
            <span>{t.conflictOverwriteHint}</span>
            <span>
              {conflict
                ? tf(t.conflictKeepBothHint, { name: conflict.suggestion })
                : ""}
            </span>
          </div>

          {conflict && conflict.rest > 0 ? (
            <label className="flex items-center gap-2 text-[12.5px] text-ws-3">
              <input
                type="checkbox"
                checked={applyAll}
                onChange={(e) => setApplyAll(e.target.checked)}
                className="h-3.5 w-3.5 accent-ws-action"
              />
              {tf(t.conflictApplyAll, { count: conflict.rest })}
            </label>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="ghost"
              onClick={() => conflict?.decide("skip", applyAll)}
              className="text-ws-3 hover:bg-foreground/5 hover:text-ws-1"
            >
              {t.conflictSkip}
            </Button>
            <span className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => conflict?.decide("rename", applyAll)}
                className="border-foreground/10 bg-transparent text-ws-2 hover:bg-foreground/5 hover:text-ws-1"
              >
                {t.conflictKeepBoth}
              </Button>
              <Button
                onClick={() => conflict?.decide("overwrite", applyAll)}
                className="bg-ws-action text-white hover:bg-ws-action-hover"
              >
                {t.conflictOverwrite}
              </Button>
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
