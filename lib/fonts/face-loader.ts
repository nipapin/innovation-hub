import { coveredCodepoints } from "./coverage"

/**
 * Загрузка лица шрифта в браузер — docs/FONTS_PLAN.md §6.
 *
 * Один запрос делает две работы: регистрирует `FontFace`, чтобы образец
 * рисовался НАСТОЯЩИМ файлом, и отдаёт покрытие из той же таблицы `cmap`.
 * Разделять их значило бы качать пятимегабайтный иероглифический шрифт дважды.
 *
 * Только браузер: `FontFace` и `document.fonts` на сервере не существуют.
 */

export type LoadedFont = {
  family: string
  /** Коды, которые шрифт рисует. Пусто — таблица не прочиталась, молчим. */
  covered: Set<number>
}

const loading = new Map<string, Promise<LoadedFont>>()

/** Адрес начертания из витрины. Для шрифта проекта адрес даёт сам проект. */
export function libraryFaceUrl(family: string): string {
  return `/api/fonts/${encodeURIComponent(family)}/file`
}

export function isFontLoaded(family: string): boolean {
  return loading.has(family)
}

export function loadFont(family: string, url: string): Promise<LoadedFont> {
  const started = loading.get(family)
  if (started) return started

  const task = (async (): Promise<LoadedFont> => {
    const res = await fetch(url, { credentials: "same-origin" })
    if (!res.ok) throw new Error(`Font request failed (${res.status}).`)
    const bytes = new Uint8Array(await res.arrayBuffer())

    // Регистрируем под ИМЕНЕМ СЕМЕЙСТВА: дальше достаточно обычного
    // `font-family`, и шрифт достаётся и образцу, и строке списка.
    const face = new FontFace(family, bytes)
    await face.load()
    document.fonts.add(face)

    return { family, covered: coveredCodepoints(bytes) }
  })()

  loading.set(family, task)
  // Неудачу не запоминаем: сеть могла моргнуть, а второй попытки уже не было бы.
  task.catch(() => loading.delete(family))
  return task
}
