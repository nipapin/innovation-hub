import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { isKotliarSiteOwner } from "@/lib/kotliar/owner"

export async function requireKotliarOwner(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  if (!isKotliarSiteOwner(auth.userId)) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }
  return auth
}
