"use client"

import { useMemo, useState } from "react"
import { Check, Plus, Trash2 } from "lucide-react"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Языки, которые предлагаем первыми.
 *
 * Не «список всех языков мира»: он длинный, а нужен обычно один из этих. Всё
 * остальное вводится кодом руками — поле ниже принимает любой ISO-639-1 или
 * BCP-47, как и требует контракт документа.
 */
const COMMON = ["ru", "en", "es", "fr", "de", "pt", "it", "pl", "tr", "ar", "hi", "zh", "ja", "ko"]

/** Название языка на языке интерфейса; нет такого кода — показываем сам код. */
export function languageName(code: string, uiLang: string): string {
  try {
    return new Intl.DisplayNames([uiLang], { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}

/**
 * Языки перевода: что уже есть и что можно добавить.
 *
 * Нужен даже когда переводов в папке нет вовсе: перевод в этом инструменте не
 * только правят, но и пишут с нуля, а писать его некуда, пока не сказано, на
 * каком языке. Язык уходит в `languages.targets` документа — оттуда его возьмёт
 * и экспорт, и следующий инструмент.
 *
 * Добавленные языки показываем здесь же: включая введённые кодом руками — иначе
 * свой язык нельзя ни увидеть в списке, ни убрать.
 */
export function LanguagePicker({
  taken,
  original,
  onPick,
  onRemove,
}: {
  taken: string[]
  original: string
  onPick: (code: string) => void
  onRemove: (code: string) => void
}) {
  const { t, lang: uiLang } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState("")

  const offered = useMemo(
    () => COMMON.filter((code) => code !== original && !taken.includes(code)),
    [original, taken],
  )

  const submit = (code: string) => {
    const value = code.trim().toLowerCase()
    if (!value) return
    onPick(value)
    setCustom("")
    setOpen(false)
  }

  const remove = (code: string) => {
    // Удаление уносит все переводы на этот язык из всех реплик — это не то,
    // что делают случайно, и не то, что стоит прятать за молчаливым кликом.
    if (!window.confirm(tf(t.srtRemoveLanguageConfirm, { name: languageName(code, uiLang) }))) {
      return
    }
    onRemove(code)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t.srtAddLanguage}
          aria-label={t.srtAddLanguage}
          className="flex h-[26px] w-[26px] items-center justify-center rounded text-ws-3 hover:bg-foreground/5 hover:text-ws-1"
        >
          <Plus className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] min-w-[260px] overflow-y-auto">
        {taken.length > 0 ? (
          <>
            <DropdownMenuLabel className="text-[11.5px] uppercase tracking-[1.4px] text-ws-5">
              {t.srtLanguagesAdded}
            </DropdownMenuLabel>
            {taken.map((code) => (
              <div
                key={code}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[14px] hover:bg-foreground/5"
              >
                <span className="min-w-0 flex-1 truncate">{languageName(code, uiLang)}</span>
                <span className="shrink-0 font-mono text-[11px] text-ws-5">{code}</span>
                <button
                  type="button"
                  title={t.srtRemoveLanguage}
                  aria-label={tf(t.srtRemoveLanguage, { name: code })}
                  onClick={() => remove(code)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-transparent text-ws-5 hover:border-destructive/40 hover:text-destructive"
                >
                  <Trash2 className="h-[15px] w-[15px]" />
                </button>
              </div>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuLabel className="text-[11.5px] uppercase tracking-[1.4px] text-ws-5">
          {t.srtAddLanguage}
        </DropdownMenuLabel>
        {offered.map((code) => (
          <DropdownMenuItem
            key={code}
            onClick={() => submit(code)}
            className="cursor-pointer justify-between gap-3 focus:bg-foreground/10"
          >
            <span className="truncate">{languageName(code, uiLang)}</span>
            <span className="shrink-0 font-mono text-[11px] text-ws-5">{code}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit(custom)
          }}
          className="flex items-center gap-2 px-2 py-1.5"
          // Ввод внутри меню: без этого Radix уводит фокус на пункт по букве.
          onKeyDown={(e) => e.stopPropagation()}
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={t.srtLanguageCode}
            maxLength={12}
            className="h-7 min-w-0 flex-1 rounded border border-foreground/[0.10] bg-ws-well px-2 text-[12px] text-ws-1 outline-none focus:border-ws-action"
          />
          <button
            type="submit"
            title={t.toolAdd}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-foreground/[0.10] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
          >
            <Check className="h-4 w-4" />
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
