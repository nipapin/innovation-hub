import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { isLedgerWallet, readLedger } from "@/lib/billing/spending"

export const runtime = "nodejs"

/**
 * Движение средств по кошелькам — своя лента, строка за строкой.
 *
 * Скоуп ставит роут, а не клиент: лента это история денег конкретного человека,
 * и подставить чужой `userId` быть не должно возможности. Кошелёк и курсор
 * клиент выбирает — они ничего не открывают, кроме порядка своих же строк.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const rawWallet = request.nextUrl.searchParams.get("wallet")
  const wallet = isLedgerWallet(rawWallet) ? rawWallet : "all"

  return NextResponse.json(
    await readLedger({
      ownerId: auth.userId,
      wallet,
      cursor: request.nextUrl.searchParams.get("cursor"),
    }),
  )
}
