import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <ForgotPasswordForm />
      </main>
      <FooterSection />
    </div>
  )
}
