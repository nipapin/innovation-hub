"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Gift, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { formatBalance, tf, useI18n } from "@/components/account/i18n"

/**
 * Выдача тестового периода — условия, конфликт имён, запрос и ход копирования.
 *
 * Вынесено из карточки баланса потому, что предложить период теперь можно из
 * двух мест: с дашборда и из раздела проектов. Машинерия должна быть ОДНА —
 * условия, вопрос о совпавших именах и разбор ответов сервера ветвятся
 * достаточно, чтобы вторая копия разошлась с первой при первой же правке.
 *
 * Диалог НЕ закрывается по согласию: на месте кнопок появляется ход
 * копирования, и закрывается окно само, когда проекты доехали. Закрыться сразу
 * означало бы вернуть человека к прежнему экрану, где ничего не изменилось —
 * копии едут несколько секунд, и всё это время выглядит так, будто нажатие
 * пропало впустую.
 *
 * Здесь нет ни загрузки состояния, ни решения, показывать ли кнопку: это дело
 * места показа. Отсюда — только «человек согласился, дальше я».
 */

export type TrialTemplate = { projectId: string; name: string }

export type TrialProgress = { done: number; total: number } | null

export type TrialState =
  | { status: "unavailable"; reason: string }
  | {
      status: "available"
      amountCents: number
      lifetimeDays: number | null
      templates: TrialTemplate[]
    }
  | {
      status: "provisioning" | "active" | "exhausted" | "expired" | "revoked"
      grant: { amountCents: number }
      projectIds: string[]
      progress: TrialProgress
    }

/** Период предлагается — состав набора известен. */
type TrialOffer = Extract<TrialState, { status: "available" }>

/**
 * Проект прошлой выдачи, чьё имя занял шаблон нового набора. Приезжает в теле
 * `409 { code: "conflicts" }` — это не отказ, а вопрос к человеку.
 */
export type TrialConflict = { templateId: string; name: string; projectId: string }

export type TrialChoice =
  | { strategy: "rename"; names: Record<string, string> }
  | { strategy: "replace" }

export type TrialFlow = ReturnType<typeof useTrialFlow>

export function useTrialFlow({
  status,
  onChanged,
}: {
  /** Текущий статус периода. По нему же ведётся опрос, пока копии едут. */
  status: TrialState["status"] | undefined
  /**
   * Перечитать всё, что зависит от периода: состояние и — там, где это уместно
   * — список проектов. Должна быть устойчивой (`useCallback`): на ней висит
   * опрос, и новая ссылка на каждую отрисовку перезапускала бы его.
   */
  onChanged: () => void | Promise<void>
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [activating, setActivating] = useState(false)
  /** Копирование идёт заметно дольше обычного — предлагаем дожать вручную. */
  const [stalled, setStalled] = useState(false)
  /** Имена заняты проектами прошлой выдачи — спрашиваем, что с ними делать. */
  const [conflicts, setConflicts] = useState<TrialConflict[] | null>(null)

  /**
   * Без аргумента — первый заход: если имена свободны, период выдаётся сразу.
   * С выбором — второй, после диалога о совпавших именах.
   */
  const activate = async (choice?: TrialChoice) => {
    setActivating(true)
    try {
      const res = await fetch("/api/account/trial", {
        method: "POST",
        ...(choice
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(choice),
            }
          : {}),
      })
      if (res.status === 409) {
        const body = (await res.json()) as {
          code?: string
          conflicts?: TrialConflict[]
        }
        // Не отказ, а вопрос: такие проекты у человека уже есть. Показываем
        // выбор вместо тоста — тост здесь сказал бы «нельзя», хотя можно.
        if (body.code === "conflicts" && body.conflicts?.length) {
          setOpen(false)
          setConflicts(body.conflicts)
          return
        }
        toast.error(
          body.code === "already-used"
            ? t.trialAlreadyUsed
            : body.code === "paid-by-other"
              ? t.trialPaidByOther
              : t.trialUnavailable,
        )
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      // Дожали незаконченную выдачу — это не активация, и поздравлять с ней
      // человека, у которого период уже есть, значит сбивать с толку.
      const body = (await res.json()) as { resumed?: boolean }
      toast.success(body.resumed ? t.trialResumeStarted : t.trialActivated)
      setConflicts(null)
      // Окно остаётся открытым: в нём теперь показывается ход копирования.
      setOpen(true)
      await onChanged()
    } catch {
      toast.error(t.trialActivateError)
    } finally {
      setActivating(false)
    }
  }

  /**
   * Пока копии едут — переспрашиваем. Одного отложенного запроса не хватает:
   * набор копируется дольше пары секунд, а окно, застрявшее на «копируем» до
   * перезагрузки страницы, читается как поломка.
   *
   * Через ~20 секунд появляется «Повторить»: выдача может встать (упавшая
   * работа, перезапуск сервера), и тогда единственный выход отсюда — повторный
   * запрос, который дожмёт незаконченную выдачу. Показывать кнопку сразу
   * нельзя — она бы предлагала чинить то, что идёт нормально.
   */
  useEffect(() => {
    if (status !== "provisioning") {
      setStalled(false)
      return
    }
    let ticks = 0
    const timer = setInterval(() => {
      ticks++
      if (ticks === 7) setStalled(true)
      // Три минуты — и хватит: дальше человек либо нажмёт «Повторить», либо
      // вернётся позже, и опрос начнётся заново.
      if (ticks > 60) {
        clearInterval(timer)
        return
      }
      void onChanged()
    }, 3000)
    return () => clearInterval(timer)
  }, [status, onChanged])

  /**
   * Копирование кончилось — закрываем окно сами. Закрываем именно по ПЕРЕХОДУ
   * из `provisioning`, а не по «статус не provisioning»: иначе окно с условиями
   * (статус `available`) закрывалось бы сразу после открытия.
   */
  const previous = useRef<TrialState["status"] | undefined>(undefined)
  useEffect(() => {
    if (previous.current === "provisioning" && status !== "provisioning") {
      setOpen(false)
    }
    previous.current = status
  }, [status])

  return { open, setOpen, activating, stalled, conflicts, setConflicts, activate }
}

/** Все окна выдачи. Ставятся рядом с кнопкой, какой бы она ни была. */
export function TrialDialogs({
  flow,
  trial,
}: {
  flow: TrialFlow
  trial: TrialState | undefined
}) {
  return (
    <>
      {flow.open && trial?.status === "available" ? (
        <TrialOfferDialog
          trial={trial}
          busy={flow.activating}
          onConfirm={() => void flow.activate()}
          onCancel={() => flow.setOpen(false)}
        />
      ) : null}

      {flow.open && trial?.status === "provisioning" ? (
        <TrialCopyingDialog
          progress={trial.progress}
          stalled={flow.stalled}
          busy={flow.activating}
          onResume={() => void flow.activate()}
          onClose={() => flow.setOpen(false)}
        />
      ) : null}

      {flow.conflicts ? (
        <TrialConflictDialog
          conflicts={flow.conflicts}
          busy={flow.activating}
          onRename={(names) => void flow.activate({ strategy: "rename", names })}
          onReplace={() => void flow.activate({ strategy: "replace" })}
          onCancel={() => flow.setConflicts(null)}
        />
      ) : null}
    </>
  )
}

/**
 * Общая оболочка окна.
 *
 * `text-left` здесь не украшение: окно хоть и `fixed`, но выравнивание текста
 * наследуется от предка ПО ДЕРЕВУ, а кнопка, из которой его открыли, может
 * стоять в центрированном блоке — и тогда весь текст уезжает в середину. Вид
 * окна не должен зависеть от того, откуда его позвали.
 */
function TrialShell({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 text-left shadow-xl">
        {children}
      </div>
    </div>
  )
}

function TrialHeader() {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-2 text-primary">
      <Gift className="h-5 w-5" />
      <h2 className="text-lg font-semibold text-foreground">
        {t.trialDialogTitle}
      </h2>
    </div>
  )
}

/**
 * Совпали имена: такие проекты человек уже получал в прошлый раз.
 *
 * Вариантов два, и они намеренно разной цены. «Положить рядом» — обратимо,
 * поэтому оно первое и с готовыми именами. «Заменить» — необратимо, поэтому
 * оно отдельной кнопкой с предупреждением, а не радиокнопкой в общем ряду:
 * перепутать их одним кликом быть не должно.
 */
function TrialConflictDialog({
  conflicts,
  busy,
  onRename,
  onReplace,
  onCancel,
}: {
  conflicts: TrialConflict[]
  busy: boolean
  onRename: (names: Record<string, string>) => void
  onReplace: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  // Подставляем «Имя (2)» — то же правило, которым хранилище разводит
  // одноимённые файлы, так что имя человеку знакомо.
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(conflicts.map((c) => [c.templateId, `${c.name} (2)`])),
  )

  const allNamed = conflicts.every((c) => (names[c.templateId] ?? "").trim())

  return (
    <TrialShell>
      <h2 className="text-lg font-semibold text-foreground">
        {t.trialConflictTitle}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {t.trialConflictBody}
      </p>

      <div className="mt-4 space-y-2">
        {conflicts.map((conflict) => (
          <div key={conflict.templateId}>
            <label className="block text-xs text-muted-foreground/80">
              {conflict.name} → {t.trialConflictNewName}
            </label>
            <input
              value={names[conflict.templateId] ?? ""}
              disabled={busy}
              onChange={(e) =>
                setNames((prev) => ({
                  ...prev,
                  [conflict.templateId]: e.target.value,
                }))
              }
              className="mt-1 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60"
            />
          </div>
        ))}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground/80">
        {t.trialConflictRenameHint}
      </p>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          {t.trialDialogCancel}
        </button>
        <button
          type="button"
          onClick={onReplace}
          disabled={busy}
          className="rounded-lg border border-destructive/50 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
        >
          {t.trialConflictReplace}
        </button>
        <button
          type="button"
          onClick={() => onRename(names)}
          disabled={busy || !allNamed}
          title={allNamed ? undefined : t.trialConflictNameEmpty}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t.trialConflictRename}
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-destructive/80">
        {t.trialConflictReplaceHint}
      </p>
    </TrialShell>
  )
}

/**
 * Условия периода перед активацией.
 *
 * Состав набора называется поимённо, а не числом: «3 проекта» человеку ничего
 * не говорит и вдобавок разойдётся с действительностью, как только состав
 * поменяют. Перечисление же считает себя само — отдельного числа в тексте нет
 * и согласовывать его с «проекта/проектов» не приходится.
 *
 * Кнопку нажимает человек — период не включается сам ни при регистрации, ни
 * при переходе по ссылке.
 */
function TrialOfferDialog({
  trial,
  busy,
  onConfirm,
  onCancel,
}: {
  trial: TrialOffer
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t, lang } = useI18n()
  return (
    <TrialShell>
      <TrialHeader />
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {tf(t.trialDialogBody, {
          amount: formatBalance(trial.amountCents, lang),
        })}
      </p>
      {/* Списком, а не перечислением в строку: набор читают глазами, чтобы
          решить, брать его или нет, и пять имён через запятую в этом не
          помогают. Нумерация своя, а не маркерами списка — она должна
          остаться видимой при копировании текста. */}
      <ol className="mt-2 space-y-1 text-sm leading-relaxed text-foreground/90">
        {trial.templates.map((project, index) => (
          <li key={project.projectId}>{`${index + 1} — «${project.name}»`}</li>
        ))}
      </ol>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {t.trialDialogBodyTail}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground/80">
        {t.trialDialogTerms}
      </p>
      {trial.lifetimeDays != null ? (
        <p className="mt-2 text-xs text-muted-foreground/80">
          {tf(t.trialDialogLifetime, { days: trial.lifetimeDays })}
        </p>
      ) : null}
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          {t.trialDialogCancel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? t.trialActivating : t.trialDialogConfirm}
        </button>
      </div>
    </TrialShell>
  )
}

/**
 * Ход копирования — то же окно, на месте кнопок.
 *
 * Полоса шагает по проектам, а не по секундам: она показывает сделанное, а не
 * изображает занятость. Поэтому на трёх шаблонах шагов будет три — честно
 * грубо. Пока сервер не сказал, сколько всего, полосы нет вовсе: пустая шкала
 * без чисел обещает точность, которой у нас в этот момент нет.
 */
function TrialCopyingDialog({
  progress,
  stalled,
  busy,
  onResume,
  onClose,
}: {
  progress: TrialProgress
  stalled: boolean
  busy: boolean
  onResume: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null

  return (
    <TrialShell>
      <TrialHeader />
      <p className="mt-3 flex items-center gap-2 text-sm leading-relaxed text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        {t.trialDialogCopying}
      </p>

      {percent != null && progress ? (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {tf(t.trialDialogProgress, {
                done: progress.done,
                total: progress.total,
              })}
            </span>
            <span>{`${percent}%`}</span>
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground/80">
        {t.trialDialogKeepOpen}
      </p>

      <div className="mt-5 flex justify-end gap-2">
        {stalled ? (
          <button
            type="button"
            onClick={onResume}
            disabled={busy}
            className="rounded-lg bg-foreground/10 px-3 py-2 text-sm hover:bg-foreground/[0.18] disabled:opacity-60"
          >
            {t.trialResume}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          {t.trialDialogClose}
        </button>
      </div>
    </TrialShell>
  )
}
