"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ExternalLink,
  FileText,
  ImageIcon,
  Loader2,
  LogOut,
  Plus,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
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

export function KotliarEditor({ publicOrigin }: { publicOrigin: string }) {
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
    const res = await fetch("/api/kotliar/pages", { cache: "no-store" })
    if (!res.ok) {
      toast.error("Не удалось загрузить")
      return [] as PageSummary[]
    }
    const data = (await res.json()) as { pages: PageSummary[] }
    setPages(data.pages)
    return data.pages
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/kotliar/pages/${id}`, { cache: "no-store" })
    if (!res.ok) {
      toast.error("Не удалось загрузить")
      return
    }
    const data = (await res.json()) as { page: PageDetail }
    setDetail(data.page)
    setTitle(data.page.title)
    setSlug(data.page.slug)
    setBody(data.page.body)
  }, [])

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
    const res = await fetch("/api/kotliar/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Новая страница" }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(
        res.status === 409
          ? "Такой адрес уже занят"
          : (data.message ?? "Не удалось создать страницу"),
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
      const res = await fetch(`/api/kotliar/pages/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, slug, body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(
          res.status === 409
            ? "Такой адрес уже занят"
            : (data.message ?? "Не удалось сохранить"),
        )
        return
      }
      const page = data.page as PageDetail
      setDetail(page)
      setPages((list) =>
        list.map((item) => (item.id === page.id ? { ...item, ...page } : item)),
      )
      toast.success("Сохранено")
    } finally {
      setSaving(false)
    }
  }

  const deletePage = async () => {
    if (!selectedId || !detail) return
    const label = detail.title.trim() || "Без названия"
    if (!window.confirm(`Удалить «${label}» вместе с файлами? Это нельзя отменить.`)) {
      return
    }
    const res = await fetch(`/api/kotliar/pages/${selectedId}`, { method: "DELETE" })
    if (!res.ok) {
      toast.error("Не удалось удалить")
      return
    }
    toast.success("Страница удалена")
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
          `/api/kotliar/pages/${selectedId}/files?fileName=${encodeURIComponent(file.name)}`,
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
          if (res.status === 400) {
            toast.error("Можно jpeg, png, webp, gif или PDF. Видео не принимаем.")
          } else if (res.status === 413) {
            toast.error("Файл слишком большой")
          } else {
            toast.error(data.message ?? "Не удалось загрузить файл")
          }
          continue
        }
        const uploaded = data.file as PageFile
        setDetail((current) =>
          current ? { ...current, files: [...current.files, uploaded] } : current,
        )
        insertAtCursor(kotliarFileMarkdown(uploaded))
        toast.success("Файл загружен")
      }
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const deleteFile = async (file: PageFile) => {
    const res = await fetch(`/api/kotliar/files/${file.id}`, { method: "DELETE" })
    if (!res.ok) {
      toast.error("Не удалось удалить")
      return
    }
    setDetail((current) =>
      current
        ? { ...current, files: current.files.filter((item) => item.id !== file.id) }
        : current,
    )
  }

  const signOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" })
    window.location.assign("/login")
  }

  const previewHtml = useMemo(() => kotliarMarkdownToHtml(body), [body])
  const publicHref = `${publicOrigin}${kotliarPagePublicPath(slug)}`
  const inputClass =
    "h-[42px] w-full rounded-[10px] border border-black/10 bg-white px-3.5 text-[15px] text-[#1c1b18] outline-none placeholder:text-[#8a8780] focus:border-[#3b5bdb]"

  return (
    <div
      data-theme="light"
      className="flex min-h-screen flex-col bg-[#f7f5f0] text-[#1c1b18]"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-black/8 px-4 md:px-6">
        <span className="text-[15px] font-semibold">Редактор</span>
        <div className="flex items-center gap-2">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-[#4a4843] hover:bg-black/5"
          >
            <ExternalLink className="h-4 w-4" />
            Сайт
          </a>
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-[#4a4843] hover:bg-black/5"
          >
            <LogOut className="h-4 w-4" />
            Выйти
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="shrink-0 border-b border-black/8 lg:w-[260px] lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="text-[11px] font-semibold tracking-[1.4px] text-[#6b6860]">
              Страницы
            </div>
            <button
              type="button"
              onClick={() => void createPage()}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] hover:bg-black/5"
            >
              <Plus className="h-4 w-4" />
              Новая
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-y-auto lg:px-2">
            {loading && pages.length === 0 ? (
              <div className="flex items-center gap-2 px-2 py-2 text-[13px] text-[#6b6860]">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : null}
            {pages.length === 0 && !loading ? (
              <p className="px-3 py-2 text-[13px] text-[#6b6860]">
                Страниц пока нет — создайте первую.
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
                    ? "bg-[#3b5bdb]/15 font-medium"
                    : "text-[#4a4843] hover:bg-black/5",
                )}
              >
                <div className="truncate">{page.title.trim() || "Без названия"}</div>
                <div className="truncate text-[12px] text-[#6b6860]">
                  {page.slug ? `/${page.slug}` : "Главная"}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
          {!selectedId || !detail ? (
            !loading ? (
              <p className="text-[15px] text-[#6b6860]">Страниц пока нет — создайте первую.</p>
            ) : null
          ) : (
            <div className="mx-auto max-w-[820px] space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-[28px] font-bold">Страница</h1>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setMode(mode === "edit" ? "preview" : "edit")}
                    className="rounded-lg border border-black/10 px-3 py-2 text-[13px] hover:bg-black/5"
                  >
                    {mode === "edit" ? "Просмотр" : "Правка"}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void savePage()}
                    className="rounded-lg bg-[#3b5bdb] px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                  >
                    {saving ? "Сохранение…" : "Сохранить"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deletePage()}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[13px] text-[#b42318] hover:bg-[#b42318]/10"
                  >
                    <Trash2 className="h-4 w-4" />
                    Удалить
                  </button>
                </div>
              </div>
              <p className="text-[14px] text-[#6b6860]">
                Обычный markdown. Картинки и PDF — ссылками /files/…
              </p>

              {mode === "preview" ? (
                <div className="rounded-2xl bg-white px-5 py-8">
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
                    <span className="text-[12px] font-medium text-[#6b6860]">Заголовок</span>
                    <input
                      className={inputClass}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[12px] font-medium text-[#6b6860]">Адрес</span>
                    <input
                      className={inputClass}
                      value={slug}
                      onChange={(event) => setSlug(event.target.value)}
                      placeholder="Главная — оставить пустым"
                    />
                    <span className="block text-[12px] text-[#6b6860]">
                      Латиница и дефис. Пусто — главная страница.
                    </span>
                    <a
                      href={publicHref}
                      className="inline-block text-[12px] text-[#3b5bdb] hover:underline"
                    >
                      {publicHref}
                    </a>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[12px] font-medium text-[#6b6860]">Текст</span>
                    <textarea
                      ref={bodyRef}
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      rows={18}
                      className="w-full rounded-[10px] border border-black/10 bg-white px-3.5 py-3 font-mono text-[14px] outline-none focus:border-[#3b5bdb]"
                    />
                  </label>
                </>
              )}

              <div className="space-y-3 rounded-2xl border border-black/10 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[12px] font-semibold tracking-[1.2px] text-[#6b6860]">
                    Файлы
                  </div>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    className="rounded-lg border border-black/10 px-3 py-1.5 text-[13px] disabled:opacity-50"
                  >
                    {uploading ? "Загрузка…" : "Загрузить файл"}
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
                  <p className="text-[13px] text-[#6b6860]">Файлов пока нет</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.files.map((file) => (
                      <li
                        key={file.id}
                        className="flex items-center gap-2 rounded-lg bg-[#f7f5f0] px-3 py-2"
                      >
                        {file.contentType.startsWith("image/") ? (
                          <ImageIcon className="h-4 w-4 shrink-0 text-[#6b6860]" />
                        ) : (
                          <FileText className="h-4 w-4 shrink-0 text-[#6b6860]" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {file.originalName}
                        </span>
                        <code className="hidden text-[11px] text-[#6b6860] sm:inline">
                          /files/{file.id}
                        </code>
                        <button
                          type="button"
                          onClick={() => insertAtCursor(kotliarFileMarkdown(file))}
                          className="text-[12px] text-[#3b5bdb] hover:underline"
                        >
                          Вставить
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteFile(file)}
                          className="text-[#6b6860] hover:text-[#b42318]"
                          title="Удалить файл"
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
    </div>
  )
}
