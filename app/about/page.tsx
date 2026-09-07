import { SITE_NAME } from "@/lib/site"
import { notFound } from "next/navigation"
import { isEnvFeatureEnabled } from "@/lib/features-env"
import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { AboutShowreel } from "@/components/about-showreel"
import { Mail, Send } from "lucide-react"

const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim()
const contactTelegram = process.env.NEXT_PUBLIC_CONTACT_TELEGRAM?.trim()

export default function AboutPage() {
  // Публичной части на этой установке нет — раздела не существует, а не «нет
  // доступа». Проверка сверх правила в proxy.ts: тот закрывает только корень,
  // а сюда ведут и прямые ссылки. Флаг `env`, поэтому база здесь не нужна.
  if (!isEnvFeatureEnabled("public.pages")) notFound()

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <div className="section-shell section-space">
          <h1 className="font-display text-3xl font-bold text-foreground md:text-4xl">
            About Us
          </h1>

          <div className="mt-10">
            <AboutShowreel />
          </div>

          <div className="mt-12 max-w-3xl space-y-4">
            <h2 className="font-display text-xl font-semibold text-foreground md:text-2xl">
              What we do
            </h2>
            {/* TODO(Vanya): replace placeholder copy */}
            <p className="text-base leading-relaxed text-muted-foreground">
              {SITE_NAME} is our curated showcase of automation and video
              production work. This section will be updated with the full
              description soon.
            </p>
          </div>

          {contactEmail || contactTelegram ? (
            <div className="mt-12 max-w-xl rounded-2xl border border-border/70 bg-surface-2/50 p-6">
              <h2 className="font-display text-lg font-semibold text-foreground">
                Contact us
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Questions about a project or a showcase video? Reach out directly.
              </p>
              <div className="mt-4 flex flex-col gap-3">
                {contactEmail ? (
                  <a
                    href={`mailto:${contactEmail}`}
                    className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80"
                  >
                    <Mail className="h-4 w-4" />
                    {contactEmail}
                  </a>
                ) : null}
                {contactTelegram ? (
                  <a
                    href={contactTelegram.startsWith("http") ? contactTelegram : `https://t.me/${contactTelegram.replace(/^@/, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80"
                  >
                    <Send className="h-4 w-4" />
                    Telegram
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </main>
      <FooterSection />
    </div>
  )
}
