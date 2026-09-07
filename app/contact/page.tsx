import { notFound } from "next/navigation"
import { isEnvFeatureEnabled } from "@/lib/features-env"
import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { Mail, MapPin, Phone } from "lucide-react"

export default function ContactPage() {
  // Публичной части на этой установке нет — раздела не существует, а не «нет
  // доступа». Проверка сверх правила в proxy.ts: тот закрывает только корень,
  // а сюда ведут и прямые ссылки. Флаг `env`, поэтому база здесь не нужна.
  if (!isEnvFeatureEnabled("public.pages")) notFound()

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h1 className="mb-12 font-display text-3xl font-bold text-foreground md:text-4xl">
            Contact
          </h1>
          <div className="flex flex-col gap-6">
            <div className="flex items-start gap-4 rounded-lg border border-border bg-card p-5">
              <Mail className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="font-medium text-foreground">Email</p>
                <p className="text-sm text-muted-foreground">hello@ffworks.io</p>
              </div>
            </div>
            <div className="flex items-start gap-4 rounded-lg border border-border bg-card p-5">
              <Phone className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="font-medium text-foreground">Phone</p>
                <p className="text-sm text-muted-foreground">+1 (555) 012-3456</p>
              </div>
            </div>
            <div className="flex items-start gap-4 rounded-lg border border-border bg-card p-5">
              <MapPin className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="font-medium text-foreground">Location</p>
                <p className="text-sm text-muted-foreground">San Francisco, CA</p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <FooterSection />
    </div>
  )
}
