import type { Metadata } from "next"
import { KotliarLoginForm } from "@/components/kotliar/login-form"
import { getCurrentUser, getSessionLogin } from "@/lib/admin-auth"
import { isKotliarSiteOwner } from "@/lib/kotliar/owner"
import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Вход",
  robots: { index: false, follow: false },
}

export default async function KotliarLoginPage() {
  const user = await getCurrentUser()
  if (user) {
    const session = await getSessionLogin()
    if (
      isKotliarSiteOwner({
        id: user.id,
        email: user.email,
        loginUserId: session?.loginUserId ?? user.loginUserId,
      })
    ) {
      redirect("/edit")
    }
  }

  return (
    <div
      data-theme="light"
      className="flex min-h-screen items-center justify-center bg-[#f7f5f0] px-5 text-[#1c1b18]"
    >
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-black/8 bg-white p-6">
        <div className="space-y-1">
          <h1 className="text-[22px] font-semibold">Редактор сайта</h1>
          <p className="text-[14px] text-[#6b6860]">Тот же вход, что и на ffworks.</p>
        </div>
        <KotliarLoginForm />
      </div>
    </div>
  )
}
