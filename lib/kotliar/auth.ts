import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { isKotliarRequest } from "@/lib/kotliar/host"
import { isKotliarSiteOwner } from "@/lib/kotliar/owner"

export async function requireKotliarOwner(request: NextRequest) {
  if (!isKotliarRequest(request.headers)) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const session = token ? await verifySessionToken(token) : null
  if (
    !isKotliarSiteOwner({
      id: auth.userId,
      email: auth.email,
      loginUserId: session?.loginId ?? null,
    })
  ) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }
  return auth
}
