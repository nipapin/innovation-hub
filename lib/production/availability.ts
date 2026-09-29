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
 * Человек вне компании получает только ответ установки:
 * `findCompanyFeaturesForUser` вернёт `null`, а `readCompanyFeatures(null)` —
 * умолчания, то есть «включено».
 *
 * Защитой это не является: оно прячет вход. Отказ дают гварды страниц и роутов
 * раздела, которые спрашивают эту же функцию.
 */
export async function isProductionAvailable(userId: string): Promise<boolean> {
  /**
   * ВРЕМЕННО: раздел в разработке и в боевой сборке скрыт целиком — решение
   * владельца продукта 2026-09-29. Виден только под `next dev`.
   *
   * Здесь, а не галкой в админке: без записи в базе выключатель берёт
   * умолчание установки («включено»), и раздел открылся бы пользователям сразу
   * после выкатки. Выключатели установки и компании при этом не работают —
   * этот запрет стоит перед ними. Снять — удалить эту строку.
   */
  if (process.env.NODE_ENV === "production") return false
  if (!(await isEnabled("production"))) return false
  const features = readCompanyFeatures(await findCompanyFeaturesForUser(userId))
  return features.production
}
