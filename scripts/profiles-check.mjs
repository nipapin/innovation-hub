/**
 * Проверка подпрофилей — docs/MULTI_COMPANY_PROFILES_PLAN.md §12.
 *
 * У человека один вход и несколько рабочих мест, и почта у них одна. Отсюда три
 * ошибки, которые снаружи не видны, пока не ударят:
 *
 *   · поиск ТЕКУЩЕГО человека по почте из сессии молча попадает во вход, даже
 *     когда он работает в профиле компании, — и меняет пароль или удаляет не то;
 *   · вход сессии, прочитанный в гварде, превращает «права по активному
 *     профилю» в «права по человеку» — и компания видит работу из «Личного»;
 *   · участие в проекте, прочитанное по одному `user_id`, не видит доступа,
 *     выданного на вход, — и проект чужой компании пропадает из профиля.
 *
 * Документацией это не удержать, поэтому проверка — восьмая в ряду
 * `i18n:check`, `company:check` и остальных.
 *
 * Что проверяется:
 *
 *   1. `findUserByEmail` не существует (переименован в `findLoginByEmail`, чтобы
 *      каждый вызов был пересмотрен), и `findLoginByEmail` не зовётся с почтой
 *      из сессии (`current.email`, `auth.email`, `session.email`).
 *   2. Вход сессии (`getSessionLogin`, поле токена `lid`) читается только в
 *      перечисленных местах: переключатель, учётные данные, push, возврат из
 *      выключенного профиля, выпуск токена. Гварды его не знают вовсе.
 *   3. Запросы к `project_members` в коде сайта сравнивают участника через
 *      `ANY(accessIdsFor(...))`, а не голым `user_id = $n`. Исключения — запись
 *      участия (точная строка) и консоль компании, каждое с причиной и счётом.
 *
 * Запуск: npm run profiles:check
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const ZONES = ["app", "lib", "components", "proxy.ts"]

/** Где можно спросить вход сессии. Каждое место — с причиной. */
const SESSION_LOGIN_ALLOWED = new Map([
  ["lib/admin-auth.ts", "объявление getSessionLogin"],
  ["lib/profile-switch.ts", "переключение и ссылка с ?profile= (§4.2, §9.3)"],
  ["app/api/auth/switch-profile/route.ts", "переключатель (§4.2)"],
  ["app/api/auth/profiles/route.ts", "список профилей переключателя (§6)"],
  ["app/api/auth/session/route.ts", "возврат из выключенного профиля (§4.4)"],
  ["app/account/layout.tsx", "возврат из выключенного профиля (§4.4)"],
  ["app/company/layout.tsx", "возврат из выключенного профиля (§4.4)"],
  ["app/api/account/password/route.ts", "пароль один — у входа (§5.3)"],
  ["app/api/account/profile/route.ts", "общие поля — на входе (§5.3)"],
  ["app/api/account/route.ts", "удаляется вход (§5.3)"],
  ["app/api/account/push-subscription/route.ts", "подписка — на входе (§9.4)"],
])

/** Где можно выпускать и читать поле токена `lid`. */
const LID_ALLOWED = new Map([
  ["lib/auth.ts", "сам токен"],
  ["lib/profile-switch.ts", "токен после переключения"],
  ["app/api/auth/signin/route.ts", "выпуск токена при входе"],
  ["app/api/auth/signup/route.ts", "выпуск токена при регистрации"],
  ["app/api/auth/google/callback/route.ts", "выпуск токена при входе через Google"],
  ["app/api/account/profile/route.ts", "перевыпуск токена при смене почты"],
])

/**
 * Гварды: права — строго по активному профилю. Ни вход сессии, ни вход
 * профиля им не нужны; появление здесь — провал.
 */
const GUARDS = ["lib/company-auth.ts", "lib/storage/auth.ts", "proxy.ts"]
const GUARD_FORBIDDEN = /\b(getSessionLogin|loginIdOf|lid|loginUserId)\b/

/**
 * Голое `user_id = $n` по участникам проекта — только здесь. Счёт — потолок:
 * новое такое сравнение в том же файле без пересмотра не пройдёт.
 */
const MEMBER_EXACT_ALLOWED = new Map([
  [
    "lib/repositories/project-members.ts",
    {
      max: 2,
      why: "findProjectMembership и removeProjectMember — точная строка для записи; решение о доступе — findMembershipForAccess",
    },
  ],
  [
    "lib/project-transfer.ts",
    { max: 1, why: "новый владелец перестаёт быть участником — запись" },
  ],
  [
    "lib/repositories/company-console.ts",
    { max: 1, why: "отзыв внешнего участника — запись, рамка компании в самом DELETE" },
  ],
])

const errors = []

function walk(path, out = []) {
  const full = join(root, path)
  let stat
  try {
    stat = statSync(full)
  } catch {
    return out
  }
  if (stat.isFile()) {
    if (/\.(ts|tsx|mjs)$/.test(path)) out.push(path)
    return out
  }
  for (const entry of readdirSync(full)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    walk(join(path, entry), out)
  }
  return out
}

/** Код без комментариев: правила — про вызовы, а не про их описание. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

const files = ZONES.flatMap((zone) => walk(zone)).map((path) => path.split("\\").join("/"))

for (const rel of files) {
  const raw = readFileSync(join(root, rel), "utf8")
  const code = stripComments(raw)

  // 1. Поиск по почте.
  if (/\bfindUserByEmail\b/.test(code)) {
    errors.push(`${rel}: findUserByEmail — теперь findLoginByEmail, и вызов надо пересмотреть (§5.2)`)
  }
  const bySession = code.match(/findLoginByEmail\(\s*(current|auth|session)\.email/)
  if (bySession) {
    errors.push(
      `${rel}: findLoginByEmail(${bySession[1]}.email) — текущего человека ищут по id из сессии, не по почте (§5.2)`,
    )
  }

  // 2. Вход сессии.
  if (/\bgetSessionLogin\b/.test(code) && !SESSION_LOGIN_ALLOWED.has(rel)) {
    errors.push(
      `${rel}: читает вход сессии (getSessionLogin) — права считаются по активному профилю (§4.1, §12)`,
    )
  }
  if (/\blid\b/.test(code) && !LID_ALLOWED.has(rel)) {
    errors.push(`${rel}: трогает поле токена lid — ему место только в выпуске токена (§4.1)`)
  }
  if (GUARDS.includes(rel)) {
    const hit = code.match(GUARD_FORBIDDEN)
    if (hit) errors.push(`${rel}: гвард знает про вход (${hit[1]}) — права только по активному профилю`)
  }
  if (rel === "lib/admin-auth.ts") {
    // Файл гвардов и объявления getSessionLogin: вход читается ровно в одном
    // месте — внутри неё самой.
    const uses = code.match(/\bloginIdOf\(/g)?.length ?? 0
    if (uses !== 1) {
      errors.push(`${rel}: loginIdOf встречается ${uses} раз(а) — только внутри getSessionLogin`)
    }
  }

  // 3. Участие в проекте.
  if (rel.startsWith("lib/") || rel.startsWith("app/")) {
    let exact = 0
    for (const literal of code.match(/`[^`]*`/g) ?? []) {
      if (!literal.includes("project_members")) continue
      exact +=
        literal.match(/(?<![\w.])(?:pm\.|m\.|project_members\.)?user_id\s*=\s*\$\d+/g)?.length ?? 0
    }
    const allowed = MEMBER_EXACT_ALLOWED.get(rel)
    if (exact > (allowed?.max ?? 0)) {
      errors.push(
        `${rel}: ${exact} сравнение(й) участника проекта голым user_id = $n` +
          (allowed ? ` (разрешено ${allowed.max}: ${allowed.why})` : "") +
          " — доступ читается через accessIdsFor (§8.3)",
      )
    }
  }
}

if (errors.length > 0) {
  console.error(
    `profiles: найдено ${errors.length} нарушений правил подпрофилей.\n` +
      "Разбор — docs/MULTI_COMPANY_PROFILES_PLAN.md §12.\n",
  )
  for (const error of errors) console.error(`  · ${error}`)
  process.exit(1)
}

console.log(`profiles: правила подпрофилей соблюдены — ${files.length} файл(ов).`)
