"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import {
  ArrowRight,
  ArrowUpRight,
  Clock,
  FolderKanban,
  ImageIcon,
  Sparkles,
  UserRound,
} from "lucide-react"
import { usePollUnreadCounts } from "@/lib/hooks/use-poll-unread-counts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CreateProjectButton } from "@/components/account/sections/create-project-button"
import { GiftCorner } from "@/components/account/workspace/gift-badge"
import type { ProjectGift } from "@/components/account/workspace/types"
import { cn } from "@/lib/utils"

export type DashboardProject = {
  id: string
  name: string
  description: string
  driveFolderId: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  unreadChatCount: number
  /** Оплачен подарком: тестовым периодом или акцией. null — платит владелец. */
  gift?: ProjectGift | null
}

function formatDate(iso: string) {
  try {
    // Fixed locale: SSR and the browser must produce identical text,
    // otherwise React reports a hydration mismatch.
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return iso
  }
}

function formatRelative(iso: string) {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return "—"
  const diff = Date.now() - then
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(iso)
}

function useGreeting() {
  const [greeting, setGreeting] = useState("Welcome back")
  useEffect(() => {
    const hour = new Date().getHours()
    if (hour < 5) setGreeting("Working late")
    else if (hour < 12) setGreeting("Good morning")
    else if (hour < 18) setGreeting("Good afternoon")
    else setGreeting("Good evening")
  }, [])
  return greeting
}

type SectionProps = {
  fullName: string
  email: string
  memberSince?: string
  /**
   * Server-rendered stats + recent projects area. Passed as a slot so the
   * hero paints immediately while the Drive scan behind this block streams
   * in via Suspense.
   */
  projectsArea: React.ReactNode
}

export function DashboardSection({
  fullName,
  email,
  memberSince,
  projectsArea,
}: SectionProps) {
  const greeting = useGreeting()
  const firstName = fullName.trim().split(/\s+/)[0] || email.split("@")[0]

  return (
    <div className="space-y-10">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="premium-card spotlight-band noise-overlay relative overflow-hidden px-6 py-8 md:px-10 md:py-10">
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/80">
              <Sparkles className="h-3.5 w-3.5" />
              Your workspace
            </p>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground md:text-[2.6rem] md:leading-[1.1]">
              {greeting}, {firstName}
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground md:text-[15px]">
              Manage your content projects and upload source media for
              generation.
            </p>
            {memberSince ? (
              <p className="pt-1 text-xs text-muted-foreground/70">
                Member since {formatDate(memberSince)}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <Button variant="outline" asChild>
              <Link href="/account/projects">
                All projects
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <CreateProjectButton />
          </div>
        </div>
      </section>

      {projectsArea}

      {/* ── Quick links ──────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2">
        <QuickLink
          href="/account/projects"
          title="Manage projects"
          description="Review briefs, upload assets, keep everything organised."
          icon={<FolderKanban className="h-4 w-4" />}
        />
        <QuickLink
          href="/account"
          title="Profile & security"
          description="Update your name, email and password."
          icon={<UserRound className="h-4 w-4" />}
        />
      </section>
    </div>
  )
}

type ProjectsOverviewProps = {
  projects: DashboardProject[]
  mediaCount: number
}

/** Stats + recent projects — the data-heavy part streamed after the hero. */
export function DashboardProjectsOverview({
  projects: initialProjects,
  mediaCount,
}: ProjectsOverviewProps) {
  const [projects, setProjects] = useState(initialProjects)

  usePollUnreadCounts((counts) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id in counts && counts[p.id] !== p.unreadChatCount
          ? { ...p, unreadChatCount: counts[p.id] }
          : p,
      ),
    )
  })

  const lastActivity =
    projects.length > 0
      ? projects.reduce(
          (latest, p) => (p.updatedAt > latest ? p.updatedAt : latest),
          projects[0].updatedAt,
        )
      : null

  return (
    <div className="space-y-10">
      {/* ── Stats ────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Projects"
          value={String(projects.length)}
          hint="Active briefs in your workspace"
          icon={<FolderKanban className="h-[18px] w-[18px]" />}
          href="/account/projects"
        />
        <StatCard
          label="Media files"
          value={String(mediaCount)}
          hint="Source assets uploaded"
          icon={<ImageIcon className="h-[18px] w-[18px]" />}
        />
        <StatCard
          label="Last activity"
          value={lastActivity ? formatRelative(lastActivity) : "—"}
          hint={
            lastActivity
              ? "Most recent project update"
              : "No activity recorded yet"
          }
          icon={<Clock className="h-[18px] w-[18px]" />}
          className="sm:col-span-2 lg:col-span-1"
        />
      </section>

      {/* ── Recent projects ──────────────────────────────────── */}
      <section className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-xl font-semibold tracking-tight">
              Recent projects
            </h2>
            <p className="text-sm text-muted-foreground">
              Open a project to upload media and manage the brief.
            </p>
          </div>
          {projects.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              asChild
            >
              <Link href="/account/projects">
                View all
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : null}
        </div>

        {projects.length === 0 ? (
          <EmptyProjects />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {projects.slice(0, 8).map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  icon,
  href,
  className,
}: {
  label: string
  value: string
  hint: string
  icon: React.ReactNode
  href?: string
  className?: string
}) {
  const classes = cn(
    "group relative block overflow-hidden rounded-2xl border border-border/60 bg-[hsl(var(--surface-2))]/60 px-5 py-5 transition-all duration-200",
    href &&
      "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-glow-soft",
    className,
  )

  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-white/[0.03] text-muted-foreground transition-colors duration-200 group-hover:border-primary/30 group-hover:text-primary">
          {icon}
        </span>
      </div>
      {/* suppressHydrationWarning: relative values ("5m ago") may drift
          between the server render and client hydration. */}
      <p
        suppressHydrationWarning
        className="mt-3 font-display text-[1.75rem] font-semibold leading-none tracking-tight text-foreground"
      >
        {value}
      </p>
      <p className="mt-2 text-xs text-muted-foreground/80">{hint}</p>
    </>
  )

  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    )
  }
  return <div className={classes}>{body}</div>
}

function ProjectCard({ project }: { project: DashboardProject }) {
  return (
    <Link
      href={`/account/projects/${project.id}`}
      className={cn(
        "group relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-[hsl(var(--surface-2))]/60 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-glow-soft",
        project.isActive
          ? "border-border/60 hover:border-primary/30"
          : "border-border/40 opacity-75 hover:border-border/60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-gradient-to-b from-white/[0.06] to-transparent text-muted-foreground transition-colors duration-200 group-hover:border-primary/30 group-hover:text-primary">
          <FolderKanban className="h-[18px] w-[18px]" />
          {project.gift ? (
            <GiftCorner gift={project.gift} ringClass="ring-[hsl(var(--surface-2))]" />
          ) : null}
        </span>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
      </div>
      <div className="min-w-0 space-y-1">
        <p className="truncate font-medium text-foreground">{project.name}</p>
        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {project.description}
        </p>
      </div>
      <div className="mt-auto flex items-center gap-2 pt-1 text-xs text-muted-foreground/70">
        <span>{formatDate(project.createdAt)}</span>
        {!project.isActive ? (
          <Badge
            variant="outline"
            className="border-border/60 bg-white/[0.03] text-[10px] font-medium text-muted-foreground"
          >
            Paused
          </Badge>
        ) : null}
        {project.unreadChatCount > 0 ? (
          <Badge className="border-primary/40 bg-primary/15 text-[10px] font-medium text-primary">
            {project.unreadChatCount > 99 ? "99+" : project.unreadChatCount} new
          </Badge>
        ) : null}
      </div>
    </Link>
  )
}

function QuickLink({
  href,
  title,
  description,
  icon,
}: {
  href: string
  title: string
  description: string
  icon: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-2xl border border-border/50 bg-white/[0.02] px-5 py-4 transition-all duration-200 hover:border-border hover:bg-white/[0.04]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-white/[0.03] text-muted-foreground transition-colors duration-200 group-hover:text-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  )
}

function EmptyProjects() {
  return (
    <div className="spotlight-band relative overflow-hidden rounded-2xl border border-dashed border-border/70 px-6 py-14 text-center">
      <div className="relative z-10">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/20 to-primary/5 shadow-glow-soft">
          <FolderKanban className="h-6 w-6 text-primary" />
        </span>
        <p className="mt-4 font-display text-lg font-semibold text-foreground">
          No projects yet
        </p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Create a project with a short description of the goal — audience,
          tone, formats — and start uploading media.
        </p>
        <div className="mt-6 flex justify-center">
          <CreateProjectButton label="Create first project" />
        </div>
      </div>
    </div>
  )
}
