import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import type { ClientRecord } from "@/lib/domain-types"

const CLIENT_FIELDS = `
  id,
  user_id AS "userId",
  display_name AS "displayName",
  created_at AS "createdAt"
`

export async function listClientsByUserId(
  userId: string,
): Promise<ClientRecord[]> {
  const result = await query<ClientRecord>(
    `SELECT ${CLIENT_FIELDS}
       FROM clients
      WHERE user_id = $1
      ORDER BY display_name ASC, created_at ASC`,
    [userId],
  )
  return result.rows
}

export async function findClientById(
  id: string,
): Promise<ClientRecord | null> {
  const result = await query<ClientRecord>(
    `SELECT ${CLIENT_FIELDS} FROM clients WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function listClientsByIds(ids: string[]): Promise<ClientRecord[]> {
  if (ids.length === 0) return []
  const result = await query<ClientRecord>(
    `SELECT ${CLIENT_FIELDS}
       FROM clients
      WHERE id = ANY($1::text[])
      ORDER BY display_name ASC, created_at ASC`,
    [ids],
  )
  return result.rows
}

/** Клиенты нескольких владельцев — рамка компании (COMPANY_PIPELINE_PLAN.md §2). */
export async function listClientsByUserIds(
  userIds: string[],
): Promise<ClientRecord[]> {
  if (userIds.length === 0) return []
  const result = await query<ClientRecord>(
    `SELECT ${CLIENT_FIELDS}
       FROM clients
      WHERE user_id = ANY($1::text[])
      ORDER BY display_name ASC, created_at ASC`,
    [[...new Set(userIds)]],
  )
  return result.rows
}

export async function listAllClients(): Promise<ClientRecord[]> {
  const result = await query<ClientRecord>(
    `SELECT ${CLIENT_FIELDS}
       FROM clients
      ORDER BY display_name ASC, created_at ASC`,
  )
  return result.rows
}

export async function createClient(input: {
  userId: string
  displayName: string
}): Promise<ClientRecord> {
  const id = randomUUID()
  const result = await query<ClientRecord>(
    `INSERT INTO clients (id, user_id, display_name)
     VALUES ($1, $2, $3)
     RETURNING ${CLIENT_FIELDS}`,
    [id, input.userId, input.displayName],
  )
  return result.rows[0]!
}
