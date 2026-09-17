import {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3"

import { buildProjectObjectKey, getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { listFilesInFolder } from "@/lib/repositories/project-files"
import { OPTIONS_FOLDER_NAME } from "@/lib/storage/keys"
import {
  writeEnsureFolderPath,
  writeFilePut,
  type StorageActor,
} from "@/lib/storage/write-path"
import {
  facesOf,
  findFontEntry,
  isValidFontName,
  normalizeFontName,
  type FontEntry,
} from "./catalog"

/**
 * Библиотека шрифтов в R2 — docs/FONTS_PLAN.md §4.
 *
 * Только сервер: ходит в бакет и в каталог файлов. Витрина (catalog.ts) от
 * этого модуля не зависит — её читает и браузер.
 *
 * Библиотека не имеет ни таблицы, ни индексного файла: что в ней есть,
 * отвечает список папок в бакете. Индекс пришлось бы держать согласованным с
 * содержимым; список папок согласован с ним по построению.
 */

export const FONT_LIBRARY_PREFIX = "fonts/google/"

/** Папка шрифтов проекта — та же, что читает программа (`projectFonts.ts`). */
export const PROJECT_FONTS_FOLDER = `${OPTIONS_FOLDER_NAME}/fonts`

/** ttf — то, что читает libass; woff2 не годится (§4 плана). */
const FONT_CONTENT_TYPE = "font/ttf"

const GF_CSS2 = "https://fonts.googleapis.com/css2"

/**
 * UA, которому Google Fonts отдаёт ttf: современному достался бы woff2,
 * разрезанный на десятки кусков по `unicode-range`. Тот же приём, что в
 * программе (`deps_commands.rs`), и разойтись они не должны.
 */
const GF_UA = "Mozilla/5.0 (Windows NT 6.1)"

export type LibraryFace = {
  /** Имя файла без расширения — оно же имя, по которому шрифт ищет машина. */
  stem: string
  key: string
  sizeBytes: number
}

export function familyPrefix(family: string): string {
  return `${FONT_LIBRARY_PREFIX}${family}/`
}

export function faceKey(family: string, stem: string): string {
  return `${familyPrefix(family)}${stem}.ttf`
}

function assertConfigured(): void {
  if (!isS3Configured()) {
    throw new Error("Object storage is not configured.")
  }
}

// ── что уже лежит в библиотеке ───────────────────────────────────────────────

type FamiliesCache = { at: number; families: Set<string> }

let familiesCache: FamiliesCache | null = null
const FAMILIES_TTL_MS = 5 * 60 * 1000

/**
 * Семейства библиотеки — имена папок под `fonts/google/`.
 *
 * Кеш на пять минут: список меняется только засевом и первым обращением к
 * новому семейству, а спрашивают его на каждое открытие модалки.
 */
export async function listLibraryFamilies(options?: {
  refresh?: boolean
}): Promise<Set<string>> {
  assertConfigured()
  const now = Date.now()
  if (
    !options?.refresh &&
    familiesCache &&
    now - familiesCache.at < FAMILIES_TTL_MS
  ) {
    return familiesCache.families
  }

  const families = new Set<string>()
  let token: string | undefined
  do {
    const page = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: getS3Bucket(),
        Prefix: FONT_LIBRARY_PREFIX,
        Delimiter: "/",
        ContinuationToken: token,
      }),
    )
    for (const prefix of page.CommonPrefixes ?? []) {
      const name = prefix.Prefix?.slice(FONT_LIBRARY_PREFIX.length).replace(/\/$/, "")
      if (name) families.add(name)
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)

  familiesCache = { at: now, families }
  return families
}

/** Начертания одного семейства с размерами — для копирования и для подписи. */
export async function listFamilyFaces(family: string): Promise<LibraryFace[]> {
  assertConfigured()
  const prefix = familyPrefix(family)
  const page = await getS3Client().send(
    new ListObjectsV2Command({ Bucket: getS3Bucket(), Prefix: prefix }),
  )
  return (page.Contents ?? [])
    .filter((item) => item.Key?.toLowerCase().endsWith(".ttf"))
    .map((item) => ({
      key: item.Key!,
      stem: item.Key!.slice(prefix.length).replace(/\.ttf$/i, ""),
      sizeBytes: item.Size ?? 0,
    }))
}

export async function readFaceBytes(key: string): Promise<Buffer | null> {
  assertConfigured()
  try {
    const res = await getS3Client().send(
      new GetObjectCommand({ Bucket: getS3Bucket(), Key: key }),
    )
    const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> }
    if (!body?.transformToByteArray) return null
    return Buffer.from(await body.transformToByteArray())
  } catch {
    return null
  }
}

// ── откуда берутся байты ─────────────────────────────────────────────────────

type GoogleFace = { weight: number; italic: boolean; url: string }

/**
 * Разбор ответа css2. Тот же разбор, что в программе: блоки `@font-face`,
 * из каждого — стиль, насыщенность и ссылка; всё, кроме ttf/otf, отбрасываем,
 * потому что остальное libass не прочитает.
 */
function parseGoogleCss(css: string): GoogleFace[] {
  const faces: GoogleFace[] = []
  for (const block of css.split("@font-face").slice(1)) {
    const url = /url\(([^)]+)\)/.exec(block)?.[1]?.replace(/['"]/g, "").trim()
    if (!url) continue
    const lower = url.toLowerCase()
    if (!lower.endsWith(".ttf") && !lower.endsWith(".otf")) continue

    const italic = /font-style:\s*italic/.test(block)
    const weightRaw = /font-weight:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? "400"
    // У переменного шрифта здесь диапазон («100 900») — берём последнее число,
    // как это делает программа.
    const weight = Number.parseInt(weightRaw.split(/\s+/).pop() ?? "400", 10)
    if (!Number.isFinite(weight)) continue
    if (faces.some((f) => f.weight === weight && f.italic === italic)) continue
    faces.push({ weight, italic, url })
  }
  return faces
}

async function fetchGoogleCss(family: string, axes: string): Promise<string> {
  const familyParam = axes
    ? `${family.replace(/ /g, "+")}:${axes}`
    : family.replace(/ /g, "+")
  const res = await fetch(`${GF_CSS2}?family=${familyParam}`, {
    headers: { "User-Agent": GF_UA },
    cache: "no-store",
  })
  if (!res.ok) {
    throw new Error(`Google Fonts answered HTTP ${res.status} for "${family}".`)
  }
  return res.text()
}

/**
 * Спросить у Google начертания семейства.
 *
 * Сначала просим четыре оси; семейство без них Google отвергает ЦЕЛИКОМ, а не
 * отдаёт что есть, — поэтому на неудаче повторяем запрос без осей.
 */
async function googleFaces(family: string): Promise<GoogleFace[]> {
  let css: string
  try {
    css = await fetchGoogleCss(family, "ital,wght@0,400;0,700;1,400;1,700")
  } catch {
    css = await fetchGoogleCss(family, "")
  }
  const faces = parseGoogleCss(css)
  if (faces.length === 0) {
    const plain = parseGoogleCss(await fetchGoogleCss(family, ""))
    if (plain.length === 0) {
      throw new Error(
        `"${family}" is not on Google Fonts (only free families are there).`,
      )
    }
    return plain
  }
  return faces
}

const inFlight = new Map<string, Promise<LibraryFace[]>>()

/**
 * Положить семейство в библиотеку, если его там ещё нет.
 *
 * Одновременные вызовы про одно семейство склеиваются: модалка спрашивает
 * превью, а сохранение — копию, и качать одно и то же дважды незачем.
 */
export async function ensureFamilyInLibrary(
  family: string,
): Promise<LibraryFace[]> {
  assertConfigured()
  const entry = findFontEntry(family)
  if (!entry) throw new Error(`"${family}" is not in the font catalog.`)

  const running = inFlight.get(family)
  if (running) return running

  const task = (async () => {
    const present = await listFamilyFaces(family)
    const wanted = facesOf(entry)
    const missing = wanted.filter(
      (face) => !present.some((item) => item.stem === face.stem),
    )
    if (missing.length === 0) return present

    const available = await googleFaces(family)
    const saved: LibraryFace[] = [...present]
    for (const face of missing) {
      const match = available.find(
        (item) => item.weight === face.weight && item.italic === face.italic,
      )
      // Начертания может не быть — метаданные и css2 расходятся у переменных
      // семейств. Это не ошибка: обычное лицо есть, остальное libass дорисует.
      if (!match) continue

      const res = await fetch(match.url, { cache: "no-store" })
      if (!res.ok) {
        throw new Error(`Could not download "${face.stem}" (HTTP ${res.status}).`)
      }
      const body = Buffer.from(await res.arrayBuffer())
      const key = faceKey(family, face.stem)
      await getS3Client().send(
        new PutObjectCommand({
          Bucket: getS3Bucket(),
          Key: key,
          Body: body,
          ContentType: FONT_CONTENT_TYPE,
        }),
      )
      saved.push({ stem: face.stem, key, sizeBytes: body.length })
    }

    if (saved.length === 0) {
      throw new Error(`Google Fonts returned no usable faces for "${family}".`)
    }
    familiesCache = null
    return saved
  })()

  inFlight.set(family, task)
  try {
    return await task
  } finally {
    inFlight.delete(family)
  }
}

// ── библиотека → проект ──────────────────────────────────────────────────────

/** Что уже лежит в `options/fonts` проекта — нормализованные имена файлов. */
export async function listProjectFontStems(
  projectId: string,
): Promise<Map<string, { name: string; sizeBytes: number }>> {
  const rows = await listFilesInFolder(projectId, PROJECT_FONTS_FOLDER)
  const stems = new Map<string, { name: string; sizeBytes: number }>()
  for (const row of rows) {
    if (row.isFolder) continue
    const stem = row.name.replace(/\.[^.]+$/, "")
    stems.set(normalizeFontName(stem), {
      name: stem,
      sizeBytes: row.sizeBytes ?? 0,
    })
  }
  return stems
}

/**
 * Положить семейство в `options/fonts` проекта — §7 плана.
 *
 * Копия внутри бакета (`CopyObject`), байты через Next не идут: для
 * иероглифического семейства это разница между мгновением и двадцатью
 * мегабайтами трафика.
 *
 * Не бросает: настройки титров — работа клиента, и терять её из-за
 * незакопировавшегося шрифта нельзя. Ровно то же решение, что в программе
 * (`stashFontsInProject`), и по той же причине: прогон на отсутствующий шрифт
 * пожалуется сам, а молча потерянная правка не пожалуется никогда.
 */
export async function installFamilyIntoProject(input: {
  storageOwnerId: string
  projectId: string
  family: string
  actor?: StorageActor | null
}): Promise<{ installed: string[] }> {
  const entry = findFontEntry(input.family)
  if (!entry) return { installed: [] }

  try {
    const present = await listProjectFontStems(input.projectId)
    const wanted = facesOf(entry).filter(
      (face) => !present.has(normalizeFontName(face.stem)),
    )
    if (wanted.length === 0) return { installed: [] }

    const library = new Map(
      (await ensureFamilyInLibrary(input.family)).map((face) => [face.stem, face]),
    )

    await writeEnsureFolderPath({
      storageOwnerId: input.storageOwnerId,
      projectId: input.projectId,
      folderPath: PROJECT_FONTS_FOLDER,
      actor: input.actor,
    })

    const installed: string[] = []
    for (const face of wanted) {
      const source = library.get(face.stem)
      if (!source) continue

      const name = `${face.stem}.ttf`
      const key = buildProjectObjectKey(
        input.storageOwnerId,
        input.projectId,
        `${PROJECT_FONTS_FOLDER}/${name}`,
      )
      try {
        const copied = await getS3Client().send(
          new CopyObjectCommand({
            Bucket: getS3Bucket(),
            Key: key,
            CopySource: `${getS3Bucket()}/${encodeURI(source.key)}`,
            ContentType: FONT_CONTENT_TYPE,
            MetadataDirective: "REPLACE",
          }),
        )
        await writeFilePut({
          projectId: input.projectId,
          folderPath: PROJECT_FONTS_FOLDER,
          name,
          s3Key: key,
          sizeBytes: source.sizeBytes,
          contentType: FONT_CONTENT_TYPE,
          etag: copied.CopyObjectResult?.ETag?.replace(/"/g, "") ?? null,
          actor: input.actor,
        })
        installed.push(name)
      } catch (error) {
        // Каждое начертание отдельно: споткнувшееся жирное не должно оставить
        // обычное вне проекта — именно оно и рисует титр.
        console.warn(
          `[fonts] "${face.stem}" was not copied into project ${input.projectId}:`,
          error,
        )
      }
    }
    return { installed }
  } catch (error) {
    console.warn(
      `[fonts] family "${input.family}" was not installed into project ${input.projectId}:`,
      error,
    )
    return { installed: [] }
  }
}

/** Имя семейства пришло от клиента — проверяем до того, как оно станет ключом. */
export function assertFamilyName(family: string): FontEntry {
  if (!isValidFontName(family)) {
    throw new Error(`Invalid font family name: "${family}".`)
  }
  const entry = findFontEntry(family)
  if (!entry) throw new Error(`"${family}" is not in the font catalog.`)
  return entry
}
