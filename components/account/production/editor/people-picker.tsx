"use client"

import { useState } from "react"
import { Check, Plus } from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useEditor } from "./editor-context"

/**
 * Люди ноды: фишки с именами и «+», открывающий поиск по кругу людей
 * (§6.1 — своя компания или свои контакты). Назначить можно только из круга;
 * человек, выпавший из круга, остаётся фишкой с пометкой — снять его можно.
 */
export function PeoplePicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string[]
  onChange: (next: string[]) => void
}) {
  const { t } = useI18n()
  const { people, readOnly } = useEditor()
  const [query, setQuery] = useState("")
  const byId = new Map(people.map((p) => [p.id, p]))
  const q = query.trim().toLowerCase()
  const found = people.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
  )
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  return (
    <div className="nodrag min-w-0 flex-1 space-y-1">
      <div className="text-[10.5px] font-semibold uppercase tracking-[1px] text-ws-4">{label}</div>
      <div className="flex flex-wrap items-center gap-1">
        {value.map((id) => {
          const person = byId.get(id)
          return (
            <span
              key={id}
              title={person?.email ?? t.productionEdPersonOutside}
              className={cn(
                "rounded px-1.5 py-0.5 text-[11.5px]",
                person ? "bg-ws-select/35 text-ws-1" : "bg-warning/15 text-warning",
              )}
            >
              {person?.name ?? "?"}
            </span>
          )
        })}
        {readOnly ? null : (
          <Popover onOpenChange={(open) => !open && setQuery("")}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t.productionAddPerson}
                title={t.productionAddPerson}
                className="flex h-5 w-5 items-center justify-center rounded border border-foreground/10 text-ws-4 hover:bg-ws-hover hover:text-ws-1"
              >
                <Plus className="h-3 w-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-1.5">
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.productionEdSearchPeople}
                className="mb-1 h-8 w-full rounded-md border border-foreground/10 bg-ws-control px-2 text-[12.5px] text-ws-1 outline-none placeholder:text-ws-5"
              />
              <div className="max-h-56 overflow-y-auto">
                {found.length === 0 ? (
                  <p className="px-2 py-2 text-[12px] text-ws-4">{t.productionEdNoPeople}</p>
                ) : (
                  found.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => toggle(person.id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] text-ws-1 hover:bg-ws-hover"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {value.includes(person.id) ? <Check className="h-3.5 w-3.5 text-success" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{person.name}</span>
                      <span className="truncate text-[11px] text-ws-4">{person.email}</span>
                    </button>
                  ))
                )}
              </div>
              {/* Снять человека, выпавшего из круга: в списке поиска его нет. */}
              {value.filter((id) => !byId.has(id)).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggle(id)}
                  className="mt-1 w-full rounded px-2 py-1.5 text-left text-[12px] text-warning hover:bg-ws-hover"
                >
                  {t.productionEdRemoveOutside}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  )
}
