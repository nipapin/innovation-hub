import "dotenv/config"
import {
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"

/**
 * Засев библиотеки шрифтов — docs/FONTS_PLAN.md §4, этап 1.
 *
 * Скачивает отобранные семейства с Google Fonts и кладёт их в `fonts/google/`
 * нашего бакета. Идемпотентен: уже лежащее начертание не перекачивает, поэтому
 * гонять можно сколько угодно, в том числе после пополнения витрины.
 *
 *   node scripts/fonts-seed.mjs              — всё, чего не хватает
 *   node scripts/fonts-seed.mjs --dry-run    — только сказать, что скачает
 *   node scripts/fonts-seed.mjs Montserrat "Noto Sans JP"
 *
 * Байты берём в ttf: это то, что читает libass на машине, и то же самое, что
 * будет рисовать превью в браузере. Google отдаёт ttf только старому UA —
 * современному достался бы woff2 (тот же приём, что в программе).
 */

const GF_CSS2 = "https://fonts.googleapis.com/css2"
const GF_UA = "Mozilla/5.0 (Windows NT 6.1)"
const PREFIX = "fonts/google/"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const only = args.filter((arg) => !arg.startsWith("--"))

const { FONT_CATALOG, facesOf } = await import("../lib/fonts/catalog.ts")

function envBool(name, defaultWhenUnset) {
  const v = process.env[name]
  if (v === undefined || v === "") return defaultWhenUnset
  return v === "1" || v.toLowerCase() === "true"
}

const bucket = process.env.AWS_S3_BUCKET
if (!bucket) {
  console.error("AWS_S3_BUCKET не задан.")
  process.exit(1)
}

const accessKeyId =
  process.env.S3_KEY_ID ??
  process.env.AWS_KEY_ID ??
  process.env.AWS_ACCESS_KEY_ID ??
  ""
const secretAccessKey =
  process.env.S3_SECRET_KEY ??
  process.env.AWS_SECRET_KEY ??
  process.env.AWS_SECRET_ACCESS_KEY ??
  ""
if (!accessKeyId || !secretAccessKey) {
  console.error("Нет ключей к хранилищу: S3_KEY_ID и S3_SECRET_KEY.")
  process.exit(1)
}

const endpoint = process.env.AWS_ENDPOINT_URL?.trim()
const client = new S3Client({
  region: process.env.AWS_REGION?.trim() || "auto",
  endpoint: endpoint || undefined,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: envBool("AWS_S3_FORCE_PATH_STYLE", Boolean(endpoint)),
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
})

async function listFamily(family) {
  const prefix = `${PREFIX}${family}/`
  const page = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  )
  return new Set(
    (page.Contents ?? [])
      .map((item) => item.Key?.slice(prefix.length).replace(/\.ttf$/i, ""))
      .filter(Boolean),
  )
}

async function fetchCss(family, axes) {
  const familyParam = axes
    ? `${family.replace(/ /g, "+")}:${axes}`
    : family.replace(/ /g, "+")
  const res = await fetch(`${GF_CSS2}?family=${familyParam}`, {
    headers: { "User-Agent": GF_UA },
  })
  if (!res.ok) throw new Error(`Google Fonts ответил HTTP ${res.status}`)
  return res.text()
}

function parseCss(css) {
  const faces = []
  for (const block of css.split("@font-face").slice(1)) {
    const url = /url\(([^)]+)\)/
      .exec(block)?.[1]
      ?.replace(/['"]/g, "")
      .trim()
    if (!url) continue
    const lower = url.toLowerCase()
    if (!lower.endsWith(".ttf") && !lower.endsWith(".otf")) continue
    const italic = /font-style:\s*italic/.test(block)
    const weightRaw = /font-weight:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? "400"
    const weight = Number.parseInt(weightRaw.split(/\s+/).pop() ?? "400", 10)
    if (!Number.isFinite(weight)) continue
    if (faces.some((f) => f.weight === weight && f.italic === italic)) continue
    faces.push({ weight, italic, url })
  }
  return faces
}

async function googleFaces(family) {
  let css
  try {
    css = await fetchCss(family, "ital,wght@0,400;0,700;1,400;1,700")
  } catch {
    css = await fetchCss(family, "")
  }
  let faces = parseCss(css)
  if (faces.length === 0) faces = parseCss(await fetchCss(family, ""))
  return faces
}

const wanted = only.length
  ? FONT_CATALOG.filter((entry) => only.includes(entry.family))
  : FONT_CATALOG

if (only.length && wanted.length !== only.length) {
  const known = new Set(FONT_CATALOG.map((e) => e.family))
  for (const name of only) {
    if (!known.has(name)) console.error(`Нет в витрине: «${name}»`)
  }
  process.exit(1)
}

let downloaded = 0
let skipped = 0
let bytes = 0

for (const entry of wanted) {
  const present = await listFamily(entry.family)
  const missing = facesOf(entry).filter((face) => !present.has(face.stem))
  if (missing.length === 0) {
    skipped += 1
    continue
  }

  if (dryRun) {
    console.log(`${entry.family}: ${missing.map((f) => f.stem).join(", ")}`)
    downloaded += missing.length
    continue
  }

  let available
  try {
    available = await googleFaces(entry.family)
  } catch (error) {
    console.error(`${entry.family}: ${error.message}`)
    continue
  }

  for (const face of missing) {
    const match = available.find(
      (item) => item.weight === face.weight && item.italic === face.italic,
    )
    if (!match) continue
    const res = await fetch(match.url)
    if (!res.ok) {
      console.error(`${face.stem}: HTTP ${res.status}`)
      continue
    }
    const body = Buffer.from(await res.arrayBuffer())
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${PREFIX}${entry.family}/${face.stem}.ttf`,
        Body: body,
        ContentType: "font/ttf",
      }),
    )
    downloaded += 1
    bytes += body.length
    console.log(`+ ${face.stem}.ttf — ${(body.length / 1024).toFixed(0)} КБ`)
  }
}

console.log(
  dryRun
    ? `\nСкачает начертаний: ${downloaded}; семейств уже на месте: ${skipped}.`
    : `\nПоложено начертаний: ${downloaded} (${(bytes / 1048576).toFixed(1)} МБ); ` +
        `семейств уже было: ${skipped}.`,
)
