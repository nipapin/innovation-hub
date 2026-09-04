import { HelpPageButton } from "@/components/help/help-page-button"
import type { HelpTopicId } from "@/lib/help/topics"

type Props = {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
  /**
   * Статья справки об этом разделе. Иконка встаёт справа от названия — одно
   * место на всю админку: у страницы появилась статья, у страницы появился
   * вход, отдельной вёрстки на каждой не нужно.
   */
  help?: HelpTopicId
}

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
  help,
}: Props) {
  return (
    <header className="flex flex-col gap-4 border-b border-border/60 pb-6 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/80">
            {eyebrow}
          </p>
        ) : null}
        {/* Заголовок и вход в справку одной строкой: справка относится ко всему
            инструменту, поэтому и живёт при его названии, а не отдельной
            строкой под описанием, где спорила бы с ним за внимание. */}
        <div className="flex items-center gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            {title}
          </h1>
          {help ? <HelpPageButton id={help} /> : null}
        </div>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground md:text-[15px]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  )
}
