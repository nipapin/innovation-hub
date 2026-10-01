import { readCompanyFeatures } from "@/lib/company-features"
import { isEnabled } from "@/lib/features-state"
import { findCompanyFeaturesForUser } from "@/lib/repositories/companies"

/**
 * Виден ли человеку раздел «Производство» — docs/PRODUCTION_PLAN.md §6.4, §9.
 *
 * Две оси, и открыты должны быть обе: выключатель установки (`production` в
 * lib/features.ts) и выключатель компании (`production` в
 * lib/company-features.ts). Порядок именно такой: компания сужает, но не
 * расширяет — выключенное на установке она включить не может.
 *
 * Человек вне команды получает набор «Личного» (админка «Команд», миграция
 * 2026-10-01-personal-features.sql). Там «Производство» выключено с самого
 * начала, и без таблицы код считает так же.
 *
 * Защитой это не является: оно прячет вход. Отказ дают гварды страниц и роутов
 * раздела, которые спрашивают эту же функцию.
 */
export async function isProductionAvailable(userId: string): Promise<boolean> {
  if (!(await isEnabled("production"))) return false
  const features = readCompanyFeatures(await findCompanyFeaturesForUser(userId))
  return features.production
}
