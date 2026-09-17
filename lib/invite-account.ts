import { randomBytes } from "node:crypto"

import { hashPassword } from "@/lib/auth"
import { syncUserMeta } from "@/lib/project-storage"
import { createUser, findUserByEmail, updateUser } from "@/lib/repositories/users"

/**
 * Ровно та запись, которую отдаёт поиск по почте, — выведена из него, а не
 * названа своим типом. Вызывающие присваивают её в ту же переменную, и
 * разойдись эти типы, расхождение всплыло бы у них, а не здесь.
 */
type FoundUser = NonNullable<Awaited<ReturnType<typeof findUserByEmail>>>

/**
 * Завести аккаунт по одной почте — общий код двух точек входа.
 *
 * Их две: приглашение в проект («Поделиться») и заведение сотрудника в консоли
 * компании (план §7). Вынесено сюда не ради краткости, а потому что заводить
 * аккаунт они обязаны ОДИНАКОВО. Две копии разойдутся молча и разойдутся
 * именно по `mustChangePassword`: копия, где флаг забыли, оставляет человека
 * жить с временным паролем, который ушёл письмом открытым текстом.
 *
 * Письмо отсюда НЕ уходит. Оно у каждой точки входа своё — проектное называет
 * проект, наше зовёт в компанию, — а временный пароль нужен обеим, и вернуть
 * его наружу можно только здесь: в базе лежит хэш.
 */
export type CreatedAccount = {
  user: FoundUser
  /** Открытым текстом — только чтобы уложить в письмо. Нигде не хранится. */
  temporaryPassword: string
}

/** Временный пароль. `base64url` — чтобы его можно было продиктовать голосом. */
export function tempPassword(): string {
  return randomBytes(9).toString("base64url")
}

/**
 * Создать человека под этой почтой.
 *
 * Возвращает `null`, если аккаунт не удалось перечитать после вставки: звать
 * дальше некого, и молча продолжать здесь нельзя — следующим шагом идёт
 * зачисление в компанию или выдача доступа к проекту.
 *
 * Имя по умолчанию — часть адреса до «собаки». Человек переименует себя сам;
 * пустое имя хуже, потому что в списках он станет безымянной строкой.
 */
export async function createAccountByEmail(input: {
  email: string
  fullName?: string
}): Promise<CreatedAccount | null> {
  const temporaryPassword = tempPassword()
  const passwordHash = await hashPassword(temporaryPassword)
  const fullName = input.fullName?.trim() || input.email.split("@")[0] || "User"

  const created = await createUser({ email: input.email, fullName, passwordHash })
  await updateUser(created.id, { mustChangePassword: true })

  const user = await findUserByEmail(input.email)
  if (!user) return null

  try {
    await syncUserMeta({
      userId: created.id,
      email: created.email,
      createdAt: created.createdAt.toISOString(),
    })
  } catch {
    // Зеркало метаданных в хранилище — не повод не завести человека.
  }

  return { user, temporaryPassword }
}
