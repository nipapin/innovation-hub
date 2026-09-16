import { randomBytes } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireUserApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { hashPassword } from "@/lib/auth"
import {
  mailBrandForOwner,
  sendProjectAccessGrantedEmail,
  sendProjectInviteWithPasswordEmail,
} from "@/lib/mail/send"
import type { MailBrand } from "@/lib/mail/templates"
import {
  canGrantRole,
  canManageMember,
  requireProjectAccessOrCapability,
  type ProjectAccessRole,
  type ProjectMemberRole,
} from "@/lib/project-access"
import { syncUserMeta } from "@/lib/project-storage"
import {
  findProjectMembership,
  listProjectMembers,
  removeProjectMember,
  upsertProjectMember,
} from "@/lib/repositories/project-members"
import { rememberShareContact } from "@/lib/repositories/share-contacts"
import { hasCapability } from "@/lib/admin-capabilities"
import { checkCompanyInvite } from "@/lib/company-invite-gate"
import {
  createUser,
  findUserByEmail,
  findUserById,
  updateUser,
} from "@/lib/repositories/users"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

const roleSchema = z.enum(["viewer", "editor", "full"])

const inviteSchema = z
  .object({
    email: z.string().email().optional(),
    emails: z.array(z.string().email()).max(20).optional(),
    role: roleSchema.default("viewer"),
    fullName: z.string().trim().min(1).max(120).optional(),
  })
  .superRefine((data, ctx) => {
    const count =
      (data.email ? 1 : 0) + (data.emails?.length ?? 0)
    if (count === 0) {
      ctx.addIssue({
        code: "custom",
        message: "At least one email is required.",
      })
    }
  })

const patchSchema = z.object({
  userId: z.string().min(1),
  role: roleSchema,
})

function tempPassword(): string {
  return randomBytes(9).toString("base64url")
}

function uniqueEmails(parsed: z.infer<typeof inviteSchema>): string[] {
  const raw = [
    ...(parsed.email ? [parsed.email] : []),
    ...(parsed.emails ?? []),
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const email = item.toLowerCase()
    if (seen.has(email)) continue
    seen.add(email)
    out.push(email)
  }
  return out
}

type InviteOk = {
  email: string
  ok: true
  createdUser: boolean
  mailOk: boolean
  mailError: string | null
  member: {
    userId: string
    email: string
    fullName: string
    role: ProjectMemberRole
    createdAt: string
  }
}

type InviteFail = {
  email: string
  ok: false
  message: string
}

async function inviteOne(input: {
  projectId: string
  projectName: string
  projectOwnerId: string
  actorUserId: string
  actorRole: ProjectAccessRole
  /** Доступ у зовущего от админского тега, а не от владения или участия. */
  actorViaCapability: boolean
  inviterName: string
  /**
   * Чьим именем подписать письмо. Компания ВЛАДЕЛЬЦА проекта, а не приглашающего
   * и не приглашаемого: человек приходит в чужое рабочее место, и узнать он
   * должен то, куда его позвали.
   */
  brand: MailBrand
  email: string
  role: ProjectMemberRole
  fullName?: string
}): Promise<InviteOk | InviteFail> {
  let user = await findUserByEmail(input.email)
  let created = false
  let temporaryPassword: string | null = null

  if (!user) {
    temporaryPassword = tempPassword()
    const passwordHash = await hashPassword(temporaryPassword)
    const fullName =
      input.fullName?.trim() || input.email.split("@")[0] || "User"
    const createdUser = await createUser({
      fullName,
      email: input.email,
      passwordHash,
    })
    await updateUser(createdUser.id, { mustChangePassword: true })
    user = await findUserByEmail(input.email)
    if (!user) {
      return {
        email: input.email,
        ok: false,
        message: "Could not create user.",
      }
    }
    created = true
    try {
      await syncUserMeta({
        userId: createdUser.id,
        email: createdUser.email,
        createdAt: createdUser.createdAt.toISOString(),
      })
    } catch {
      // best-effort
    }
  }

  if (user.id === input.projectOwnerId) {
    return {
      email: input.email,
      ok: false,
      message: "The project owner already has full access.",
    }
  }

  // Админ из «Папок пользователей» распоряжается чужим проектом по тегу
  // `projects.manage`, а не по участию: записи в project_members у него нет, и
  // проект не появляется у него в «Расшаренных» — а значит недоступен и
  // инструментам кабинета вроде редактора субтитров. Выдать доступ себе для
  // него не бессмыслица, а единственный способ открыть проект как обычный
  // участник, поэтому «у вас уже есть доступ» остаётся только владельцу и
  // участникам, у которых этот доступ действительно есть.
  if (user.id === input.actorUserId && !input.actorViaCapability) {
    return {
      email: input.email,
      ok: false,
      message: "You already have access to this project.",
    }
  }

  // Приглашение того, кто уже в проекте, — это смена его роли, и правило здесь
  // то же, что у PATCH: полный доступ не переписывает роль такому же полному.
  // Без этой проверки диалог «Поделиться» стал бы обходным путём: ввёл адрес
  // коллеги с полным доступом, выбрал «Читатель» — и понизил его.
  const existing = await findProjectMembership(input.projectId, user.id)
  if (existing) {
    if (existing.role === input.role) {
      return {
        email: input.email,
        ok: false,
        message: "This person already has that access.",
      }
    }
    if (!canManageMember(input.actorRole, existing.role)) {
      return {
        email: input.email,
        ok: false,
        message: "Only the project owner can change this person's access.",
      }
    }
  }

  const member = await upsertProjectMember({
    projectId: input.projectId,
    userId: user.id,
    role: input.role,
    // Кто позвал — история приглашения, и переписывать её сменой роли нельзя:
    // владелец должен видеть, откуда человек взялся в проекте.
    invitedBy: existing?.invitedBy ?? input.actorUserId,
  })

  let mailOk = true
  let mailError: string | null = null

  if (created && temporaryPassword) {
    const mail = await sendProjectInviteWithPasswordEmail({
      to: input.email,
      inviteeName: user.fullName,
      projectName: input.projectName,
      role: input.role,
      inviterName: input.inviterName,
      temporaryPassword,
      brand: input.brand,
    })
    mailOk = mail.ok
    mailError = mail.ok ? null : mail.error
  } else {
    const mail = await sendProjectAccessGrantedEmail({
      to: input.email,
      inviteeName: user.fullName,
      projectName: input.projectName,
      projectId: input.projectId,
      role: input.role,
      inviterName: input.inviterName,
      brand: input.brand,
    })
    mailOk = mail.ok
    mailError = mail.ok ? null : mail.error
  }

  return {
    email: input.email,
    ok: true,
    createdUser: created,
    mailOk,
    mailError,
    member: {
      userId: member.userId,
      email: user.email,
      fullName: user.fullName,
      role: member.role,
      createdAt: member.createdAt.toISOString(),
    },
  }
}

/**
 * GET /api/projects/:id/members — владелец или участник с полным доступом.
 *
 * Список плоский: кто бы кого ни позвал, владелец видит в диалоге всех сразу и
 * там же снимает доступ или меняет роль. `invitedBy` идёт рядом — при
 * делегировании иначе не понять, откуда в проекте взялся человек.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  // Владелец, участник с полным доступом — или админ, которому доверено
  // распоряжаться чужими проектами: он раздаёт доступ из «Папок пользователей»
  // тем же диалогом, что и владелец (docs/ADMIN_WORKSPACE_PLAN.md §7).
  const access = await requireProjectAccessOrCapability(
    id,
    auth,
    "full",
    "projects.manage",
  )
  if (access instanceof NextResponse) return access

  const [members, owner] = await Promise.all([
    listProjectMembers(id),
    findUserById(access.project.userId),
  ])
  return NextResponse.json({
    viewerUserId: auth.userId,
    viewerRole: access.role,
    owner: {
      userId: access.project.userId,
      email: owner?.email ?? "",
      fullName: owner?.fullName ?? owner?.email ?? "",
    },
    members: members.map((m) => ({
      userId: m.userId,
      email: m.email,
      fullName: m.fullName,
      role: m.role,
      invitedBy: m.invitedBy,
      invitedByName: m.invitedByName ?? null,
      invitedByEmail: m.invitedByEmail ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
  })
}

/** POST /api/projects/:id/members — invite by email (owner or full access). */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  // Владелец, участник с полным доступом — или админ, которому доверено
  // распоряжаться чужими проектами: он раздаёт доступ из «Папок пользователей»
  // тем же диалогом, что и владелец (docs/ADMIN_WORKSPACE_PLAN.md §7).
  const access = await requireProjectAccessOrCapability(
    id,
    auth,
    "full",
    "projects.manage",
  )
  if (access instanceof NextResponse) return access

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }
  const parsed = inviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  if (!canGrantRole(access.role, parsed.data.role)) {
    return NextResponse.json(
      { message: "You cannot grant access above your own." },
      { status: 403 },
    )
  }

  const emails = uniqueEmails(parsed.data)

  // Граница доверия вынесена в модуль и проверяется на данных отдельно,
  // см. lib/company-invite-gate.ts.
  const gate = await checkCompanyInvite({
    projectOwnerId: access.project.userId,
    actorUserId: auth.userId,
    actorIsSiteManager:
      access.viaCapability === true ||
      hasCapability(auth.role, auth.capabilities, "projects.manage"),
    emails,
  })
  if (!gate.ok) {
    return NextResponse.json(
      {
        message:
          "Only a company admin with the invite right can share this project outside the company.",
        code: gate.reason,
        emails: gate.emails,
      },
      { status: 403 },
    )
  }

  const inviter = await findUserById(auth.userId)
  const inviterName = inviter?.fullName ?? auth.email
  const brand = await mailBrandForOwner(access.project.userId)

  const results: Array<InviteOk | InviteFail> = []
  for (const email of emails) {
    results.push(
      await inviteOne({
        projectId: access.project.id,
        projectName: access.project.name,
        projectOwnerId: access.project.userId,
        actorUserId: auth.userId,
        actorRole: access.role,
        actorViaCapability: access.viaCapability === true,
        inviterName,
        brand,
        email,
        role: parsed.data.role,
        fullName: parsed.data.fullName,
      }),
    )
  }

  const invited = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)
  const status = invited.length === 0 ? 400 : 200

  // История получателей — у того, кто позвал, и пишется здесь, а не в браузере:
  // диалог один и тот же в кабинете и в админке, и список подсказок обязан
  // пополняться одинаково, откуда бы приглашение ни ушло. Только удавшиеся:
  // адрес с опечаткой в подсказках не нужен. Сбой записи приглашение не рушит —
  // доступ уже выдан и письмо ушло.
  for (const result of invited) {
    if (!result.ok) continue
    try {
      await rememberShareContact({
        userId: auth.userId,
        email: result.member.email,
        fullName: result.member.fullName,
      })
    } catch (error) {
      console.error("[members] не записали получателя в историю", error)
    }
  }

  // Одна запись на приглашение, а не одна на запрос: в одном обращении бывает
  // до двадцати адресов, и «выдал доступ 20 людям» в журнале не ответит на
  // вопрос «кому именно».
  if (access.viaCapability) {
    const audit = auditFrom(request, auth)
    for (const result of invited) {
      if (!result.ok) continue
      await audit({
        action: "project.shared",
        targetType: "project",
        targetId: access.project.id,
        targetLabel: access.project.name,
        meta: { email: result.email, role: parsed.data.role },
      })
    }
  }

  return NextResponse.json(
    {
      results,
      invited: invited.length,
      failed: failed.length,
      // Backward-compatible single-invite fields
      member: invited[0]?.ok ? invited[0].member : undefined,
      createdUser: invited[0]?.ok ? invited[0].createdUser : undefined,
      mailOk: invited[0]?.ok ? invited[0].mailOk : undefined,
      mailError: invited[0]?.ok ? invited[0].mailError : undefined,
      message: failed[0] && !failed[0].ok ? failed[0].message : undefined,
    },
    { status },
  )
}

/** PATCH /api/projects/:id/members — change a member's role. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  // Владелец, участник с полным доступом — или админ, которому доверено
  // распоряжаться чужими проектами: он раздаёт доступ из «Папок пользователей»
  // тем же диалогом, что и владелец (docs/ADMIN_WORKSPACE_PLAN.md §7).
  const access = await requireProjectAccessOrCapability(
    id,
    auth,
    "full",
    "projects.manage",
  )
  if (access instanceof NextResponse) return access

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  if (parsed.data.userId === access.project.userId) {
    return NextResponse.json(
      { message: "Owner role cannot be changed." },
      { status: 400 },
    )
  }
  // Себе роль не меняют — кроме админа, который пришёл сюда по тегу: свой
  // доступ к чужому проекту он и так может переписать, сняв его и выдав заново
  // (POST выше), так что запрет здесь ничего не защищал бы, а только заставлял
  // ходить кругом.
  if (parsed.data.userId === auth.userId && !access.viaCapability) {
    return NextResponse.json(
      { message: "You cannot change your own access." },
      { status: 400 },
    )
  }

  const existing = (await listProjectMembers(id)).find(
    (m) => m.userId === parsed.data.userId,
  )
  if (!existing) {
    return NextResponse.json({ message: "Member not found." }, { status: 404 })
  }

  if (!canManageMember(access.role, existing.role)) {
    return NextResponse.json(
      { message: "Only the project owner can change this person's access." },
      { status: 403 },
    )
  }
  if (!canGrantRole(access.role, parsed.data.role)) {
    return NextResponse.json(
      { message: "You cannot grant access above your own." },
      { status: 403 },
    )
  }

  const member = await upsertProjectMember({
    projectId: access.project.id,
    userId: parsed.data.userId,
    role: parsed.data.role,
    invitedBy: existing.invitedBy ?? auth.userId,
  })

  if (access.viaCapability) {
    await auditFrom(request, auth)({
      action: "project.shared",
      targetType: "project",
      targetId: access.project.id,
      targetLabel: access.project.name,
      meta: { userId: parsed.data.userId, role: parsed.data.role },
    })
  }

  return NextResponse.json({
    member: {
      userId: member.userId,
      email: existing.email,
      fullName: existing.fullName,
      role: member.role,
      createdAt: member.createdAt.toISOString(),
    },
  })
}

/**
 * DELETE /api/projects/:id/members?userId= — снять доступ.
 *
 * Каскада нет: те, кого позвал снятый участник, остаются в проекте. Иначе один
 * клик убирал бы из проекта группу людей, а вернуть их можно только заново
 * пригласив каждого — цена ошибки несоизмерима с задачей «убрать одного».
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  // Владелец, участник с полным доступом — или админ, которому доверено
  // распоряжаться чужими проектами: он раздаёт доступ из «Папок пользователей»
  // тем же диалогом, что и владелец (docs/ADMIN_WORKSPACE_PLAN.md §7).
  const access = await requireProjectAccessOrCapability(
    id,
    auth,
    "full",
    "projects.manage",
  )
  if (access instanceof NextResponse) return access

  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) {
    return NextResponse.json({ message: "userId is required." }, { status: 400 })
  }
  if (userId === access.project.userId) {
    return NextResponse.json(
      { message: "The project owner cannot be removed." },
      { status: 400 },
    )
  }

  const existing = await findProjectMembership(id, userId)
  if (!existing) {
    return NextResponse.json({ message: "Member not found." }, { status: 404 })
  }
  // Исключение для себя: снять свой доступ — это выход из чужого проекта, а не
  // отзыв. Без него участник с полным доступом уйти бы не смог: правило п. 2
  // (docs/BACKEND_PLAN.md §8.2б) не даёт ему тронуть такой же полный доступ,
  // включая свой собственный.
  if (userId !== auth.userId && !canManageMember(access.role, existing.role)) {
    return NextResponse.json(
      { message: "Only the project owner can remove this person." },
      { status: 403 },
    )
  }

  const ok = await removeProjectMember(id, userId)
  if (!ok) {
    return NextResponse.json({ message: "Member not found." }, { status: 404 })
  }
  if (access.viaCapability) {
    await auditFrom(request, auth)({
      action: "project.unshared",
      targetType: "project",
      targetId: access.project.id,
      targetLabel: access.project.name,
      meta: { userId, role: existing.role },
    })
  }
  return NextResponse.json({ ok: true })
}
