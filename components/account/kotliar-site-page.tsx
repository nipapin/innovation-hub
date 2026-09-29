"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ExternalLink,
  FileText,
  ImageIcon,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { ProcessingIndicator } from "@/components/account/processing-indicator"
import { tf, useI18n } from "@/components/account/i18n"
import { kotliarFileMarkdown, kotliarMarkdownToHtml } from "@/lib/kotliar/markdown"
import { kotliarPagePublicPath } from "@/lib/kotliar/owner"
import { cn } from "@/lib/utils"

type PageSummary = {
  id: string
  slug: string
  title: string
  body: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

type PageFile = {
  id: string
  pageId: string
  originalName: string
  contentType: string
  sizeBytes: number
  createdAt: string
}

type PageDetail = PageSummary & { files: PageFile[] }

export function KotliarSitePage({ publicOrigin }: { publicOrigin: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const [pages, setPages] = useState<PageSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PageDetail | null>(null)
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState("")
  const [body, setBody] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [mode, setMode] = useState<"edit" | "preview">("edit")
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadPages = useCallback(async () => {
    const res = await fetch("/api/account/kotliar/pages", { cache: "no-store" })
    if (!res.ok) {
      toast.error(t.siteLoadFailed)
      return [] as PageSummary[]
    }
    const data = (await res.json()) as { pages: PageSummary[] }
    setPages(data.pages)
    return data.pages
  }, [t.siteLoadFailed])

  const loadDetail = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/account/kotliar/pages/${id}`, {
        cache: "no-store",
      })
      if (!res.ok) {
        toast.error(t.siteLoadFailed)
        return
      }
      const data = (await res.json()) as { page: PageDetail }
      setDetail(data.page)
      setTitle(data.page.title)
      setSlug(data.page.slug)
      setBody(data.page.body)
    },
    [t.siteLoadFailed],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const list = await loadPages()
      if (cancelled) return
      const first = list[0]
      if (first) {
        setSelectedId(first.id)
        await loadDetail(first.id)
      }
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [loadPages, loadDetail])

  const selectPage = async (id: string) => {
    setSelectedId(id)
    setMode("edit")
    await loadDetail(id)
  }

  const createPage = async () => {
    const res = await fetch("/api/account/kotliar/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t.siteNewPage }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(
        res.status === 409 ? t.siteSlugTaken : (data.message ?? t.siteCreateFailed),
      )
      return
    }
    const page = data.page as PageSummary
    await loadPages()
    setSelectedId(page.id)
    await loadDetail(page.id)
  }

  const savePage = async () => {
    if (!selectedId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/account/kotliar/pages/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, slug, body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(
          res.status === 409 ? t.siteSlugTaken : (data.message ?? t.siteSaveFailed),
        )
        return
      }
      const page = data.page as PageDetail
      setDetail(page)
      setPages((list) =>
        list.map((item) => (item.id === page.id ? { ...item, ...page } : item)),
      )
      toast.success(t.siteSaved)
    } finally {
      setSaving(false)
    }
  }

  const deletePage = async () => {
    if (!selectedId || !detail) return
    const label = detail.title.trim() || t.siteUntitled
    if (!window.confirm(tf(t.siteDeleteConfirm, { title: label }))) return
    const res = await fetch(`/api/account/kotliar/pages/${selectedId}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      toast.error(t.siteDeleteFailed)
      return
    }
    toast.success(t.siteDeleted)
    const list = await loadPages()
    const next = list[0]
    if (next) {
      setSelectedId(next.id)
      await loadDetail(next.id)
    } else {
      setSelectedId(null)
      setDetail(null)
      setTitle("")
      setSlug("")
      setBody("")
    }
  }

  const insertAtCursor = (text: string) => {
    const el = bodyRef.current
    setBody((current) => {
      if (!el) {
        const gap = current.endsWith("\n") || !current ? "" : "\n"
        return `${current}${gap}${text}\n`
      }
      const start = el.selectionStart
      const end = el.selectionEnd
      return `${current.slice(0, start)}${text}${current.slice(end)}`
    })
    if (el) {
      requestAnimationFrame(() => {
        el.focus()
        const pos = el.selectionStart + text.length
        el.setSelectionRange(pos, pos)
      })
    }
  }

  const uploadFiles = async (fileList: FileList | null) => {
    if (!selectedId || !fileList || fileList.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(fileList)) {
        const res = await fetch(
          `/api/account/kotliar/pages/${selectedId}/files?fileName=${encodeURIComponent(file.name)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "x-file-name": encodeURIComponent(file.name),
            },
            body: file,
          },
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (res.status === 400) toast.error(t.siteTypeRejected)
          else if (res.status === 413) toast.error(t.siteTooLarge)
          else toast.error(data.message ?? t.siteUploadFailed)
          continue
        }
        const uploaded = data.file as PageFile
        setDetail((current) =>
          current
            ? { ...current, files: [...current.files, uploaded] }
            : current,
        )
        insertAtCursor(kotliarFileMarkdown(uploaded))
        toast.success(t.siteUploaded)
      }
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const deleteFile = async (file: PageFile) => {
    const res = await fetch(`/api/account/kotliar/files/${file.id}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      toast.error(t.siteDeleteFailed)
      return
    }
    setDetail((current) =>
      current
        ? { ...current, files: current.files.filter((item) => item.id !== file.id) }
        : current,
    )
  }

  const previewHtml = useMemo(() => kotliarMarkdownToHtml(body), [body])
  const publicHref = `${publicOrigin}${kotliarPagePublicPath(slug)}`

  const inputClass =
    "h-[42px] w-full rounded-[10px] border border-foreground/10 bg-surface-1 px-3.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground/65 focus:border-primary"

  return (
    <main className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-foreground/[0.07] px-4 md:px-6">
        <div className="text-[13px] text-muted-foreground/90">
          <span
            className="cursor-pointer hover:text-foreground"
            onClick={() => router.push("/account/projects")}
          >
            {t.accountCrumb}
          </span>
          <span className="text-muted-foreground/50"> / </span>
          <span className="text-foreground">{t.siteNav}</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={publicOrigin}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
            {t.siteOpenPublic}
          </a>
          <ProcessingIndicator />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <aside className="shrink-0 border-b border-foreground/[0.07] lg:w-[260px] lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="text-[11px] font-semibold tracking-[1.4px] text-muted-foreground/70">
              {t.sitePages}
            </div>
            <button
              type="button"
              onClick={() => void createPage()}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] text-foreground hover:bg-foreground/5"
            >
              <Plus className="h-4 w-4" />
              {t.siteNewPage}
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-y-auto lg:px-2">
            {loading && pages.length === 0 ? (
              <div className="flex items-center gap-2 px-2 py-2 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : null}
            {pages.length === 0 && !loading ? (
              <p className="px-3 py-2 text-[13px] text-muted-foreground">
                {t.siteNoPages}
              </p>
            ) : null}
            {pages.map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => void selectPage(page.id)}
                className={cn(
                  "shrink-0 rounded-[10px] px-3 py-2 text-left text-[14px] lg:w-full",
                  selectedId === page.id
                    ? "bg-primary/15 text-foreground"
                    : "text-secondary-foreground hover:bg-foreground/5",
                )}
              >
                <div className="truncate font-medium">
                  {page.title.trim() || t.siteUntitled}
                </div>
                <div className="truncate text-[12px] text-muted-foreground/80">
                  {page.slug ? `/${page.slug}` : t.siteHomeLabel}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
          {!selectedId || !detail ? (
            !loading ? (
              <p className="text-[15px] text-muted-foreground">{t.siteNoPages}</p>
            ) : null
          ) : (
            <div className="mx-auto max-w-[820px] space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-[28px] font-bold">{t.siteTitle}</h1>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setMode(mode === "edit" ? "preview" : "edit")}
                    className="rounded-lg border border-foreground/10 px-3 py-2 text-[13px] hover:bg-foreground/5"
                  >
                    {mode === "edit" ? t.sitePreview : t.siteEdit}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void savePage()}
                    className="rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {saving ? t.siteSaving : t.saveChanges}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deletePage()}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[13px] text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t.siteDeletePage}
                  </button>
                </div>
              </div>
              <p className="text-[14px] text-muted-foreground">{t.siteSub}</p>

              {mode === "preview" ? (
                <div
                  data-theme="light"
                  className="rounded-2xl bg-[#f7f5f0] px-5 py-8 text-[#1c1b18]"
                >
                  {title.trim() ? (
                    <h2 className="mb-6 text-[1.7rem] font-semibold">{title.trim()}</h2>
                  ) : null}
                  <div
                    className="md-body"
                    style={{ "--md-measure": "100%" } as React.CSSProperties}
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              ) : (
                <>
                  <label className="block space-y-1.5">
                    <span className="text-[12px] font-medium text-muted-foreground">
                      {t.sitePageTitle}
                    </span>
                    <input
                      className={inputClass}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[12px] font-medium text-muted-foreground">
                      {t.siteSlug}
                    </span>
                    <input
                      className={inputClass}
                      value={slug}
                      onChange={(event) => setSlug(event.target.value)}
                      placeholder={t.siteHomeLabel}
                    />
                    <span className="block text-[12px] text-muted-foreground">
                      {t.siteSlugHint}
                    </span>
                    <a
                      href={publicHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
                    >
                      {publicHref}
                    </a>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[12px] font-medium text-muted-foreground">
                      {t.siteBody}
                    </span>
                    <textarea
                      ref={bodyRef}
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      rows={18}
                      className="w-full rounded-[10px] border border-foreground/10 bg-surface-1 px-3.5 py-3 font-mono text-[14px] text-foreground outline-none focus:border-primary"
                    />
                    <span className="block text-[12px] text-muted-foreground">
                      {t.siteBodyHint}
                    </span>
                  </label>
                </>
              )}

              <div className="space-y-3 rounded-2xl border border-foreground/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[12px] font-semibold tracking-[1.2px] text-muted-foreground">
                    {t.siteFiles}
                  </div>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    className="rounded-lg border border-foreground/10 px-3 py-1.5 text-[13px] disabled:opacity-50"
                  >
                    {uploading ? t.siteUploading : t.siteUpload}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.pdf"
                    multiple
                    onChange={(event) => void uploadFiles(event.target.files)}
                  />
                </div>
                {detail.files.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">{t.siteNoFiles}</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.files.map((file) => (
                      <li
                        key={file.id}
                        className="flex items-center gap-2 rounded-lg bg-foreground/[0.03] px-3 py-2"
                      >
                        {file.contentType.startsWith("image/") ? (
                          <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {file.originalName}
                        </span>
                        <code className="hidden text-[11px] text-muted-foreground sm:inline">
                          /files/{file.id}
                        </code>
                        <button
                          type="button"
                          onClick={() => insertAtCursor(kotliarFileMarkdown(file))}
                          className="text-[12px] text-primary hover:underline"
                        >
                          {t.siteInsert}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteFile(file)}
                          className="text-muted-foreground hover:text-destructive"
                          title={t.siteDeleteFile}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
