"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Building2, Loader2, LogOut } from "lucide-react"
import { toast } from "sonner"
import { HelpPageButton } from "@/components/help/help-page-button"
import { useI18n } from "@/components/account/i18n"
import {
  isCompanyToolActive,
  visibleCompanyTools,
} from "@/components/company/nav-config"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { CompanyCapability } from "@/lib/company-capabilities"
import type { CompanyRole } from "@/lib/domain-types"
import { cn } from "@/lib/utils"

export type CompanyPick = { id: string; title: string }

/**
 * Оболочка консоли компании: колонка разделов и переключатель компаний.
 *
 * Разделы приходят готовым списком с сервера, а не считаются здесь: тот же
 * ответ на вопрос «что ему видно» даёт гейт, и второй его источник в браузере
 * однажды разошёлся бы с первым. `visibleCompanyTools` вызывается на сервере,
 * в layout, и результат передаётся сюда именами.
 */
export function CompanyShell({
  companyTitle,
  companyRole,
  capabilities,
  companies,
  currentCompanyId,
  isSiteSuperAdmin,
  children,
}: {
  companyTitle: string
  companyRole: CompanyRole
  capabilities: CompanyCapability[]
  /** Непусто только у суперадмина сайта — ему одному есть между чем выбирать. */
  companies: CompanyPick[]
  currentCompanyId: string
  /** Суперадмин смотрит компанию гостем: ему одному и выходить. */
  isSiteSuperAdmin: boolean
  children: React.ReactNode
}) {
  const { t } = useI18n()
  const pathname = usePathname() ?? ""
  const router = useRouter()
  const [exiting, setExiting] = useState(false)
  const tools = visibleCompanyTools(companyRole, capabilities)

  const switchCompany = async (companyId: string) => {
    await fetch("/api/company/scope", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    })
    router.refresh()
  }

  /**
   * Выход из просмотра: сброс куки переключателя и возврат в админку, откуда
   * обычно и зашли. Просто ссылки назад мало: пока кука стоит, следующий заход
   * в `/company` снова открыл бы ту же компанию.
   */
  const exitConsole = async () => {
    setExiting(true)
    try {
      const res = await fetch("/api/company/scope", { method: "DELETE" })
      if (!res.ok) {
        toast.error(t.coExitFailed)
        return
      }
      router.push("/admin/companies")
    } catch {
      toast.error(t.coExitFailed)
    } finally {
      setExiting(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Building2 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/80">
              {t.coConsole}
            </p>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                {companyTitle}
              </h1>
              {/* Вход в справку при названии — одно место на всю консоль, как в
                  шапке страниц админки. */}
              <HelpPageButton id="companies.console" />
            </div>
          </div>
        </div>

        {companies.length > 1 || isSiteSuperAdmin ? (
          <div className="flex flex-wrap items-center gap-3">
            {companies.length > 1 ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t.coSwitch}</span>
                <Select
                  value={currentCompanyId}
                  onValueChange={(value) => void switchCompany(value)}
                >
                  <SelectTrigger className="h-9 w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {/* Выход — только суперадмину: сотруднику компании выходить некуда,
                консоль его компании и есть его рабочее место. */}
            {isSiteSuperAdmin ? (
              <Button
                variant="outline"
                size="sm"
                disabled={exiting}
                onClick={() => void exitConsole()}
              >
                {exiting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="mr-2 h-4 w-4" />
                )}
                {t.coExitCompany}
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        <nav className="flex shrink-0 flex-row flex-wrap gap-1 lg:w-56 lg:flex-col">
          {tools.map((tool) => {
            const Icon = tool.icon
            const active = isCompanyToolActive(tool, pathname)
            return (
              <Link
                key={tool.key}
                href={tool.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary/15 font-medium text-primary"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {t[tool.labelKey]}
              </Link>
            )
          })}
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

/** Карточки разделов на главной консоли — чтобы вход был не только через меню. */
export function CompanyToolCards({
  companyRole,
  capabilities,
}: {
  companyRole: CompanyRole
  capabilities: CompanyCapability[]
}) {
  const { t } = useI18n()
  const tools = visibleCompanyTools(companyRole, capabilities)

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {tools.map((tool) => {
        const Icon = tool.icon
        return (
          <Link
            key={tool.key}
            href={tool.href}
            className="group rounded-xl border border-border/60 bg-card p-5 transition-colors hover:border-primary/40"
          >
            <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-4.5 w-4.5" />
            </span>
            <p className="font-medium text-foreground group-hover:text-primary">
              {t[tool.labelKey]}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t[tool.descriptionKey]}
            </p>
          </Link>
        )
      })}
    </div>
  )
}
