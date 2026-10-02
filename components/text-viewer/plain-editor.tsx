"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { MarkupEditor } from "./markup-editor"
import { useUnsavedMark } from "./unsaved"

/**
 * Правка текста файла: простое поле или редактор с оформлением, и общая
 * строка «Отмена / Сохранить» под ними.
 *
 * `validate` возвращает текст ошибки, пока сохранять нельзя (json, который не
 * разбирается), и `null`, когда можно.
 */
export function EditFooter({
  dirty,
  error,
  onSave,
  onCancel,
}: {
  dirty: boolean
  error: string | null
  onSave: () => Promise<unknown>
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [saving, setSaving] = useState(false)
  // Изменённый текст — в общий реестр: окно и стрелки спросят перед уходом.
  useUnsavedMark(dirty)
  return (
    <div className="flex flex-none items-center justify-end gap-2">
      {error ? (
        <span className="mr-auto text-[12px] text-destructive">{error}</span>
      ) : null}
      <button
        type="button"
        onClick={() => {
          if (!dirty || window.confirm(t.textUnsavedDiscard)) onCancel()
        }}
        className="h-8 rounded-[9px] border border-foreground/10 bg-ws-control px-3 text-[13px] text-ws-2 hover:bg-ws-hover"
      >
        {t.productionEditCancel}
      </button>
      <button
        type="button"
        disabled={!dirty || saving || error !== null}
        onClick={async () => {
          setSaving(true)
          try {
            await onSave()
          } finally {
            setSaving(false)
          }
        }}
        className="flex h-8 items-center gap-1.5 rounded-[9px] bg-success px-3 text-[13px] font-medium text-background hover:bg-success/90 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {t.productionEditSave}
      </button>
    </div>
  )
}

/** Простое поле — для всего текста без оформления (json, srt, md, лог…). */
export function PlainEditor({
  initial,
  onSave,
  onCancel,
  validate,
}: {
  initial: string
  onSave: (text: string) => Promise<unknown>
  onCancel: () => void
  validate?: (text: string) => string | null
}) {
  const [text, setText] = useState(initial)
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <textarea
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        className="scrollbar-elegant min-h-0 w-full flex-1 resize-none rounded-lg border border-foreground/10 bg-ws-control p-3 font-mono text-[13px] text-ws-1 outline-none focus:border-ws-select"
      />
      <EditFooter
        dirty={text !== initial}
        error={validate ? validate(text) : null}
        onSave={() => onSave(text)}
        onCancel={onCancel}
      />
    </div>
  )
}

/** Редактор с оформлением — для `.txt`, тот же, что в «Элементе». */
export function MarkupFileEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string
  onSave: (text: string) => Promise<unknown>
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <MarkupEditor value={initial} onChange={setText} loadKey={0} className="min-h-0 flex-1" />
      <EditFooter
        dirty={text !== initial}
        error={null}
        onSave={() => onSave(text)}
        onCancel={onCancel}
      />
    </div>
  )
}
