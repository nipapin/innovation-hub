import { hasCompanyCapability } from "@/lib/company-capabilities"
import { listCompanyCapabilitiesFor } from "@/lib/repositories/company-capabilities"
import { findUserByEmail, findUserById } from "@/lib/repositories/users"

/**
 * Можно ли звать этих людей в проект компании.
 *
 * Отдельным модулем от роута, а не функцией внутри него, по одной причине: это
 * граница доверия, и её надо уметь прогнать на данных. Внутри обработчика её
 * можно проверить только через HTTP с живой сессией — то есть на боевой базе и
 * с риском завести лишний аккаунт ровно в том случае, когда проверка сломана.
 *
 * Зачем она вообще: незнакомый адрес в диалоге «Поделиться» заводит НОВЫЙ
 * аккаунт на сайте, человек получает файлы проекта, а обработка ложится на
 * кошелёк компании. До этой проверки так мог сделать любой участник с полным
 * доступом, и в консоли компании он не отражался никак.
 *
 * Рамка считается по ВЛАДЕЛЬЦУ проекта, а не по приглашающему: компания у
 * работы одна — та, чей это проект и чей кошелёк за него платит. Иначе внешний
 * участник с полным доступом звал бы кого угодно, сам не будучи ни в какой
 * компании.
 *
 * «Свой» — тот, кто уже в ТОЙ ЖЕ компании. Проверка по существующему аккаунту,
 * а не по домену почты: домен подделывается опечаткой, а принадлежность
 * компании — запись, которую ставил администратор.
 */
export type InviteGate =
  | { ok: true }
  | { ok: false; reason: "company-outsider"; emails: string[] }

export async function checkCompanyInvite(input: {
  projectOwnerId: string
  actorUserId: string
  /** Админ сайта с `projects.manage`: он распоряжается чужими проектами по должности. */
  actorIsSiteManager: boolean
  emails: string[]
}): Promise<InviteGate> {
  if (input.actorIsSiteManager) return { ok: true }

  const owner = await findUserById(input.projectOwnerId)
  const companyId = owner?.companyId ?? null
  // Проект общего раздела — правило компании к нему неприменимо.
  if (!companyId) return { ok: true }

  const actor = await findUserById(input.actorUserId)
  if (actor?.companyId === companyId) {
    const granted = await listCompanyCapabilitiesFor(input.actorUserId)
    if (hasCompanyCapability(actor.companyRole, granted, "people.invite")) {
      return { ok: true }
    }
  }

  const foreign: string[] = []
  for (const email of input.emails) {
    const target = await findUserByEmail(email)
    if (!target || target.companyId !== companyId) foreign.push(email)
  }
  if (foreign.length === 0) return { ok: true }

  return { ok: false, reason: "company-outsider", emails: foreign }
}
