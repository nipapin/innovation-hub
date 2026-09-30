"use client"

import { useEffect, useState } from "react"
import { Check, Copy, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { tf, useAdminI18n } from "@/components/admin/admin-dict"
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
import { Textarea } from "@/components/ui/textarea"

type Props = {
  open: boolean
  computerId: string | null
  computerName: string
  computerDescription: string
  onOpenChange: (open: boolean) => void
  /** Описание могли поправить — список надо перечитать. */
  onRotated?: () => void
}

export function RotateTokenDialog({
  open,
  computerId,
  computerName,
  computerDescription,
  onOpenChange,
  onRotated,
}: Props) {
  const t = useAdminI18n()
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [description, setDescription] = useState(computerDescription)

  // Подставляем текущее описание при каждом открытии, а не один раз при монтировании.
  useEffect(() => {
    if (open) setDescription(computerDescription)
  }, [open, computerDescription])

  const resetAndClose = (next: boolean) => {
    if (!next) {
      setToken(null)
      setCopied(false)
      setLoading(false)
    }
    onOpenChange(next)
  }

  const handleRotate = async () => {
    if (!computerId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/admin/computers/${computerId}/rotate-token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: description.trim() }),
        },
      )
      const data = (await res.json()) as { message?: string; token?: string }
      if (!res.ok || !data.token) {
        toast.error(data.message ?? t.remoteRotateError)
        return
      }
      setToken(data.token)
      toast.success(t.remoteRotated)
      onRotated?.()
    } catch {
      toast.error(t.remoteRotateError)
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      toast.success(t.remoteTokenCopied)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t.remoteTokenCopyError)
    }
  }

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {token ? t.remoteNewToken : t.remoteRotateTitle}
          </DialogTitle>
          <DialogDescription>
            {token
              ? computerName
                ? tf(t.remoteRotateTokenFor, { name: computerName })
                : t.remoteTokenSaveNow
              : computerName
                ? tf(t.remoteRotateWarnFor, { name: computerName })
                : t.remoteRotateWarn}
          </DialogDescription>
        </DialogHeader>

        {token ? (
          <div className="space-y-3">
            <Label>{t.remoteBearerToken}</Label>
            <div className="flex gap-2">
              <Input readOnly value={token} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void handleCopy()}
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="rotate-desc">{t.remoteDescOptional}</Label>
            <Textarea
              id="rotate-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.remoteDescPlaceholder}
              maxLength={500}
              rows={2}
              disabled={loading}
            />
          </div>
        )}

        <DialogFooter>
          {token ? (
            <Button type="button" onClick={() => resetAndClose(false)}>
              {t.done}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => resetAndClose(false)}
                disabled={loading}
              >
                {t.cancel}
              </Button>
              <Button
                type="button"
                onClick={() => void handleRotate()}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t.updating}
                  </>
                ) : (
                  t.remoteRotateToken
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
