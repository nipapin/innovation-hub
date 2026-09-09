import { Suspense } from "react"
import { redirect } from "next/navigation"
import {
  DashboardProjectsOverview,
  DashboardSection,
} from "@/components/account/sections/dashboard-section"
import { Skeleton } from "@/components/ui/skeleton"
import { getCurrentUser } from "@/lib/admin-auth"
import { listGiftProjects } from "@/lib/billing/grants"
import { countUnreadForProjects } from "@/lib/repositories/project-chat"
import {
  countMediaByUserId,
  listProjectsByUserId,
} from "@/lib/repositories/projects"

export const dynamic = "force-dynamic"

export default async function AccountDashboardPage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/login")
  }

  return (
    <DashboardSection
      fullName={user.fullName}
      email={user.email}
      memberSince={user.createdAt.toISOString()}
      projectsArea={
        <Suspense fallback={<ProjectsAreaSkeleton />}>
          <DashboardProjectsData userId={user.id} />
        </Suspense>
      }
    />
  )
}

async function DashboardProjectsData({ userId }: { userId: string }) {
  const [projects, mediaCount, gifts] = await Promise.all([
    listProjectsByUserId(userId, { archived: false }),
    countMediaByUserId(userId),
    // Подарочные проекты — тем же запросом, что и список: значок про подарок
    // должен появляться вместе с карточкой, а не догоняться отдельным вызовом.
    listGiftProjects(userId),
  ])
  const unreadCounts = await countUnreadForProjects(projects.map((p) => p.id))

  return (
    <DashboardProjectsOverview
      mediaCount={mediaCount}
      projects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        driveFolderId: p.driveFolderId,
        isActive: p.isActive,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        unreadChatCount: unreadCounts[p.id] ?? 0,
        gift: gifts.get(p.id) ?? null,
      }))}
    />
  )
}

function ProjectsAreaSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    </div>
  )
}
