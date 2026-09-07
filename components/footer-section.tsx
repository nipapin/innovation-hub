import { SITE_NAME } from "@/lib/site"

export function FooterSection() {
  return (
    <footer className="border-t border-border/40 bg-surface-1/80">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-8 text-center md:flex-row md:text-left lg:px-10">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {SITE_NAME}
        </p>
        <p className="text-xs text-muted-foreground">
          Curated AI product intelligence for teams that ship.
        </p>
        <p className="text-xs text-muted-foreground">
          {"\u00A9 "}{SITE_NAME}. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
