#!/usr/bin/env node
/**
 * Проверки чистой логики папки элемента — `lib/tools/element/`.
 *
 *   npm run element:check
 *
 * Тестраннера в проекте нет, а здесь лежат ОБЕ половины двух контрактов с
 * программой: грамматика имён в папке элемента и разметка текста. Ошибка в них
 * не падает исключением — она молча кладёт файл под именем, которого граф не
 * ждёт, или теряет кусок текста при сохранении. Поэтому проверки написаны
 * отдельно и запускаются руками, как у папки задачи (check-dialog-logic.mts).
 *
 * Проверяется только то, что не требует ни браузера, ни сети.
 */

import { applyNameMasks, RANDOM_DEFAULT_LENGTH } from "../lib/tools/element/masks.ts"
import {
  elementDisplayName,
  elementFolderName,
  freeElementName,
  parseSlotName,
  renumber,
  slotFileName,
  subfolderName,
} from "../lib/tools/element/names.ts"
import { parseMarkup, serializeMarkup } from "../lib/tools/element/markup.ts"
import { stepScale } from "../lib/tools/element/palette.ts"
import {
  expectedMimePrefix,
  extensionFits,
  mimeFits,
  parseSiteForm,
} from "../lib/tools/element/site-form.ts"
import {
  canAdd,
  canRemove,
  isComplete,
  missingFolders,
  missingLabels,
  readElement,
  type FolderEntry,
} from "../lib/tools/element/slots.ts"

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  const ok = a === b
  if (!ok) fails += 1
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${ok ? "" : `: ${a}, ждали ${b}`}`)
}

console.log("имена (names.ts)")
eq("дефис держит инструмент", elementFolderName("Ролик 2026-09-23"), "-Ролик 2026-09-23")
eq("дефис не удваивается", elementFolderName("-Ролик"), "-Ролик")
eq("имя для показа", elementDisplayName("-Ролик 2026-09-23"), "Ролик 2026-09-23")
eq("файл в слоте", slotFileName(1, "Ведущий", "clip.mp4"), "01 Ведущий - clip.mp4")
eq("файл без исходного имени", slotFileName(1, "Текст ролика"), "01 Текст ролика")
eq("десятый слот", slotFileName(10, "Кадр", "a.png"), "10 Кадр - a.png")
eq("подпапка без дефиса", subfolderName(2, "Сцена"), "02 Сцена")

const labels = ["Ведущий", "Текст", "Текст ролика"]
eq("разбор файла", parseSlotName("01 Ведущий - clip.mp4", labels), {
  index: 1,
  label: "Ведущий",
  originalName: "clip.mp4",
})
eq("самый длинный label побеждает", parseSlotName("01 Текст ролика - a.txt", labels), {
  index: 1,
  label: "Текст ролика",
  originalName: "a.txt",
})
eq("без исходного имени", parseSlotName("02 Текст.txt", labels), {
  index: 2,
  label: "Текст",
  originalName: null,
})
eq("дефис внутри исходного имени", parseSlotName("01 Ведущий - a - b.mp4", labels), {
  index: 1,
  label: "Ведущий",
  originalName: "a - b.mp4",
})
eq("label с дефисом", parseSlotName("01 Кадр - крупно - a.png", ["Кадр - крупно"]), {
  index: 1,
  label: "Кадр - крупно",
  originalName: "a.png",
})
eq("чужое имя не разбирается", parseSlotName("clip.mp4", labels), null)
eq("без номера не разбирается", parseSlotName("Ведущий - clip.mp4", labels), null)
eq("нулевого слота не бывает", parseSlotName("00 Ведущий - clip.mp4", labels), null)
eq("неизвестный label", parseSlotName("01 Диктор - clip.mp4", labels), null)

eq("занятое имя", freeElementName(["-Ролик", "-Ролик (2)"], "-Ролик"), "-Ролик (3)")
eq("свободное имя как есть", freeElementName(["-Другое"], "-Ролик"), "-Ролик")
eq("регистр не спасает", freeElementName(["-ролик"], "-Ролик"), "-Ролик (2)")

eq(
  "дыра после удаления закрывается",
  renumber(["01 Кадр - a.png", "03 Кадр - c.png"], ["Кадр"]),
  [{ from: "03 Кадр - c.png", to: "02 Кадр - c.png" }],
)
eq(
  "перестановка меняет только номер",
  renumber(["02 Кадр - b.png", "01 Кадр - a.png"], ["Кадр"]),
  [
    { from: "02 Кадр - b.png", to: "01 Кадр - b.png" },
    { from: "01 Кадр - a.png", to: "02 Кадр - a.png" },
  ],
)
eq("на месте — ничего не переименовываем", renumber(["01 Кадр - a.png"], ["Кадр"]), [])
eq(
  "удалили средний из четырёх — хвост подтянулся",
  renumber(["01 Кадр - a.png", "02 Кадр - b.png", "04 Кадр - d.png"], ["Кадр"]),
  [{ from: "04 Кадр - d.png", to: "03 Кадр - d.png" }],
)
eq(
  "удалили первый — сдвинулись все",
  renumber(["02 Кадр - b.png", "03 Кадр - c.png"], ["Кадр"]),
  [
    { from: "02 Кадр - b.png", to: "01 Кадр - b.png" },
    { from: "03 Кадр - c.png", to: "02 Кадр - c.png" },
  ],
)
eq(
  "четвёртый перетащили на третье место",
  renumber(
    ["01 Кадр - a.png", "02 Кадр - b.png", "04 Кадр - d.png", "03 Кадр - c.png"],
    ["Кадр"],
  ),
  [
    { from: "04 Кадр - d.png", to: "03 Кадр - d.png" },
    { from: "03 Кадр - c.png", to: "04 Кадр - c.png" },
  ],
)

console.log("маски имени (masks.ts)")
const now = new Date(2026, 8, 23, 14, 5, 7) // 23 сентября 2026, 14:05:07 местного
const fixed = (length: number) => "R".repeat(length)
eq(
  "полный шаблон",
  applyNameMasks("$YYYY-$MM-$DD $HH.$mm.$ss", { now, random: fixed }),
  "2026-09-23 14.05.07",
)
eq("MM — месяц, mm — минуты", applyNameMasks("$MM/$mm", { now, random: fixed }), "09/05")
eq(
  "random без числа — десять знаков",
  applyNameMasks("$random", { now, random: fixed }),
  "R".repeat(RANDOM_DEFAULT_LENGTH),
)
eq("random() — тоже десять", applyNameMasks("$random()", { now, random: fixed }), "R".repeat(10))
eq("random(4)", applyNameMasks("$random(4)", { now, random: fixed }), "RRRR")
eq("неизвестная маска остаётся", applyNameMasks("$width x $YYYY", { now, random: fixed }), "$width x 2026")
eq("пустой шаблон", applyNameMasks("", { now, random: fixed }), "")

console.log("разметка текста (markup.ts)")
const sample = 'Обычный текст, <этот кусок>[Bold, #FF3B30, x1.5, "медленно"] и дальше.'
const parsed = parseMarkup(sample)
eq("чистый текст без разметки", parsed.text, "Обычный текст, этот кусок и дальше.")
eq("один диапазон", parsed.ranges.length, 1)
eq("границы диапазона", [parsed.ranges[0]!.start, parsed.ranges[0]!.length], [15, 10])
eq("свойства по форме", parsed.ranges[0]!.props, {
  bold: true,
  color: "#FF3B30",
  scale: 1.5,
  note: "медленно",
})
eq("туда и обратно", serializeMarkup(parsed.text, parsed.ranges), sample)
eq("неизвестное свойство игнорируется, текст цел", parseMarkup("<кусок>[Wobble]").text, "кусок")
eq("неизвестное свойство не даёт диапазона", parseMarkup("<кусок>[Wobble]").ranges.length, 0)
eq("пустые свойства — просто текст", parseMarkup("<кусок>[]").text, "кусок")
eq("экранирование читается", parseMarkup("цена \\< 5 и \\[скобка\\]").text, "цена < 5 и [скобка]")
eq("экранирование пишется", serializeMarkup("цена < 5", []), "цена \\< 5")
eq("запятая внутри тега не делит", parseMarkup('<а>["тихо, но внятно"]').ranges[0]!.props.note, "тихо, но внятно")
eq("переносы строк как есть", parseMarkup("первая\nвторая").text, "первая\nвторая")
eq("незакрытый фрагмент — текст", parseMarkup("а < б").text, "а < б")
eq("цвет приводится к верхнему регистру", parseMarkup("<а>[#ff3b30]").ranges[0]!.props.color, "#FF3B30")
eq("короткий цвет не принимается", parseMarkup("<а>[#f00]").ranges.length, 0)
eq("нулевой множитель не принимается", parseMarkup("<а>[x0]").ranges.length, 0)
eq(
  "пересечение не пишем",
  serializeMarkup("абвг", [
    { start: 0, length: 3, props: { bold: true } },
    { start: 1, length: 3, props: { italic: true } },
  ]),
  "<абв>[Bold]г",
)

console.log("множитель кегля (palette.ts)")
eq("шаг вверх", stepScale(1, 0.1), 1.1)
eq("шаг вниз", stepScale(1, -0.1), 0.9)
eq("двоичный хвост округляется", stepScale(1.1, 0.1), 1.2)
eq("возврат к единице снимает свойство", stepScale(1.1, -0.1), null)
eq("ниже нижней границы не уходим", stepScale(0.1, -0.1), 0.1)
eq("выше верхней не уходим", stepScale(10, 0.1), 10)
eq("мусор считаем единицей", stepScale(Number.NaN, 0.1), 1.1)

console.log("форма из графа (site-form.ts)")
const formJson = {
  version: 1,
  element: {
    nodeType: "checkFolder",
    folderNameTemplate: "$YYYY-$MM-$DD $HH.$mm",
    nodeLabel: "Check Folder",
    rows: [
      { id: "a", label: "Ведущий", tooltip: "", type: "video", op: "=", count: 1 },
      { id: "b", label: "Текст ролика", tooltip: "", type: "text", op: "=", count: 1 },
      {
        id: "c",
        label: "Сцена",
        tooltip: "",
        type: "folder",
        op: ">=",
        count: 2,
        children: [{ id: "c1", label: "Кадр", tooltip: "", type: "image", op: "=", count: 1 }],
      },
    ],
  },
  fileTypes: { video: ["mp4", ".MOV"], text: ["txt"], image: ["png"] },
}
const form = parseSiteForm(formJson)
eq("форма читается", form.ok, true)
if (!form.ok) throw new Error("форма не разобралась — дальше проверять нечего")
eq("расширения нормализованы", form.form.fileTypes.video, ["mp4", "mov"])
eq("вложенное требование", form.form.rows[2]!.children[0]!.label, "Кадр")
eq("расширение подходит", extensionFits(form.form, "video", "clip.MOV"), true)
eq("расширение не подходит", extensionFits(form.form, "video", "clip.avi"), false)
eq("неизвестный тип не ограничивает", extensionFits(form.form, "прочее", "clip.avi"), true)

console.log("подсказка при перетаскивании (site-form.ts)")
eq("видео в картинки — чужое семейство", mimeFits("image", "video/mp4"), false)
eq("картинка в картинки", mimeFits("image", "image/png"), true)
eq("видео в видео", mimeFits("video", "video/quicktime"), true)
eq("pdf в картинки не пугаем", mimeFits("image", "application/pdf"), true)
eq("MIME неизвестен — не мешаем", mimeFits("image", ""), true)
eq("у типа нет семейства — не мешаем", mimeFits("aep", "video/mp4"), true)
eq("семейство типа", expectedMimePrefix("audio"), "audio/")
eq("у psd семейства нет", expectedMimePrefix("psd"), null)

eq("чужая версия не читается", parseSiteForm({ ...formJson, version: 2 }).ok, false)
eq(
  "чужая версия названа причиной",
  (parseSiteForm({ ...formJson, version: 2 }) as { error: { reason: string } }).error.reason,
  "version",
)
const dupes = parseSiteForm({
  ...formJson,
  element: {
    ...formJson.element,
    rows: [
      { id: "a", label: "Текст", tooltip: "", type: "text", op: "=", count: 1 },
      { id: "b", label: "Текст", tooltip: "", type: "text", op: "=", count: 1 },
    ],
  },
})
eq("дубли label — отказ", dupes.ok, false)
eq("причина отказа названа", (dupes as { error: { reason: string } }).error.reason, "duplicate-label")

console.log("слоты (slots.ts)")
const rows = form.form.rows
const empty = readElement(rows, [])
eq("пустая папка: слотов столько, сколько объявлено", empty.groups.map((g) => g.slots.length), [1, 1, 2])
eq("пустая папка не собрана", isComplete(empty), false)
eq("видно, чего не хватает", missingLabels(empty), [
  "Ведущий",
  "Текст ролика",
  "Сцена 1 / Кадр",
  "Сцена 2 / Кадр",
])

const filled: FolderEntry[] = [
  { dir: "", name: "01 Ведущий - clip.mp4", isFolder: false },
  { dir: "", name: "01 Текст ролика - сценарий.txt", isFolder: false },
  { dir: "", name: "01 Сцена", isFolder: true },
  { dir: "", name: "02 Сцена", isFolder: true },
  { dir: "", name: "мусор.tmp", isFolder: false },
  { dir: "01 Сцена", name: "01 Кадр - a.png", isFolder: false },
  { dir: "02 Сцена", name: "01 Кадр - b.png", isFolder: false },
]
const state = readElement(rows, filled)
eq("файл лёг в слот", state.groups[0]!.slots[0]!.file?.name, "01 Ведущий - clip.mp4")
eq("исходное имя сохранено", state.groups[0]!.slots[0]!.file?.originalName, "clip.mp4")
eq("подпапки нашлись", state.groups[2]!.slots.map((s) => s.folderName), ["01 Сцена", "02 Сцена"])
eq("вложенный слот заполнен", state.groups[2]!.slots[0]!.groups[0]!.slots[0]!.file?.name, "01 Кадр - a.png")
eq("лишнее не спрятано", state.extras.map((e) => e.name), ["мусор.tmp"])
eq("собранная папка полна", isComplete(state), true)

const grown = readElement(rows, [
  ...filled,
  { dir: "", name: "03 Сцена", isFolder: true },
  { dir: "03 Сцена", name: "01 Кадр - c.png", isFolder: false },
])
eq("добавленный сверх минимума слот виден", grown.groups[2]!.slots.length, 3)

console.log("структура заводится сразу (slots.ts)")
eq(
  "в пустом элементе не хватает обеих подпапок",
  missingFolders(rows, []).map((f) => `${f.dir}|${f.index} ${f.label}`),
  ["|1 Сцена", "|2 Сцена"],
)
eq("в собранном элементе не хватает ничего", missingFolders(rows, filled), [])
eq(
  "родитель раньше ребёнка",
  missingFolders(
    [
      {
        id: "a",
        label: "Блок",
        tooltip: "",
        type: "folder",
        op: "=",
        count: 1,
        children: [
          { id: "b", label: "Сцена", tooltip: "", type: "folder", op: "=", count: 1, children: [] },
        ],
      },
    ],
    [],
  ).map((f) => `${f.dir}|${f.index} ${f.label}`),
  ["|1 Блок", "01 Блок|1 Сцена"],
)

eq("при >= можно добавить", canAdd(rows[2]!), true)
eq("при = добавить нельзя", canAdd(rows[0]!), false)
eq("при = не удаляется ни один", canRemove(rows[0]!, 1), false)
eq("ниже минимума не удаляется", canRemove(rows[2]!, 2), false)
eq("сверх минимума удаляется", canRemove(rows[2]!, 3), true)

console.log(fails === 0 ? "\nвсё сошлось" : `\nне сошлось: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
