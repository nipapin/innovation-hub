import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { ChatsContent } from "@/components/admin/chats/chats-content"

export const dynamic = "force-dynamic"

/**
 * Тот же тег, что у «Папок» (`projects.access`): чат проекта — часть работы с
 * чужим проектом, ступень 1. Отвечать клиенту можно, не имея права
 * распоряжаться его проектами.
 */
export default async function AdminChatsPage() {
  await requireCapabilityPage("projects.access")

  return <ChatsContent />
}
