import { IBM_Plex_Sans } from "next/font/google"
import { redirect } from "next/navigation"

import { HelpShell } from "@/components/help/help-shell"
import { getCurrentUser } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

const ibmPlex = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex",
  display: "swap",
})

/**
 * Справка — зона для вошедших, а не публичная страница: она описывает рабочее
 * место и то, как устроена обработка, и состав видимых статей зависит от прав
 * (lib/help/topics.ts).
 *
 * Свой шелл, а не `WorkspaceShell`: справку открывают из модалок в новой
 * вкладке, и вторая копия сайдбара с балансом и списком проектов там только
 * мешает. Шрифт и токены — те же, что в кабинете.
 */
export default async function HelpLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!user.isActive) redirect("/")

  return (
    <div className={ibmPlex.variable}>
      <HelpShell>{children}</HelpShell>
    </div>
  )
}
