"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Search } from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { HELP_SECTIONS, type HelpAudience, type HelpSection } from "@/lib/help/topics"
import { cn } from "@/lib/utils"

type Meta = { title: string; summary: string; tags: string[] }

export type HelpEntry = {
  id: string
  section: HelpSection
  audience: HelpAudience
  ru: Meta
  /** null — перевода нет, показываем русскую шапку. */
  en: Meta | null
}

/**
 * Индекс справки: список тем по разделам, с фильтром по тексту и тегам.
 *
 * Поиск клиентский и по заголовку с тегами, а не полнотекстовый по телу статей.
 * Тем сотни, а не десятки тысяч — полнотекстовый индекс здесь стоил бы дороже
 * пользы. Понадобится — в базе уже есть Postgres с `tsvector`, но начинать
 * с него было бы решением задачи, которой пока нет.
 *
 * Список приходит с сервера уже отфильтрованным по правам: этот компонент
 * ничего не прячет, он только сортирует и ищет.
 */
export function HelpIndex({ entries }: { entries: HelpEntry[] }) {
  const { t, lang } = useI18n()
  const [query, setQuery] = useState("")
  const [tag, setTag] = useState<string | null>(null)

  const pick = useMemo(
    () => (entry: HelpEntry) => (lang === "en" && entry.en ? entry.en : entry.ru),
    [lang],
  )

  const tags = useMemo(() => {
    const all = new Set<string>()
    for (const entry of entries) for (const one of pick(entry).tags) all.add(one)
    return [...all].sort((a, b) => a.localeCompare(b))
  }, [entries, pick])

  const found = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return entries.filter((entry) => {
      const meta = pick(entry)
      if (tag && !meta.tags.includes(tag)) return false
      if (!needle) return true
      return (
        meta.title.toLocaleLowerCase().includes(needle) ||
        meta.summary.toLocaleLowerCase().includes(needle) ||
        meta.tags.some((one) => one.toLocaleLowerCase().includes(needle))
      )
    })
  }, [entries, pick, query, tag])

  return (
    <>
      <h1 className="text-[26px] font-semibold text-ws-1">{t.helpTitle}</h1>
      <p className="mt-1.5 text-[14px] text-ws-4">{t.helpSubtitle}</p>

      <div className="relative mt-6">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ws-4" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.helpSearch}
          className="h-11 w-full rounded-[11px] border border-white/[0.09] bg-ws-control pl-10 pr-4 text-[14px] text-ws-1 placeholder:text-ws-5 focus:border-ws-action focus:outline-none"
        />
      </div>

      {tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <TagPill active={tag === null} onClick={() => setTag(null)}>
            {t.helpTagAll}
          </TagPill>
          {tags.map((one) => (
            <TagPill
              key={one}
              active={tag === one}
              onClick={() => setTag(tag === one ? null : one)}
            >
              {one}
            </TagPill>
          ))}
        </div>
      ) : null}

      {found.length === 0 ? (
        <p className="mt-10 text-[14px] text-ws-4">{t.helpEmpty}</p>
      ) : (
        HELP_SECTIONS.map((section) => {
          const inSection = found.filter((entry) => entry.section === section.key)
          if (inSection.length === 0) return null

          return (
            <section key={section.key} className="mt-8">
              <h2 className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ws-5">
                {t[section.labelKey]}
              </h2>

              <div className="flex flex-col gap-1.5">
                {inSection.map((entry) => {
                  const meta = pick(entry)
                  return (
                    <Link
                      key={entry.id}
                      href={`/help/${entry.id}`}
                      className="group rounded-[11px] border border-white/[0.07] bg-ws-panel px-4 py-3.5 transition-colors hover:border-white/[0.14]"
                    >
                      <div className="flex items-baseline gap-2.5">
                        <span className="text-[14.5px] font-medium text-ws-1 group-hover:text-white">
                          {meta.title}
                        </span>
                        <Audience audience={entry.audience} />
                      </div>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ws-4">
                        {meta.summary}
                      </p>
                    </Link>
                  )
                })}
              </div>
            </section>
          )
        })
      )}
    </>
  )
}

function TagPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-[12px] transition-colors",
        active
          ? "border-ws-action bg-ws-action/15 text-ws-1"
          : "border-white/[0.09] text-ws-4 hover:text-ws-2",
      )}
    >
      {children}
    </button>
  )
}

/**
 * Метка аудитории.
 *
 * У админских тем показывается сам тег (`settings.write`), а не переведённое
 * название: ровно этой строкой право и называется на экране выдачи доступов,
 * и человек должен узнать её без перевода в уме.
 */
function Audience({ audience }: { audience: HelpAudience }) {
  const { t } = useI18n()

  return audience === "user" ? (
    <span className="text-[11px] text-ws-5">{t.helpAudienceUser}</span>
  ) : (
    <span className="font-mono text-[11px] text-ws-5">{audience}</span>
  )
}
