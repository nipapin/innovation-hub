import { notFound } from "next/navigation"
import { isEnvFeatureEnabled } from "@/lib/features-env"
import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { FeatureSuggestionSection } from "@/components/landing/feature-suggestion-section"

export const dynamic = "force-dynamic"

export default function SuggestPage() {
  // Публичной части на этой установке нет — раздела не существует, а не «нет
  // доступа». Проверка сверх правила в proxy.ts: тот закрывает только корень,
  // а сюда ведут и прямые ссылки. Флаг `env`, поэтому база здесь не нужна.
  if (!isEnvFeatureEnabled("public.pages")) notFound()

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <FeatureSuggestionSection />
      </main>
      <FooterSection />
    </div>
  )
}
