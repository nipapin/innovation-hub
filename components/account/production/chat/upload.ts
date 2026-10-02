"use client"

/**
 * Заливка вложения чата этапа: подписанная ссылка → PUT в R2 → запись в
 * каталог рабочей папки этапа (lib/production/uploads.ts). Байты мимо сайта.
 */
export type UploadedFile = { id: string; name: string; s3Key: string; contentType: string; sizeBytes: number }

export async function uploadChatFile(
  stepId: string,
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
  /** Слот формы: файл ляжет в папку слота под именем слота. */
  slot?: { rowId: string; index: number; dir: string },
  /** Правка вложения: новым файлом в корень рабочей папки, без места в форме. */
  editCopy?: boolean,
): Promise<UploadedFile> {
  const base = `/api/production/steps/${encodeURIComponent(stepId)}/upload`
  const presignRes = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, sizeBytes: file.size, slot, editCopy }),
    signal,
  })
  const presign = (await presignRes.json().catch(() => null)) as
    | { url?: string; s3Key?: string; contentType?: string; fileName?: string; code?: string }
    | null
  if (!presignRes.ok || !presign?.url || !presign.s3Key) {
    throw new Error(presign?.code ?? `presign-${presignRes.status}`)
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", presign.url!)
    xhr.setRequestHeader("Content-Type", presign.contentType ?? "application/octet-stream")
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`put-${xhr.status}`)))
    xhr.onerror = () => reject(new Error("network"))
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"))
    signal?.addEventListener("abort", () => xhr.abort())
    xhr.send(file)
  })

  const completeRes = await fetch(`${base}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      s3Key: presign.s3Key,
      fileName: presign.fileName ?? file.name,
      sizeBytes: file.size,
      contentType: presign.contentType ?? "application/octet-stream",
      slot,
      editCopy,
    }),
  })
  const complete = (await completeRes.json().catch(() => null)) as { file?: UploadedFile } | null
  if (!completeRes.ok || !complete?.file) throw new Error(`complete-${completeRes.status}`)
  return complete.file
}

/** Ссылка на файл через медиапрокси: ключ кодируется посегментно. */
export function mediaUrl(key: string): string {
  return `/api/media/${key.split("/").map(encodeURIComponent).join("/")}`
}

export function isImage(contentType: string, name: string): boolean {
  return contentType.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)$/i.test(name)
}

export function isVideo(contentType: string, name: string): boolean {
  return contentType.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(name)
}
