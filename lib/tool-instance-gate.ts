import { readCompanyFeatures } from "@/lib/company-features"
import { enabledToolKeys } from "@/lib/features-state"
import { findCompanyFeaturesForUser } from "@/lib/repositories/companies"
import { findUserTool, type UserToolRecord } from "@/lib/repositories/user-tools"

/**
 * Живой экземпляр инструмента — docs/COMPANY_SETUP_PANEL_PLAN.md §2.5.
 *
 * Отвечает на вопрос, которого не задавал `findUserTool`: инструмент не только
 * ЕГО, но и доступен ли вообще — включён на установке (lib/features.ts) и продан
 * его компании (набор из §2). Раньше дочерние роуты экземпляра спрашивали только
 * про владение, поэтому сотрудник с открытой вкладкой или знающий `id`
 * продолжал работать инструментом, который из списка уже пропал.
 *
 * Одна функция на все роуты, а не условие, дописанное в каждый: копий было бы
 * семь, и разошлись бы они молча — хуже того, добавленный восьмой роут просто
 * не узнал бы, что такое условие существует. Здесь же его нельзя не позвать:
 * другого способа достать экземпляр у роутов не остаётся.
 *
 * Тот же `enabledToolKeys`, что сужает каталог в `/api/account/tools`, —
 * намеренно он, а не «такая же» проверка рядом: список и доступ обязаны отвечать
 * одно и то же, иначе инструмент либо виден и не работает, либо работает и не
 * виден.
 *
 * `null` вместо отдельной причины «не продан» — это не лень, а решение: все
 * семь мест отвечают на него одинаковым 404 «Tool not found», и так и надо.
 * Сказать «инструмент есть, но вам его не продали» значит сообщить сотруднику
 * состав закупки его компании — не его дело и не наш разговор.
 */
export async function findLiveUserTool(
  id: string,
  userId: string,
): Promise<UserToolRecord | null> {
  const tool = await findUserTool(id, userId)
  if (!tool) return null

  const features = readCompanyFeatures(await findCompanyFeaturesForUser(userId))
  const allowed = await enabledToolKeys(features.companyTools)
  return allowed.includes(tool.toolKey) ? tool : null
}
