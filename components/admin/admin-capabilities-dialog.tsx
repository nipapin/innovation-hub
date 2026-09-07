"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import type { AdminUser } from "@/components/admin/admin-types"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ADMIN_CAPABILITIES,
  CAPABILITY_PRESETS,
  CAPABILITY_PRESET_NAMES,
  type AdminCapability,
  type CapabilityPreset,
} from "@/lib/admin-capabilities"

type Dict = ReturnType<typeof useAdminI18n>

const LABEL_KEY: Record<AdminCapability, keyof Dict> = {
  "users.read": "capUsersRead",
  "users.manage": "capUsersManage",
  "content.manage": "capContentManage",
  "pipeline.operate": "capPipelineOperate",
  "posting.operate": "capPostingOperate",
  "settings.write": "capSettingsWrite",
  "machines.manage": "capMachinesManage",
  "projects.access": "capProjectsAccess",
  "projects.manage": "capProjectsManage",
  "statistics.view": "capStatisticsView",
  "statistics.import": "capStatisticsImport",
  "visitors.view": "capVisitorsView",
  "billing.manage": "capBillingManage",
  "billing.trial": "capBillingTrial",
  "billing.promo": "capBillingPromo",
  "services.manage": "capServicesManage",
  "audit.view": "capAuditView",
  "features.manage": "capFeaturesManage",
}

const PRESET_KEY: Record<CapabilityPreset, keyof Dict> = {
  content: "capsPresetContent",
  support: "capsPresetSupport",
  manager: "capsPresetManager",
  pipeline: "capsPresetPipeline",
  posting: "capsPresetPosting",
  full: "capsPresetFull",
}

type Grant = {
  capability: AdminCapability
  grantedByEmail: string | null
  grantedAt: string
}

type Props = {
  open: boolean
  user?: AdminUser
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function AdminCapabilitiesDialog({
  open,
  user,
  onOpenChange,
  onSaved,
}: Props) {
  const t = useAdminI18n()
  const [selected, setSelected] = useState<AdminCapability[]>([])
  const [grants, setGrants] = useState<Grant[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const applicable = user?.role === "ADMIN"

  useEffect(() => {
    if (!open || !user || !applicable) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/admin/users/${user.id}/capabilities`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("caps")
        return response.json() as Promise<{
          capabilities: AdminCapability[]
          grants: Grant[]
        }>
      })
      .then((data) => {
        if (cancelled) return
        setSelected(data.capabilities)
        setGrants(data.grants)
      })
      .catch(() => {
        if (!cancelled) toast.error(t.capsLoadError)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, user, applicable, t.capsLoadError])

  const toggle = (capability: AdminCapability) => {
    setSelected((prev) =>
      prev.includes(capability)
        ? prev.filter((value) => value !== capability)
        : [...prev, capability],
    )
  }

  const applyPreset = (preset: CapabilityPreset) => {
    setSelected([...CAPABILITY_PRESETS[preset]])
  }

  const save = async () => {
    if (!user) return
    setSaving(true)
    try {
      const response = await fetch(
        `/api/admin/users/${user.id}/capabilities`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capabilities: selected }),
        },
      )
      if (!response.ok) throw new Error("caps")
      toast.success(t.capsSaved)
      onSaved()
      onOpenChange(false)
    } catch {
      toast.error(t.capsSaveError)
    } finally {
      setSaving(false)
    }
  }

  const grantByCapability = new Map(
    grants.map((grant) => [grant.capability, grant]),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.capsTitle}</DialogTitle>
          <DialogDescription>
            {user?.role === "SUPERADMIN"
              ? t.capsSuperadminNote
              : user?.role === "USER"
                ? t.capsMemberNote
                : t.capsDesc}
          </DialogDescription>
        </DialogHeader>

        {!applicable ? null : loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t.capsPresets}
              </p>
              <div className="flex flex-wrap gap-2">
                {CAPABILITY_PRESET_NAMES.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => applyPreset(preset)}
                  >
                    {t[PRESET_KEY[preset]] as string}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              {ADMIN_CAPABILITIES.map((capability) => {
                const grant = grantByCapability.get(capability)
                const checked = selected.includes(capability)
                return (
                  <label
                    key={capability}
                    className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(capability)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-foreground">
                        {t[LABEL_KEY[capability]] as string}
                      </span>
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {capability}
                        {checked && grant?.grantedByEmail
                          ? ` · ${tf(t.capsGrantedBy, { email: grant.grantedByEmail })}`
                          : ""}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>

            {selected.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">{t.capsEmpty}</p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          {applicable ? (
            <Button onClick={() => void save()} disabled={saving || loading}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {t.capsSave}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
