#!/usr/bin/env node
/**
 * Проверки чистой логики производства — `lib/production/graph.ts`, `masks.ts`
 * и `form.ts`.
 *
 *   npm run production:check
 *
 * Тестраннера в проекте нет. Ошибка здесь не падает исключением, а тихо
 * складывает два ролика в одну папку или пропускает граф, в котором этап ждёт
 * вход, который никогда не придёт, — поэтому проверки написаны отдельно.
 */

import {
  canConnect,
  createEmptyGraph,
  createFormRow,
  createWorkNode,
  hasErrors,
  lastStages,
  orderedStages,
  pipelineGraphSchema,
  structureSignature,
  upgradeGraph,
  validateGraph,
  type PipelineGraph,
} from "../lib/production/graph.ts"
import { formStatus } from "../lib/production/form.ts"
import {
  checkTemplate,
  isPerRun,
  resolveFileName,
  resolvePath,
  resolveRunName,
  suggestMasks,
  unknownMasks,
} from "../lib/production/masks.ts"

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  const ok = a === b
  if (!ok) fails += 1
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${ok ? "" : `: ${a}, ждали ${b}`}`)
}
const codes = (graph: PipelineGraph) => validateGraph(graph).map((i) => `${i.level}:${i.code}`)

// 30 сентября 2026, 14:05:09 по Москве (UTC+3) — сервер видит 11:05:09 UTC.
const ctx = {
  pipelineName: "Промо",
  runName: "Промо 12",
  runStartedAt: new Date(Date.UTC(2026, 8, 30, 11, 5, 9)),
  tzOffsetMin: -180,
  stageName: "Анимация",
  stageNum: 3,
  stageStartedAt: new Date(Date.UTC(2026, 9, 1, 7, 30, 0)),
  user: "Алексей",
}

console.log("маски (masks.ts)")
eq("путь по умолчанию", resolvePath(["$runTime-$runName", "$stageNum $stageName", "versions"], ctx), {
  ok: true,
  path: "09.30-14.05-Промо 12/03 Анимация/versions",
  segments: ["09.30-14.05-Промо 12", "03 Анимация", "versions"],
})
eq("время — по поясу запустившего", resolvePath(["$YYYY-$MM-$DD $HH.$mm.$ss"], ctx), {
  ok: true,
  path: "2026-09-30 14.05.09",
  segments: ["2026-09-30 14.05.09"],
})
eq("$stageTime — время открытия этапа", resolvePath(["$stageTime"], ctx), {
  ok: true,
  path: "10.01-10.30",
  segments: ["10.01-10.30"],
})
eq("$MM и $mm — разные маски", resolvePath(["$MM$mm"], ctx), { ok: true, path: "0905", segments: ["0905"] })
eq("слеш в названии не заводит папку", resolvePath(["$runName"], { ...ctx, runName: "Промо 12/13" }), {
  ok: true,
  path: "Промо 12-13",
  segments: ["Промо 12-13"],
})
eq("старые маски — неизвестные", unknownMasks("$pipeline/$run"), ["$pipeline", "$run"])
eq("опечатка — неизвестная маска", unknownMasks("$runName2"), ["$runName2"])
eq("маска с текстом за ней", unknownMasks("$runName_2"), [])
eq("$fileName — только в имени файла", unknownMasks("$fileName", "path"), ["$fileName"])
eq("$prevStageName — во входной папке можно", unknownMasks("IN/$prevStageName", "input"), [])
eq("$prevStageName — в рабочей нельзя", unknownMasks("$prevStageName", "path"), ["$prevStageName"])
eq("в имени папки-проекта — только пайплайн", unknownMasks("$pipelineName $runName", "project"), ["$runName"])
{
  const r = resolvePath(["$random", "x$random(3)"], ctx)
  eq("$random — 10 символов, $random(3) — 3", r.ok ? r.segments.map((s) => s.length) : null, [10, 4])
}
eq("$random(0) и $random(99) — ошибка", unknownMasks("$random(0)$random(99)"), ["$random(0)", "$random(99)"])
eq("скобки только у $random", unknownMasks("$runName(3)"), ["$runName(3)"])
eq("пустое значение — ошибка", resolvePath(["$runName"], { ...ctx, runName: "  " }), {
  ok: false,
  error: { code: "empty-value", segment: "$runName", mask: "$runName" },
})
eq("`..` не выводит наружу", resolvePath([".."], ctx).ok, false)
eq("проверка шаблона: пустой сегмент", checkTemplate(["a", " "]), { code: "empty-segment", index: 1 })
eq("подсказки по месту", suggestMasks("$st", "path").map((m) => m.token), ["$stageName", "$stageNum", "$stageTime"])
eq("в названии ролика нет $stageName", suggestMasks("$st", "run").length, 0)
eq("путь по роликам различается", [isPerRun(["IN"]), isPerRun(["$runTime", "x"])], [false, true])
eq("имя файла: расширение исходное", resolveFileName("$user-$fileName", ctx, "take 1.mp4"), "Алексей-take 1.mp4")
eq("имя файла: пустой шаблон — как есть", resolveFileName("", ctx, "a.wav"), "a.wav")
eq("название ролика по шаблону", resolveRunName("$pipelineName $MM.$DD", ctx), "Промо 09.30")

console.log("граф (graph.ts)")
const empty = createEmptyGraph({ start: "Старт" })
eq("пустой граф проходит схему", pipelineGraphSchema.safeParse(empty).success, true)
eq("без этапов — ошибка", codes(empty).includes("error:no-stages"), true)

const start = empty.nodes[0]
const form = createWorkNode("form", "Исходники")
const tool = createWorkNode("tool", "Монтаж")
const auto = createWorkNode("auto", "Рендер")
const action = createWorkNode("action", "Копия")
if (form.kind === "form") form.data.rows = [{ ...createFormRow("video"), label: "Ролик" }]
const g: PipelineGraph = {
  ...empty,
  nodes: [start, form, tool, auto, action],
  edges: [
    { id: "e2", source: form.id, target: tool.id },
    { id: "e3", source: form.id, target: auto.id },
    { id: "e4", source: tool.id, target: action.id },
    { id: "e5", source: auto.id, target: action.id },
  ],
}
eq("граф со всеми типами проходит схему", pipelineGraphSchema.safeParse(g).success, true)
eq("ошибок нет", hasErrors(validateGraph(g)), false)
eq("этап без входа — первый, не ошибка", codes(g).some((c) => c.startsWith("error")), false)
eq("номера этапов по порядку", orderedStages(g).map((n) => n.data.name), ["Исходники", "Монтаж", "Рендер", "Копия"])
eq("последние этапы — без исходящих связей", [...lastStages(g)], [action.id])
eq("автоматика по умолчанию копирует в IN", auto.kind === "auto" ? auto.data.paths.in : null, ["IN"])
eq("папка по умолчанию — имя $pipelineName, без проекта", form.data.project, { id: null, name: "$pipelineName" })

eq("в вход можно сколько угодно связей", canConnect(g, { source: form.id, target: action.id }), true)
eq("повтор связи нельзя", canConnect(g, { source: form.id, target: tool.id }), false)
eq("круг нельзя", canConnect(g, { source: action.id, target: form.id }), false)
eq("со «Стартом» связей нет", canConnect(g, { source: start.id, target: form.id }), false)
eq("связь со «Стартом» в графе — ошибка", codes({ ...g, edges: [...g.edges, { id: "x", source: start.id, target: form.id }] }).includes("error:bad-edge"), true)
eq(
  "папка без маски ролика — предупреждение",
  codes({
    ...g,
    nodes: g.nodes.map((n) => (n.id === tool.id && n.kind === "tool" ? { ...n, data: { ...n.data, paths: { ...n.data.paths, work: ["work"] } } } : n)),
  }).includes("warning:path-shared"),
  true,
)
eq(
  "строка формы без названия — ошибка",
  codes({ ...g, nodes: g.nodes.map((n) => (n.kind === "form" ? { ...n, data: { ...n.data, rows: [createFormRow("video")] } } : n)) }).includes("error:form-row-label"),
  true,
)
eq(
  "неизвестная маска в имени папки — ошибка",
  codes({
    ...g,
    nodes: g.nodes.map((n) => (n.id === tool.id && n.kind === "tool" ? { ...n, data: { ...n.data, project: { id: null, name: "$runName" } } } : n)),
  }).includes("error:bad-path"),
  true,
)
eq(
  "люди и ширина не меняют структуру",
  structureSignature(g) ===
    structureSignature({
      ...g,
      nodes: g.nodes.map((n) => (n.id === tool.id && n.kind === "tool" ? { ...n, width: 700, data: { ...n.data, executors: ["u1"] } } : n)),
    }),
  true,
)

console.log("старые схемы → 3 (upgradeGraph)")
const v1 = {
  schemaVersion: 1,
  nodes: [
    { id: "s", kind: "start", position: { x: 0, y: 0 }, data: { name: "Старт", launchers: ["u1"] } },
    {
      id: "a",
      kind: "stage",
      position: { x: 1, y: 0 },
      data: {
        name: "Анимация", inputs: ["in_1"], executors: ["u2"], reviewers: [], watchers: [],
        execution: "human", approval: "human",
        paths: { work: ["$pipeline", "$run", "$stage", "work"], final: ["$pipeline", "$run", "$stage", "final"] },
        copyInput: false, normHours: 4, tool: null,
      },
    },
    {
      id: "m",
      kind: "stage",
      position: { x: 2, y: 0 },
      data: {
        name: "Рендер", inputs: ["in_2"], executors: [], reviewers: [], watchers: [],
        execution: "machine", approval: "auto", paths: { work: ["$run"], final: ["$run", "out"] },
        copyInput: true, normHours: null, tool: null,
      },
    },
    { id: "f", kind: "final", position: { x: 3, y: 0 }, data: { name: "Финал", inputs: ["in_3"] } },
  ],
  edges: [
    { id: "e1", source: "s", target: "a", targetHandle: "in_1" },
    { id: "e2", source: "a", target: "m", targetHandle: "in_2" },
    { id: "e3", source: "m", target: "f", targetHandle: "in_3" },
  ],
}
const up = upgradeGraph(v1)
eq("схема 1: проходит схему", pipelineGraphSchema.safeParse(up).success, true)
eq("схема 1: человек → инструмент, машина → автоматика, «Финала» нет", up.nodes.map((n) => n.kind), ["start", "tool", "auto"])
eq("схема 1: маски — на новые имена", up.nodes[1].kind === "tool" ? up.nodes[1].data.paths.work : null, ["$pipelineName", "$runName", "$stageName", "work"])
eq("схема 1: связи со «Стартом» и «Финалом» сняты", up.edges.map((e) => `${e.source}>${e.target}`), ["a>m"])
const v2 = {
  schemaVersion: 2,
  nodes: [
    { id: "fm", kind: "form", position: { x: 0, y: 0 }, data: { name: "Ф", executors: [], reviewers: [], watchers: [], project: "$pipelineName", paths: { in: [], work: ["$runName", "w"], final: ["$runName", "f"] }, normHours: null, rows: [{ id: "r1", kind: "file", folder: "", name: "Титры", type: "text", op: "eq", count: 2 }, { id: "r2", kind: "folder", folder: "123", name: "", type: "any", op: "gte", count: 1 }] } },
  ],
  edges: [],
}
const up2 = upgradeGraph(v2)
eq("схема 2: проходит схему", pipelineGraphSchema.safeParse(up2).success, true)
eq("схема 2: папка — ссылка, строки — дерево", up2.nodes[0].kind === "form" ? [up2.nodes[0].data.project, up2.nodes[0].data.rows.map((r) => [r.label, r.types, r.op, r.count])] : null, [{ id: null, name: "$pipelineName" }, [["Титры", ["text"], "=", 2], ["123", ["folder"], ">=", 1]]])
eq("граф схемы 4 не трогается", upgradeGraph(g) === g, true)
const v3 = { schemaVersion: 3, nodes: [{ id: "fm", kind: "form", position: { x: 0, y: 0 }, data: { ...form.data, rows: [{ id: "r", label: "Сцена", type: "folder", op: ">=", count: 1, children: [{ id: "c", label: "Кадр", type: "image", op: "=", count: 2, children: [] }] }] } }], edges: [] }
const up3 = upgradeGraph(v3)
eq("схема 3: проходит схему", pipelineGraphSchema.safeParse(up3).success, true)
eq("схема 3: тип строки — список, и во вложенных", up3.nodes[0].kind === "form" ? [up3.nodes[0].data.rows[0].types, up3.nodes[0].data.rows[0].children[0].types] : null, [["folder"], ["image"]])

console.log("форма (form.ts)")
const rows = [
  { id: "t", label: "Титры", types: ["text"], op: "=" as const, count: 2, children: [] },
  { id: "s", label: "Сцена", types: ["folder"], op: ">=" as const, count: 1, children: [{ id: "v", label: "Видео", types: ["video", "image"], op: ">=" as const, count: 1, children: [] }] },
]
const work = "R/01 Форма/versions"
const f = (dir: string, name: string) => ({ name, folderPath: dir ? `${work}/${dir}` : work })
const partial = formStatus(rows, work, [f("", "01 Титры - a.srt"), f("01 Сцена", "01 Видео - clip.mp4")])
eq("не хватает второго титра", [partial.complete, partial.missing], [false, ["Титры"]])
const full = formStatus(rows, work, [f("", "01 Титры - a.srt"), f("", "02 Титры - b.srt"), f("01 Сцена", "01 Видео - clip.mp4")])
eq("всё на месте", full.complete, true)
eq("вместо видео — картинка: строка «видео или картинка»", formStatus(rows, work, [f("", "01 Титры - a.srt"), f("", "02 Титры - b.srt"), f("01 Сцена", "01 Видео - frame.png")]).complete, true)
eq("пустая подпапка слот не заполняет", formStatus(rows, work, [f("", "01 Титры - a.srt"), f("", "02 Титры - b.srt")]).complete, false)
eq("пустая форма не собрана", formStatus([], work, []).complete, false)

console.log(fails === 0 ? "\nВсё в порядке." : `\nОшибок: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
