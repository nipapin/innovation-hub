import { readCompanyFeatures } from "@/lib/company-features"
import {
  findCompanyById,
  findCompanyFeaturesForUser,
} from "@/lib/repositories/companies"

/**
 * «Работа этой компании идёт за наш счёт» по одному человеку —
 * docs/COMPANY_SETUP_PANEL_PLAN.md §3.
 *
 * Отдельный модуль по той же причине, что и company-chat-gate.ts: сам
 * lib/company-features.ts базы не касается намеренно — его читает и браузер.
 *
 * Здесь читается компания САМОГО человека, и это не то же самое, что гейт
 * конвейера. Тот спрашивает про владельца проекта (§3.1: платит компания
 * владельца, а не плательщика), а этот отвечает на вопрос «показывать ли ЭТОМУ
 * человеку его кошелёк» — вопрос про того, кто смотрит на экран.
 *
 * Человек вне компании получает `false`: `findCompanyFeaturesForUser` вернёт
 * `null`, а умолчание у `billingFree` — «выключено», то есть «платит сам». Для
 * этого ключа умолчание намеренно строгое (`=== true`): забытый ключ обязан
 * читаться как «счёт выставляем», потому что такая ошибка видна сразу, а
 * обратная — только в счёте за внешние сервисы через месяц.
 */
export async function isCompanyBillingFree(userId: string): Promise<boolean> {
  const features = readCompanyFeatures(await findCompanyFeaturesForUser(userId))
  return features.billingFree
}

/**
 * То же самое, но по компании — для консоли, где на руках `companyId`, а не
 * человек (§3.5: тег `wallet.manage` перестаёт что-либо открывать).
 *
 * Гейт здесь стоит СВЕРХ набора разделов, а не вместо него. Набор гасит пункт
 * меню, но он настройка: его можно забыть проставить или вернуть по ошибке
 * вместе с другим разделом, а адрес страницы к тому времени уже у кого-то в
 * закладках. Раздел, который нам нечего показывать, не должен зависеть от того,
 * не забыли ли снять галочку.
 *
 * Компания без строки в базе (`null`) — не «бесплатная»: не найдя её, роут и так
 * ответит 404, и выдавать за неё «за наш счёт» значило бы принимать решение о
 * деньгах по отсутствию данных.
 */
export async function isCompanyBillingFreeById(
  companyId: string,
): Promise<boolean> {
  const company = await findCompanyById(companyId)
  return company ? readCompanyFeatures(company.features).billingFree : false
}
