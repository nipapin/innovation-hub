import { HelpPageButton } from "@/components/help/help-page-button"
import type { HelpTopicId } from "@/lib/help/topics"

type Props = {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
  /**
   * Статья справки об этом разделе. Место входа то же, что в админке —
   * иконка сразу после названия: стиль подсказок один на весь продукт, и
   * человек не должен искать справку заново в каждой зоне (UI_GUIDE §0.13).
   */
  help?: HelpTopicId
}

export function AccountPageHeader({
  eyebrow,
  title,
  description,
  actions,
  help,
}: Props) {
  return (
    <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2.5">
        {eyebrow ? (
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/80">
            <span className="h-px w-6 bg-primary/50" aria-hidden />
            {eyebrow}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            {title}
          </h1>
          {help ? <HelpPageButton id={help} /> : null}
        </div>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-[15px]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      ) : null}
    </header>
  )
}
