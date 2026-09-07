import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { FeaturesContent } from "@/components/admin/features/features-content"

export const dynamic = "force-dynamic"

export default async function AdminFeaturesPage() {
  await requireCapabilityPage("features.manage")

  return <FeaturesContent />
}
