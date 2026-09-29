import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { isKotliarRequest } from "@/lib/kotliar/host"

export const dynamic = "force-dynamic"

export default async function KotliarSiteLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headerStore = await headers()
  if (!isKotliarRequest(headerStore)) notFound()
  return children
}
