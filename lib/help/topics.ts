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
  { key: "statistics", labelKey: "helpSectionStatistics" },
  { key: "billing", labelKey: "helpSectionBilling" },
  // Последним: остальные разделы про работу на сайте, а этот — про саму
  // установку, что здесь включено и почему знакомого по другой площадке
  // раздела тут может не быть.
  { key: "site", labelKey: "helpSectionSite" },
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
  // Раздел целиком: открывается кнопкой в шапке страницы, а не знаком «?» у
  // параметра. Видна тем же, кому открыт сам раздел.
  {
    id: "features.overview",
    section: "site",
    audience: "features.manage",
  },
  {
    id: "pipeline.file-types",
    section: "pipeline",
    audience: "user",
    standalone: true,
    seeAlso: ["pipeline.settings.file-type"],
  },

  // ── Статистика ────────────────────────────────────────────────────────────
  //
  // Раздел разложен на две тройки, а не на одну общую статью с оговорками.
  // Витрины отвечают на разные вопросы: кабинет — «сколько сделал и потратил
  // я», админка — «что происходит в системе». У них разный набор осей, разные
  // источники под одними словами (спенд против себестоимости) и разная цена
  // ошибки: пользователю нули в архиве надо объяснить, админу — показать, какую
  // кнопку нажать. Склейка дала бы текст, плохой для обоих (§5 HELP_SYSTEM.md).
  {
    id: "statistics.personal",
    section: "statistics",
    audience: "user",
    seeAlso: [
      "statistics.personal.metrics",
      "statistics.personal.scope",
    ],
  },
  {
    id: "statistics.personal.metrics",
    section: "statistics",
    audience: "user",
    seeAlso: ["statistics.personal", "statistics.personal.scope"],
  },
  {
    id: "statistics.personal.scope",
    section: "statistics",
    audience: "user",
    seeAlso: ["statistics.personal", "statistics.personal.metrics"],
  },
  {
    id: "statistics.overview",
    section: "statistics",
    audience: "statistics.view",
    seeAlso: [
      "statistics.metrics",
      "statistics.breakdowns",
      "statistics.import",
      "statistics.personal",
    ],
  },
  {
    id: "statistics.metrics",
    section: "statistics",
    audience: "statistics.view",
    seeAlso: [
      "statistics.overview",
      "statistics.breakdowns",
      "statistics.personal.metrics",
    ],
  },
  {
    id: "statistics.breakdowns",
    section: "statistics",
    audience: "statistics.view",
    seeAlso: [
      "statistics.overview",
      "statistics.metrics",
      "statistics.personal.scope",
    ],
  },
  {
    id: "statistics.import",
    section: "statistics",
    audience: "statistics.import",
    seeAlso: ["statistics.overview", "statistics.metrics"],
  },

  // ── Деньги ────────────────────────────────────────────────────────────────
  //
  // «Тарифы» — первый инструмент, размеченный на уровне секций: у страницы своя
  // статья при заголовке, и у каждой из четырёх секций своя при её заголовке.
  // Так вышло не из любви к дроблению, а потому что секции здесь отвечают на
  // независимые вопросы: «сколько берём», «что мы уже потратили», «когда вообще
  // браться» и «включено ли это». Ответы на них нужны в разное время и разным
  // людям (HELP_SYSTEM.md §7, правило про уровни входа).
  {
    id: "billing.rates",
    section: "billing",
    audience: "billing.manage",
    seeAlso: [
      "billing.rates.grid",
      "billing.rates.vendor",
      "billing.rates.limits",
      "billing.rates.enforce",
    ],
  },
  {
    id: "billing.rates.grid",
    section: "billing",
    audience: "billing.manage",
    seeAlso: ["billing.rates", "billing.rates.vendor", "billing.rates.limits"],
  },
  {
    id: "billing.rates.vendor",
    section: "billing",
    audience: "billing.manage",
    seeAlso: ["billing.rates", "billing.rates.grid"],
  },
  {
    id: "billing.rates.limits",
    section: "billing",
    audience: "billing.manage",
    seeAlso: ["billing.rates", "billing.rates.grid", "billing.rates.enforce"],
  },
  {
    id: "billing.rates.enforce",
    section: "billing",
    audience: "billing.manage",
    seeAlso: ["billing.rates", "billing.rates.limits"],
  },

  // Тестовый период и акции — соседние инструменты со своими тегами. Статьи
  // ссылаются друг на друга, но не переиспользуются: доверить раздачу подарков
  // и правку прайса можно разным людям, и текст, написанный «для всех троих»,
  // объяснял бы каждому чужое.
  {
    id: "billing.trial",
    section: "billing",
    audience: "billing.trial",
    seeAlso: [
      "billing.trial.settings",
      "billing.trial.templates",
      "billing.trial.activations",
      "billing.promo",
    ],
  },
  {
    id: "billing.trial.settings",
    section: "billing",
    audience: "billing.trial",
    seeAlso: ["billing.trial", "billing.trial.templates"],
  },
  {
    id: "billing.trial.templates",
    section: "billing",
    audience: "billing.trial",
    seeAlso: ["billing.trial", "billing.trial.activations"],
  },
  {
    id: "billing.trial.activations",
    section: "billing",
    audience: "billing.trial",
    seeAlso: ["billing.trial", "billing.trial.templates", "billing.promo"],
  },
  {
    id: "billing.promo",
    section: "billing",
    audience: "billing.promo",
    seeAlso: [
      "billing.promo.user",
      "billing.promo.grant",
      "billing.promo.projects",
      "billing.promo.overdraft",
      "billing.promo.history",
      "billing.trial",
    ],
  },
  {
    id: "billing.promo.user",
    section: "billing",
    audience: "billing.promo",
    seeAlso: ["billing.promo", "billing.promo.history"],
  },
  {
    id: "billing.promo.grant",
    section: "billing",
    audience: "billing.promo",
    seeAlso: ["billing.promo", "billing.promo.projects"],
  },
  {
    id: "billing.promo.projects",
    section: "billing",
    audience: "billing.promo",
    seeAlso: ["billing.promo", "billing.promo.grant"],
  },
  {
    id: "billing.promo.overdraft",
    section: "billing",
    audience: "billing.promo",
    seeAlso: ["billing.promo", "billing.rates.limits"],
  },
  {
    id: "billing.promo.history",
    section: "billing",
    audience: "billing.promo",
    seeAlso: ["billing.promo", "billing.promo.user"],
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
 * Соседние темы. У темы без соседей — пустой список.
 *
 * Помощник, а не `topic.seeAlso ?? []` по месту: реестр объявлен через
 * `as const`, поэтому у темы без этого поля его нет и в типе, и обращение
 * напрямую не собирается. Пока `seeAlso` стоял у всех тем подряд, это не
 * всплывало — первая же тема без соседей сломала бы оба потребителя сразу.
 */
export function seeAlsoOf(topic: HelpTopic): readonly string[] {
  return "seeAlso" in topic ? topic.seeAlso : []
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
