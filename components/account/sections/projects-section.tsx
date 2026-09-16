"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  ArrowUpRight,
  FolderKanban,
  LayoutGrid,
  List,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import {
  createProjectSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
} from "@/lib/project-schemas"
import type { DashboardProject } from "@/components/account/sections/dashboard-section"
import { AccountPageHeader } from "@/components/account/shell/account-page-header"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { usePollUnreadCounts } from "@/lib/hooks/use-poll-unread-counts"
import { cn } from "@/lib/utils"

type Props = {
  projects: DashboardProject[]
}

type ViewMode = "grid" | "list"

const VIEW_STORAGE_KEY = "ff-account-projects-view"

function formatDate(iso: string) {
  // Fixed locale: SSR and the browser must produce identical text,
  // otherwise React reports a hydration mismatch.
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>("grid")

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY)
    if (stored === "grid" || stored === "list") setMode(stored)
  }, [])

  const update = (next: ViewMode) => {
    setMode(next)
    window.localStorage.setItem(VIEW_STORAGE_KEY, next)
  }

  return [mode, update]
}

export function ProjectsSection({ projects: initial }: Props) {
  const router = useRouter()
  const [projects, setProjects] = useState(initial)
  const [view, setView] = useViewMode()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [editingProject, setEditingProject] = useState<DashboardProject | null>(
    null,
  )
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DashboardProject | null>(
    null,
  )
  const [deleting, setDeleting] = useState(false)

  usePollUnreadCounts((counts) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id in counts && counts[p.id] !== p.unreadChatCount
          ? { ...p, unreadChatCount: counts[p.id] }
          : p,
      ),
    )
  })

  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: "", description: "" },
  })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q),
    )
  }, [projects, query])

  const onCreate = async (values: CreateProjectInput) => {
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      const data = (await response.json().catch(() => null)) as
        | (DashboardProject & { message?: string })
        | { message?: string }
        | null

      if (!response.ok || !data || !("id" in data)) {
        toast.error(
          data && "message" in data && data.message
            ? data.message
            : "Could not create project.",
        )
        return
      }

      setProjects((prev) => [
        {
          id: data.id,
          name: data.name,
          description: data.description,
          driveFolderId: data.driveFolderId,
          isActive: data.isActive ?? true,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          unreadChatCount: 0,
        },
        ...prev,
      ])
      toast.success("Project created.")
      form.reset({ name: "", description: "" })
      setOpen(false)
      router.push(`/account/projects/${data.id}`)
      router.refresh()
    } catch {
      toast.error("Unable to reach the server.")
    }
  }

  const onToggleActive = async (project: DashboardProject, next: boolean) => {
    setTogglingId(project.id)
    setProjects((prev) =>
      prev.map((p) => (p.id === project.id ? { ...p, isActive: next } : p)),
    )
    try {
      // `options/folderState.json` on Drive is the real automation switch
      // (read by the desktop app's hot processing loop). Prefer writing it
      // there so this toggle can never drift from the project detail page;
      // fall back to the plain DB flag when automation hasn't been set up
      // for this project yet (409 = no folderState.json to rewrite) or
      // Drive isn't wired up at all.
      let response = await fetch(
        `/api/projects/${project.id}/drive/folder-state`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        },
      )

      if (response.status === 409) {
        response = await fetch(`/api/projects/${project.id}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: next }),
        })
      }

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(data?.message ?? "Could not update project.")
      }
      toast.success(next ? "Project resumed." : "Project paused.")
      router.refresh()
    } catch (error) {
      // Revert the optimistic update on failure.
      setProjects((prev) =>
        prev.map((p) =>
          p.id === project.id ? { ...p, isActive: !next } : p,
        ),
      )
      toast.error(
        error instanceof Error ? error.message : "Unable to reach the server.",
      )
    } finally {
      setTogglingId(null)
    }
  }

  const onEditSave = async (id: string, values: UpdateProjectInput) => {
    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      const data = (await response.json().catch(() => null)) as
        | (DashboardProject & { message?: string })
        | { message?: string }
        | null
      if (!response.ok || !data || !("id" in data)) {
        toast.error(
          data && "message" in data && data.message
            ? data.message
            : "Could not update project.",
        )
        return
      }
      setProjects((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, name: data.name, description: data.description }
            : p,
        ),
      )
      toast.success("Project updated.")
      setEditingProject(null)
      router.refresh()
    } catch {
      toast.error("Unable to reach the server.")
    }
  }

  const onConfirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const response = await fetch(`/api/projects/${pendingDelete.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string
        } | null
        toast.error(data?.message ?? "Could not delete project.")
        return
      }
      setProjects((prev) => prev.filter((p) => p.id !== pendingDelete.id))
      toast.success("Project deleted.")
      router.refresh()
    } catch {
      toast.error("Unable to reach the server.")
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }

  return (
    <div className="space-y-8">
      <AccountPageHeader
        eyebrow="Projects"
        title="Your projects"
        description="Create projects, describe the brief, and upload media for content generation."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="shadow-glow-soft">
                <Plus className="h-4 w-4" />
                New project
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>New project</DialogTitle>
                <DialogDescription>
                  Give the project a name and a clear description of what you
                  need.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onCreate)}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Brand kit Q3" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={5}
                            placeholder="What should we produce, and from which assets?"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button
                      type="submit"
                      disabled={form.formState.isSubmitting}
                    >
                      {form.formState.isSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Creating…
                        </>
                      ) : (
                        "Create project"
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        }
      />

      {projects.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects…"
              className="pl-9"
              aria-label="Search projects"
            />
          </div>
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-foreground/[0.02] p-1">
            <ViewToggleButton
              active={view === "grid"}
              label="Grid view"
              onClick={() => setView("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
            </ViewToggleButton>
            <ViewToggleButton
              active={view === "list"}
              label="List view"
              onClick={() => setView("list")}
            >
              <List className="h-4 w-4" />
            </ViewToggleButton>
          </div>
        </div>
      ) : null}

      {projects.length === 0 ? (
        <div className="spotlight-band relative overflow-hidden rounded-2xl border border-dashed border-border/70 px-6 py-14 text-center">
          <div className="relative z-10">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/20 to-primary/5 shadow-glow-soft">
              <FolderKanban className="h-6 w-6 text-primary" />
            </span>
            <p className="mt-4 font-display text-lg font-semibold text-foreground">
              No projects yet
            </p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Start with a clear brief so we know the goal — audience, tone,
              formats and assets.
            </p>
            <Button className="mt-6 shadow-glow-soft" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              Create project
            </Button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-foreground/[0.02] px-6 py-12 text-center">
          <p className="font-medium text-foreground">Nothing found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No projects match “{query}”. Try a different search.
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((project) => (
            <ProjectGridCard
              key={project.id}
              project={project}
              toggling={togglingId === project.id}
              onToggleActive={(next) => void onToggleActive(project, next)}
              onEdit={() => setEditingProject(project)}
              onDelete={() => setPendingDelete(project)}
            />
          ))}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((project) => (
            <ProjectListRow
              key={project.id}
              project={project}
              toggling={togglingId === project.id}
              onToggleActive={(next) => void onToggleActive(project, next)}
              onEdit={() => setEditingProject(project)}
              onDelete={() => setPendingDelete(project)}
            />
          ))}
        </ul>
      )}

      <EditProjectDialog
        project={editingProject}
        onOpenChange={(isOpen) => {
          if (!isOpen) setEditingProject(null)
        }}
        onSave={onEditSave}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !deleting) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{pendingDelete?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the project and all of its media. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                void onConfirmDelete()
              }}
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete project"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ViewToggleButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function ChatButton({
  projectId,
  unreadCount = 0,
  size = "sm",
}: {
  projectId: string
  unreadCount?: number
  size?: "sm" | "icon"
}) {
  return (
    <div className="relative inline-flex">
      <Button
        type="button"
        variant="outline"
        size={size}
        className={cn("gap-1.5", size === "icon" && "h-8 w-8")}
        asChild
      >
        <Link
          href={`/account/projects/${projectId}/chat`}
          aria-label="Project chat"
          onClick={(e) => e.stopPropagation()}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {size === "sm" ? "Chat" : null}
        </Link>
      </Button>
      {unreadCount > 0 ? (
        <span
          aria-label={`${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`}
          className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </div>
  )
}

function StatusSwitch({
  checked,
  disabled,
  onCheckedChange,
  compact,
}: {
  checked: boolean
  disabled: boolean
  onCheckedChange: (next: boolean) => void
  compact?: boolean
}) {
  return (
    <div
      className="flex items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={checked ? "Pause project" : "Resume project"}
      />
      {!compact ? (
        <span
          className={cn(
            "text-xs font-medium",
            checked ? "text-success" : "text-muted-foreground",
          )}
        >
          {checked ? "Active" : "Paused"}
        </span>
      ) : null}
    </div>
  )
}

function ProjectActionsMenu({
  project,
  onEdit,
  onDelete,
}: {
  project: DashboardProject
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground/70 hover:text-foreground"
          aria-label={`Actions for ${project.name}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem asChild>
          <Link href={`/account/projects/${project.id}`}>
            <ArrowUpRight className="h-4 w-4" />
            Open project
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onEdit()
          }}
        >
          <Pencil className="h-4 w-4" />
          Edit details
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          onSelect={(e) => {
            e.preventDefault()
            onDelete()
          }}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProjectGridCard({
  project,
  toggling,
  onToggleActive,
  onEdit,
  onDelete,
}: {
  project: DashboardProject
  toggling: boolean
  onToggleActive: (next: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col gap-3 rounded-2xl border bg-[hsl(var(--surface-2))]/60 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-glow-soft",
        project.isActive
          ? "border-border/60 hover:border-primary/30"
          : "border-border/40 opacity-75 hover:border-border/60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-gradient-to-b from-foreground/[0.06] to-transparent text-muted-foreground transition-colors duration-200 group-hover:border-primary/30 group-hover:text-primary">
          <FolderKanban className="h-[18px] w-[18px]" />
        </span>
        <ProjectActionsMenu
          project={project}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>

      <Link
        href={`/account/projects/${project.id}`}
        className="min-w-0 space-y-1"
      >
        <h2 className="truncate font-display text-lg font-semibold tracking-tight text-foreground">
          {project.name}
        </h2>
        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {project.description}
        </p>
      </Link>

      <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
        <span>Created {formatDate(project.createdAt)}</span>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/50 pt-3">
        <StatusSwitch
          checked={project.isActive}
          disabled={toggling}
          onCheckedChange={onToggleActive}
        />
        <ChatButton projectId={project.id} unreadCount={project.unreadChatCount} />
      </div>
    </div>
  )
}

function ProjectListRow({
  project,
  toggling,
  onToggleActive,
  onEdit,
  onDelete,
}: {
  project: DashboardProject
  toggling: boolean
  onToggleActive: (next: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <li
      className={cn(
        "group flex flex-col gap-3 rounded-xl border bg-[hsl(var(--surface-2))]/50 px-4 py-3.5 transition-colors duration-150 sm:flex-row sm:items-center sm:gap-4",
        project.isActive
          ? "border-border/60 hover:border-primary/30"
          : "border-border/40 opacity-75 hover:border-border/60",
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-foreground/[0.03] text-muted-foreground group-hover:text-primary">
        <FolderKanban className="h-4 w-4" />
      </span>

      <Link
        href={`/account/projects/${project.id}`}
        className="min-w-0 flex-1 space-y-0.5"
      >
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-foreground">
            {project.name}
          </p>
        </div>
        <p className="line-clamp-1 text-sm text-muted-foreground">
          {project.description}
        </p>
      </Link>

      <div className="flex shrink-0 items-center gap-4 sm:gap-5">
        <span className="hidden text-xs text-muted-foreground/70 md:inline">
          {formatDate(project.createdAt)}
        </span>
        <StatusSwitch
          checked={project.isActive}
          disabled={toggling}
          onCheckedChange={onToggleActive}
          compact
        />
        <ChatButton
          projectId={project.id}
          size="icon"
          unreadCount={project.unreadChatCount}
        />
        <ProjectActionsMenu
          project={project}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </li>
  )
}

function EditProjectDialog({
  project,
  onOpenChange,
  onSave,
}: {
  project: DashboardProject | null
  onOpenChange: (open: boolean) => void
  onSave: (id: string, values: UpdateProjectInput) => Promise<void>
}) {
  const form = useForm<UpdateProjectInput>({
    resolver: zodResolver(updateProjectSchema),
    defaultValues: { name: "", description: "" },
  })

  useEffect(() => {
    if (project) {
      form.reset({ name: project.name, description: project.description })
    }
  }, [project, form])

  return (
    <Dialog open={project !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>
            Update the name and description of “{project?.name}”.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(async (values) => {
              if (!project) return
              await onSave(project.id, values)
            })}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Brand kit Q3" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={5}
                      placeholder="What should we produce, and from which assets?"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
