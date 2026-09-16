import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { searchUsers } from "@/lib/billing/reports"

export const runtime = "nodejs"

/** Поиск человека, чтобы перевести его в компанию. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (q.length < 2) return NextResponse.json({ users: [] })

  return NextResponse.json({ users: await searchUsers(q) })
}
