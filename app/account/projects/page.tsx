import { Suspense } from "react"
import { WorkspacePageClient } from "@/components/account/workspace/workspace-page"
import { isEnabled } from "@/lib/features-state"

export const dynamic = "force-dynamic"

export default async function ProjectsPage() {
  /**
   * Сборка элемента — выключатель установки (`workspace.element`). Читается
   * здесь, на сервере, и уезжает пропсом: состояние флагов лежит в базе, а
   * модуль, который её читает, тянет `pg` — в клиентском бандле ему не место.
   *
   * Защитой это не является и не должно: кнопку выключатель убирает, а запись
   * всё равно проверяют роуты хранилища по правам проекта.
   */
  const elementEnabled = await isEnabled("workspace.element")

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-ws-4">
          Loading…
        </div>
      }
    >
      <WorkspacePageClient elementEnabled={elementEnabled} />
    </Suspense>
  )
}
