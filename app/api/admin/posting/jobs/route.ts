import { NextResponse, type NextRequest } from "next/server"

import { requireAdminApi } from "@/lib/admin-auth"
import { listPostJobs, type PostJobStatus } from "@/lib/posting/jobs"

export const runtime = "nodejs"

const STATUSES = new Set<PostJobStatus>([
  "queued",
  "running",
  "done",
  "failed",
  "skipped",
])

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "posting.operate")
  if (auth instanceof NextResponse) return auth

  const raw = request.nextUrl.searchParams.get("status")
  const status = raw && STATUSES.has(raw as PostJobStatus)
    ? (raw as PostJobStatus)
    : undefined

  const jobs = await listPostJobs({ status, limit: 200 })
  return NextResponse.json({ jobs })
}
