/**
 * Маски `$…` в тексте поста.
 *
 * Подмножество `src/Utils/masks.ts` из fs.manager.tauri — то, что имеет смысл
 * в ТЕКСТЕ ПУБЛИКАЦИИ. Полный набор там про имена файлов и пути: `$localFolder`,
 * `$projectPathGD`, `$mainFolderPath` — это машинно-локальные пути, которым в
 * посте на стене делать нечего, а `$index`/`$loopIndex` значат что-то только
 * внутри витка обработки.
 *
 * Поэтому три разных исхода, и они не одно и то же:
 *
 *   • поддержанная маска      → подставляем значение;
 *   • путевая маска           → подставляем пустую строку. Оставить её текстом
 *                               значило бы опубликовать «$localFolder» на стене;
 *   • незнакомый `$токен`     → оставляем КАК ЕСТЬ. В тексте поста доллар живёт
 *                               своей жизнью («$5», «$$$»), и съедать его —
 *                               портить текст, который человек написал.
 *
 * Время берётся из ОДНОГО момента на публикацию, а не из `new Date()` на
 * каждую маску: иначе `$mm` и `$ss` одного поста разъезжаются на границе
 * минуты. Это же правило записано в программе у временных масок.
 */

export type MaskContext = {
  /** Имя файла с расширением. */
  fileName: string
  projectName: string
  /** Момент публикации — источник всех временных масок. */
  now: Date
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

function withoutExtension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(0, dot) : name
}

/**
 * Чистое имя и id — порт `clearFileNameAndID` из программы: id в скобках в
 * начале имени, остальное чистится от эмодзи и кавычек.
 */
function splitNameAndId(name: string): { id: string; clearName: string } {
  const base = withoutExtension(name)
  const match = base.match(/^\s*[([{]\s*([A-Za-z0-9_-]{2,})\s*[)\]}]\s*(.*)$/)
  const id = match ? match[1] : ""
  const rest = match ? match[2] : base
  const clean = rest
    // Эмодзи и служебные символы: в имени файла они встречаются, в заголовке
    // публикации выглядят мусором.
    .replace(/[\p{Extended_Pictographic}‍️]/gu, "")
    .replace(/["'«»„“”]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
  return { id, clearName: clean || base }
}

const pad = (value: number) => String(value).padStart(2, "0")

/** Маски, у которых в тексте поста нет смысла: подставляем пустую строку. */
const PATH_MASKS = [
  "projectPathGD",
  "mainFolderPath",
  "mainFolderName",
  "localFolder",
  "workFolder",
  "loopIndex",
  "index",
]

export function resolveMasks(text: string, context: MaskContext): string {
  if (!text.includes("$")) return text

  const { id, clearName } = splitNameAndId(context.fileName)
  const now = context.now

  const values: Record<string, string> = {
    clearName,
    clearFileName: clearName,
    curItemName: withoutExtension(context.fileName),
    fileName: withoutExtension(context.fileName),
    id,
    projectName: context.projectName,
    YYYY: String(now.getFullYear()),
    MM: pad(now.getMonth() + 1),
    DD: pad(now.getDate()),
    HH: pad(now.getHours()),
    mm: pad(now.getMinutes()),
    ss: pad(now.getSeconds()),
    curMonthStr: MONTHS[now.getMonth()],
    findTime: `${pad(now.getDate())}.${pad(now.getMonth() + 1)}-${pad(now.getHours())}.${pad(now.getMinutes())}`,
  }
  for (const key of PATH_MASKS) values[key] = ""

  // `$random(N)` — отдельным проходом, как и в программе: у него аргумент.
  let out = text.replace(/\$random\((\d*)\)/g, (_, digits: string) => {
    const length = Math.min(64, Math.max(1, Number.parseInt(digits || "10", 10)))
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    let result = ""
    for (let i = 0; i < length; i += 1) {
      result += alphabet[Math.floor(Math.random() * alphabet.length)]
    }
    return result
  })

  // Длинные ключи раньше коротких: иначе `$MM` съел бы начало `$MMM`, а
  // `$id` — начало `$index`.
  const keys = Object.keys(values).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    out = out.split(`$${key}`).join(values[key])
  }
  return out
}
