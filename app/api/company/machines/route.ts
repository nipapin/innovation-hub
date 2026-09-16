import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { auditFrom } from "@/lib/audit"
import { requireCompanyApi } from "@/lib/company-auth"
import {
  createRemoteComputer,
  generateRemoteComputerToken,
} from "@/lib/repositories/remote-computers"
import { listCompanyMachines } from "@/lib/repositories/company-console"
import {
  findCompanyById,
  patchCompanyFeatures,
} from "@/lib/repositories/companies"
import {
  OWN_MACHINES_ONLY_KEY,
  readCompanyFeatures,
} from "@/lib/company-features"

export const runtime = "nodejs"

/**
 * Машины компании — docs/COMPANY_PIPELINE_PLAN.md §2.
 *
 * Токен выдаёт админ компании у себя, а не мы из своей админки: машина стоит в
 * его офисе, и ключ от неё — его дело. Наша сторона решает только, что компания
 * вообще может иметь свои машины.
 *
 * Что получает такой токен — не роль, а рамка: `reachScope` в
 * lib/storage/auth.ts отдаёт ему `{ kind: "company" }`, и чужих проектов он не
 * видит ни в хранилище, ни в каталоге.
 */
export async function GET(request: NextRequest) {
  const auth = await requireCompanyApi(request, "machines.manage")
  if (auth instanceof NextResponse) return auth

  const [machines, company] = await Promise.all([
    listCompanyMachines(auth.companyId),
    findCompanyById(auth.companyId),
  ])
  return NextResponse.json({
    machines: machines.map((machine) => ({
      ...machine,
      lastHeartbeatAt: machine.lastHeartbeatAt?.toISOString() ?? null,
      createdAt: machine.createdAt.toISOString(),
    })),
    ownMachinesOnly: readCompanyFeatures(company?.features).ownMachinesOnly,
  })
}

/**
 * Флаг «только свои машины» — docs/COMPANY_PIPELINE_PLAN.md §4.
 *
 * Он отвечает на один вопрос: что делать, если своих машин не осталось совсем.
 * Выключен — обработку берём на себя; включён — очередь стоит и ждёт.
 *
 * Настраивает это компания у себя, а не мы из своей админки, и по той же
 * причине, что и выдачу токенов: решение «нашу работу на чужом железе не
 * обрабатывать» — их, а не наше. Наша сторона отвечает на этот флаг, а не
 * устанавливает его. Тег тот же, `machines.manage`: это одна тема, и разводить
 * её по двум правам значило бы, что кто-то заводит машины, но не может сказать,
 * зачем их завёл.
 */
const policySchema = z.object({
  ownMachinesOnly: z.boolean(),
})

export async function PATCH(request: NextRequest) {
  const auth = await requireCompanyApi(request, "machines.manage")
  if (auth instanceof NextResponse) return auth

  const parsed = policySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }

  const updated = await patchCompanyFeatures({
    companyId: auth.companyId,
    patch: { [OWN_MACHINES_ONLY_KEY]: parsed.data.ownMachinesOnly },
  })
  if (!updated) {
    return NextResponse.json({ message: "Company not found." }, { status: 404 })
  }

  await auditFrom(request, { userId: auth.userId, email: auth.email })({
    action: "company.machines_policy_changed",
    targetType: "company",
    targetId: auth.companyId,
    targetLabel: auth.companyTitle,
    companyId: auth.companyId,
    meta: { ownMachinesOnly: parsed.data.ownMachinesOnly },
  })

  return NextResponse.json({
    ok: true,
    ownMachinesOnly: readCompanyFeatures(updated.features).ownMachinesOnly,
  })
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
})

export async function POST(request: NextRequest) {
  const auth = await requireCompanyApi(request, "machines.manage")
  if (auth instanceof NextResponse) return auth

  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }

  const token = generateRemoteComputerToken()
  const created = await createRemoteComputer({
    name: parsed.data.name,
    description: parsed.data.description,
    createdBy: auth.userId,
    // Компания берётся ИЗ ГЕЙТА, а не из запроса: иначе админ одной компании
    // завёл бы машину другой, подставив чужой идентификатор.
    companyId: auth.companyId,
    rawToken: token,
  })

  await auditFrom(request, { userId: auth.userId, email: auth.email })({
    action: "company.machine_created",
    targetType: "computer",
    targetId: created.id,
    targetLabel: created.name,
    companyId: auth.companyId,
  })

  // Токен отдаётся ОДИН раз: в базе лежит только его отпечаток, и показать его
  // второй раз неоткуда. Тот же контракт, что у машин в нашей админке.
  return NextResponse.json({ id: created.id, name: created.name, token }, { status: 201 })
}
