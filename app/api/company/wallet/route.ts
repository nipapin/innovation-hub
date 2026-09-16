import { NextResponse, type NextRequest } from "next/server"
import { getFunds } from "@/lib/billing/funds"
import { requireCompanyApi } from "@/lib/company-auth"
import { findCompanyById } from "@/lib/repositories/companies"
import {
  listCompanyLedger,
  listCompanyPayees,
} from "@/lib/repositories/company-console"

export const runtime = "nodejs"

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

/**
 * Кошелёк компании — остаток, резерв, лента и список оплачиваемых.
 *
 * Деньги читает `getFunds` кошелька, а не свой запрос: именно по нему работает
 * допуск задач (lib/billing/admission.ts), и второе вычисление «доступно»
 * однажды разошлось бы с тем, что на самом деле пускает работу.
 */
export async function GET(request: NextRequest) {
  const auth = await requireCompanyApi(request, "wallet.manage")
  if (auth instanceof NextResponse) return auth

  const company = await findCompanyById(auth.companyId)
  if (!company) {
    return NextResponse.json({ message: "Company not found." }, { status: 404 })
  }

  const rawLimit = Number.parseInt(
    request.nextUrl.searchParams.get("limit") ?? "",
    10,
  )
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT
  const before = request.nextUrl.searchParams.get("before")

  const [funds, ledger, payees] = await Promise.all([
    getFunds(company.walletUserId),
    listCompanyLedger({ walletUserId: company.walletUserId, limit, before }),
    listCompanyPayees(company.walletUserId),
  ])

  return NextResponse.json({
    balanceOwnCents: funds.balances.own,
    balanceGiftCents: funds.balances.gift,
    reservedOwnCents: funds.reserved.own,
    reservedGiftCents: funds.reserved.gift,
    availableOwnCents: funds.availableOwnCents,
    availableGiftCents: funds.availableGiftCents,
    overdraftLimitCents: funds.overdraftLimitCents,
    grants: funds.grants.map((grant) => ({
      grantId: grant.grantId,
      kind: grant.kind,
      remainingCents: grant.remainingCents,
      availableCents: grant.availableCents,
      expiresAt: grant.expiresAt ? grant.expiresAt.toISOString() : null,
    })),
    ledger: ledger.rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: ledger.nextCursor,
    payees,
  })
}
