"use client"

import { useState } from "react"
import type { NodeProps } from "@xyflow/react"
import { Bot, ChevronDown, Download, File, Folder, Loader2, Minus, Plus, X } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/account/i18n"
import { toolText } from "@/components/account/tools/registry-ui"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  createFormRow,
  FOLDER_ROW_TYPE,
  isFolderFormRow,
  type FormRow,
  type PipelineNode,
  type WorkData,
  type WorkNode,
} from "@/lib/production/graph"
import { TOOLS } from "@/lib/tools/registry"
import { cn } from "@/lib/utils"
import { useEditor } from "./editor-context"
import { DaysInput, Divider, FieldLabel, NodeFrame, PathInput, ProjectPicker, RowLabelInput } from "./node-parts"
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
          <textarea
            value={d.description}
            disabled={readOnly}
            onChange={(event) => set({ description: event.target.value })}
            rows={4}
            className="nodrag nowheel w-full resize-y rounded-md border border-foreground/10 bg-ws-control px-2 py-1.5 text-[12.5px] text-ws-1 outline-none disabled:opacity-60"
          />
        </div>
      </div>
    </NodeFrame>
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
              <PeoplePicker label={t.productionReviewers} value={d.reviewers} onChange={(reviewers) => set({ reviewers })} />
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

function AutoApproveToggle({ node }: { node: Extract<WorkNode, { kind: "auto" }> }) {
  const { t } = useI18n()
  const { readOnly } = useEditor()
  const set = useWork(node.id)
  return (
    <label className="nodrag flex items-center gap-1.5 text-[11.5px] text-ws-3">
      <input
        type="checkbox"
        disabled={readOnly}
        checked={node.data.autoApprove}
        onChange={(event) => set<"auto">({ autoApprove: event.target.checked })}
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
function TypesPicker({ value, options, onChange }: { value: string[]; options: string[]; onChange: (types: string[]) => void }) {
  const { t } = useI18n()
  const { readOnly } = useEditor()
  // Тип из формы программы, которого нет в словаре установки, тоже показываем.
  const all = [...options, ...value.filter((type) => !options.includes(type))]
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        disabled={readOnly}
        title={t.productionEdRowType}
        className={cn(selectClass, "flex max-w-[45%] items-center gap-1")}
      >
        <span className="truncate">{value.join(" / ")}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-ws-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        {all.map((type) => {
          const checked = value.includes(type)
          return (
            <DropdownMenuCheckboxItem
              key={type}
              checked={checked}
              disabled={checked && value.length === 1}
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

/** Действие (§3.0): без людей и без чата. Пока одно — скопировать вход. */
export function ActionNodeView({ data }: Props) {
  const { t } = useI18n()
  const { readOnly } = useEditor()
  const node = data.node
  const set = useWork(node.id)
  if (node.kind !== "action") return null
  return (
    <NodeFrame id={node.id} kind="action" kindLabel={t.productionEdKindAction} name={node.data.name} removable onRename={(name) => set({ name })}>
      <WorkTop node={node} executors={null} />
      <Bottom>
        <label className="nodrag flex items-center gap-2 text-[12px] text-ws-3">
          {t.productionEdAction}
          <select disabled={readOnly} value={node.data.action} className={cn(selectClass, "flex-1")} onChange={() => {}}>
            <option value="copy">{t.productionEdActionCopy}</option>
          </select>
        </label>
        <p className="text-[11px] text-ws-5">{t.productionEdActionHint}</p>
      </Bottom>
    </NodeFrame>
  )
}
