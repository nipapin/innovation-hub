"use client"
import { SITE_MONOGRAM, SITE_NAME } from "@/lib/site"
import { isElevated } from "@/lib/admin-roles"

import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import {
  ChevronDown,
  FolderKanban,
  Gift,
  LogIn,
  LogOut,
  Menu,
  Settings,
  User,
  UserRound,
} from "lucide-react"
import type { UserRole } from "@/lib/domain-types"

type SessionUser = {
  email: string
  role: UserRole
  /** Тестовый период ещё не брали и он включён — есть что предложить. */
  trialAvailable: boolean
}

const TOOL_LINKS = [
  { label: "Coverly", href: "https://coverly.pro" },
  { label: "Video Parser", href: "https://ai-video-parse-frontend-yglmi.ondigitalocean.app/" },
  { label: "Translate", href: "https://ai-video-parse-frontend-yglmi.ondigitalocean.app/translate" },
  { label: "Re-Voice", href: "https://ai-video-parse-frontend-yglmi.ondigitalocean.app/revoice" },
  { label: "Text Editor", href: "https://ai-video-parse-frontend-yglmi.ondigitalocean.app/editor" },
] as const

function ToolsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="rounded-full text-muted-foreground hover:text-foreground"
          type="button"
        >
          Tools
          <ChevronDown className="ml-1 h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {TOOL_LINKS.map((tool) => (
          <DropdownMenuItem key={tool.href} asChild>
            <a href={tool.href} target="_blank" rel="noopener noreferrer">
              {tool.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * «Попробовать бесплатно» — перед входом, потому что это первое, что мы
 * предлагаем незнакомому человеку, а вход нужен тому, кто уже решил.
 *
 * Гостя ведём в регистрацию с пометкой намерения, вошедшего — в дашборд, где
 * период активируется явной кнопкой. Сам по себе период не включается нигде:
 * копии шаблонов не должны заводиться тому, кто зарегистрировался и ушёл.
 */
function TrialButton({ href }: { href: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="hidden rounded-full border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary sm:inline-flex"
      asChild
    >
      <Link href={href}>
        <Gift className="mr-2 h-4 w-4" />
        <span>Try free</span>
      </Link>
    </Button>
  )
}

function splitEmail(email: string) {
  const i = email.indexOf("@")
  if (i === -1) {
    return { local: email, atDomain: "" as string }
  }
  return { local: email.slice(0, i), atDomain: `@${email.slice(i + 1)}` }
}

function emailAvatarLetter(email: string) {
  const { local } = splitEmail(email)
  const segment = local.trim() || email.trim()
  const match = segment.match(/\p{L}/u)
  if (match) {
    return match[0].toLocaleUpperCase()
  }
  const ch = segment[0]
  return ch ? ch.toLocaleUpperCase() : "?"
}

function UserMenu({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const { local, atDomain } = splitEmail(user.email)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto gap-2 rounded-full px-2 py-1.5 pr-3 hover:bg-accent"
          type="button"
        >
          <Avatar className="h-9 w-9 border border-border/60">
            <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">
              {emailAvatarLetter(user.email)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-[9rem] truncate text-left text-sm font-medium text-foreground sm:inline">
            {local}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <div className="flex flex-col gap-0.5 px-2 py-1.5">
          <p className="truncate text-sm font-semibold leading-none">{local}</p>
          {atDomain ? (
            <p className="truncate text-xs text-muted-foreground">{atDomain}</p>
          ) : (
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <Settings className="h-4 w-4" />
            Workspace
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/projects">
            <FolderKanban className="h-4 w-4" />
            Projects
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/profile">
            <UserRound className="h-4 w-4" />
            Profile
          </Link>
        </DropdownMenuItem>
        {isElevated(user.role) ? (
          <DropdownMenuItem asChild>
            <Link href="/admin">Admin dashboard</Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={onSignOut}>
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Header() {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" })
        const data = (await res.json()) as {
          authenticated?: boolean
          email?: string
          role?: UserRole
          trialAvailable?: boolean
        }
        if (cancelled) return
        if (data.authenticated && data.email) {
          setUser({
            email: data.email,
            role: data.role ?? "USER",
            trialAvailable: data.trialAvailable === true,
          })
        } else {
          setUser(null)
        }
      } catch {
        if (!cancelled) setUser(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pathname])

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" })
    setUser(null)
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-10">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/15">
              <span className="font-display text-sm font-bold text-primary">{SITE_MONOGRAM}</span>
            </div>
            <span className="font-display text-sm tracking-[0.08em] text-foreground/90">{SITE_NAME}</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            <Button variant="ghost" className="rounded-full text-muted-foreground hover:text-foreground" asChild>
              <Link href="/about">About</Link>
            </Button>
            <Button variant="ghost" className="rounded-full text-muted-foreground hover:text-foreground" asChild>
              <Link href="/suggest">Suggest</Link>
            </Button>
            <Button variant="ghost" className="rounded-full text-muted-foreground hover:text-foreground" asChild>
              <Link href="/contact">Contact</Link>
            </Button>
            <ToolsMenu />
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full md:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent className="border-border/70 bg-surface-1/95 backdrop-blur-xl">
              <SheetHeader>
                <SheetTitle className="font-display text-2xl text-foreground">Navigation</SheetTitle>
              </SheetHeader>
              <div className="mt-8 grid gap-2">
                <Button variant="ghost" className="justify-start rounded-full" asChild>
                  <Link href="/">Home</Link>
                </Button>
                <Button variant="ghost" className="justify-start rounded-full" asChild>
                  <Link href="/about">About</Link>
                </Button>
                <Button variant="ghost" className="justify-start rounded-full" asChild>
                  <Link href="/suggest">Suggest a feature</Link>
                </Button>
                <Button variant="ghost" className="justify-start rounded-full" asChild>
                  <Link href="/contact">Contact</Link>
                </Button>
                <p className="mt-4 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Tools</p>
                {TOOL_LINKS.map((tool) => (
                  <Button key={tool.href} variant="ghost" className="justify-start rounded-full" asChild>
                    <a href={tool.href} target="_blank" rel="noopener noreferrer">
                      {tool.label}
                    </a>
                  </Button>
                ))}
                <div className="mt-4">
                  <Button className="w-full rounded-full" asChild>
                    <Link href="/register">Get Early Access</Link>
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
          {user === undefined ? (
            <div className="h-10 w-[7.5rem] animate-pulse rounded-md bg-muted/60" aria-hidden />
          ) : user ? (
            <>
              {user.trialAvailable ? <TrialButton href="/account?trial=1" /> : null}
              <UserMenu user={user} onSignOut={signOut} />
            </>
          ) : (
            <>
              <TrialButton href="/register?trial=1" />
              <Button
                variant="ghost"
                size="sm"
                className="hidden rounded-full text-muted-foreground hover:text-foreground sm:inline-flex"
                asChild
              >
                <Link href="/login">
                  <LogIn className="mr-2 h-4 w-4" />
                  <span>Sign In</span>
                </Link>
              </Button>
              <Button size="sm" className="rounded-full bg-primary text-primary-foreground shadow-glow-soft hover:bg-primary/90" asChild>
                <Link href="/register">
                  <User className="mr-2 h-4 w-4" />
                  <span className="hidden sm:inline">Get Access</span>
                  <span className="sm:hidden">Join</span>
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
