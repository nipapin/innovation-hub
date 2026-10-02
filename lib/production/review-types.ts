/**
 * Пометки ревью — docs/PRODUCTION_PLAN.md §8. Типы общие для сервера и клиента.
 *
 * Пометка = текст + якорь + рисунок. Рисунок — вектор в нормированных
 * координатах 0..1 от картинки (x — доля ширины, y — доля высоты): совпадает на
 * любом размере. Толщина и размер текста — ступень 1..5, в пикселях считаются
 * от большей стороны картинки при показе.
 *
 * Якорь общий для будущих видов: у картинки — `image`; у видео будут кадр
 * (`frame`, с рисунком) и диапазон (`range`, только текст).
 */

/** Точка [x, y] в долях картинки. */
export type ReviewPoint = [number, number]

export type ReviewShapeStyle = { id: string; color: string; size: number }

export type ReviewShape =
  | (ReviewShapeStyle & { kind: "pen"; points: ReviewPoint[] })
  | (ReviewShapeStyle & { kind: "arrow" | "line" | "rect" | "ellipse"; a: ReviewPoint; b: ReviewPoint })
  | (ReviewShapeStyle & { kind: "text"; at: ReviewPoint; text: string })

export type ReviewAnchor = { kind: "image" }

export type ReviewComment = {
  id: string
  authorId: string
  authorName: string
  createdAt: string
  editedAt?: string
  body: string
  anchor: ReviewAnchor
  shapes: ReviewShape[]
  resolvedBy?: string
  resolvedByName?: string
  resolvedAt?: string
}

/** Файл `<рабочая>/.review/<fileId>.json`. */
export type ReviewDoc = { version: 1; fileId: string; comments: ReviewComment[] }

/** Ответ GET: файл, пометки и что можно мне. */
export type ReviewView = {
  file: { id: string; name: string; s3Key: string; contentType: string }
  comments: ReviewComment[]
  me: { userId: string; canResolve: boolean; isOwner: boolean }
}
