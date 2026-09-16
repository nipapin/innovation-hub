import { query } from "@/lib/db"
import {
  isCompanyCapability,
  type CompanyCapability,
} from "@/lib/company-capabilities"

/**
 * Теги прав внутри компании. Устройство повторяет
 * lib/repositories/admin-capabilities.ts — и по той же причине отдельной
 * таблицей, а не массивом: `granted_by` и `granted_at` отвечают на первый
 * вопрос владельца, увидевшего неожиданное, — «кто ему это выдал и когда».
 *
 * Компания у тега не хранится: она выводится через человека (план §3).
 * Отдельная колонка была бы вторым ответом на вопрос «в какой он компании» и
 * однажды разошлась бы с первым.
 */
export async function listCompanyCapabilitiesFor(
  userId: string,
): Promise<CompanyCapability[]> {
  const result = await query<{ capability: string }>(
    `SELECT capability FROM company_capabilities WHERE user_id = $1`,
    [userId],
  )
  // Как и у админских тегов: неизвестное имя ничего не открывает и не всплывает
  // в интерфейсе галочкой без подписи.
  return result.rows.map((row) => row.capability).filter(isCompanyCapability)
}

export type CompanyCapabilityGrant = {
  capability: CompanyCapability
  grantedBy: string | null
  grantedByEmail: string | null
  grantedAt: Date
}

export async function listCompanyGrantsFor(
  userId: string,
): Promise<CompanyCapabilityGrant[]> {
  const result = await query<CompanyCapabilityGrant & { capability: string }>(
    `SELECT cc.capability,
            cc.granted_by AS "grantedBy",
            u.email       AS "grantedByEmail",
            cc.granted_at AS "grantedAt"
       FROM company_capabilities cc
       LEFT JOIN users u ON u.id = cc.granted_by
      WHERE cc.user_id = $1
      ORDER BY cc.capability ASC`,
    [userId],
  )
  return result.rows.filter((row) =>
    isCompanyCapability(row.capability),
  ) as CompanyCapabilityGrant[]
}

export async function listCompanyCapabilitiesForMany(
  userIds: string[],
): Promise<Map<string, CompanyCapability[]>> {
  const unique = [...new Set(userIds.filter(Boolean))]
  if (unique.length === 0) return new Map()

  const result = await query<{ userId: string; capability: string }>(
    `SELECT user_id AS "userId", capability
       FROM company_capabilities
      WHERE user_id = ANY($1::text[])`,
    [unique],
  )

  const byUser = new Map<string, CompanyCapability[]>()
  for (const row of result.rows) {
    if (!isCompanyCapability(row.capability)) continue
    const list = byUser.get(row.userId)
    if (list) list.push(row.capability)
    else byUser.set(row.userId, [row.capability])
  }
  return byUser
}

/**
 * Заменить набор целиком — как экран с галочками, diff'ом, а не «снести и
 * вставить»: иначе `granted_by` сбрасывался бы у тегов, которых никто не
 * касался.
 *
 * `allowed` — потолок выдающего: правило компании «выдать можно только то, что
 * есть у тебя самого» (план §4). Проверяется здесь, а не только в роуте, чтобы
 * второй вызывающий не мог его обойти.
 */
export async function setCompanyCapabilities(input: {
  userId: string
  capabilities: readonly CompanyCapability[]
  grantedBy: string
  allowed: readonly CompanyCapability[]
}): Promise<
  | { ok: true; added: CompanyCapability[]; removed: CompanyCapability[] }
  | { ok: false; reason: "not-allowed"; capabilities: CompanyCapability[] }
> {
  const current = await listCompanyCapabilitiesFor(input.userId)
  const next = [...new Set(input.capabilities)]

  const added = next.filter((c) => !current.includes(c))
  const removed = current.filter((c) => !next.includes(c))

  // Потолок применяется к ИЗМЕНЕНИЯМ, а не ко всему набору: админ без тега
  // «ключи» не должен уметь ни выдать его, ни отобрать у соседа, но и не должен
  // спотыкаться о чужой тег, правя соседние галочки.
  const beyond = [...added, ...removed].filter((c) => !input.allowed.includes(c))
  if (beyond.length > 0) {
    return { ok: false, reason: "not-allowed", capabilities: [...new Set(beyond)] }
  }

  if (added.length > 0) {
    await query(
      `INSERT INTO company_capabilities (user_id, capability, granted_by)
       SELECT $1, capability, $3 FROM UNNEST($2::text[]) AS capability
       ON CONFLICT (user_id, capability) DO NOTHING`,
      [input.userId, added, input.grantedBy],
    )
  }
  if (removed.length > 0) {
    await query(
      `DELETE FROM company_capabilities
        WHERE user_id = $1 AND capability = ANY($2::text[])`,
      [input.userId, removed],
    )
  }

  return { ok: true, added, removed }
}

/** Понижение до участника: теги есть только у админов компании. */
export async function clearCompanyCapabilities(userId: string): Promise<void> {
  await query(`DELETE FROM company_capabilities WHERE user_id = $1`, [userId])
}

/**
 * Сколько во владельцах компании, кроме указанного.
 *
 * Тот же инвариант, что у `countActiveSuperAdmins` на сайте: последнего
 * владельца снять нельзя, иначе права в компании станет некому раздавать и
 * изнутри она не разблокируется.
 */
export async function countCompanyOwners(
  companyId: string,
  excludeUserId?: string,
): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM users
      WHERE company_id = $1
        AND company_role = 'owner'
        AND is_active = TRUE
        AND ($2::text IS NULL OR id <> $2)`,
    [companyId, excludeUserId ?? null],
  )
  return result.rows[0]?.count ?? 0
}
