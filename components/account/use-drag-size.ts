"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type Options = {
  initial: number
  min: number
  max: number
  /** "x" — тянем по горизонтали (ширина), "y" — по вертикали (высота). */
  axis: "x" | "y"
  /** true, если ручка на противоположном крае: движение назад увеличивает размер. */
  invert?: boolean
  /** Ключ localStorage — размер запоминается между сессиями. */
  storageKey?: string
}

/**
 * Размер панели в пикселях, который пользователь тянет за край.
 * Возвращает текущий размер и обработчик для невидимой ручки на краю.
 */
export function useDragSize({
  initial,
  min,
  max,
  axis,
  invert = false,
  storageKey,
}: Options) {
  const [size, setSizeState] = useState(initial)
  const sizeRef = useRef(initial)
  const [dragging, setDragging] = useState(false)

  const clamp = useCallback(
    (v: number) => Math.min(max, Math.max(min, Math.round(v))),
    [min, max],
  )

  const apply = useCallback((v: number) => {
    sizeRef.current = v
    setSizeState(v)
  }, [])

  useEffect(() => {
    if (!storageKey) return
    const raw = window.localStorage.getItem(storageKey)
    const parsed = raw == null ? Number.NaN : Number(raw)
    if (Number.isFinite(parsed)) apply(clamp(parsed))
  }, [storageKey, clamp, apply])

  // Пределы бывают живыми (высота по содержимому): сузились — текущий размер
  // подтягивается внутрь, иначе ручка сперва «съедала» бы невидимый запас.
  useEffect(() => {
    if (sizeRef.current !== clamp(sizeRef.current)) apply(clamp(sizeRef.current))
  }, [clamp, apply])

  const persist = useCallback(() => {
    if (storageKey) window.localStorage.setItem(storageKey, String(sizeRef.current))
  }, [storageKey])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      const start = axis === "x" ? event.clientX : event.clientY
      const base = sizeRef.current
      const body = document.body
      const prevCursor = body.style.cursor
      const prevSelect = body.style.userSelect
      body.style.cursor = axis === "x" ? "col-resize" : "row-resize"
      body.style.userSelect = "none"
      setDragging(true)

      const onMove = (e: PointerEvent) => {
        const delta = (axis === "x" ? e.clientX : e.clientY) - start
        apply(clamp(base + (invert ? -delta : delta)))
      }
      const onUp = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        body.style.cursor = prevCursor
        body.style.userSelect = prevSelect
        setDragging(false)
        persist()
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [axis, invert, clamp, apply, persist],
  )

  /** Программно выставить размер (кнопкой «свернуть», сбросом и т.п.). */
  const setSize = useCallback(
    (value: number) => {
      apply(clamp(value))
      persist()
    },
    [apply, clamp, persist],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? 40 : 12
      const back = axis === "x" ? "ArrowLeft" : "ArrowUp"
      const forward = axis === "x" ? "ArrowRight" : "ArrowDown"
      if (event.key !== back && event.key !== forward) return
      event.preventDefault()
      const dir = event.key === forward ? 1 : -1
      apply(clamp(sizeRef.current + (invert ? -dir : dir) * step))
      persist()
    },
    [axis, invert, clamp, apply, persist],
  )

  return { size, setSize, dragging, onPointerDown, onKeyDown }
}
