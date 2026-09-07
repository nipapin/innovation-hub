"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { KeyRound, Share2, type LucideIcon } from "lucide-react"

import { useI18n, type DictKey } from "@/components/account/i18n"
import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import { cn } from "@/lib/utils"

/**
 * «Ключи и аккаунты» — раздел кабинета из двух инструментов.
 *
 * Раньше это был один пункт «Мои ключи». Аккаунты площадок в него не влезают:
 * у ключа вендора есть прайс и расход, у аккаунта VK — группы и срок токена, а
 * общего у них только то, что и то и другое чужой секрет. Свалить их в один
 * список значило бы объяснять на каждой строке, что это за сущность.
 *
 * Раскладка повторяет админку (`AdminToolsColumn`): слева инструменты раздела с
 * подписями, справа сам инструмент. Приём тот же и по той же причине — без
 * колонки второй инструмент виден только с хаба, то есть всегда в два клика.
 */

type KeysTool = {
  href: string
  labelKey: DictKey
  descriptionKey: DictKey
  icon: LucideIcon
}

export const KEYS_TOOLS: KeysTool[] = [
  {
    href: "/account/vendor-keys",
    labelKey: "keysToolVendor",
    descriptionKey: "keysToolVendorDesc",
    icon: KeyRound,
  },
  {
    href: "/account/social-accounts",
    labelKey: "keysToolSocial",
    descriptionKey: "keysToolSocialDesc",
    icon: Share2,
  },
]

export function isKeysPath(pathname: string): boolean {
  return KEYS_TOOLS.some((tool) => pathname.startsWith(tool.href))
}

export function KeysShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  const pathname = usePathname() ?? ""

  const { size, dragging, onPointerDown, onKeyDown } = useDragSize({
    initial: 260,
    min: 200,
    max: 420,
    axis: "x",
    storageKey: "ffworks-keys-tools-width",
  })

  return (
    <div className="flex h-full min-w-0">
      <section
        style={{ width: size }}
        className="relative hidden h-full shrink-0 flex-col overflow-hidden border-r border-white/[0.08] bg-ws-well lg:flex"
      >
        <header className="flex items-center gap-2 px-4 pb-2 pt-5">
          <span className="h-3 w-[3px] shrink-0 rounded-full bg-primary/60" />
          <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-ws-4">
            {t.keysAreaNav}
          </span>
        </header>

        <nav className="scrollbar-elegant flex-1 overflow-y-auto px-2 pb-3">
          {KEYS_TOOLS.map((tool) => {
            const Icon = tool.icon
            const active = pathname.startsWith(tool.href)
            return (
              <Link
                key={tool.href}
                href={tool.href}
                className={cn(
                  "flex items-start gap-2.5 rounded-[10px] px-2.5 py-2 transition-colors",
                  active
                    ? "bg-ws-select/35 text-ws-1"
                    : "text-ws-3 hover:bg-white/5 hover:text-ws-1",
                )}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">
                    {t[tool.labelKey]}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-ws-4">
                    {t[tool.descriptionKey]}
                  </span>
                </span>
              </Link>
            )
          })}
        </nav>

        <ResizeGrip
          orientation="vertical"
          side="right"
          label={t.keysAreaNav}
          dragging={dragging}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
        />
      </section>

      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
