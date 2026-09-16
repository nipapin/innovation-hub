"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Loader2, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { avatarInitials, tf, type Dictionary } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useWorkspace } from "./workspace-context"

type MemberRole = "viewer" | "editor" | "full"

/** Роль смотрящего: владелец видит и меняет всё, полный доступ — не всё. */
type ViewerRole = MemberRole | "owner"

type Person = {
  userId: string
  email: string
  fullName: string
  role: MemberRole | "owner"
  /** Кто позвал этого человека: при делегировании звал не всегда владелец. */
  invitedBy?: string | null
  invitedByName?: string | null
}

/**
 * Кого смотрящий уже приглашал — история из его настроек, а не список
 * участников этого проекта. Живёт на сервере (`share_contacts`), поэтому
 * подсказки одинаковы в кабинете и в админке.
 */
type Contact = { email: string; fullName: string }

/**
 * Получатель, набранный в поле. Имя рядом с адресом нужно, чтобы выбранного из
 * подсказок человека было видно так же, как в списке доступа: одним адресом
 * коллегу не узнать.
 */
type Chip = { email: string; name: string }

const AVATAR_COLORS = [
  "#1a73e8",
  "#d93025",
  "#188038",
  "#e37400",
  "#9334e6",
  "#007b83",
  "#c5221f",
  "#1967d2",
]

function colorFor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function tokenize(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

function roleLabel(role: MemberRole, t: Dictionary): string {
  if (role === "full") return t.shareFull
  return role === "editor" ? t.shareEditor : t.shareViewer
}

function roleHint(role: MemberRole, t: Dictionary): string {
  if (role === "full") return t.shareFullHint
  return role === "editor" ? t.shareEditorHint : t.shareViewerHint
}

const ROLES: MemberRole[] = ["viewer", "editor", "full"]

/**
 * Может ли смотрящий распоряжаться доступом этого человека.
 *
 * Владелец — всеми. Полный доступ — читателями и редакторами, но не таким же
 * полным доступом: иначе двое приглашённых могли бы вычеркнуть друг друга из
 * проекта, который завёл не они. Те же правила стоят на сервере
 * (canManageMember в lib/project-access.ts) — здесь только показ.
 */
function canManage(viewerRole: ViewerRole, person: Person): boolean {
  if (person.role === "owner") return false
  if (viewerRole === "owner") return true
  if (viewerRole !== "full") return false
  return person.role !== "full"
}

function PersonAvatar({ name, email }: { name: string; email: string }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
      style={{ backgroundColor: colorFor(email || name) }}
    >
      {avatarInitials(name, email)}
    </span>
  )
}

export function ShareDialog() {
  const { t, shareTarget, closeShareDialog } = useWorkspace()
  const open = shareTarget !== null
  const project = shareTarget

  const [draft, setDraft] = useState("")
  const [chips, setChips] = useState<Chip[]>([])
  const [inviteRole, setInviteRole] = useState<MemberRole>("viewer")
  const [owner, setOwner] = useState<Person | null>(null)
  const [members, setMembers] = useState<Person[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  /** −1 — ничего не подсвечено: Enter тогда разбирает набранное, а не выбирает. */
  const [active, setActive] = useState(-1)
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [viewerRole, setViewerRole] = useState<ViewerRole>("owner")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const taken = useMemo(() => {
    const set = new Set<string>()
    if (owner) set.add(owner.email.toLowerCase())
    for (const m of members) set.add(m.email.toLowerCase())
    for (const c of chips) set.add(c.email)
    return set
  }, [owner, members, chips])

  const reset = useCallback(() => {
    setDraft("")
    setChips([])
    setInviteRole("viewer")
    setOwner(null)
    setMembers([])
    setContacts([])
    setSuggestOpen(false)
    setActive(-1)
    setViewerUserId(null)
    setViewerRole("owner")
    setHint(null)
    setBusyId(null)
    setSending(false)
  }, [])

  useEffect(() => {
    if (!open || !project) {
      reset()
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/members`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          toast.error(data.message ?? "Failed to load people")
          return
        }
        setViewerUserId(
          typeof data.viewerUserId === "string" ? data.viewerUserId : null,
        )
        setViewerRole(
          data.viewerRole === "full" ? "full" : "owner",
        )
        setOwner(
          data.owner
            ? {
                userId: data.owner.userId,
                email: data.owner.email,
                fullName: data.owner.fullName,
                role: "owner",
              }
            : null,
        )
        setMembers(
          Array.isArray(data.members)
            ? data.members.map(
                (m: {
                  userId: string
                  email: string
                  fullName: string
                  role: MemberRole
                  invitedBy?: string | null
                  invitedByName?: string | null
                }) => ({
                  userId: m.userId,
                  email: m.email,
                  fullName: m.fullName,
                  role: m.role,
                  invitedBy: m.invitedBy ?? null,
                  invitedByName: m.invitedByName ?? null,
                }),
              )
            : [],
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, project, reset])

  // История получателей — про того, кто смотрит, а не про проект: отдельный
  // запрос, чтобы смена проекта в диалоге её не перезагружала.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/account/share-contacts")
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        if (cancelled || !Array.isArray(data.contacts)) return
        setContacts(
          data.contacts
            .filter(
              (c: unknown): c is Contact =>
                typeof (c as Contact)?.email === "string",
            )
            .map((c: Contact) => ({
              email: c.email.toLowerCase(),
              fullName: typeof c.fullName === "string" ? c.fullName : "",
            })),
        )
      } catch {
        // Подсказки — удобство: без них диалог работает как раньше.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  /**
   * Что показать под полем: те, кого уже приглашали, кроме уже добавленных.
   *
   * Фильтр — по всей набранной строке, а не по последнему слову: имя пишется с
   * пробелом, и «Иван Пет» должно находить «Иван Петров».
   *
   * ПУСТОЕ ПОЛЕ — ПУСТОЙ СПИСОК, а не «показать всех».
   *
   * Раньше диалог открывался с готовым списком тех, кого этот человек уже
   * приглашал. В компании это почти весь её состав: кто с кем работал, кто чей
   * подрядчик — выложено на экран тому, кто просто нажал «Поделиться». Список
   * своей переписки человек и так помнит; тому, кто его открыл, он не нужен, а
   * случайному зрителю за плечом — тем более. Подсказка обязана быть ответом на
   * вопрос, а не описью.
   */
  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase()
    if (!q) return []
    return contacts
      .filter((c) => !taken.has(c.email))
      .filter(
        (c) => c.email.includes(q) || c.fullName.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [contacts, draft, taken])

  /**
   * Набранное → человек из истории, если он там один.
   *
   * Так поле принимает и имя, и почту: точное совпадение сильнее частичного, а
   * неоднозначное «Иван» ничего не выбирает — иначе доступ ушёл бы не тому.
   */
  const contactFor = useCallback(
    (raw: string): Contact | null => {
      const q = raw.trim().toLowerCase()
      if (!q) return null
      // Набран целый адрес — берём его буквально: частичное совпадение иначе
      // подменило бы новый адрес похожим знакомым (`van@corp.co` → знакомый
      // `ivan@corp.com`), и доступ ушёл бы не тому.
      if (EMAIL_RE.test(q)) return contacts.find((c) => c.email === q) ?? null
      const exact = contacts.filter(
        (c) => c.email === q || c.fullName.trim().toLowerCase() === q,
      )
      // Список приходит «свежие сверху»: у полных тёзок берём того, кого звали
      // последним.
      if (exact.length) return exact[0]!
      const partial = contacts.filter(
        (c) => c.email.includes(q) || c.fullName.toLowerCase().includes(q),
      )
      return partial.length === 1 ? partial[0]! : null
    },
    [contacts],
  )

  /**
   * Разбор набранного текста в получателей — без записи в состояние.
   *
   * Чистая, потому что её зовут двое: Enter в поле и кнопка «Отправить». Иначе
   * адрес, набранный и не подтверждённый Enter, при отправке терялся бы.
   */
  const parse = useCallback(
    (raw: string): { picked: Chip[]; leftover: string; message: string | null } => {
      const contact = contactFor(raw)
      if (contact) {
        if (taken.has(contact.email)) {
          return {
            picked: [],
            leftover: "",
            message:
              owner && contact.email === owner.email.toLowerCase()
                ? t.shareOwnerEmail
                : t.shareAlreadyAdded,
          }
        }
        return {
          picked: [{ email: contact.email, name: contact.fullName }],
          leftover: "",
          message: null,
        }
      }

      const parts = tokenize(raw)
      if (parts.length === 0) return { picked: [], leftover: raw.trim(), message: null }
      const leftover: string[] = []
      const picked: Chip[] = []
      let message: string | null = null
      for (const part of parts) {
        if (!EMAIL_RE.test(part)) {
          leftover.push(part)
          message = t.shareInvalidEmail
          continue
        }
        if (taken.has(part) || picked.some((c) => c.email === part)) {
          message =
            owner && part === owner.email.toLowerCase()
              ? t.shareOwnerEmail
              : t.shareAlreadyAdded
          continue
        }
        // Имя из истории: адрес набран руками, но человек знакомый.
        const known = contacts.find((c) => c.email === part)
        picked.push({ email: part, name: known?.fullName ?? "" })
      }
      return { picked, leftover: leftover.join(" "), message }
    },
    [contactFor, contacts, owner, t, taken],
  )

  const addChips = useCallback((picked: Chip[]) => {
    if (!picked.length) return
    setChips((prev) => [
      ...prev,
      ...picked.filter((p) => !prev.some((c) => c.email === p.email)),
    ])
  }, [])

  /** Выбор строки в подсказках: имя в фишку, поле — чистое. */
  const pick = useCallback(
    (contact: Contact) => {
      addChips([{ email: contact.email, name: contact.fullName }])
      setDraft("")
      setHint(null)
      setActive(-1)
      inputRef.current?.focus()
    },
    [addChips],
  )

  /**
   * Убрать человека из подсказок. Сначала из списка, потом с сервера: строку
   * удаляют, чтобы она пропала, и ждать ответа тут не за чем — при сбое
   * возвращаем на место.
   */
  const forget = useCallback(async (contact: Contact) => {
    setContacts((prev) => prev.filter((c) => c.email !== contact.email))
    setActive(-1)
    try {
      const res = await fetch(
        `/api/account/share-contacts?email=${encodeURIComponent(contact.email)}`,
        { method: "DELETE" },
      )
      if (!res.ok) throw new Error("failed")
    } catch {
      setContacts((prev) =>
        prev.some((c) => c.email === contact.email) ? prev : [contact, ...prev],
      )
      toast.error(t.shareForgetFailed)
    }
  }, [t])

  const commitDraft = useCallback(
    (raw: string): string => {
      const { picked, leftover, message } = parse(raw)
      addChips(picked)
      setHint(message)
      return leftover
    },
    [addChips, parse],
  )

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault()
      setSuggestOpen(true)
      setActive((prev) => Math.min(prev + 1, suggestions.length - 1))
      return
    }
    if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault()
      setActive((prev) => Math.max(prev - 1, -1))
      return
    }
    if (event.key === "Escape" && suggestOpen) {
      event.preventDefault()
      setSuggestOpen(false)
      setActive(-1)
      return
    }
    if (event.key === "Backspace" && !draft && chips.length) {
      event.preventDefault()
      setChips((prev) => prev.slice(0, -1))
      setHint(null)
      return
    }
    // Пробел разделяет адреса, но не слова имени: «Иван Петров» иначе распался
    // бы на два «некорректных адреса» раньше, чем человек дописал фамилию.
    if (event.key === " " && !draft.includes("@")) return
    if (["Enter", "Tab", ",", ";", " "].includes(event.key)) {
      const highlighted = active >= 0 ? suggestions[active] : null
      if (highlighted) {
        event.preventDefault()
        pick(highlighted)
        return
      }
      if (!draft.trim()) return
      event.preventDefault()
      setDraft(commitDraft(draft))
      setActive(-1)
    }
  }

  const onPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text")
    if (!/[,;\s]/.test(text)) return
    event.preventDefault()
    setDraft(commitDraft(`${draft} ${text}`))
  }

  const send = async () => {
    if (!project) return
    // Набранное, но не подтверждённое Enter, — тоже получатель: человек ввёл
    // адрес и сразу нажал «Отправить».
    const { picked, leftover, message } = parse(draft)
    const all = [...chips]
    for (const item of picked) {
      if (!all.some((c) => c.email === item.email)) all.push(item)
    }
    const unique = all.map((c) => c.email)
    setDraft(leftover)
    if (unique.length === 0) {
      setHint(message ?? (draft.trim() ? t.shareInvalidEmail : null))
      return
    }
    setSuggestOpen(false)
    setActive(-1)
    setSending(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: unique, role: inviteRole }),
      })
      const data = await res.json().catch(() => ({}))
      // Отказ по рамке компании приходит ОДИН на весь запрос, без `results`:
      // сервер не зовёт никого, если в списке есть посторонний. Иначе часть
      // адресов уехала бы, часть нет, и человек не понял бы, что произошло.
      if (res.status === 403 && data.code === "company-outsider") {
        toast.error(t.coShareOutsider)
        return
      }
      const results = Array.isArray(data.results) ? data.results : []
      const ok = results.filter((r: { ok?: boolean }) => r.ok)
      const fail = results.filter((r: { ok?: boolean }) => !r.ok)
      for (const item of ok) {
        if (item.member) {
          setMembers((prev) => {
            if (prev.some((m) => m.userId === item.member.userId)) {
              return prev.map((m) =>
                m.userId === item.member.userId
                  ? { ...m, role: item.member.role }
                  : m,
              )
            }
            return [
              ...prev,
              {
                userId: item.member.userId,
                email: item.member.email,
                fullName: item.member.fullName,
                role: item.member.role,
              },
            ]
          })
        }
      }
      const okEmails = new Set(
        ok.map((r: { email?: string }) => r.email?.toLowerCase()).filter(Boolean),
      )
      setChips((prev) => prev.filter((c) => !okEmails.has(c.email)))
      // Тех же людей сервер только что записал в историю; повторяем это у себя,
      // чтобы подсказки не отставали до следующего открытия диалога.
      const invited: Contact[] = ok
        .filter((r: { member?: { email?: string } }) => r.member?.email)
        .map((r: { member: { email: string; fullName?: string } }) => ({
          email: r.member.email.toLowerCase(),
          fullName: r.member.fullName ?? "",
        }))
      if (invited.length) {
        setContacts((prev) => [
          ...invited,
          ...prev.filter((c) => !invited.some((i) => i.email === c.email)),
        ])
      }
      if (ok.length && fail.length === 0) {
        const mailFail = ok.some((r: { mailOk?: boolean }) => r.mailOk === false)
        if (mailFail) toast.message(t.shareMailWarn)
        else toast.success(t.shareInviteSuccess)
        closeShareDialog()
      } else if (ok.length) {
        toast.message(t.shareInvitePartial)
        setHint(fail[0]?.message ?? t.shareInvitePartial)
      } else {
        toast.error(data.message ?? fail[0]?.message ?? "Share failed")
        setHint(data.message ?? fail[0]?.message ?? null)
      }
    } finally {
      setSending(false)
    }
  }

  const changeRole = async (person: Person, role: MemberRole) => {
    if (!project || person.role === "owner" || person.role === role) return
    setBusyId(person.userId)
    try {
      const res = await fetch(`/api/projects/${project.id}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: person.userId, role }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.message ?? "Failed")
        return
      }
      setMembers((prev) =>
        prev.map((m) => (m.userId === person.userId ? { ...m, role } : m)),
      )
    } finally {
      setBusyId(null)
    }
  }

  const removePerson = async (person: Person) => {
    if (!project || person.role === "owner") return
    setBusyId(person.userId)
    try {
      const res = await fetch(
        `/api/projects/${project.id}/members?userId=${encodeURIComponent(person.userId)}`,
        { method: "DELETE" },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.message ?? "Failed")
        return
      }
      setMembers((prev) => prev.filter((m) => m.userId !== person.userId))
    } finally {
      setBusyId(null)
    }
  }

  const hasPending =
    chips.length > 0 ||
    EMAIL_RE.test(draft.trim().toLowerCase()) ||
    contactFor(draft) !== null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeShareDialog()
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="gap-0 border-border/60 bg-ws-raised p-0 sm:max-w-lg"
      >
        <DialogHeader className="px-6 pb-1 pt-6">
          <DialogTitle className="pr-8 text-[18px] font-semibold tracking-tight text-ws-1">
            {t.shareTitle}
            {project ? ` «${project.name}»` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-2 pt-4">
          <div className="relative">
            <div
              className="flex min-h-[48px] items-start gap-2 rounded-xl border border-foreground/10 bg-ws-control px-2 py-1.5 focus-within:border-ws-select"
              onClick={() => inputRef.current?.focus()}
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-0.5">
                {chips.map((chip) => (
                  <span
                    key={chip.email}
                    title={chip.email}
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-foreground/10 py-0.5 pl-2 pr-1 text-[13px] text-ws-1"
                  >
                    <span className="truncate">{chip.name || chip.email}</span>
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center rounded-full text-ws-3 hover:bg-foreground/10 hover:text-ws-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        setChips((prev) =>
                          prev.filter((c) => c.email !== chip.email),
                        )
                      }}
                      aria-label={t.shareRemove}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    setSuggestOpen(true)
                    setActive(-1)
                    if (hint) setHint(null)
                  }}
                  onKeyDown={onKeyDown}
                  onPaste={onPaste}
                  onFocus={() => setSuggestOpen(true)}
                  onBlur={() => {
                    setSuggestOpen(false)
                    setActive(-1)
                    if (!draft.trim()) return
                    setDraft(commitDraft(draft))
                  }}
                  placeholder={chips.length ? "" : t.shareAddPeoplePh}
                  className="min-w-[140px] flex-1 bg-transparent py-1.5 text-[14px] text-ws-1 outline-none placeholder:text-ws-4"
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <RoleMenu
                t={t}
                value={inviteRole}
                onChange={setInviteRole}
                disabled={sending}
              />
            </div>

            {/*
              Кого уже приглашали. Мышь здесь работает по onMouseDown с
              preventDefault: без него поле теряет фокус раньше клика, onBlur
              разбирает набранное и закрывает список — по строке не попасть.
            */}
            {suggestOpen && suggestions.length > 0 ? (
              <div className="absolute inset-x-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-xl border border-foreground/10 bg-ws-raised shadow-lg">
                <p className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wide text-ws-4">
                  {t.shareRecent}
                </p>
                <ul className="max-h-[220px] overflow-y-auto pb-1">
                  {suggestions.map((contact, index) => (
                    <li
                      key={contact.email}
                      className={cn(
                        "flex items-center gap-2 px-1.5",
                        index === active && "bg-foreground/10",
                      )}
                      onMouseEnter={() => setActive(index)}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-1.5 text-left"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(contact)}
                      >
                        <PersonAvatar
                          name={contact.fullName}
                          email={contact.email}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] text-ws-1">
                            {contact.fullName || contact.email}
                          </span>
                          <span className="block truncate text-[12px] text-ws-4">
                            {contact.email}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ws-4 hover:bg-foreground/10 hover:text-destructive"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void forget(contact)}
                        aria-label={t.shareForget}
                        title={t.shareForget}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          {hint ? (
            <p className="mt-2 text-[12px] text-destructive">{hint}</p>
          ) : (
            <p className="mt-2 text-[12px] text-ws-4">{t.shareAddPeople}</p>
          )}
        </div>

        <div className="px-6 pb-2 pt-3">
          <p className="mb-2 text-[13px] font-medium text-ws-2">
            {t.sharePeopleWithAccess}
          </p>
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-[13px] text-ws-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t.loading}
            </div>
          ) : (
            <ul className="max-h-[240px] space-y-1 overflow-y-auto pr-1">
              {owner ? (
                <li className="flex items-center gap-3 rounded-xl px-1 py-2">
                  <PersonAvatar name={owner.fullName} email={owner.email} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-ws-1">
                      {owner.fullName || owner.email}
                      {owner.userId === viewerUserId ? (
                        <span className="ml-1.5 text-[12px] font-normal text-ws-4">
                          ({t.shareYou})
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-[12px] text-ws-4">{owner.email}</p>
                  </div>
                  <span className="shrink-0 px-2 text-[13px] text-ws-3">
                    {t.shareOwner}
                  </span>
                </li>
              ) : null}
              {members.map((person) => {
                const role: MemberRole =
                  person.role === "owner" ? "viewer" : person.role
                // «Добавил X» — только про чужие приглашения: строка, которую
                // смотрящий сам и создал, в подписи не нуждается.
                const addedBy =
                  person.invitedBy && person.invitedBy !== viewerUserId
                    ? person.invitedByName
                    : null
                return (
                  <li
                    key={person.userId}
                    className="flex items-center gap-3 rounded-xl px-1 py-2"
                  >
                    <PersonAvatar name={person.fullName} email={person.email} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-ws-1">
                        {person.fullName || person.email}
                        {person.userId === viewerUserId ? (
                          <span className="ml-1.5 text-[12px] font-normal text-ws-4">
                            ({t.shareYou})
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-[12px] text-ws-4">
                        {person.email}
                        {addedBy
                          ? ` · ${tf(t.shareInvitedBy, { name: addedBy })}`
                          : ""}
                      </p>
                    </div>
                    {busyId === person.userId ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ws-4" />
                    ) : canManage(viewerRole, person) ? (
                      <MemberRoleMenu
                        t={t}
                        value={role}
                        onChange={(next) => void changeRole(person, next)}
                        onRemove={() => void removePerson(person)}
                      />
                    ) : (
                      // Роль показана, но не как кнопка: у смотрящего нет права
                      // её менять, и подсказка объясняет, почему.
                      <span
                        className="shrink-0 px-2 text-[13px] text-ws-3"
                        title={
                          person.userId === viewerUserId
                            ? t.shareManagedByOwner
                            : t.shareOwnerOnlyRole
                        }
                      >
                        {roleLabel(role, t)}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="border-t border-foreground/10 px-6 py-4">
          {hasPending ? (
            <Button
              type="button"
              onClick={() => void send()}
              disabled={sending}
              className="bg-ws-action text-white hover:bg-ws-action-hover"
            >
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t.sending}
                </>
              ) : (
                t.shareSend
              )}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={closeShareDialog}
              className="bg-ws-action text-white hover:bg-ws-action-hover"
            >
              {t.shareDone}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RoleMenu({
  t,
  value,
  onChange,
  disabled,
}: {
  t: Dictionary
  value: MemberRole
  onChange: (role: MemberRole) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="mt-0.5 inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[13px] text-ws-2 hover:bg-foreground/10 hover:text-ws-1 disabled:opacity-50"
          onClick={(e) => e.stopPropagation()}
        >
          {roleLabel(value, t)}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[220px] border-foreground/10 bg-ws-raised text-ws-1"
      >
        {ROLES.map((role) => (
          <RoleItem
            key={role}
            t={t}
            role={role}
            selected={value === role}
            onSelect={onChange}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MemberRoleMenu({
  t,
  value,
  onChange,
  onRemove,
}: {
  t: Dictionary
  value: MemberRole
  onChange: (role: MemberRole) => void
  onRemove: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[13px] text-ws-2 hover:bg-foreground/10 hover:text-ws-1"
        >
          {roleLabel(value, t)}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[220px] border-foreground/10 bg-ws-raised text-ws-1"
      >
        {ROLES.map((role) => (
          <RoleItem
            key={role}
            t={t}
            role={role}
            selected={value === role}
            onSelect={onChange}
          />
        ))}
        <DropdownMenuSeparator className="bg-foreground/10" />
        <DropdownMenuItem
          className="cursor-pointer text-destructive focus:bg-foreground/10 focus:text-destructive"
          onSelect={onRemove}
        >
          {t.shareRemove}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RoleItem({
  t,
  role,
  selected,
  onSelect,
}: {
  t: Dictionary
  role: MemberRole
  selected: boolean
  onSelect: (role: MemberRole) => void
}) {
  return (
    <DropdownMenuItem
      className="cursor-pointer flex-col items-start gap-0.5 py-2 focus:bg-foreground/10 focus:text-ws-1"
      onSelect={() => onSelect(role)}
    >
      <span className="flex w-full items-center gap-2">
        <span className="flex-1 font-medium">{roleLabel(role, t)}</span>
        {selected ? <Check className="h-3.5 w-3.5 text-ws-action" /> : null}
      </span>
      <span className="text-[12px] font-normal text-ws-4">
        {roleHint(role, t)}
      </span>
    </DropdownMenuItem>
  )
}
