"use client"

import { usePathname } from "next/navigation"
import { AdminDataProvider } from "@/components/admin/data/admin-data-context"
import { AdminToolsColumn } from "@/components/admin/shell/admin-tools-column"
import { AdminTopbar } from "@/components/admin/shell/admin-topbar"
import { useAdminDensity } from "@/components/admin/shell/use-admin-density"
import { ADMIN_AREAS, findTool } from "@/components/admin/shell/nav-config"
import type { UserRole } from "@/lib/domain-types"
import type { AdminCapability } from "@/lib/admin-capabilities"

type Props = {
  email: string
  fullName: string
  currentUserId: string
  currentUserRole: UserRole
  currentUserCapabilities: AdminCapability[]
  children: React.ReactNode
}

/**
 * Страницы-рабочие области: занимают всю высоту и ширину, скроллят внутри себя.
 *
 * Остальные страницы админки — это документы: центрированная колонка с отбивками
 * и общий вертикальный скролл. «Папкам пользователей» такая обёртка не подходит:
 * у них три колонки со своими скроллами — внутри max-w-7xl с padding'ом всё это
 * ужимается.
 *
 * «Конвейер» из этого списка вышел: колонки уехали в «Папки», а пульт и очередь
 * — обычный документ. Полноэкранный режим убирает верхнюю панель и колонку
 * инструментов области, и держать в нём страницу, которой ширина больше не
 * нужна, значило бы отнимать у неё навигацию просто по привычке.
 *
 * «Чаты» здесь по той же причине, что и «Папки»: это не документ, а рабочая
 * область — колонка переписок и дерево файлов рядом.
 */
const FULL_BLEED_PATHS = ["/admin/workspaces", "/admin/chats"]

export function AdminShell({
  email,
  fullName,
  currentUserId,
  currentUserRole,
  currentUserCapabilities,
  children,
}: Props) {
  const pathname = usePathname()
  const fullBleed = FULL_BLEED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  )
  const { density, setDensity } = useAdminDensity()

  // Область текущей страницы: у инструмента берём его основную, на хабе —
  // совпадение по адресу. Колонки нет там, где страница занимает всю ширину
  // (конвейер) — у него свои три колонки, четвёртая была бы лишней.
  const tool = findTool(pathname ?? "")
  const area =
    tool?.areas[0] ??
    ADMIN_AREAS.find((candidate) => candidate.href === pathname)?.key
  const showColumn = !fullBleed && area != null

  return (
    <AdminDataProvider
      currentUserId={currentUserId}
      currentUserRole={currentUserRole}
      currentUserCapabilities={currentUserCapabilities}
    >
      {fullBleed ? (
        <div className="h-full overflow-hidden bg-background">{children}</div>
      ) : (
        <div className="flex h-full min-w-0 bg-background">
          {showColumn && density === "full" ? (
            <AdminToolsColumn area={area} />
          ) : null}
          <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
            <AdminTopbar
              email={email}
              fullName={fullName}
              density={density}
              setDensity={setDensity}
              hasColumn={showColumn}
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8 md:py-10">
                {children}
              </main>
            </div>
          </div>
        </div>
      )}
    </AdminDataProvider>
  )
}
