import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <ResetPasswordForm token={token ?? ""} />
      </main>
      <FooterSection />
    </div>
  )
}
