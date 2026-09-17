/**
 * Какие символы шрифт умеет рисовать — docs/FONTS_PLAN.md §6.
 *
 * Читается таблица `cmap` самого файла, то есть ответ — факт, а не догадка по
 * ширине строки. Это важно: не найдя глифа, браузер молча подставляет системный
 * шрифт, и японский образец в латинском шрифте выглядит прилично, а libass на
 * машине нарисует пустые квадраты. Единственный способ сказать правду до
 * рендера — спросить сам файл.
 *
 * Модуль работает и в браузере, и на сервере: `Uint8Array`, без `Buffer`.
 * Разбор идёт ТАМ ЖЕ, где грузится превью, — байты уже приехали ради картинки,
 * и второй раз качать пять мегабайт иероглифического шрифта незачем.
 *
 * Разбираем два формата подтаблиц: 4 (базовая плоскость) и 12 (всё остальное,
 * включая редкие иероглифы). Остальные в шрифтах Google не встречаются.
 */

function tableOffset(view: DataView, tag: string): number | null {
  if (view.byteLength < 12) return null
  const numTables = view.getUint16(4)
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16
    if (record + 16 > view.byteLength) return null
    const name = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3),
    )
    if (name === tag) return view.getUint32(record + 8)
  }
  return null
}

/** Формат 4: сегменты BMP. Символ покрыт, только если глиф не нулевой. */
function readFormat4(view: DataView, at: number, out: Set<number>): void {
  const segCount = view.getUint16(at + 6) / 2
  const endAt = at + 14
  const startAt = endAt + segCount * 2 + 2
  const deltaAt = startAt + segCount * 2
  const rangeAt = deltaAt + segCount * 2

  for (let seg = 0; seg < segCount; seg++) {
    const end = view.getUint16(endAt + seg * 2)
    const start = view.getUint16(startAt + seg * 2)
    if (start > end || start === 0xffff) continue
    const delta = view.getInt16(deltaAt + seg * 2)
    const rangeOffset = view.getUint16(rangeAt + seg * 2)

    for (let code = start; code <= end; code++) {
      let glyph: number
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff
      } else {
        const glyphAt = rangeAt + seg * 2 + rangeOffset + (code - start) * 2
        if (glyphAt + 2 > view.byteLength) continue
        const raw = view.getUint16(glyphAt)
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff
      }
      if (glyph !== 0) out.add(code)
    }
  }
}

/** Формат 12: группы кодов за пределами BMP и крупные иероглифические наборы. */
function readFormat12(view: DataView, at: number, out: Set<number>): void {
  const groups = view.getUint32(at + 12)
  for (let i = 0; i < groups; i++) {
    const group = at + 16 + i * 12
    if (group + 12 > view.byteLength) return
    const start = view.getUint32(group)
    const end = view.getUint32(group + 4)
    const startGlyph = view.getUint32(group + 8)
    if (startGlyph === 0) continue
    // Защита от испорченного файла: миллион кодов в одной группе — не шрифт.
    if (end < start || end - start > 0x10ffff) continue
    for (let code = start; code <= end; code++) out.add(code)
  }
}

/**
 * Коды, которые шрифт рисует. Пустое множество означает «таблицу не прочитали»,
 * и вызывающий обязан промолчать, а не объявить, что символов нет.
 */
export function coveredCodepoints(font: Uint8Array): Set<number> {
  const covered = new Set<number>()
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
  const cmap = tableOffset(view, "cmap")
  if (cmap == null || cmap + 4 > view.byteLength) return covered

  const count = view.getUint16(cmap + 2)
  for (let i = 0; i < count; i++) {
    const record = cmap + 4 + i * 8
    if (record + 8 > view.byteLength) break
    const platformId = view.getUint16(record)
    const encodingId = view.getUint16(record + 2)
    const offset = cmap + view.getUint32(record + 4)
    if (offset + 4 > view.byteLength) continue

    // Символьные кодировки: Windows Unicode (3,1 и 3,10) и Unicode (0,*).
    const unicode =
      (platformId === 3 && (encodingId === 1 || encodingId === 10)) ||
      platformId === 0
    if (!unicode) continue

    try {
      const format = view.getUint16(offset)
      if (format === 4) readFormat4(view, offset, covered)
      else if (format === 12) readFormat12(view, offset, covered)
    } catch {
      // Испорченная подтаблица — пробуем следующую: у шрифта их обычно две.
    }
  }
  return covered
}

/** Пробелы и управляющие символы шрифт рисовать не обязан — их не считаем. */
function isIgnorable(code: number): boolean {
  return code === 0x20 || code === 0xa0 || code < 0x20
}

/**
 * Символы образца, которых в шрифте нет, — в порядке появления, без повторов.
 *
 * Пустое покрытие (файл не разобрался) даёт пустой ответ: сказать «шрифт ничего
 * не умеет», не прочитав файл, было бы такой же неправдой, как тихая подмена
 * шрифта, от которой мы уходим.
 */
export function missingCharacters(
  covered: Set<number>,
  text: string,
): string[] {
  if (covered.size === 0) return []

  const missing: string[] = []
  const seen = new Set<number>()
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code == null || isIgnorable(code) || seen.has(code)) continue
    seen.add(code)
    if (!covered.has(code)) missing.push(char)
  }
  return missing
}
