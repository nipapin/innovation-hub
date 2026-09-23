"use client"

/**
 * Операции над папкой элемента — один закрытый список.
 *
 * Слоты не ходят в сеть сами: форма рекурсивная, и разбросанные по ней `fetch`
 * означали бы, что правило «как называется файл» живёт в десятке мест. Здесь же
 * всё, что меняет папку, и каждое действие собирает имя через `lib/tools/element`.
 *
 * Заливка идёт прямым путём (presign → PUT → notify), как в кабинете: диалог
 * существует только там, где флаг включён, а это зона с `directUpload`.
 */

import { uploadProjectFileDirect } from "@/lib/project-direct-upload"
import { renumber, slotFileName, subfolderName } from "@/lib/tools/element/names"
import type { DriveFile } from "../types"

export type ElementIO = {
  projectId: string
  /** Логический путь папки элемента от корня проекта: `IN/-Ролик 2026-09-23`. */
  folderPath: string
  /** Залить файл в слот под именем, которое ждёт граф. */
  putFile: (input: {
    dir: string
    index: number
    label: string
    file: File
    originalName?: string | null
    /** Имя, которое слот занимал раньше: перезапись идёт поверх него. */
    replaces?: string | null
    /** Проценты — их рисует сама строка слота, поверх подчёркивания. */
    onProgress?: (percent: number) => void
  }) => Promise<void>
  /** Записать текст слота отдельным `.txt`. */
  putText: (input: {
    dir: string
    index: number
    label: string
    text: string
    originalName?: string | null
    replaces?: string | null
  }) => Promise<void>
  /** Завести подпапку слота. */
  makeFolder: (input: { dir: string; index: number; label: string }) => Promise<void>
  /** Удалить строку каталога по id. */
  remove: (fileId: string) => Promise<void>
  /** Перенумеровать слоты строки требования одной пачкой. */
  reorder: (input: {
    /** Узлы в желаемом порядке — из них берутся id и старые имена. */
    nodes: DriveFile[]
    labels: string[]
  }) => Promise<void>
}

/** Полный путь внутри проекта: папка элемента плюс путь от неё. */
function joinPath(folderPath: string, dir: string): string {
  return dir ? `${folderPath}/${dir}` : folderPath
}

export function createElementIO(input: {
  projectId: string
  folderPath: string
  fileUrl: (projectId: string, fileId: string) => string
  folderUrl: (projectId: string) => string
}): ElementIO {
  const { projectId, folderPath, fileUrl, folderUrl } = input

  const upload = async (
    dir: string,
    name: string,
    file: File,
    replaces: string | null | undefined,
    onProgress?: (percent: number) => void,
  ) => {
    await uploadProjectFileDirect({
      projectId,
      file,
      folderPath: joinPath(folderPath, dir),
      name,
      // Перезапись поверх того же имени сохраняет файлу историю и id. Имя при
      // этом всегда наше: слот его и задаёт.
      overwrite: replaces === name,
      onProgress,
    })
  }

  return {
    projectId,
    folderPath,

    putFile: async ({ dir, index, label, file, originalName, replaces, onProgress }) => {
      const name = slotFileName(index, label, originalName ?? file.name)
      await upload(dir, name, file, replaces, onProgress)
    },

    putText: async ({ dir, index, label, text, originalName, replaces }) => {
      // Итог всегда один — новый `.txt`, записанный инструментом. Так у двух
      // разных текстов никогда не совпадут имена (план §7.3).
      const base = originalName?.trim()
      const name = base
        ? slotFileName(index, label, base.replace(/\.[^.]*$/, "") + ".txt")
        : `${slotFileName(index, label)}.txt`
      const file = new File([text], name, { type: "text/plain;charset=utf-8" })
      await upload(dir, name, file, replaces)
    },

    makeFolder: async ({ dir, index, label }) => {
      const res = await fetch(folderUrl(projectId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: subfolderName(index, label),
          folderPath: joinPath(folderPath, dir),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? "Failed")
      }
    },

    remove: async (fileId) => {
      const res = await fetch(fileUrl(projectId, fileId), { method: "DELETE" })
      if (!res.ok) throw new Error("Failed")
    },

    reorder: async ({ nodes, labels }) => {
      const moves = renumber(
        nodes.map((node) => node.name),
        labels,
      )
      if (moves.length === 0) return
      // Пачкой, а не по файлу: перестановка двух соседей — это цикл `01` ↔ `02`,
      // и поштучно он невыполним вовсе (см. writeRenameBatch).
      const byName = new Map(nodes.map((node) => [node.name, node.id]))
      const res = await fetch("/api/storage/v1/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          items: moves
            .map((move) => ({ fileId: byName.get(move.from), name: move.to }))
            .filter((item): item is { fileId: string; name: string } =>
              Boolean(item.fileId),
            ),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? "Failed")
      }
    },
  }
}
