import { PutObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { requireUserApi } from "@/lib/admin-auth"
import { requireProjectAccess } from "@/lib/project-access"
import { projectUploadObjectKey } from "@/lib/project-storage"
import { listFilesInFolder } from "@/lib/repositories/project-files"
import { findLiveUserTool } from "@/lib/tool-instance-gate"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { StorageWriteError, writeNotifyUpload } from "@/lib/storage/write-path"
import { findCue, findTrack, parseDialogDoc } from "@/lib/tools/dialog/dialog-doc"
import { buildPeaks } from "@/lib/tools/dialog/peaks"
import { nextTakeNumber, synthText, takeFilePath } from "@/lib/tools/dialog/voice"
import { encodeWav, stubVoiceHz, synthesizeStub } from "@/lib/tools/voice/stub"

export const runtime = "nodejs"

const DOC_NAME = "dialog.json"
const PROVIDER = "stub"
/**
 * Задержка нарочная.
 *
 * Настоящий синтез не мгновенный, и очередь с состояниями надо видеть в работе
 * ещё до появления провайдера. Мгновенный ответ создал бы интерфейс, который на
 * реальных задержках развалится.
 */
const FAKE_DELAY_MS = 1600

type Params = { params: Promise<{ id: string }> }

const schema = z.object({
  cueId: z.string().min(1),
  /** Язык, который озвучиваем: тейки у реплики свои на каждый язык. */
  lang: z.string().min(1).max(32),
})

/**
 * Заглушка синтеза речи.
 *
 * Отдаёт настоящий WAV и настоящие пики, кладёт их в папку задачи и возвращает
 * описание тейка. В документ его вписывает клиент: документом владеет он, и
 * второй писатель здесь создал бы гонку с автосохранением.
 *
 * Замена на провайдера — это подмена `synthesizeStub` на вызов сервиса. Всё
 * остальное в этом файле от провайдера не зависит.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const tool = await findLiveUserTool(id, auth.userId)
  if (!tool) return NextResponse.json({ message: "Tool not found." }, { status: 404 })

  const source = (tool.source ?? {}) as { projectId?: string | null; folderPath?: string | null }
  const projectId = source.projectId ?? null
  const folderPath = source.folderPath ?? null
  if (!projectId || !folderPath) {
    return NextResponse.json({ message: "Tool has no source folder." }, { status: 400 })
  }

  const access = await requireProjectAccess(projectId, auth.userId, "editor")
  if (access instanceof NextResponse) return access
  if (!isS3Configured()) {
    return NextResponse.json({ message: "Object storage is not available." }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }
  const parsedBody = schema.safeParse(body)
  if (!parsedBody.success) {
    return NextResponse.json(
      { message: parsedBody.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }
  const { cueId, lang } = parsedBody.data

  // Документ читаем из папки, а не из тела запроса: синтезировать надо то, что
  // сохранено, иначе тейк не совпадёт с тем, что увидит второй человек.
  const files = await listFilesInFolder(projectId, folderPath)
  const row = files.find((file) => !file.isFolder && file.name === DOC_NAME)
  if (!row?.s3Key) {
    return NextResponse.json({ message: "dialog.json not found." }, { status: 404 })
  }

  const client = getS3Client()
  const bucket = getS3Bucket()

  let stored: unknown = null
  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3")
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: row.s3Key }))
    const text = await object.Body?.transformToString("utf-8")
    stored = text ? JSON.parse(text) : null
  } catch (error) {
    console.error("[voice] read document failed", error)
    return NextResponse.json({ message: "Failed to read the document." }, { status: 503 })
  }

  const parsed = parseDialogDoc(stored)
  if (!parsed.ok) {
    return NextResponse.json(
      { message: "Document is invalid.", error: parsed.error },
      { status: 422 },
    )
  }
  const doc = parsed.doc
  const cue = findCue(doc, cueId)
  if (!cue) return NextResponse.json({ message: "Cue not found." }, { status: 404 })
  const track = findTrack(doc, cue.trackId)
  if (!track) return NextResponse.json({ message: "Track not found." }, { status: 404 })

  const text = synthText(doc, cue, lang).trim()
  if (!text) {
    return NextResponse.json({ message: "Nothing to synthesize." }, { status: 422 })
  }

  const index = nextTakeNumber(cue)
  /**
   * Случайность живёт здесь, а не в синтезе.
   *
   * Сам синтез детерминирован: тот же текст с тем же числом даёт тот же файл.
   * Число берётся на границе — так «Озвучить заново» даёт слышимо другой тейк, и
   * список версий на реплике становится проверяемым, а модуль остаётся
   * пригодным для проверок.
   */
  const seed = (Date.now() ^ Math.imul(index, 0x9e3779b1)) >>> 0
  const spoken = synthesizeStub(text, { hz: stubVoiceHz(track.no), seed })
  const wav = encodeWav(spoken.samples, spoken.sampleRate)
  const peaks = buildPeaks(spoken.samples, spoken.sampleRate)

  const audioPath = takeFilePath(track, cue, index, "wav")
  const peaksPath = `${audioPath.replace(/\.wav$/, "")}.peaks.json`

  try {
    await Promise.all([
      putFile(
        client,
        bucket,
        access.project.storageOwnerId,
        access.project.ownerId,
        projectId,
        folderPath,
        audioPath,
        wav,
        "audio/wav",
      ),
      putFile(
        client,
        bucket,
        access.project.storageOwnerId,
        access.project.ownerId,
        projectId,
        folderPath,
        peaksPath,
        Buffer.from(`${JSON.stringify(peaks)}\n`, "utf-8"),
        "application/json",
      ),
    ])
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    console.error("[voice] write take failed", error)
    return NextResponse.json({ message: "Failed to write the take." }, { status: 503 })
  }

  await new Promise((resolve) => setTimeout(resolve, FAKE_DELAY_MS))

  return NextResponse.json({
    take: {
      id: `tk_${Date.now().toString(36)}${index}`,
      lang,
      file: audioPath,
      peaks: peaksPath,
      durationMs: spoken.durationMs,
      provider: PROVIDER,
      voiceId: null,
      createdAt: new Date().toISOString(),
      selected: true,
      offsetMs: 0,
      rate: 1,
      gainDb: 0,
      // Что отдали синтезу: по нему потом видно, что тейк устарел.
      source: text,
    },
  })
}

/**
 * Записать файл в папку задачи.
 *
 * Тем же путём, что все файлы проекта (`writeNotifyUpload`), — иначе журнал
 * изменений и курсор синхронизации разойдутся с содержимым бакета. Заодно он
 * заводит строки папок `voice/` и `voice/NN`, без которых файл попадёт в
 * хранилище, но пропадёт из дерева.
 */
async function putFile(
  client: ReturnType<typeof getS3Client>,
  bucket: string,
  /** Адрес проекта в хранилище — из него собирается ключ. */
  storageOwnerId: string,
  /** Владелец проекта — им подписывается запись в журнале. */
  ownerId: string,
  projectId: string,
  taskFolder: string,
  relative: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const slash = relative.lastIndexOf("/")
  const folderPath = `${taskFolder}/${relative.slice(0, slash)}`
  const fileName = relative.slice(slash + 1)
  const s3Key = projectUploadObjectKey(
    storageOwnerId,
    projectId,
    folderPath,
    fileName,
  )

  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: s3Key, Body: bytes, ContentType: contentType }),
  )
  await writeNotifyUpload({
    storageOwnerId,
    projectId,
    s3Key,
    folderPath,
    fileName,
    sizeBytes: bytes.byteLength,
    contentType,
    // Озвучка не приносит исходники: `contact` задачи от неё переезжать не должен.
    actor: { userId: ownerId, isUploader: false },
  })
}
