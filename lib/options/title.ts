/**
 * Титры: разбор значения `titleSettings` — docs/TITLE_CONTROL_PLAN.md.
 *
 * Чистый модуль, как overlay.ts и video-adjust.ts: тем же кодом читает страница,
 * пишет сервер и проверяет приёмка.
 *
 * Значение — СТРОКА с JSON, три формата (`landscape`, `portrait`, `square`), в
 * каждом около тридцати пяти полей. Сайт правит девять из них; остальное
 * (анимация, типографика, `encode`, размеры кадра) принадлежит программе и
 * возвращается нетронутым.
 */

export const TITLE_FORMATS = ["landscape", "portrait", "square"] as const
export type TitleFormat = (typeof TITLE_FORMATS)[number]

/** Размер кадра формата — та же система координат, что у титров в программе. */
export const TITLE_FRAME: Record<TitleFormat, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
}

/**
 * Шрифты, которые сайт предлагал раньше, — шесть системных.
 *
 * Список БОЛЬШЕ НЕ ЗАКРЫТЫЙ: у проекта появилась своя папка шрифтов
 * (`options/fonts`), файл едет вместе с проектом, и «шрифт обязан стоять на всех
 * машинах парка» перестало быть условием — docs/FONTS_PLAN.md §2.
 *
 * Константа осталась для одного: в проектах, настроенных до этой работы, в
 * значении стоит «Arial», и модалке надо отличать такое имя от выбранного из
 * витрины. Положить эти файлы в нашу библиотеку нельзя — они принадлежат
 * Microsoft и Monotype (§5 плана).
 */
export const TITLE_SYSTEM_FONTS = [
  "Arial",
  "Georgia",
  "Times New Roman",
  "Verdana",
  "Trebuchet MS",
  "Courier New",
] as const

/**
 * Имя шрифта — свободная строка, но не любая.
 *
 * Запрещено ровно то, что ломает получателей: управляющие символы и запятая
 * (строка `Style:` в ASS разделена запятыми), а также символы, недопустимые в
 * имени файла, — шрифт ищется по имени файла в `options/fonts`.
 *
 * Латиницей НЕ ограничиваем, хотя у самой программы для скачивания с Google
 * проверка строже (`check_font_family`): в папку проекта автор мог положить
 * файл с любым именем, и подменить такое имя на «Arial» значило бы молча
 * переписать его настройки.
 */
const FONT_NAME = /^[^\u0000-\u001f,{}\\/:*?"<>|]{1,64}$/u

/** Цвета текста: белый, чёрный и несколько ярких. Свой задаётся пипеткой. */
export const TITLE_COLORS = [
  "#ffffff",
  "#000000",
  "#ffd400",
  "#ff4d4d",
  "#4dd2ff",
  "#7cff6b",
] as const

/**
 * Ширина строки в процентах ширины кадра — `wrapWidth`. 80 % это стандарт
 * программы, и он же значение по умолчанию.
 *
 * Ручкой стал 2026-09-19: размер шрифта один на все форматы, и длину строки
 * задаёт именно это число — то есть им и решают, во сколько строк ляжет фраза.
 * Узкая колонка посреди кадра — обычная просьба, а раньше добиться её было
 * нечем.
 */
export const TITLE_WRAP_PERCENT = 80

/** Ходовые ширины — кнопками, как число строк. Остальное ползунком. */
export const TITLE_WRAPS = [40, 60, 80] as const

/**
 * Поле от края кадра до якорей «слева» и «справа».
 *
 * Держится ОТДЕЛЬНО от `wrapWidth`: раньше оно из него и считалось, но с
 * ручкой ширины это значило бы, что узкая колонка сама себе отодвигает край —
 * выбрал 40 %, и «слева» уехало на треть кадра. Поле — про безопасную зону
 * площадки, ширина строки — про длину фразы, и связывать их незачем.
 */
export const TITLE_SAFE_MARGIN = 10

export type TitlePosition = "top" | "middle" | "bottom"
export type TitleHAlign = "left" | "center" | "right"

/**
 * Положение — две связанные величины (`y` и `vAlign`) с тремя осмысленными
 * сочетаниями, поэтому кнопки, а не ползунок.
 *
 * Отступ от края в 10 % не случаен: у площадок там своя разметка — таймлайн,
 * подписи, кнопки, — и титр, прижатый вплотную, окажется под ней.
 */
export const TITLE_POSITIONS: Record<
  TitlePosition,
  { y: number; vAlign: "top" | "middle" | "bottom" }
> = {
  top: { y: 10, vAlign: "top" },
  middle: { y: 50, vAlign: "middle" },
  bottom: { y: 90, vAlign: "bottom" },
}

/**
 * Точка привязки по горизонтали, которую ставит КНОПКА выравнивания.
 *
 * Не формула, по которой `x` считается всегда: в файле лежит своё число, и
 * ползунок под шестерёнкой правит его отдельно (см. `TitleValue.x`). Здесь —
 * только те три значения, на которые встают кнопки.
 *
 * Семантика программы (`buildAss`): `textX = ширина · x/100`, и при `left`
 * строка НАЧИНАЕТСЯ в этой точке, при `right` — КОНЧАЕТСЯ в ней. Поэтому
 * якоря стоят на краях безопасного поля и посередине кадра: 10 · 50 · 90.
 */
export const TITLE_ANCHOR_X: Record<TitleHAlign, number> = {
  left: TITLE_SAFE_MARGIN,
  center: 50,
  right: 100 - TITLE_SAFE_MARGIN,
}

export type TitleShadowPreset = "none" | "soft" | "hard" | "glow" | "lift"
export type TitleBoxPreset = "none" | "translucent" | "solid" | "rounded"

/** Тень — сами значения, а не имя заготовки: иначе «свои» числа автора не показать. */
export type TitleShadow = {
  enabled: boolean
  color: string
  offsetX: number
  offsetY: number
  blur: number
}

/** Плашка — тоже значения: цвет, прозрачность, отступы и радиус из файла. */
export type TitleBox = {
  enabled: boolean
  color: string
  opacity: number
  paddingX: number
  paddingY: number
  borderRadius: number
}

/**
 * Заготовки — это НЕ режимы, а просто несколько значений под одним именем.
 *
 * Выбрал «мягкая» — записались конкретные смещение, размытие и цвет. Дальше всё
 * правится поверх, и заготовка ни на что больше не влияет: в сохранённом
 * значении её имени нет.
 *
 * Ползунок там, где число одно (обводка, размер); заготовка там, где значений
 * несколько и по отдельности они бессмысленны.
 */
export const TITLE_SHADOWS: Record<TitleShadowPreset, TitleShadow> = {
  none: { enabled: false, color: "#000000", offsetX: 0, offsetY: 0, blur: 0 },
  soft: { enabled: true, color: "#000000", offsetX: 0, offsetY: 4, blur: 12 },
  hard: { enabled: true, color: "#000000", offsetX: 4, offsetY: 4, blur: 0 },
  // Свечение: тень без смещения и с большим размытием — читается на пёстром кадре.
  glow: { enabled: true, color: "#000000", offsetX: 0, offsetY: 0, blur: 24 },
  lift: { enabled: true, color: "#000000", offsetX: 0, offsetY: 10, blur: 20 },
}

export const TITLE_BOXES: Record<TitleBoxPreset, TitleBox> = {
  none: { enabled: false, color: "#000000", opacity: 0, paddingX: 0, paddingY: 0, borderRadius: 0 },
  translucent: { enabled: true, color: "#000000", opacity: 0.45, paddingX: 24, paddingY: 12, borderRadius: 0 },
  solid: { enabled: true, color: "#000000", opacity: 1, paddingX: 24, paddingY: 12, borderRadius: 0 },
  rounded: { enabled: true, color: "#000000", opacity: 0.75, paddingX: 28, paddingY: 14, borderRadius: 16 },
}

export const TITLE_LIMITS = {
  /** Размер шрифта в пикселях; ОДИНАКОВ во всех форматах, как в программе. */
  size: { min: 24, max: 160, step: 2 },
  outline: { min: 0, max: 12, step: 1 },
  /**
   * Дальше — границы ползунков ТОЧНОЙ настройки (шестерёнка). Кнопка-заготовка
   * ставит набор значений разом, а эти ползунки правят каждое по отдельности,
   * когда заготовка не подошла.
   */
  /** Якоря — проценты стороны кадра, как `x` и `y` в программе. */
  anchor: { min: 0, max: 100, step: 1 },
  /**
   * Ширина строки. Снизу 20 %: в колонку уже уже не влезает длинное слово, и
   * фраза начинает рассыпаться по строке на слово, а не переноситься.
   */
  wrap: { min: 20, max: 100, step: 1 },
  /** Смещение тени по осям: в обе стороны, поэтому диапазон знаковый. */
  shadowOffset: { min: -40, max: 40, step: 1 },
  shadowBlur: { min: 0, max: 60, step: 1 },
  /** Прозрачность плашки — доля, а не проценты: так её хранит программа. */
  boxOpacity: { min: 0, max: 1, step: 0.05 },
  boxPadding: { min: 0, max: 80, step: 2 },
  boxRadius: { min: 0, max: 60, step: 2 },
} as const

/** Число строк: одна, две, три — кнопками, как заготовки тени и плашки. */
export const TITLE_LINES = [1, 2, 3] as const

/**
 * То, что правит сайт.
 *
 * Все восемь полей относятся к ОДНОМУ формату: модалка пишет их либо во все
 * три сразу (режим по умолчанию), либо только в выбранный — как синхронизация
 * в наложении (docs/OVERLAY_CONTROL_PLAN.md §8.1).
 */
export type TitleValue = {
  font: string
  size: number
  color: string
  /** `maxLines`: сколько строк занимает титр. */
  lines: number
  /** `wrapWidth`: ширина строки в процентах ширины кадра. */
  wrapWidth: number
  /** Вертикальное выравнивание — `vAlign`. */
  position: TitlePosition
  /** Горизонтальное выравнивание — `hAlign`. */
  hAlign: TitleHAlign
  /**
   * Якоря в процентах стороны кадра — `x` и `y` из файла.
   *
   * Хранятся ОТДЕЛЬНО от выравниваний, а не считаются из них: автор графа мог
   * поставить любые числа, и затирать их якорями кнопок значило бы молча
   * сдвинуть титр в ролике (docs/TITLE_CONTROL_PLAN.md §4 обещает обратное).
   * Кнопка ставит пару (якорь + выравнивание) разом, ползунки под шестерёнкой
   * правят только якорь; не совпал с кнопочным — кнопка не подсвечена.
   */
  x: number
  y: number
  outlineWidth: number
  outlineColor: string
  shadow: TitleShadow
  box: TitleBox
}

function asRecord(node: unknown): Record<string, unknown> | null {
  return node && typeof node === "object" && !Array.isArray(node)
    ? (node as Record<string, unknown>)
    : null
}

function num(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const HEX = /^#[0-9a-f]{6}$/i

export function defaultTitleValue(): TitleValue {
  return {
    font: "Arial",
    size: 60,
    color: "#ffffff",
    // Как в программе: два блока слов на экран — обычное дело для титров.
    lines: 2,
    wrapWidth: TITLE_WRAP_PERCENT,
    position: "bottom",
    hAlign: "center",
    x: TITLE_ANCHOR_X.center,
    y: TITLE_POSITIONS.bottom.y,
    outlineWidth: 0,
    outlineColor: "#000000",
    shadow: { ...TITLE_SHADOWS.none },
    box: { ...TITLE_BOXES.none },
  }
}

/**
 * Какая заготовка совпадает с текущими значениями — для ПОДСВЕТКИ кнопки.
 *
 * Имя заготовки в значении не хранится — там только числа, и автор графа мог
 * поставить любые. Совпадение ищется точным равенством всех полей; не совпало
 * ни одно — `null`, и ни одна кнопка не подсвечивается. Подсветить «мягкую»
 * там, где стоят другие числа, значило бы соврать о том, что увидит клиент.
 */
export function matchTitlePreset<T extends Record<string, unknown>>(
  presets: Record<string, T>,
  current: Record<string, unknown> | null,
): string | null {
  if (!current) return null
  for (const [name, preset] of Object.entries(presets)) {
    const same = Object.entries(preset).every(([key, value]) => {
      const actual = current[key]
      return typeof value === "number"
        ? Math.abs(num(actual, NaN) - value) < 0.001
        : actual === value
    })
    if (same) return name
  }
  return null
}

/** Строка значения → то, что правит сайт. Формат — чей блок читать. */
export function parseTitleValue(
  raw: unknown,
  format: TitleFormat = "landscape",
): TitleValue {
  const fallback = defaultTitleValue()
  let root: unknown = null
  if (typeof raw === "string" && raw.trim()) {
    try {
      root = JSON.parse(raw)
    } catch {
      root = null
    }
  } else if (raw && typeof raw === "object") {
    root = raw
  }
  const obj = asRecord(root)
  if (!obj) return fallback

  // Запрошенный формат — первым; если его блока в файле нет, читаем любой
  // другой. Размер при этом приводить не надо: он в пикселях и одинаков
  // во всех форматах — так устроена программа.
  const order = [format, ...TITLE_FORMATS.filter((item) => item !== format)]
  let block: Record<string, unknown> | null = null
  for (const item of order) {
    const candidate = asRecord(obj[item])
    if (candidate) {
      block = candidate
      break
    }
  }
  if (!block) return fallback

  const text = asRecord(block.text) ?? {}
  const position = asRecord(block.position) ?? {}
  const outline = asRecord(block.outline) ?? {}

  // Имя берём как есть, если оно годное: закрытого списка больше нет, и
  // подменять выбор автора графа на «Arial» только потому, что мы такого шрифта
  // не предлагаем, значило бы молча переписать его настройки.
  const font =
    typeof text.font === "string" && FONT_NAME.test(text.font.trim())
      ? text.font.trim()
      : fallback.font
  const vAlign = position.vAlign
  const place: TitlePosition =
    vAlign === "top" ? "top" : vAlign === "middle" ? "middle" : "bottom"
  const hAlignRaw = position.hAlign
  const hAlign: TitleHAlign =
    hAlignRaw === "left" ? "left" : hAlignRaw === "right" ? "right" : "center"
  // Якоря автора берём КАК ЕСТЬ. Нет их в файле — становимся на якоря того
  // выравнивания, которое прочитали, и кнопки честно подсветятся.
  const x = clamp(num(position.x, TITLE_ANCHOR_X[hAlign]), 0, 100)
  const y = clamp(num(position.y, TITLE_POSITIONS[place].y), 0, 100)

  const shadowRaw = asRecord(block.shadow) ?? {}
  const boxRaw = asRecord(block.background) ?? {}
  const hexOr = (raw: unknown, fallbackHex: string) =>
    typeof raw === "string" && HEX.test(raw) ? raw : fallbackHex

  return {
    font,
    size: Math.round(num(text.size, fallback.size)),
    color: hexOr(text.color, fallback.color),
    // `Math.max(1, …)` — как у программы: ноль строк смысла не имеет.
    lines: Math.max(1, Math.round(num(text.maxLines, fallback.lines))),
    wrapWidth: clamp(
      Math.round(num(text.wrapWidth, fallback.wrapWidth)),
      TITLE_LIMITS.wrap.min,
      TITLE_LIMITS.wrap.max,
    ),
    position: place,
    hAlign,
    x,
    y,
    outlineWidth:
      outline.enabled === true
        ? Math.round(num(outline.width, fallback.outlineWidth))
        : 0,
    outlineColor: hexOr(outline.color, fallback.outlineColor),
    // Тень и плашка читаются КАК ЕСТЬ: значения автора могут не совпасть ни с
    // одной заготовкой, и тогда не подсвечивается ни одна кнопка — это честнее,
    // чем показать ближайшую (см. matchTitlePreset).
    shadow: {
      enabled: shadowRaw.enabled === true,
      color: hexOr(shadowRaw.color, fallback.shadow.color),
      offsetX: Math.round(num(shadowRaw.offsetX, 0)),
      offsetY: Math.round(num(shadowRaw.offsetY, 0)),
      blur: Math.round(num(shadowRaw.blur, 0)),
    },
    box: {
      enabled: boxRaw.enabled === true,
      color: hexOr(boxRaw.color, fallback.box.color),
      opacity: num(boxRaw.opacity, 0),
      paddingX: Math.round(num(boxRaw.paddingX, 0)),
      paddingY: Math.round(num(boxRaw.paddingY, 0)),
      borderRadius: Math.round(num(boxRaw.borderRadius, 0)),
    },
  }
}

/**
 * Все шрифты, которые называет значение, — по одному на формат.
 *
 * Сайт пишет один и тот же во все три, но автор графа в программе мог поставить
 * разные, и при установке в проект (docs/FONTS_PLAN.md §7) нужны все: на вход
 * ноды придёт ролик неизвестного формата, и не положенный шрифт остановит
 * прогон ровно тогда, когда придёт «не тот» формат.
 */
export function titleFontNames(raw: unknown): string[] {
  let root: unknown = null
  if (typeof raw === "string" && raw.trim()) {
    try {
      root = JSON.parse(raw)
    } catch {
      return []
    }
  } else if (raw && typeof raw === "object") {
    root = raw
  }
  const obj = asRecord(root)
  if (!obj) return []

  const names = new Set<string>()
  for (const format of TITLE_FORMATS) {
    const block = asRecord(obj[format])
    const font = asRecord(block?.text)?.font
    if (typeof font === "string" && FONT_NAME.test(font.trim())) {
      names.add(font.trim())
    }
  }
  return [...names]
}

/**
 * Размер под формат НЕ пересчитывается — и это не экономия, а модель программы:
 * кегль один на все форматы в пикселях, а длину строки в каждом кадре держит
 * `wrapWidth` (проценты ширины кадра). Прежний пересчёт долей менял размер от
 * формата к формату, и один и тот же титр собирался из трёх разных кеглей.
 */

/**
 * Слияние правки клиента в ТЕКУЩЕЕ значение из файла.
 *
 * По умолчанию правка ложится во ВСЕ ТРИ формата — так работает режим
 * «одинаково во всех»: какой ролик придёт на вход, заранее неизвестно.
 * Передан формат — пишем только его: модалка со снятой синхронизацией
 * настраивает каждый формат по отдельности. Всё, чего сайт не знает
 * (анимация, перенос строк, число строк, `encode`), берётся из файла и
 * возвращается на место — слияние на сервере, не доверие браузеру.
 */
export function mergeTitleValue(
  currentRaw: unknown,
  incoming: TitleValue,
  onlyFormat?: TitleFormat,
): string {
  let root: Record<string, unknown> = {}
  if (typeof currentRaw === "string" && currentRaw.trim()) {
    try {
      const parsed = JSON.parse(currentRaw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        root = parsed as Record<string, unknown>
      }
    } catch {
      // Значение испорчено — пишем поверх, сохранять нечего.
    }
  }

  const place = TITLE_POSITIONS[incoming.position]
  const targets = onlyFormat ? [onlyFormat] : TITLE_FORMATS
  for (const format of targets) {
    const block = asRecord(root[format]) ?? {}
    const text = asRecord(block.text) ?? {}
    const position = asRecord(block.position) ?? {}

    root[format] = {
      ...block,
      videoWidth: num(block.videoWidth, TITLE_FRAME[format].width),
      videoHeight: num(block.videoHeight, TITLE_FRAME[format].height),
      text: {
        ...text,
        font: incoming.font,
        size: incoming.size,
        color: incoming.color,
        wrapWidth: incoming.wrapWidth,
        maxLines: incoming.lines,
      },
      position: {
        ...position,
        // Якоря пишем ТЕ, что в черновике, а не пересчитанные из выравниваний:
        // кнопка ставит пару (якорь + выравнивание) сама, а нетронутые якоря
        // автора обязаны доехать обратно нетронутыми — §4 плана.
        x: incoming.x,
        hAlign: incoming.hAlign,
        y: incoming.y,
        vAlign: place.vAlign,
      },
      outline: {
        ...(asRecord(block.outline) ?? {}),
        enabled: incoming.outlineWidth > 0,
        width: incoming.outlineWidth,
        color: incoming.outlineColor,
      },
      shadow: { ...(asRecord(block.shadow) ?? {}), ...incoming.shadow },
      background: { ...(asRecord(block.background) ?? {}), ...incoming.box },
    }
  }
  return JSON.stringify(root)
}

/**
 * Слияние на СЕРВЕРЕ: клиент присылает значение целиком, в форме графа —
 * три блока, по одному на формат.
 *
 * Каждый присланный блок сливается со СВОИМ блоком в файле, а не пишется во
 * все три: иначе правка одного формата со снятой синхронизацией затирала бы
 * остальные значениями горизонтального. Блока в присланном нет — формат не
 * трогаем. Старый клиент, приславший три одинаковых блока, получает ровно
 * прежний результат.
 */
export function mergeTitleFormats(
  currentRaw: unknown,
  incomingRaw: unknown,
): string {
  let root: unknown = null
  if (typeof incomingRaw === "string" && incomingRaw.trim()) {
    try {
      root = JSON.parse(incomingRaw)
    } catch {
      root = null
    }
  } else if (incomingRaw && typeof incomingRaw === "object") {
    root = incomingRaw
  }
  const obj = asRecord(root)

  let merged =
    typeof currentRaw === "string"
      ? currentRaw
      : JSON.stringify(currentRaw ?? {})
  if (!obj) return merged

  for (const format of TITLE_FORMATS) {
    if (!asRecord(obj[format])) continue
    merged = mergeTitleValue(merged, parseTitleValue(obj, format), format)
  }
  return merged
}

/** Панграмма: в ней все буквы — сразу видно, как шрифт справляется с кириллицей. */
export const TITLE_SAMPLE_TEXT =
  "Съешь же ещё этих мягких французских булок"
