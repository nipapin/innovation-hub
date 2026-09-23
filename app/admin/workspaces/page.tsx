import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { WorkspacesContent } from "@/components/admin/workspaces/workspaces-content"
import { isEnabled } from "@/lib/features-state"

export const dynamic = "force-dynamic"

/**
 * Страница открыта по ступени 1 (`projects.access`): помогать с чужими файлами
 * можно, не имея права распоряжаться проектами. Ступень 2 (`projects.manage`)
 * гасит действия внутри страницы, а не саму страницу — так же, как «Завести
 * человека» на /admin/users. Разбор — docs/ADMIN_WORKSPACE_PLAN.md §3.
 */
export default async function AdminWorkspacesPage() {
  await requireCapabilityPage("projects.access")

  /**
   * Сборка элемента нужна и здесь: админ помогает с чужими папками с того же
   * рабочего места, и собирать элемент в чужом `IN` ему приходится ровно так
   * же. Флаг читается на сервере и уезжает пропсом — состояние выключателей
   * лежит в базе, а модуль, который её читает, тянет `pg`.
   */
  const elementEnabled = await isEnabled("workspace.element")

  return <WorkspacesContent elementEnabled={elementEnabled} />
}
