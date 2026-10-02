"use client"

import { useEffect, useId } from "react"

/**
 * Несохранённые правки текста — один реестр на страницу.
 *
 * Редакторы (`EditFooter` у всех трёх) отмечают здесь, что текст изменён;
 * окна и списки перед закрытием или переходом к другому файлу спрашивают
 * `confirmDiscardEdits`. Реестр в модуле, а не проброс флага через пропсы:
 * редактор живёт глубоко в просмотрщике, а закрывают его окно, стрелки и
 * выбор файла в разных местах дерева.
 */
const dirtyEditors = new Set<string>()

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (dirtyEditors.size === 0) return
  event.preventDefault()
  // Старые браузеры показывают вопрос только при непустом returnValue.
  event.returnValue = ""
}

function mark(id: string, dirty: boolean) {
  const before = dirtyEditors.size
  if (dirty) dirtyEditors.add(id)
  else dirtyEditors.delete(id)
  if (before === 0 && dirtyEditors.size > 0) window.addEventListener("beforeunload", onBeforeUnload)
  if (before > 0 && dirtyEditors.size === 0) window.removeEventListener("beforeunload", onBeforeUnload)
}

/** Отметить редактор изменённым; снимается при сохранении, отмене и размонтировании. */
export function useUnsavedMark(dirty: boolean) {
  const id = useId()
  useEffect(() => {
    mark(id, dirty)
    return () => mark(id, false)
  }, [id, dirty])
}

export function hasUnsavedEdits(): boolean {
  return dirtyEditors.size > 0
}

/**
 * Можно ли бросить правки: нет изменённых — да сразу, иначе спрашиваем.
 * Согласие отметки не снимает: редакторы, что остаются на странице, должны
 * и дальше быть под защитой (снимет размонтирование). Повторный вопрос в том же
 * действии гасит флаг «только что согласились» до конца текущей задачи.
 */
let justConfirmed = false

export function confirmDiscardEdits(message: string): boolean {
  if (dirtyEditors.size === 0 || justConfirmed) return true
  if (!window.confirm(message)) return false
  justConfirmed = true
  setTimeout(() => {
    justConfirmed = false
  }, 0)
  return true
}
