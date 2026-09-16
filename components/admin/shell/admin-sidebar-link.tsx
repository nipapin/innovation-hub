"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { isToolActive, type AdminTool } from "./nav-config"

type Props = {
  item: AdminTool
  label: string
  badge?: number
  onNavigate?: () => void
}

export function AdminSidebarLink({ item, label, badge, onNavigate }: Props) {
  const pathname = usePathname()
  const active = isToolActive(item, pathname ?? "")
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary/12 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]"
          : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-1/2 h-5 -translate-y-1/2 rounded-full bg-primary transition-all",
          active ? "w-[3px] opacity-100" : "w-0 opacity-0",
        )}
        aria-hidden
      />
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
          active
            ? "border-primary/40 bg-primary/15 text-primary"
            : "border-transparent bg-foreground/[0.03] text-muted-foreground group-hover:border-border group-hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 truncate">{label}</span>
      {typeof badge === "number" ? (
        <span
          className={cn(
            "rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
            active
              ? "border-primary/30 bg-primary/15 text-primary"
              : "border-border/60 bg-muted/50 text-muted-foreground",
          )}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  )
}
