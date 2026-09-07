import { request as httpsRequest } from "node:https"
import { PassThrough, Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import { GetObjectCommand } from "@aws-sdk/client-s3"

import { getS3Client } from "@/lib/s3-client"
import { getS3Bucket } from "@/lib/s3-config"
import { VkApiError } from "@/lib/social/vk"

/**
 * Публикация видео во ВКонтакте: `video.save` → заливка → `wall.post`.
 *
 * Порт `plugins-dev/autoPostVK/_publisher.ts` из fs.manager.tauri. Отличие
 * одно, и оно определяет весь файл: там заливается ЛОКАЛЬНЫЙ файл, здесь —
 * объект из R2, которого на диске нет и быть не должно.
 *
 * ⚠️ СТРИМ, А НЕ БУФЕР. Ролик на два гигабайта, прочитанный в память, положит
 * процесс: в pm2 стоит `max_memory_restart: 1G` (`ecosystem.config.json`).
 * Поэтому байты идут из R2 прямо в сокет VK, не задерживаясь.
 *
 * ⚠️ ПОЧЕМУ `node:https`, А НЕ `fetch`. Загрузчику VK нужен `Content-Length`:
 * длину мы знаем из каталога, а `fetch` со стрим-телом отправляет
 * `Transfer-Encoding: chunked` и своего `Content-Length` поставить не даёт —
 * это запрещённый заголовок по спецификации Fetch. Сырой https-запрос таких
 * ограничений не имеет, а больше нам от него ничего и не нужно.
 */

const V = "5.199"

export type VkPublishInput = {
  accessToken: string
  /** Ключ объекта в R2 и его размер из каталога. */
  sourceKey: string
  sizeBytes: number
  fileName: string
  title: string
  description: string
  /** id сообщества без знака. Пусто — публикуем на свою стену. */
  groupId?: string
  onLog?: (message: string) => void
}

export type VkPublishResult = {
  ownerId: number
  videoId: number
  postId: number | null
  permalink: string
}

/** Вызов метода VK. Токен в теле, не в адресе — чтобы не попасть в логи. */
async function vkApi(
  method: string,
  params: Record<string, string | number | undefined>,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ v: V })
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    body.set(key, String(value))
  }

  const res = await fetch(`https://api.vk.com/method/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  })
  const text = await res.text()

  let json: Record<string, unknown>
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(
      `VK ${method}: не-JSON ответ (HTTP ${res.status}): ${text.slice(0, 200)}`,
    )
  }
  if (json.error) {
    throw new VkApiError(method, json.error as Record<string, unknown>)
  }
  return (json.response ?? {}) as Record<string, unknown>
}

/** Тело объекта из R2 как поток. Байты не читаются, пока их не потянут. */
async function openObjectStream(key: string): Promise<Readable> {
  const response = await getS3Client().send(
    new GetObjectCommand({ Bucket: getS3Bucket(), Key: key }),
  )
  const body = response.Body
  if (!body) throw new Error(`R2: пустое тело у ${key}`)
  return body as Readable
}

/**
 * Заливка файла в `upload_url` одним multipart-полем.
 *
 * Длину считаем заранее: преамбула + сам файл + хвост. Размер файла берём из
 * каталога, а не из R2 — он там уже есть, и лишний HEAD-запрос ничего бы не
 * уточнил.
 */
async function uploadStream(input: {
  uploadUrl: string
  field: string
  fileName: string
  sizeBytes: number
  contentType: string
  source: Readable
}): Promise<string> {
  const boundary = `----ffworks${Math.random().toString(16).slice(2)}`
  const preamble = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${input.field}"; filename="${input.fileName.replace(/"/g, "")}"\r\n` +
      `Content-Type: ${input.contentType}\r\n\r\n`,
    "utf8",
  )
  const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
  const contentLength = preamble.length + input.sizeBytes + epilogue.length

  const url = new URL(input.uploadUrl)
  const body = new PassThrough()

  const responseText = new Promise<string>((resolve, reject) => {
    const req = httpsRequest(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(contentLength),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8")
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`upload ${input.field}: HTTP ${res.statusCode}`))
            return
          }
          resolve(text)
        })
      },
    )
    req.on("error", reject)
    body.pipe(req)
  })

  body.write(preamble)
  // Ошибка чтения из R2 обязана убить запрос, а не оставить сокет висеть с
  // недописанным телом: сервер будет ждать `Content-Length` байт до таймаута.
  await pipeline(input.source, body, { end: false }).catch((error) => {
    body.destroy(error as Error)
    throw error
  })
  body.end(epilogue)

  return responseText
}

function contentTypeFor(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? ""
  if (ext === "mov") return "video/quicktime"
  if (ext === "webm") return "video/webm"
  if (ext === "mkv") return "video/x-matroska"
  if (ext === "avi") return "video/x-msvideo"
  return "video/mp4"
}

/**
 * Опубликовать видео.
 *
 * Три шага, и все три обязательны: `video.save` заводит запись и выдаёт адрес
 * загрузчика, заливка кладёт байты, `wall.post` показывает видео на стене.
 * Без третьего ролик остаётся в разделе «Видео», но в ленте не появляется.
 */
export async function publishVideoToVk(
  input: VkPublishInput,
): Promise<VkPublishResult> {
  const log = input.onLog ?? (() => {})

  log(`1/3 video.save (${input.title})`)
  const save = await vkApi("video.save", {
    access_token: input.accessToken,
    name: input.title,
    description: input.description,
    group_id: input.groupId,
  })
  const ownerId = Number(save.owner_id)
  const videoId = Number(save.video_id)
  const uploadUrl = String(save.upload_url ?? "")
  if (!uploadUrl) throw new Error("VK video.save: не отдал upload_url")

  log(`2/3 заливка ${input.fileName} (${input.sizeBytes} Б)`)
  const source = await openObjectStream(input.sourceKey)
  await uploadStream({
    uploadUrl,
    field: "video_file",
    fileName: input.fileName,
    sizeBytes: input.sizeBytes,
    contentType: contentTypeFor(input.fileName),
    source,
  })

  log("3/3 wall.post")
  const post = await vkApi("wall.post", {
    access_token: input.accessToken,
    owner_id: ownerId,
    message: input.description,
    attachments: `video${ownerId}_${videoId}`,
    // Публикация в сообществе от имени сообщества, а не от своего: иначе пост
    // выглядит как запись человека на стене группы.
    from_group: ownerId < 0 ? 1 : undefined,
  })
  const postId = Number(post.post_id)

  return {
    ownerId,
    videoId,
    postId: Number.isFinite(postId) ? postId : null,
    permalink: Number.isFinite(postId)
      ? `https://vk.com/wall${ownerId}_${postId}`
      : `https://vk.com/video${ownerId}_${videoId}`,
  }
}

/**
 * Пауза аккаунта после жёсткой ошибки VK, секунды. `0` — ошибка разовая,
 * паузу не ставим.
 *
 * Порт `cooldownSecForCode` из `autoPostVK.ts`. Смысл: при лимите и капче
 * площадка ограничивает аккаунт, и продолжать долбить её следующим файлом —
 * прямой путь к бану токена.
 */
export function vkCooldownSec(code: number): number {
  switch (code) {
    case 5:
      return 12 * 3600 // токен невалиден — до ручного переподключения
    case 6:
      return 5 * 60 // слишком много запросов в секунду
    case 9:
      return 60 * 60 // flood control
    case 14:
      return 60 * 60 // капча
    case 29:
      return 6 * 3600 // суточный лимит метода
    case 214:
      return 6 * 3600 // суточный лимит постов на стену
    default:
      return 0
  }
}
