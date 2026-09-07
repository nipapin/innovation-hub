import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { PostingContent } from "@/components/admin/posting/posting-content"

export const dynamic = "force-dynamic"

export default async function AdminPostingPage() {
  await requireCapabilityPage("posting.operate")

  return <PostingContent />
}
