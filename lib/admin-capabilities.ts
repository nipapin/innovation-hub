/**
 * Теги прав админа — что ему открыто по работе.
 *
 * Чистый модуль: без базы и без `next/server`, потому что его импортируют и
 * роуты, и интерфейс. Матрица одна, а не по копии на слой.
 *
 * Как это соотносится с ролью (lib/admin-roles.ts): два механизма, и они не
 * пересекаются. Лестница отвечает, пускать ли в админку и кто кем управляет;
 * теги — какие разделы работы открыты. Полный разбор — docs/ADMIN_ROLES_PLAN.md.
 *
 * ГЛАВНОЕ ПРАВИЛО: теги раздают доступ к работе, но никогда — к раздаче доступа.
 * Ни один тег не даёт выдавать теги, менять роли и трогать другого админа: это
 * свойство роли SUPERADMIN и только её. Тега вроде `capabilities.grant` в этом
 * списке нет и быть не должно — с ним админ дотянулся бы до суперадмина через
 * сам механизм тегов.
 */
import type { UserRole } from "@/lib/domain-types"
import { isSuperAdmin } from "@/lib/admin-roles"

export const ADMIN_CAPABILITIES = [
  "users.read",
  "users.manage",
  "content.manage",
  "pipeline.operate",
  // Автопостинг — отдельный тег, а не довесок к конвейеру. Разница не в объёме
  // работы, а в том, чем распоряжаешься: конвейер гоняет файлы по нашим же
  // машинам, а постинг публикует от имени ЧУЖОГО аккаунта на чужой площадке,
  // и отменить опубликованное нельзя. Человеку, следящему за обработкой, это
  // право не нужно; тому, кто ведёт публикации, не нужно обратное.
  "posting.operate",
  "settings.write",
  "machines.manage",
  // Две ступени работы в чужой папке, а не одна. `projects.access` — помощь:
  // открыть, скачать, положить файл, забрать файл. `projects.manage` —
  // распоряжение: создать, удалить, передать другому человеку, расшарить.
  // Разница не в силе, а в обратимости: положить файл не туда правится за
  // минуту, передать проект не тому — это чужие деньги и чужой доступ. Оператору
  // поддержки нужна первая и не нужна вторая. Разбор —
  // docs/ADMIN_WORKSPACE_PLAN.md §3.
  "projects.access",
  "projects.manage",
  "statistics.view",
  "statistics.import",
  "visitors.view",
  // Три тега на деньги, а не один: ставки — распоряжение о цене для всего
  // сайта, тестовый период — маркетинговое решение, акции — раздача денег
  // конкретным людям. Это разные полномочия, и совмещать их в одном теге
  // означало бы, что человек, которому доверили начислять акции, заодно может
  // переписать прайс.
  "billing.manage",
  "billing.trial",
  "billing.promo",
  // Ключи от чужих кошельков — не то же самое, что прайс. Человеку, которому
  // доверили тариф, незачем доставать ключ ElevenLabs, и наоборот.
  "services.manage",
  "audit.view",
  // Выключатели частей сайта (lib/features.ts). Тег отдельный, а не довесок к
  // `settings.write`: словари конвейера — это работа внутри раздела, а здесь
  // распоряжение самим набором разделов, и гасится он сразу для всех
  // пользователей установки.
  "features.manage",
] as const

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number]

export function isAdminCapability(value: unknown): value is AdminCapability {
  return (
    typeof value === "string" &&
    (ADMIN_CAPABILITIES as readonly string[]).includes(value)
  )
}

/**
 * Есть ли у актора право на действие.
 *
 * Суперадмину теги не проверяются: у него их нет в таблице и не должно быть.
 * Всем, кто ниже админа, — отказ независимо от содержимого `granted`: тег,
 * оставшийся у понижённого до USER аккаунта, не должен ничего открывать.
 */
export function hasCapability(
  role: UserRole,
  granted: readonly AdminCapability[] | null | undefined,
  needed: AdminCapability,
): boolean {
  if (isSuperAdmin(role)) return true
  if (role !== "ADMIN") return false
  return granted?.includes(needed) ?? false
}

/**
 * Наборы галочек для экрана выдачи.
 *
 * Не сущность в базе и не роль: кнопка проставляет группу тегов, дальше их
 * правят поштучно. Хранится всё равно плоский набор — иначе получим второй
 * уровень иерархии, который придётся синхронизировать с первым.
 */
export const CAPABILITY_PRESETS = {
  content: ["content.manage", "visitors.view"],
  // Ступень 1: всё, чем помогают клиенту, и ничего, что меняет принадлежность.
  support: [
    "users.read",
    "users.manage",
    "projects.access",
    "pipeline.operate",
  ],
  // Ступень 2: то же плюс распоряжение чужими проектами. Отдельным пресетом, а
  // не галочкой поверх «Поддержки»: разница между ними — это ровно тот вопрос,
  // который человек должен задать себе осознанно.
  manager: [
    "users.read",
    "users.manage",
    "projects.access",
    "projects.manage",
    "pipeline.operate",
  ],
  pipeline: ["pipeline.operate", "settings.write", "statistics.view"],
  // Постинг отдельным пресетом: это работа «ведущего публикации», и от конвейера
  // ей нужен только взгляд на статистику.
  posting: ["posting.operate", "statistics.view"],
  // `features.manage` в «полный доступ» не входит намеренно. Пресет — кнопка для
  // удобства, её нажимают не глядя; выключатель же гасит раздел или инструмент
  // сразу всем пользователям установки. Такое право выдают поштучно и осознанно.
  // Суперадмина это не ограничивает: ему теги не проверяются вовсе.
  full: ADMIN_CAPABILITIES.filter((capability) => capability !== "features.manage"),
} as const satisfies Record<string, readonly AdminCapability[]>

export type CapabilityPreset = keyof typeof CAPABILITY_PRESETS
export const CAPABILITY_PRESET_NAMES = Object.keys(
  CAPABILITY_PRESETS,
) as CapabilityPreset[]
