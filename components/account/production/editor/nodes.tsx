"use client"

import { useEffect, useState } from "react"
import { useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Bot, ChevronDown, Download, File, Folder, Loader2, Minus, Plus, X } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/account/i18n"
import { toolText } from "@/components/account/tools/registry-ui"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  createFormRow,
  createSplitOutput,
  DEFAULT_FINAL_PATH,
  DEFAULT_PROJECT,
  DEFAULT_REST_FOLDER,
  FOLDER_ROW_TYPE,
  isFolderFormRow,
  type FormRow,
  type PipelineNode,
  type SplitOutput,
  type WorkData,
  type WorkNode,
} from "@/lib/production/graph"
import { TOOLS } from "@/lib/tools/registry"
import { cn } from "@/lib/utils"
import { useEditor } from "./editor-context"
import {
  ChipsInput,
  DaysInput,
  Divider,
  FieldLabel,
  NodeFrame,
  OutHandle,
  PathInput,
  ProjectPicker,
  RowLabelInput,
  SuggestInput,
  useDraft,
  type Option,
} from "./node-parts"
import { PeoplePicker } from "./people-picker"

/** Данные xyflow-ноды: сама нода графа. Позицию и ширину xyflow держит сам. */
export type FlowData = { node: PipelineNode }

type Props = NodeProps & { data: FlowData }

const selectClass =
  "nodrag h-7 rounded-md border border-foreground/10 bg-ws-control px-1.5 text-[12px] text-ws-1 outline-none disabled:opacity-60"

/**
 * Старт (§3.0): кто запускает ролики, кто правит пайплайн, сроки хранения и
 * описание — подсказка тому, кто запускает ролик. Связей у него нет.
 */
export function StartNodeView({ data }: Props) {
  const { t } = useI18n()
  const { updateNode, readOnly } = useEditor()
  const node = data.node
  if (node.kind !== "start") return null
  const d = node.data
  const set = (patch: Partial<typeof d>) =>
    updateNode(node.id, (n) => (n.kind === "start" ? { ...n, data: { ...n.data, ...patch } } : n))

  return (
    <NodeFrame
      id={node.id}
      kind="start"
      kindLabel={t.productionEdKindStart}
      name={d.name}
      removable={false}
      input={false}
      output={false}
      onRename={(name) => set({ name })}
    >
      <div className="space-y-3 px-3 py-2.5">
        <div className="flex gap-3">
          <PeoplePicker label={t.productionEdLaunchers} value={d.launchers} onChange={(launchers) => set({ launchers })} />
          <PeoplePicker label={t.productionEdEditors} value={d.editors} onChange={(editors) => set({ editors })} />
        </div>
        <Divider />
        <DaysInput
          label={t.productionEdKeepVariants}
          value={d.retention.variantsDays}
          onChange={(variantsDays) => set({ retention: { ...d.retention, variantsDays } })}
        />
        <DaysInput
          label={t.productionEdKeepFinals}
          value={d.retention.finalsDays}
          onChange={(finalsDays) => set({ retention: { ...d.retention, finalsDays } })}
        />
        <Divider />
        <div className="space-y-1">
          <FieldLabel>{t.productionEdDescription}</FieldLabel>
          <DescriptionInput value={d.description} disabled={readOnly} onChange={(description) => set({ description })} />
        </div>
      </div>
    </NodeFrame>
  )
}

function DescriptionInput(props: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const [value, setValue] = useDraft(props.value, props.onChange)
  return (
    <textarea
      value={value}
      disabled={props.disabled}
      onChange={(event) => setValue(event.target.value)}
      rows={4}
      className="nodrag nowheel w-full resize-y rounded-md border border-foreground/10 bg-ws-control px-2 py-1.5 text-[12.5px] text-ws-1 outline-none disabled:opacity-60"
    />
  )
}

/** Правка данных этапа любого типа. */
function useWork(id: string) {
  const { updateNode } = useEditor()
  return <K extends WorkNode["kind"]>(patch: Partial<Extract<WorkNode, { kind: K }>["data"]>) =>
    updateNode(id, (n) => (n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as PipelineNode) : n))
}

/**
 * Верх этапа: люди, разделитель, затем папки — каждая своей строкой: основная
 * папка-проект, внутри неё входная, версии и Final.
 */
function WorkTop({ node, executors }: { node: WorkNode; executors: React.ReactNode }) {
  const { t } = useI18n()
  const set = useWork(node.id)
  const d: WorkData = node.data
  const action = node.kind === "action"

  return (
    <div className="space-y-2.5 px-3 py-2.5">
      {action ? null : (
        <>
          <div className="flex gap-3">
            {executors}
            <div className="min-w-0 flex-1 space-y-1">
              <PeoplePicker
                label={t.productionReviewers}
                value={d.reviewers}
                // Проверяющий — люди или автоматика: выбрали человека — автоприёмка снимается.
                onChange={(reviewers) =>
                  set(node.kind === "auto" && reviewers.length > 0 ? { reviewers, autoApprove: false } : { reviewers })
                }
              />
              {node.kind === "auto" ? <AutoApproveToggle node={node} /> : null}
            </div>
          </div>
          <Divider />
        </>
      )}
      <div className="space-y-1">
        <FieldLabel>{t.productionEdProject}</FieldLabel>
        <ProjectPicker value={d.project} onChange={(project) => set({ project })} />
      </div>
      {action ? null : (
        <div className="space-y-1">
          <FieldLabel>{t.productionEdInPath}</FieldLabel>
          <PathInput
            value={d.paths.in}
            scope="input"
            historyKey="in"
            placeholder={t.productionEdInByLink}
            onChange={(value) => set({ paths: { ...d.paths, in: value } })}
          />
        </div>
      )}
      {action ? null : (
        <div className="space-y-1">
          <FieldLabel>{t.productionEdWorkPath}</FieldLabel>
          <PathInput value={d.paths.work} historyKey="work" onChange={(work) => set({ paths: { ...d.paths, work } })} />
        </div>
      )}
      <div className="space-y-1">
        <FieldLabel>{t.productionEdFinalPath}</FieldLabel>
        <PathInput value={d.paths.final} historyKey="final" onChange={(final) => set({ paths: { ...d.paths, final } })} />
      </div>
    </div>
  )
}

function Executors({ node }: { node: WorkNode }) {
  const { t } = useI18n()
  const set = useWork(node.id)
  return <PeoplePicker label={t.productionExecutors} value={node.data.executors} onChange={(executors) => set({ executors })} />
}

/** Исполнитель автоматики — машина, выбирать некого. */
function MachineExecutor() {
  const { t } = useI18n()
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <FieldLabel>{t.productionExecutors}</FieldLabel>
      <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[11.5px] text-warning">
        <Bot className="h-3 w-3" />
        {t.productionEdAutomation}
      </span>
    </div>
  )
}

/**
 * Проверяющий «автоматика»: этап принимается сам. Взаимоисключающе с людьми —
 * галка снимает проверяющих. Последнему этапу нельзя: упади он — сказать
 * некому, и ролик не сдастся; его завершает человек.
 */
function AutoApproveToggle({ node }: { node: Extract<WorkNode, { kind: "auto" }> }) {
  const { t } = useI18n()
  const { readOnly, hasNext } = useEditor()
  const set = useWork(node.id)
  const last = !hasNext(node.id)
  // Снять уже стоящую галку можно всегда, поставить последнему — нет.
  const blocked = last && !node.data.autoApprove
  return (
    <label
      title={last ? t.productionEdAutoLastHint : undefined}
      className={cn("nodrag flex items-center gap-1.5 text-[11.5px] text-ws-3", blocked && "opacity-50")}
    >
      <input
        type="checkbox"
        disabled={readOnly || blocked}
        checked={node.data.autoApprove}
        onChange={(event) =>
          set<"auto">(event.target.checked ? { autoApprove: true, reviewers: [] } : { autoApprove: false })
        }
      />
      {t.productionEdAutomation}
    </label>
  )
}

/** Низ ноды — настройки типа (эскиз). */
function Bottom({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2 rounded-b-xl border-t border-foreground/10 bg-ws-well px-3 py-2.5">{children}</div>
}

/**
 * Инструмент (§3.0). Выбор инструмента вставляет его название в шапку — чтобы
 * было видно, что это за этап; дальше название от инструмента не зависит.
 */
export function ToolNodeView({ data }: Props) {
  const { t } = useI18n()
  const { readOnly, toolKeys, nameStage } = useEditor()
  const node = data.node
  const set = useWork(node.id)
  if (node.kind !== "tool") return null
  return (
    <NodeFrame id={node.id} kind="tool" kindLabel={t.productionEdKindTool} name={node.data.name} removable onRename={(name) => set({ name })}>
      <WorkTop node={node} executors={<Executors node={node} />} />
      <Bottom>
        <label className="nodrag flex items-center gap-2 text-[12px] text-ws-3">
          {t.productionEdTool}
          <select
            disabled={readOnly}
            value={node.data.tool?.key ?? ""}
            onChange={(event) => {
              const key = event.target.value
              set<"tool">({ tool: key ? { key, preset: {} } : null })
              if (key) nameStage(node.id, t[toolText(key).name])
            }}
            className={cn(selectClass, "flex-1")}
          >
            <option value="">{t.productionEdNoTool}</option>
            {/* Только доступные; уже выбранный, но погашенный — остаётся, иначе
                список молча показал бы «без инструмента». */}
            {TOOLS.filter(
              (tool) =>
                tool.status === "ready" &&
                (toolKeys.includes(tool.key) || tool.key === node.data.tool?.key),
            ).map((tool) => (
              <option key={tool.key} value={tool.key}>
                {t[toolText(tool.key).name]}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-ws-5">{node.data.tool ? t.productionEdPresetSoon : t.productionEdToolHint}</p>
      </Bottom>
    </NodeFrame>
  )
}

/** `>=` ⇄ `=` — кнопка, а не список: значений два (`OpToggle` программы). */
function OpToggle({ value, onChange }: { value: FormRow["op"]; onChange: (op: FormRow["op"]) => void }) {
  const { t } = useI18n()
  const { readOnly } = useEditor()
  return (
    <button
      type="button"
      disabled={readOnly}
      onClick={() => onChange(value === ">=" ? "=" : ">=")}
      title={value === ">=" ? t.productionEdOpGte : t.productionEdOpEq}
      className="nodrag h-7 w-9 shrink-0 rounded-md border border-foreground/10 bg-ws-control text-[13px] font-semibold text-ws-1 hover:bg-ws-hover disabled:opacity-60"
    >
      {value === ">=" ? "≥" : "="}
    </button>
  )
}

/**
 * Типы файла строки — галками: подходит файл любого из отмеченных («видео или
 * картинка»). Последнюю галку не снять: строка без типа ничего не примет.
 */
function TypesPicker({
  value,
  options,
  onChange,
  emptyLabel,
  wide,
}: {
  value: string[]
  options: string[]
  onChange: (types: string[]) => void
  /** Задан — галки можно снять все, пустой список подписан им («любой тип»). */
  emptyLabel?: string
  /** Во всю ширину ячейки, а не узким списком у края строки. */
  wide?: boolean
}) {
  const { t } = useI18n()
  const { readOnly } = useEditor()
  // Тип из формы программы, которого нет в словаре установки, тоже показываем.
  const all = [...options, ...value.filter((type) => !options.includes(type))]
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        disabled={readOnly}
        title={t.productionEdRowType}
        className={cn(
          selectClass,
          "flex max-w-[45%] items-center gap-1",
          wide && "w-full max-w-none justify-between",
        )}
      >
        <span className={cn("truncate", value.length === 0 && "text-ws-4")}>{value.length === 0 ? emptyLabel : value.join(" / ")}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-ws-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        {emptyLabel === undefined ? null : (
          <>
            {/* Явный пункт «любой тип»: снимает все галки разом. */}
            <DropdownMenuCheckboxItem
              checked={value.length === 0}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => onChange([])}
            >
              {emptyLabel}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
          </>
        )}
        {all.map((type) => {
          const checked = value.includes(type)
          return (
            <DropdownMenuCheckboxItem
              key={type}
              checked={checked}
              disabled={checked && value.length === 1 && emptyLabel === undefined}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(on) => onChange(on ? [...value, type] : value.filter((v) => v !== type))}
            >
              {type}
            </DropdownMenuCheckboxItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Строки формы — дерево, как `FolderRequirementsProperty` программы: у строки
 * название (для чего поле; оно же префикс имени файла), тип, `≥`/`=` и число;
 * подпапка — такие же строки внутри.
 */
function FormRows({
  nodeId,
  rows,
  onChange,
  depth,
}: {
  nodeId: string
  rows: FormRow[]
  onChange: (rows: FormRow[]) => void
  depth: number
}) {
  const { t } = useI18n()
  const { readOnly, fileTypes } = useEditor()
  const setRow = (id: string, patch: Partial<FormRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const types = fileTypes.length > 0 ? fileTypes : ["video"]

  return (
    <div className={cn("space-y-1.5", depth > 0 && "border-l border-violet/30 pl-2.5")}>
      {rows.map((row) => {
        const folder = isFolderFormRow(row)
        return (
          <div key={row.id} className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-ws-4">{folder ? <Folder className="h-3.5 w-3.5" /> : <File className="h-3.5 w-3.5" />}</span>
              <RowLabelInput
                value={row.label}
                nodeId={nodeId}
                onChange={(label) => setRow(row.id, { label })}
                placeholder={folder ? t.productionEdRowFolderLabel : t.productionEdRowLabel}
                invalid={!row.label.trim()}
              />
              {folder ? null : (
                <TypesPicker value={row.types} options={types} onChange={(next) => setRow(row.id, { types: next })} />
              )}
              <OpToggle value={row.op} onChange={(op) => setRow(row.id, { op })} />
              <div className="nodrag flex h-7 shrink-0 items-center rounded-md border border-foreground/10 bg-ws-control">
                <button
                  type="button"
                  disabled={readOnly || row.count <= 1}
                  onClick={() => setRow(row.id, { count: row.count - 1 })}
                  className="flex h-full w-6 items-center justify-center text-ws-4 hover:text-ws-1 disabled:opacity-40"
                  aria-label="−"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="w-6 text-center text-[12px] tabular-nums text-ws-1">{row.count}</span>
                <button
                  type="button"
                  disabled={readOnly || row.count >= 999}
                  onClick={() => setRow(row.id, { count: row.count + 1 })}
                  className="flex h-full w-6 items-center justify-center text-ws-4 hover:text-ws-1 disabled:opacity-40"
                  aria-label="+"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              {readOnly ? null : (
                <button
                  type="button"
                  aria-label={t.productionEdRemoveRow}
                  title={t.productionEdRemoveRow}
                  onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                  className="nodrag flex h-6 w-6 shrink-0 items-center justify-center rounded text-ws-4 hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {folder ? (
              <div className="ml-5">
                <FormRows nodeId={nodeId} rows={row.children} depth={depth + 1} onChange={(children) => setRow(row.id, { children })} />
              </div>
            ) : null}
          </div>
        )
      })}
      {readOnly ? null : (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onChange([...rows, createFormRow(types[0])])}
            className="nodrag flex h-7 items-center gap-1 rounded-md border border-foreground/10 px-2 text-[12px] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.productionEdRowFile}
          </button>
          <button
            type="button"
            onClick={() => onChange([...rows, createFormRow(FOLDER_ROW_TYPE)])}
            className="nodrag flex h-7 items-center gap-1 rounded-md border border-foreground/10 px-2 text-[12px] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.productionEdRowFolder}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Форма (§3.0): минимальный набор файлов, который вводится в пайплайн. Папки —
 * только для структуры: собирается форма из файлов.
 */
/**
 * «Из программы» — взять строки формы, которую программа оставила в проекте
 * (`options/onSiteFolderCheckForm.json`, lib/production/program-forms.ts).
 * Список проектов грузится при открытии: он нужен редко, а запрос не бесплатный.
 */
function ProgramFormPicker({ hasRows, onPick }: { hasRows: boolean; onPick: (rows: FormRow[]) => void }) {
  const { t } = useI18n()
  const { pipelineId, readOnly } = useEditor()
  const [forms, setForms] = useState<{ projectId: string; projectName: string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  if (readOnly) return null
  const url = `/api/production/pipelines/${pipelineId}/program-forms`

  const load = async () => {
    const res = await fetch(url, { cache: "no-store" })
    const body = (await res.json().catch(() => ({}))) as { forms?: { projectId: string; projectName: string }[] }
    setForms(res.ok ? (body.forms ?? []) : [])
  }
  const pick = async (projectId: string) => {
    if (hasRows && !window.confirm(t.productionEdProgramFormReplace)) return
    setBusy(true)
    try {
      const res = await fetch(`${url}?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" })
      const body = (await res.json().catch(() => ({}))) as { rows?: FormRow[]; code?: string }
      if (!res.ok || !body.rows) {
        toast.error(body.code === "invalid" ? t.productionEdProgramFormInvalid : t.productionEdProgramFormFailed)
        return
      }
      onPick(body.rows)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu modal={false} onOpenChange={(open) => open && void load()}>
      <DropdownMenuTrigger
        disabled={busy}
        title={t.productionEdProgramFormHint}
        className="nodrag flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        {t.productionEdProgramForm}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        {forms === null ? (
          <div className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-ws-4">
            <Loader2 className="h-3 w-3 animate-spin" />
          </div>
        ) : forms.length === 0 ? (
          <div className="max-w-[260px] px-2 py-1.5 text-[12px] text-ws-4">{t.productionEdProgramFormNone}</div>
        ) : (
          forms.map((f) => (
            <DropdownMenuItem key={f.projectId} onSelect={() => void pick(f.projectId)}>
              <Folder className="h-3.5 w-3.5 text-ws-4" />
              {f.projectName}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function FormNodeView({ data }: Props) {
  const { t } = useI18n()
  const node = data.node
  const set = useWork(node.id)
  if (node.kind !== "form") return null
  return (
    <NodeFrame id={node.id} kind="form" kindLabel={t.productionEdKindForm} name={node.data.name} removable onRename={(name) => set({ name })}>
      <WorkTop node={node} executors={<Executors node={node} />} />
      <Bottom>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>{t.productionEdFormRows}</FieldLabel>
          <ProgramFormPicker hasRows={node.data.rows.length > 0} onPick={(rows) => set<"form">({ rows })} />
        </div>
        {node.data.rows.length === 0 ? <p className="text-[11.5px] text-ws-4">{t.productionEdFormEmpty}</p> : null}
        <FormRows nodeId={node.id} rows={node.data.rows} depth={0} onChange={(rows) => set<"form">({ rows })} />
      </Bottom>
    </NodeFrame>
  )
}

/**
 * Автоматика (§3.0): исполнитель — машина, вход копируется во входную папку
 * (по умолчанию `IN`), этап открывается сам. Проверяющий — люди или автоматика.
 */
export function AutoNodeView({ data }: Props) {
  const { t } = useI18n()
  const node = data.node
  const set = useWork(node.id)
  if (node.kind !== "auto") return null
  return (
    <NodeFrame id={node.id} kind="auto" kindLabel={t.productionEdKindAuto} name={node.data.name} removable onRename={(name) => set({ name })}>
      <WorkTop node={node} executors={<MachineExecutor />} />
      <Bottom>
        <p className="text-[11.5px] text-ws-4">{t.productionEdAutoHint}</p>
      </Bottom>
    </NodeFrame>
  )
}

/**
 * Действие (§3.0): другой тип — без людей и без чата, поэтому без общего верха
 * этапа. Сначала выбирают действие, от него зависят поля ниже. Пока одно —
 * скопировать вход; папка — та же, что у
 * остальных этапов (по умолчанию папка пайплайна), здесь задают только путь в ней.
 */
export function ActionNodeView({ data }: Props) {
  const { t } = useI18n()
  const { readOnly } = useEditor()
  const node = data.node
  const set = useWork(node.id)
  if (node.kind !== "action") return null
  const d = node.data
  return (
    <NodeFrame
      id={node.id}
      kind="action"
      kindLabel={t.productionEdKindAction}
      name={d.name}
      removable
      output={d.action !== "split"}
      onRename={(name) => set({ name })}
    >
      <div className="space-y-2.5 px-3 py-2.5">
        <select
          disabled={readOnly}
          value={d.action}
          aria-label={t.productionEdAction}
          className={cn(selectClass, "h-8 w-full text-[12.5px]")}
          onChange={(event) => {
            const action = event.target.value as typeof d.action
            if (action !== "split") return set<"action">({ action })
            // Путь копирования не виден в «Разделить» — он не должен молча
            // увести раскладку в чужую папку: стандартные папка и Final.
            set<"action">({
              action,
              project: { ...DEFAULT_PROJECT },
              paths: { ...d.paths, final: [...DEFAULT_FINAL_PATH] },
              outputs: d.outputs?.length ? d.outputs : [createSplitOutput()],
            })
          }}
        >
          <option value="copy">{t.productionEdActionCopy}</option>
          <option value="split">{t.productionEdActionSplit}</option>
        </select>
        {/* Свои настройки у каждого действия. «Разделить» раскладывает в Final
            по умолчанию — путь у него не правится. */}
        {d.action === "copy" ? (
          <div className="space-y-1">
            <div className="text-[12px] text-ws-3">{t.productionEdCopyTo}</div>
            <CopyPath node={node} />
          </div>
        ) : null}
      </div>
      {d.action === "split" ? <SplitOutputs node={node} /> : null}
      <Bottom>
        <p className="text-[11px] text-ws-5">{d.action === "split" ? t.productionEdSplitHint : t.productionEdActionHint}</p>
        {d.action === "copy" ? <p className="text-[11px] text-ws-5">{t.productionEdCopyLastHint}</p> : null}
      </Bottom>
    </NodeFrame>
  )
}

/**
 * Выходы «Разделить»: у каждого — карточка (папка, типы, «содержит»,
 * «не содержит» — подпись слева, поле справа) и свой хендлер справа. Внизу — «остальное» с основным выходом.
 */
function SplitOutputs({ node }: { node: Extract<WorkNode, { kind: "action" }> }) {
  const { t } = useI18n()
  const { readOnly, fileTypes, rowNames } = useEditor()
  const set = useWork(node.id)
  const updateInternals = useUpdateNodeInternals()
  const outputs = node.data.outputs ?? []
  const ids = outputs.map((o) => o.id).join(",")
  // Хендлеры появились или пропали — xyflow должен перемерить их места.
  useEffect(() => updateInternals(node.id), [ids, node.id, updateInternals])

  const setOutputs = (next: SplitOutput[]) => set<"action">({ outputs: next })
  const patch = (id: string, change: Partial<SplitOutput>) =>
    setOutputs(outputs.map((o) => (o.id === id ? { ...o, ...change } : o)))
  // Подсказки «содержит» — названия строк форм: они и есть префиксы имён файлов.
  const labels: Option[] = [...new Set(rowNames.map((r) => r.label.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value }))
  const folders = outputs.map((o) => o.folder.trim().toLowerCase())
  const rest = node.data.restFolder ?? DEFAULT_REST_FOLDER
  const badFolder = (folder: string) => {
    const f = folder.trim()
    const key = f.toLowerCase()
    const used = [...folders, rest.trim().toLowerCase()].filter((x) => x === key).length
    return !f || f.includes("/") || used > 1
  }

  return (
    <div className="border-t border-foreground/10">
      {outputs.map((output) => (
        // Карточка выхода во всю ширину ноды — хендлер встаёт на её правую границу.
        <div key={output.id} className="relative px-3 pt-2.5">
          <OutHandle id={output.id} />
          <div className="relative rounded-lg border border-foreground/10 p-2.5 pr-8">
            {readOnly ? null : (
              <button
                type="button"
                aria-label={t.productionEdSplitRemove}
                title={t.productionEdSplitRemove}
                onClick={() => setOutputs(outputs.filter((o) => o.id !== output.id))}
                className="nodrag absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded text-ws-4 hover:bg-ws-hover hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
              <span className="text-[12px] text-ws-3">{t.productionEdSplitFolder}</span>
              <SuggestInput
                value={output.folder}
                onChange={(folder) => patch(output.id, { folder })}
                options={[...output.types, ...output.contains].map((value) => ({ value }))}
                placeholder=""
                invalid={badFolder(output.folder)}
              />
              <span className="text-[12px] text-ws-3">{t.productionEdSplitTypes}</span>
              <TypesPicker
                value={output.types}
                options={fileTypes}
                emptyLabel={t.productionEdSplitAnyType}
                wide
                onChange={(types) => patch(output.id, { types })}
              />
              <span className="text-[12px] text-ws-3">{t.productionEdSplitContains}</span>
              <ChipsInput
                value={output.contains}
                onChange={(contains) => patch(output.id, { contains })}
                options={labels}
                placeholder=""
              />
              <span className="text-[12px] text-ws-3">{t.productionEdSplitExcludes}</span>
              <ChipsInput
                value={output.excludes}
                onChange={(excludes) => patch(output.id, { excludes })}
                options={labels}
                placeholder=""
              />
            </div>
          </div>
        </div>
      ))}
      {readOnly ? null : (
        <div className="px-3 py-2">
          <button
            type="button"
            onClick={() => setOutputs([...outputs, createSplitOutput()])}
            className="nodrag flex h-7 items-center gap-1 rounded-md border border-foreground/10 px-2 text-[12px] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.productionEdSplitAdd}
          </button>
        </div>
      )}
      <div className="relative flex items-center gap-2 border-t border-foreground/10 px-3 py-2.5">
        <OutHandle />
        <span className="shrink-0 text-[12px] text-ws-3">{t.productionEdSplitRest}</span>
        <SuggestInput
          value={rest}
          onChange={(restFolder) => set<"action">({ restFolder })}
          options={[]}
          placeholder={DEFAULT_REST_FOLDER}
          invalid={badFolder(rest)}
        />
      </div>
    </div>
  )
}

/**
 * Путь копирования одной строкой: первый сегмент — своя папка (проект или
 * `$pipelineName`), дальше — папки внутри. На каждом уровне подсказываются
 * уже существующие папки; если путь до уровня с маской — их не узнать.
 */
function CopyPath({ node }: { node: Extract<WorkNode, { kind: "action" }> }) {
  const { t } = useI18n()
  const { pipelineId, projects } = useEditor()
  const set = useWork(node.id)
  const d = node.data
  // Корневую папку сняли — путь пуст, пока не выберут новую; в данных до
  // этого остаётся прежняя (папка обязательна), она видна подсказкой в поле.
  const [cleared, setCleared] = useState(false)
  const value = cleared ? [] : [d.project.name, ...d.paths.final]
  const [folders, setFolders] = useState<{ key: string; names: string[] } | null>(null)

  const inside = d.paths.final
  const key = d.project.id && !inside.some((s) => s.includes("$")) ? `${d.project.id}:${inside.join("/")}` : null
  useEffect(() => {
    if (!key || !d.project.id) return
    let alive = true
    const params = new URLSearchParams({ projectId: d.project.id, path: inside.join("/") })
    fetch(`/api/production/pipelines/${pipelineId}/folders?${params}`)
      .then((r) => (r.ok ? r.json() : { folders: [] }))
      .then((body: { folders?: string[] }) => alive && setFolders({ key, names: body.folders ?? [] }))
      .catch(() => alive && setFolders({ key, names: [] }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pipelineId])

  const levelOptions: Option[] | null =
    value.length === 0
      ? [{ value: "$pipelineName", hint: t.productionMaskPipeline }, ...projects.map((p) => ({ value: p.name, id: p.id }))]
      : key && folders?.key === key
        ? folders.names.map((name) => ({ value: name, id: `folder:${name}` }))
        : null

  const onChange = (next: string[]) => {
    const [first, ...rest] = next
    const rootRemoved = !cleared && next.length === value.length - 1 && next.join("/") === d.paths.final.join("/")
    if (first === undefined || rootRemoved) {
      setCleared(true)
      return set({ paths: { ...d.paths, final: [] } })
    }
    setCleared(false)
    const project =
      first === d.project.name ? d.project : (() => {
        const found = projects.find((p) => p.name.toLowerCase() === first.toLowerCase())
        return found ? { id: found.id, name: found.name } : { id: null, name: first }
      })()
    set({ project, paths: { ...d.paths, final: rest } })
  }

  return (
    <PathInput
      value={value}
      onChange={onChange}
      firstScope="project"
      historyKey="copy"
      placeholder={cleared ? d.project.name : undefined}
      levelOptions={levelOptions}
    />
  )
}
