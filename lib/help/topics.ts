/**
 * Реестр тем справки — что вообще может быть объяснено и кому это показывать.
 *
 * Чистый модуль: без базы и без `node:fs`, потому что его импортируют и
 * серверные страницы, и клиентский якорь `<HelpDot>`. Тексты живут отдельно, в
 * `content/help/<lang>/<id>.md` — здесь только карта.
 *
 * Почему реестр, а не просто папка с файлами: `HelpTopicId` выводится из этого
 * массива, поэтому `<HelpDot id="…">` с опечаткой не собирается. Файл без темы
 * и тема без файла ловятся `npm run help:check` — иначе справка тихо
 * разъезжается с интерфейсом, и через полгода половина якорей ведёт в пустоту.
 *
 * Контракт целиком — docs/HELP_SYSTEM.md.
 */
import {
  hasCapability,
  type AdminCapability,
} from "@/lib/admin-capabilities"
import type { UserRole } from "@/lib/domain-types"

/**
 * Разделы верхнего уровня. `labelKey` — ключ в словаре кабинета
 * (components/account/i18n.tsx): название раздела человек читает и переводит,
 * а сам реестр про переводы не знает.
 */
export const HELP_SECTIONS = [
  { key: "pipeline", labelKey: "helpSectionPipeline" },
] as const

export type HelpSection = (typeof HELP_SECTIONS)[number]["key"]

/**
 * Кому статья видна.
 *
 * `"user"` — любому вошедшему. Иначе — тег права: статью видит тот, кому открыт
 * тот же кусок интерфейса, про который она написана.
 *
 * ВАЖНО: это не «скрыть абзац», а «показать другую статью». Одна и та же
 * настройка для пользователя и для админа — это два разных текста, а не один с
 * обрезкой: пользователю нужно «почему мой файл не подхватился», админу —
 * порядок доменов и что правка разъедется на весь парк машин. Попытка склеить
 * их в одну статью даёт текст, плохой для обоих. Поэтому пара живёт двумя
 * темами, связанными через `seeAlso`.
 */
export type HelpAudience = "user" | AdminCapability

type HelpTopicShape = {
  id: string
  section: HelpSection
  audience: HelpAudience
  /** Статья без якоря в интерфейсе: раздел целиком, а не отдельный параметр. */
  standalone?: boolean
  /** Соседние темы — в первую очередь пара для другой аудитории. */
  seeAlso?: readonly string[]
}

export const HELP_TOPICS = [
  // Статья о разделе целиком: её открывает кнопка в шапке страницы
  // (`AdminPageHeader help=…`), а не знак «?» у параметра. Видна тем же, кому
  // открыт сам раздел, — тег страницы, а не тег правки словарей.
  {
    id: "pipeline.overview",
    section: "pipeline",
    audience: "pipeline.operate",
    seeAlso: ["pipeline.settings", "pipeline.settings.sweep"],
  },
  {
    id: "pipeline.settings",
    section: "pipeline",
    audience: "settings.write",
    seeAlso: [
      "pipeline.overview",
      "pipeline.settings.file-type",
      "pipeline.settings.sweep",
      "pipeline.file-types",
    ],
  },
  {
    id: "pipeline.settings.file-type",
    section: "pipeline",
    audience: "settings.write",
    seeAlso: ["pipeline.settings", "pipeline.file-types"],
  },
  {
    id: "pipeline.settings.node-type",
    section: "pipeline",
    audience: "settings.write",
    seeAlso: ["pipeline.settings", "pipeline.settings.data-type"],
  },
  {
    id: "pipeline.settings.data-type",
    section: "pipeline",
    audience: "settings.write",
    seeAlso: ["pipeline.settings", "pipeline.settings.node-type"],
  },
  {
    id: "pipeline.settings.path-pattern",
    section: "pipeline",
    audience: "settings.write",
    seeAlso: ["pipeline.settings"],
  },
  {
    id: "pipeline.settings.sweep",
    section: "pipeline",
    audience: "settings.write",
    seeAlso: ["pipeline.settings"],
  },
  // Пара к `pipeline.settings.file-type` для другой аудитории. Якоря пока нет:
  // в кабинете ещё некуда его поставить, файловый браузер справкой не размечен.
  {
    id: "pipeline.file-types",
    section: "pipeline",
    audience: "user",
    standalone: true,
    seeAlso: ["pipeline.settings.file-type"],
  },
] as const satisfies readonly HelpTopicShape[]

export type HelpTopic = (typeof HELP_TOPICS)[number]
export type HelpTopicId = HelpTopic["id"]

const BY_ID = new Map<string, HelpTopic>(
  HELP_TOPICS.map((topic) => [topic.id, topic]),
)

export function findTopic(id: string): HelpTopic | undefined {
  return BY_ID.get(id)
}

/**
 * Видна ли тема этому человеку.
 *
 * Проверка нужна на сервере, при отдаче: спрятать ссылку мало — текст не должен
 * попадать в клиентский бандл, иначе «скрытая» часть читается из devtools.
 */
export function canSeeTopic(
  user: { role: UserRole; capabilities: readonly AdminCapability[] },
  topic: HelpTopic,
): boolean {
  if (topic.audience === "user") return true
  return hasCapability(user.role, user.capabilities, topic.audience)
}

export function visibleTopics(user: {
  role: UserRole
  capabilities: readonly AdminCapability[]
}): HelpTopic[] {
  return HELP_TOPICS.filter((topic) => canSeeTopic(user, topic))
}
