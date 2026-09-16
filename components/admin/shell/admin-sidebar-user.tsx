"use client"

import { LogOut } from "lucide-react"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

type Props = {
  email: string
  fullName: string
  onSignOut: () => void
}

function avatarLetter(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return "?"
  const match = trimmed.match(/\p{L}/u)
  return (match ? match[0] : trimmed[0]).toLocaleUpperCase()
}

export function AdminSidebarUser({ email, fullName, onSignOut }: Props) {
  const t = useAdminI18n()
  const display = fullName.trim() || email
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-foreground/[0.03] p-2.5">
      <Avatar className="h-9 w-9 border border-border/50">
        <AvatarFallback className="bg-primary/15 text-sm font-semibold text-primary">
          {avatarLetter(display)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{display}</p>
        <p className="truncate text-[11px] text-muted-foreground">{email}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={onSignOut}
        title={t.signOut}
      >
        <LogOut className="h-4 w-4" />
        <span className="sr-only">{t.signOut}</span>
      </Button>
    </div>
  )
}
