import { resolveProjectContentType } from "@/lib/project-upload-policy"

export type DirectUploadResult = {
  id: string
  projectId: string
  name: string
  contentType: string
  sizeBytes: number
  s3Key: string | null
  createdAt: string
}

/**
 * Заливку оборвали — это не поломка, а решение человека.
 *
 * Отдельный тип, потому что вызывающему нужно различать: про сетевой сбой он
 * показывает тост, а про отмену молчит — человек и так знает, что нажал.
 */
export class UploadCancelled extends Error {
  constructor() {
    super("Upload cancelled.")
    this.name = "UploadCancelled"
  }
}

export function isUploadCancelled(error: unknown): boolean {
  return (
    error instanceof UploadCancelled ||
    (error instanceof DOMException && error.name === "AbortError")
  )
}

/** Отказ `fetch` по сигналу приходит как AbortError — переводим в свой тип. */
function asCancel(error: unknown): unknown {
  if (error instanceof DOMException && error.name === "AbortError") {
    return new UploadCancelled()
  }
  return error
}

/**
 * Browser upload: presign → PUT bytes to R2 → notify. Does not go through Next.
 */
export async function uploadProjectFileDirect(input: {
  projectId: string
  file: File
  folderPath?: string
  /**
   * Под каким именем сохранить. Пусто — имя самого файла.
   *
   * Нужно, когда имя в папке занято и человек выбрал «сохранить оба»: файл на
   * диске у него тот же, а в проекте должен лечь как `clip (2).mp4`.
   */
  name?: string
  /**
   * Писать поверх одноимённого файла: тот же объект, та же строка каталога, тот
   * же `file_id`. Ключ находит сервер — браузеру физическая идентичность
   * объекта не нужна.
   */
  overwrite?: boolean
  onProgress?: (percent: number) => void
  /**
   * Оборвать заливку. Действует до конца отправки байтов; успевший доехать до
   * R2 объект уже не отменяем — почему, сказано перед `notify`.
   */
  signal?: AbortSignal
}): Promise<DirectUploadResult> {
  if (input.signal?.aborted) throw new UploadCancelled()
  const name = input.name ?? input.file.name
  const contentType =
    resolveProjectContentType({ name, type: input.file.type }) ??
    "application/octet-stream"
  const folderPath = input.folderPath ?? ""

  let presignRes: Response
  try {
    presignRes = await fetch("/api/storage/v1/presign", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: input.projectId,
        method: "PUT",
        folderPath,
        fileName: name,
        contentType,
        overwrite: input.overwrite ?? false,
      }),
      signal: input.signal,
    })
  } catch (error) {
    throw asCancel(error)
  }
  const presign = (await presignRes.json().catch(() => null)) as
    | {
        url?: string
        s3Key?: string
        fileName?: string
        folderPath?: string
        contentType?: string
        message?: string
      }
    | null
  if (!presignRes.ok || !presign?.url || !presign.s3Key) {
    throw new Error(presign?.message ?? `Could not prepare upload (${presignRes.status})`)
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const detach = () => input.signal?.removeEventListener("abort", abort)
    xhr.open("PUT", presign.url!)
    xhr.setRequestHeader("Content-Type", presign.contentType ?? contentType)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && input.onProgress) {
        input.onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      detach()
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Storage rejected the upload (HTTP ${xhr.status}).`))
    }
    xhr.onerror = () => {
      detach()
      reject(new Error("Network error during upload."))
    }
    xhr.onabort = () => {
      detach()
      reject(new UploadCancelled())
    }
    input.signal?.addEventListener("abort", abort)
    xhr.send(input.file)
  })

  /*
   * Дальше отмена не действует, и это намеренно.
   *
   * Байты уже в бакете. Не позвать `notify` — значит оставить объект без строки
   * каталога, а такой объект не пропадает: полная переиндексация проекта
   * (lib/storage/write-path.ts#reindexProject) сверяет R2 со справочником и
   * заводит строки всему, чего в нём нет. Отменённый файл всплыл бы в папке
   * позже и сам. Поэтому окно отмены кончается на последнем отправленном байте.
   */
  const notifyRes = await fetch("/api/storage/v1/notify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      s3Key: presign.s3Key,
      folderPath: presign.folderPath ?? folderPath,
      fileName: name,
      sizeBytes: input.file.size,
      contentType: presign.contentType ?? contentType,
    }),
  })
  const notify = (await notifyRes.json().catch(() => null)) as
    | { file?: DirectUploadResult & { name: string }; message?: string }
    | null
  if (!notifyRes.ok || !notify?.file) {
    throw new Error(notify?.message ?? `Upload confirm failed (${notifyRes.status})`)
  }
  const file = notify.file
  return {
    ...file,
    createdAt: new Date(file.createdAt).toISOString(),
  }
}
