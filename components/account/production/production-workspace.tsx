"use client"

import { useEffect, useRef, useState } from "react"
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  SendHorizontal,
  UserPlus,
  Workflow,
} from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { WorkplaceModeSwitch } from "./mode-switch"

/**
 * Рабочее место «Производство» — каркас по эскизу владельца продукта
 * (docs/PRODUCTION_PLAN.md §9.1).
 *
 * Настоящих данных пока нет: схема, люди и файлы — демонстрационные, чтобы
 * раскладку можно было оценить глазами. Смотрящий в демо — исполнитель, этап
 * открыт. Правило «кто может принять» переедет на сервер, когда этап начнёт
 * приходить оттуда.
 */

type ViewerRole = "executor" | "reviewer" | "other"
/**
 * Статусов у этапа два (решение 2026-09-29, PRODUCTION_PLAN §4.1): вся работа —
 * варианты и замечания — идёт в чате, а кнопка одна, «Принято».
 */
type StageStatus = "open" | "approved"

const DEMO_ROLE: ViewerRole = "executor"
/** Смотрящий в демо — первый исполнитель. */
const DEMO_ME = "e1"

type Person = { id: string; name: string }

export function ProductionWorkspace() {
  const { t } = useI18n()
  const role = DEMO_ROLE
  const [status, setStatus] = useState<StageStatus>("open")
  // Отметившиеся исполнители. Отметка — не «занял этап», а «делаю его»: по ней
  // человек попадает исполнителем во все отчёты.
  const [marked, setMarked] = useState<string[]>([])

  const executors: Person[] = [
    { id: "e1", name: t.productionDemoExecutor1 },
    { id: "e2", name: t.productionDemoExecutor2 },
    { id: "e3", name: t.productionDemoExecutor3 },
  ]
  const reviewers: Person[] = [
    { id: "r1", name: t.productionDemoReviewer1 },
    { id: "r2", name: t.productionDemoReviewer2 },
  ]
  const toggleMe = () =>
    setMarked((list) =>
      list.includes(DEMO_ME) ? list.filter((id) => id !== DEMO_ME) : [...list, DEMO_ME],
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-foreground/[0.07] px-3 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <WorkplaceModeSwitch />
          <span className="rounded-md border border-foreground/10 px-2 py-0.5 text-[11px] font-medium text-ws-4">
            {t.productionInDevelopment}
          </span>
        </div>
        <button
          type="button"
          disabled
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] bg-ws-action px-3 text-[13px] font-medium text-white opacity-50"
        >
          <Plus className="h-4 w-4" />
          {t.productionNewRun}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <RunsColumn />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SchemeStrip />
          <StageHeader
            role={role}
            status={status}
            executors={executors}
            reviewers={reviewers}
            marked={marked}
            me={role === "executor" ? DEMO_ME : undefined}
            onToggleMe={toggleMe}
            onApprove={() => setStatus("approved")}
          />
          <FilesPanel />
          <ChatPane />
        </main>
      </div>
    </div>
  )
}

/** Ролики и мои этапы в каждом — как список чатов в мессенджере. */
function RunsColumn() {
  const { t } = useI18n()

  return (
    <aside className="flex shrink-0 flex-col border-b border-foreground/[0.07] lg:w-[300px] lg:border-b-0 lg:border-r">
      <div className="flex h-11 shrink-0 items-center justify-between px-4">
        <span className="text-[12px] font-semibold uppercase tracking-[1.2px] text-ws-3">
          {t.productionRuns}
        </span>
        <button
          type="button"
          disabled
          title={t.archiveTab}
          aria-label={t.archiveTab}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ws-4 opacity-60"
        >
          <Archive className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
        <Clapperboard className="h-8 w-8 text-ws-5" />
        <p className="text-[14px] font-medium text-ws-2">{t.productionRunsEmpty}</p>
        <p className="text-[12.5px] leading-relaxed text-ws-4">{t.productionRunsEmptyHint}</p>
      </div>

      {/* Пайплайны — отдельным списком внизу колонки: их видят только те, кто
          настраивает и запускает (§9.2), и остальным он не мешает. */}
      <div className="shrink-0 border-t border-foreground/[0.07] p-3">
        <div className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13.5px] text-ws-3 opacity-60">
          <Workflow className="h-[18px] w-[18px]" />
          <span className="flex-1">{t.productionPipelines}</span>
        </div>
      </div>
    </aside>
  )
}

// ─── Схема ролика ─────────────────────────────────────────────────────────

type SchemeNode = { id: string; x: number; y: number; done: boolean }

/**
 * Демонстрационная схема — ровно та, что на эскизе: развилка на две ветки,
 * слияние, развилка на три, слияние и хвост. Координаты в «клетках»: x —
 * колонка, y — ряд. Настоящую раскладку даст dagre по графу версии пайплайна.
 */
const DEMO_NODES: SchemeNode[] = [
  { id: "a", x: 0, y: 1, done: true },
  { id: "b", x: 1, y: 1, done: true },
  { id: "c1", x: 2, y: 0.5, done: true },
  { id: "c2", x: 2, y: 1.5, done: true },
  { id: "d1", x: 3, y: 0.5, done: true },
  { id: "d2", x: 3, y: 1.5, done: false },
  { id: "e", x: 4, y: 1, done: false },
  { id: "f1", x: 5, y: 0, done: false },
  { id: "f2", x: 5, y: 1, done: false },
  { id: "f3", x: 5, y: 2, done: false },
  { id: "g", x: 6, y: 1, done: false },
  { id: "h", x: 7, y: 1, done: false },
  { id: "i", x: 8, y: 1, done: false },
]
const DEMO_EDGES: [string, string][] = [
  ["a", "b"],
  ["b", "c1"],
  ["b", "c2"],
  ["c1", "d1"],
  ["c2", "d2"],
  ["d1", "e"],
  ["d2", "e"],
  ["e", "f1"],
  ["e", "f2"],
  ["e", "f3"],
  ["f1", "g"],
  ["f2", "g"],
  ["f3", "g"],
  ["g", "h"],
  ["h", "i"],
]

const ROW = 16
const RADIUS = 6.5
const PAD = 12
/** Радиус скругления на повороте линии. */
const TURN = 6

/**
 * Линия между этапами — горизонталь, вертикаль и снова горизонталь, со
 * скруглёнными поворотами, как на эскизе. Вертикаль посередине между
 * кружками: у развилки ветки расходятся сразу за этапом, у слияния сходятся
 * перед ним, и общий вертикальный отрезок читается как скобка.
 */
function edgePath(ax: number, ay: number, bx: number, by: number): string {
  if (Math.abs(ay - by) < 0.5) return `M ${ax} ${ay} H ${bx}`
  const xv = (ax + bx) / 2
  const dir = by > ay ? 1 : -1
  const r = Math.min(TURN, Math.abs(by - ay) / 2, (bx - ax) / 4)
  return [
    `M ${ax} ${ay}`,
    `H ${xv - r}`,
    `Q ${xv} ${ay} ${xv} ${ay + dir * r}`,
    `V ${by - dir * r}`,
    `Q ${xv} ${by} ${xv + r} ${by}`,
    `H ${bx}`,
  ].join(" ")
}

/**
 * Схема всего ролика: кружок на этап, зелёный с галочкой — принят. Без подписей:
 * название этапа — в подсказке при наведении. Растянута на всю ширину полосы —
 * шаг между колонками считается от её ширины. Сворачивается: она нужна, чтобы
 * глянуть, где производство, а не держать её перед глазами всё время.
 */
function SchemeStrip() {
  const { t } = useI18n()
  const [open, setOpen] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [open])

  const byId = new Map(DEMO_NODES.map((node) => [node.id, node]))
  const cols = Math.max(...DEMO_NODES.map((n) => n.x))
  const rows = Math.max(...DEMO_NODES.map((n) => n.y))
  const height = rows * ROW + PAD * 2
  const step = cols > 0 ? Math.max(0, width - PAD * 2) / cols : 0
  const px = (node: SchemeNode) => ({ x: PAD + node.x * step, y: PAD + node.y * ROW })

  return (
    <section className="flex shrink-0 items-center gap-2 border-b border-foreground/[0.07] px-3 py-1.5 md:px-6">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={open ? t.productionSchemeHide : t.productionSchemeShow}
        aria-label={open ? t.productionSchemeHide : t.productionSchemeShow}
        aria-expanded={open}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ws-4 hover:bg-ws-hover hover:text-ws-1"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open ? (
        <div ref={box} className="min-w-0 flex-1">
          {width > 0 ? (
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              className="block overflow-visible"
              role="img"
              aria-label={t.productionScheme}
            >
              {DEMO_EDGES.map(([from, to]) => {
                const a = px(byId.get(from)!)
                const b = px(byId.get(to)!)
                return (
                  <path
                    key={`${from}-${to}`}
                    d={edgePath(a.x, a.y, b.x, b.y)}
                    fill="none"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    className={
                      byId.get(to)!.done ? "stroke-success/70" : "stroke-foreground/20"
                    }
                  />
                )
              })}
              {DEMO_NODES.map((node, index) => {
                const { x, y } = px(node)
                return (
                  <g key={node.id}>
                    <title>{t.productionSchemeStage.replace("{n}", String(index + 1))}</title>
                    <circle
                      cx={x}
                      cy={y}
                      r={RADIUS}
                      strokeWidth={1.5}
                      className={
                        node.done
                          ? "fill-success stroke-success"
                          : "fill-background stroke-foreground/35"
                      }
                    />
                    {node.done ? (
                      <path
                        d={`M ${x - 3} ${y} L ${x - 0.8} ${y + 2.3} L ${x + 3.2} ${y - 2.4}`}
                        fill="none"
                        strokeWidth={1.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="stroke-background"
                      />
                    ) : null}
                  </g>
                )
              })}
            </svg>
          ) : (
            <div style={{ height }} />
          )}
        </div>
      ) : (
        <span className="text-[12px] text-ws-4">{t.productionScheme}</span>
      )}
    </section>
  )
}

// ─── Этап: люди и «Принято» ───────────────────────────────────────────────

/**
 * Шапка этапа: название, люди и одна кнопка — docs/PRODUCTION_PLAN.md §4.1,
 * решение 2026-09-29. «Взять», «Отказаться», «На проверку» и «На доработку»
 * убраны: варианты присылают в чат, замечания пишут там же. Остаётся приёмка —
 * справа от проверяющих, потому что это их кнопка. У остальных она видна, но
 * погашена: так понятно, чего этап ждёт.
 */
function StageHeader({
  role,
  status,
  executors,
  reviewers,
  marked,
  me,
  onToggleMe,
  onApprove,
}: {
  role: ViewerRole
  status: StageStatus
  executors: Person[]
  reviewers: Person[]
  marked: string[]
  /** Смотрящий — исполнитель этого этапа: может отметить себя. */
  me?: string
  onToggleMe: () => void
  onApprove: () => void
}) {
  const { t } = useI18n()
  const approved = status === "approved"
  const canApprove = role === "reviewer" && !approved

  return (
    <section className="shrink-0 border-b border-foreground/[0.07] px-3 py-3 md:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-[17px] font-semibold text-ws-1">{t.productionDemoStage}</h2>
        <PeopleSelect
          label={t.productionExecutors}
          people={executors}
          marked={marked}
          me={approved ? undefined : me}
          onToggleMe={onToggleMe}
        />
        <div className="flex items-center gap-2">
          <PeopleSelect label={t.productionReviewers} people={reviewers} />
          <button
            type="button"
            disabled={!canApprove}
            onClick={onApprove}
            title={canApprove || approved ? undefined : t.productionApproveHint}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-medium transition-colors",
              approved
                ? "border border-success/30 bg-success/15 text-success"
                : canApprove
                  ? "bg-success text-background hover:bg-success/90"
                  : "border border-foreground/10 bg-ws-control text-ws-4",
              "disabled:cursor-default",
            )}
          >
            {approved ? <Check className="h-3.5 w-3.5" /> : null}
            {t.productionApprove}
          </button>
        </div>
      </div>
    </section>
  )
}

/**
 * Выпадающий список людей этапа. Отмеченные исполнители — первыми и с голубым
 * фоном; первый из них стоит на кнопке списка. Исполнитель отмечает себя сам,
 * выбрав своё имя: отметка и есть «я делаю этот этап», по ней он попадает в
 * отчёты. Отметиться могут несколько — этап иногда делают вдвоём. Добавить
 * человека можно из своей компании или контактов (§6.1) — пока неактивно.
 */
function PeopleSelect({
  label,
  people,
  marked = [],
  me,
  onToggleMe,
}: {
  label: string
  people: Person[]
  marked?: string[]
  me?: string
  onToggleMe?: () => void
}) {
  const { t } = useI18n()
  const isMarked = (id: string) => marked.includes(id)
  const ordered = [...people].sort(
    (a, b) => Number(isMarked(b.id)) - Number(isMarked(a.id)),
  )
  const head = ordered[0]
  const rest = ordered.length - 1

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-7 items-center gap-1.5 rounded-[8px] border border-foreground/10 bg-ws-control px-2.5 text-[12.5px] text-ws-2 hover:bg-ws-hover"
        >
          <span className="text-ws-4">{label}:</span>
          <span className={cn("rounded px-1", head && isMarked(head.id) && "bg-info/15 text-info")}>
            {head ? head.name : "—"}
          </span>
          {rest > 0 ? <span className="text-ws-4">+{rest}</span> : null}
          <ChevronDown className="h-3.5 w-3.5 text-ws-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        {ordered.map((person) => {
          const mine = person.id === me
          return (
            <DropdownMenuItem
              key={person.id}
              // Кликается только своя строка: отметить можно себя, но не другого.
              disabled={!mine && !isMarked(person.id)}
              onSelect={(event) => {
                if (!mine) return event.preventDefault()
                onToggleMe?.()
              }}
              title={mine ? (isMarked(person.id) ? t.productionUnmarkSelf : t.productionMarkSelf) : undefined}
              className={cn(
                "data-[disabled]:opacity-100",
                isMarked(person.id) && "bg-info/15 text-info focus:bg-info/20",
              )}
            >
              <span className="flex-1">
                {person.name}
                {mine ? <span className="ml-1 text-ws-4">({t.productionYou})</span> : null}
              </span>
              {isMarked(person.id) ? (
                <span className="text-[11px]">{t.productionMarkedMark}</span>
              ) : mine ? (
                <span className="text-[11px] text-ws-4">{t.productionMarkSelf}</span>
              ) : null}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <UserPlus className="mr-2 h-4 w-4" />
          {t.productionAddPerson}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Файлы ────────────────────────────────────────────────────────────────

type FolderTab = "in" | "versions" | "final"

/**
 * Файлы этапа ролика: исходники, версии и принятое (§2.3). Рабочая папка OUT
 * здесь не показывается. Все три папки — только чтение: IN и FINAL наполняет
 * сайт, «Версии» — чат (файлы из сообщений). Отдельной заливки нет, чтобы у
 * варианта было одно место появления и обсуждение шло рядом с ним.
 * Панель сворачивается до строки заголовка и тянется по высоте за нижний край.
 */
function FilesPanel() {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<FolderTab>("versions")
  const height = useDragSize({
    initial: 150,
    min: 64,
    max: 520,
    axis: "y",
    storageKey: "ffworks-production-files-height",
  })

  const tabs: { id: FolderTab; label: string; locked: boolean }[] = [
    { id: "in", label: "IN", locked: true },
    { id: "versions", label: t.productionVersions, locked: false },
    { id: "final", label: "FINAL", locked: true },
  ]

  return (
    <section className="relative shrink-0 border-b border-foreground/[0.07]">
      <div className="flex h-10 items-center gap-2 px-3 md:px-6">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? t.productionFilesExpand : t.productionFilesCollapse}
          aria-label={collapsed ? t.productionFilesExpand : t.productionFilesCollapse}
          aria-expanded={!collapsed}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ws-4 hover:bg-ws-hover hover:text-ws-1"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <span className="text-[12px] font-semibold uppercase tracking-[1.2px] text-ws-3">
          {t.productionFiles}
        </span>
        <div className="ml-2 flex gap-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTab(item.id)
                setCollapsed(false)
              }}
              title={item.locked ? t.productionFolderLocked : undefined}
              className={cn(
                "flex h-6 items-center gap-1 rounded-md border px-2 text-[12px] transition-colors",
                tab === item.id && !collapsed
                  ? "border-foreground/15 bg-ws-select/35 text-ws-1"
                  : "border-foreground/10 text-ws-4 hover:text-ws-1",
              )}
            >
              {item.locked ? <Lock className="h-3 w-3" /> : null}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {collapsed ? null : (
        <>
          <div
            style={{ height: height.size }}
            className="scrollbar-elegant overflow-y-auto px-3 pb-3 md:px-6"
          >
            {tab === "in" ? <FolderEmpty text={t.productionInEmpty} /> : null}
            {tab === "final" ? <FolderEmpty text={t.productionFinalEmpty} /> : null}
            {tab === "versions" ? <VersionsDemo /> : null}
          </div>
          <ResizeGrip
            orientation="horizontal"
            side="bottom"
            label={t.productionFilesResize}
            dragging={height.dragging}
            onPointerDown={height.onPointerDown}
            onKeyDown={height.onKeyDown}
          />
        </>
      )}
    </section>
  )
}

/**
 * Версии этапа. Номер пока просто порядковый — как указывать версию (номер,
 * подпись, выбор файлов из сообщения), ещё решаем (PRODUCTION_PLAN §4.1).
 */
function VersionsDemo() {
  const { t } = useI18n()
  const rows = ["v1", "v2"]

  return (
    <div className="space-y-2">
      {rows.map((version) => (
        <div
          key={version}
          className="flex items-center gap-3 rounded-lg border border-foreground/10 px-3 py-2 text-[13px]"
        >
          <span className="font-semibold text-ws-1">{version}</span>
          <span className="flex-1 text-ws-4">{t.productionVersionFromChat}</span>
        </div>
      ))}
      <p className="flex items-center gap-2 px-1 pt-1 text-[12px] text-ws-4">
        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
        {t.productionVersionsFromChat}
      </p>
    </div>
  )
}

function FolderEmpty({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-[40px] items-center justify-center text-[12.5px] text-ws-4">
      {text}
    </div>
  )
}

// ─── Чат ──────────────────────────────────────────────────────────────────

/** Чат этапа: своя переписка у этапа каждого ролика, без YouGile (§7). */
function ChatPane() {
  const { t } = useI18n()

  return (
    <section className="flex min-h-[200px] flex-1 flex-col p-3 md:px-6">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-foreground/15 px-4 text-center">
        <MessageSquare className="h-5 w-5 text-ws-5" />
        <p className="text-[13.5px] font-medium text-ws-3">{t.productionChat}</p>
        <p className="max-w-md text-[12px] leading-relaxed text-ws-4">{t.productionChatHint}</p>
      </div>
      <div className="mt-3 flex shrink-0 items-center gap-2 rounded-[10px] border border-foreground/10 bg-ws-control px-3 py-2 opacity-60">
        {/* Скрепка — единственная дорога файла в «Версии». */}
        <Paperclip className="h-4 w-4 text-ws-4" aria-label={t.productionAttach} />
        <span className="flex-1 text-[13.5px] text-ws-4">{t.productionChatInput}</span>
        <SendHorizontal className="h-4 w-4 text-ws-4" />
      </div>
    </section>
  )
}
