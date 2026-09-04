import { query } from "@/lib/db"
import { projectPrefix } from "@/lib/storage/keys"

/**
 * Состояние обработки элементов папки `IN` — для отметки в дереве кабинета.
 *
 * Отвечает на вопрос, который до сих пор можно было задать только контекстному
 * меню: «этот файл уже прогоняли?». Обе линии сборки берут только то, по чему
 * задачи не было вообще (docs/PIPELINE.md §3), поэтому обработанный файл лежит
 * в `IN` неотличимо от только что залитого — и человек ждал обработки, которой
 * уже не будет. Пункт «Обработать заново» из этого положения выводит, но найти
 * его можно, только заранее зная, что файл встал.
 *
 * Идентичность элемента считаем ровно так же, как обе линии сборки и
 * `reprocess.ts`: у файла это физический ключ, у папки — собранный, потому что
 * у строки-папки `s3_key` нет по схеме. Разъедься это здесь — отметка стояла бы
 * не на том элементе.
 *
 * Только верхний уровень `IN`: единица работы конвейера — элемент верхнего
 * уровня, у файла внутри `IN/raw` задачи не бывает, и отмечать там нечего.
 */

/**
 * Что показываем человеку. Словарь тот же, что у `account-tasks.ts`, и по той
 * же причине: `claimed` наружу не выходит — разница между «машина взяла» и
 * «машина работает» существует только внутри очереди.
 */
export type InItemStatus = "queued" | "running" | "done" | "failed"

/** id строки каталога → состояние последней задачи по этому элементу. */
export type InStatusMap = Record<string, InItemStatus>

type Row = {
  fileId: string
  status: "queued" | "claimed" | "running" | "done" | "failed"
}

export async function loadInStatus(input: {
  projectId: string
  storageOwnerId: string
}): Promise<InStatusMap> {
  const prefix = projectPrefix(input.storageOwnerId, input.projectId)

  // DISTINCT ON — последняя задача по элементу. «Обработать заново» прежние
  // строки не трогает, и без этого у файла, прогнанного дважды, было бы два
  // состояния сразу. Выборка ложится на tasks_source_key_idx
  // (project_id, source_key) — тот же индекс, которым спрашивает обход.
  const result = await query<Row>(
    `SELECT DISTINCT ON (pf.id)
            pf.id AS "fileId",
            t.status
       FROM project_files pf
       JOIN tasks t
         ON t.project_id = pf.project_id
        AND t.source_key = CASE WHEN pf.is_folder
                                -- Явный ::text обязателен: у 'unknown || unknown'
                                -- Postgres не может выбрать оператор.
                                THEN $2::text || 'IN/' || pf.name
                                ELSE pf.s3_key
                           END
      WHERE pf.project_id = $1
        AND pf.folder_path = 'IN'
        AND pf.deleted_at IS NULL
      ORDER BY pf.id, t.created_at DESC`,
    [input.projectId, prefix],
  )

  const map: InStatusMap = {}
  for (const row of result.rows) {
    map[row.fileId] = row.status === "claimed" ? "running" : row.status
  }
  return map
}
