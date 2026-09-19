"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { FONT_GROUPS, type FontGroup, type FontScript } from "@/lib/fonts/catalog"
import { libraryFaceUrl, loadFont } from "@/lib/fonts/face-loader"
import { cn } from "@/lib/utils"

/**
 * Витрина шрифтов — docs/FONTS_PLAN.md §3 и §6.
 *
 * Три уровня видно как две группы: «в проекте» (файл уже лежит рядом с
 * проектом, гарантия) и библиотека, разложенная по назначению. Витрина одна,
 * потому что выбирают не источник, а шрифт.
 *
 * Строка списка рисуется СВОИМ шрифтом — иначе выбирать не из чего. Загрузка
 * ленивая, по появлению строки на экране, и иероглифические семейства из этого
 * выключены: пять мегабайт ради одной подписи в списке никому не нужны, лицо
 * видно в превью после выбора.
 */

/**
 * Сколько пикселей считать «строкой», когда браузер меряет прокрутку строками.
 * Три щелчка Firefox (deltaY 3) дают около сотни точек — столько же, сколько
 * один щелчок в Chrome.
 */
const WHEEL_LINE_PX = 32

export type LibraryFont = {
  family: string
  group: FontGroup
  scripts: FontScript[]
  bold: boolean
  italic: boolean
  replaces: string | null
  heavy: boolean
  inLibrary: boolean
}

export type ProjectFont = {
  name: string
  ext: string
  sizeBytes: number
  loadable: boolean
  url: string
}

export type FontChoice = {
  family: string
  /** Откуда взять байты: витрина или файл в проекте. */
  url: string
  /** Файл уже лежит в проекте — класть при сохранении нечего. */
  inProject: boolean
}

const SCRIPT_ORDER: FontScript[] = [
  "cyrillic",
  "latin",
  "greek",
  "vietnamese",
  "japanese",
  "korean",
  "chineseSimplified",
  "chineseTraditional",
  "thai",
  "arabic",
  "hebrew",
  "devanagari",
]

/** Строка списка: своё лицо подгружается, когда строка доехала до экрана. */
function FontRow({
  family,
  url,
  eager,
  children,
}: {
  family: string
  url: string
  eager: boolean
  children?: React.ReactNode
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!eager) return
    const node = ref.current
    if (!node) return

    let alive = true
    const start = () => {
      loadFont(family, url)
        .then(() => {
          if (alive) setReady(true)
        })
        .catch(() => {
          // Не загрузился — строка останется набранной шрифтом интерфейса.
        })
    }

    if (typeof IntersectionObserver === "undefined") {
      start()
      return () => {
        alive = false
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          start()
        }
      },
      { rootMargin: "120px" },
    )
    observer.observe(node)
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [family, url, eager])

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span
        ref={ref}
        style={ready ? { fontFamily: `"${family}"` } : undefined}
        className="min-w-0 flex-1 truncate text-[14px]"
      >
        {family}
      </span>
      {children}
    </span>
  )
}

export type FontSources = {
  library: LibraryFont[]
  projectFonts: ProjectFont[]
  ready: boolean
  /** Откуда взять байты для этого имени. `null` — системный, файла у нас нет. */
  resolveUrl: (family: string) => string | null
}

/**
 * Витрина и шрифты проекта — одним запросом на открытие модалки.
 *
 * Живёт здесь, а не внутри выпадашки: список нужен и превью — чтобы понять,
 * откуда брать байты уже настроенного шрифта, ещё до того, как выпадашку
 * откроют.
 */
export function useFontSources(projectId: string, enabled: boolean): FontSources {
  const [library, setLibrary] = useState<LibraryFont[]>([])
  const [projectFonts, setProjectFonts] = useState<ProjectFont[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!enabled || ready) return
    let alive = true
    void (async () => {
      const [fonts, own] = await Promise.all([
        fetch("/api/fonts", { credentials: "same-origin" })
          .then((res) => (res.ok ? res.json() : { fonts: [] }))
          .catch(() => ({ fonts: [] })),
        fetch(`/api/projects/${projectId}/fonts`, { credentials: "same-origin" })
          .then((res) => (res.ok ? res.json() : { fonts: [] }))
          .catch(() => ({ fonts: [] })),
      ])
      if (!alive) return
      setLibrary((fonts.fonts ?? []) as LibraryFont[])
      setProjectFonts((own.fonts ?? []) as ProjectFont[])
      setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [enabled, ready, projectId])

  const resolveUrl = useMemo(() => {
    const own = new Map(projectFonts.map((font) => [font.name, font]))
    const known = new Set(library.map((font) => font.family))
    return (family: string): string | null => {
      // Файл проекта — первым, как и на машине (`fonts.ensure`): свой файл
      // побеждает библиотечного тёзку.
      const mine = own.get(family)
      if (mine) return mine.loadable ? mine.url : null
      return known.has(family) ? libraryFaceUrl(family) : null
    }
  }, [library, projectFonts])

  // Ссылка обязана быть устойчивой: превью в модалке держит на ней эффект, и
  // новый объект на каждый рендер загонял бы загрузку шрифта в круг.
  return useMemo(
    () => ({ library, projectFonts, ready, resolveUrl }),
    [library, projectFonts, ready, resolveUrl],
  )
}

export function FontPicker({
  sources,
  value,
  disabled,
  onChange,
}: {
  sources: FontSources
  value: string
  disabled?: boolean
  onChange: (choice: FontChoice) => void
}) {
  const { t } = useI18n()
  const { library, projectFonts } = sources
  const [open, setOpen] = useState(false)
  const [script, setScript] = useState<FontScript | "all">("all")

  /**
   * Колёсико над списком прокручиваем сами.
   *
   * Модальный диалог под поповером глушит wheel (react-remove-scroll считает
   * портал «снаружи» и отменяет событие), поэтому нативной прокрутки здесь нет.
   * Слушатель именно нативный и непассивный: React вешает `onWheel` пассивно —
   * `preventDefault` оттуда не работает, и там, где диалог событие всё-таки
   * пропустит, наша прокрутка сложилась бы с нативной.
   */
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = listRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      // `deltaY` — пиксели далеко не везде: Firefox отдаёт строки (deltaMode 1,
      // ±3 за щелчок), при deltaMode 2 — экраны. Без перевода в пиксели список
      // полз бы по три точки за щелчок.
      const step =
        event.deltaMode === 1
          ? WHEEL_LINE_PX
          : event.deltaMode === 2
            ? node.clientHeight
            : 1
      node.scrollTop += event.deltaY * step
    }
    node.addEventListener("wheel", onWheel, { passive: false })
    return () => node.removeEventListener("wheel", onWheel)
    // Список живёт только пока открыт поповер — до этого узла попросту нет.
  }, [open])

  const groupLabels: Record<FontGroup, string> = {
    sans: t.fontGroupSans,
    narrow: t.fontGroupNarrow,
    serif: t.fontGroupSerif,
    display: t.fontGroupDisplay,
    handwriting: t.fontGroupHandwriting,
    mono: t.fontGroupMono,
  }

  const scriptLabels: Record<FontScript, string> = {
    latin: t.fontScriptLatin,
    cyrillic: t.fontScriptCyrillic,
    greek: t.fontScriptGreek,
    vietnamese: t.fontScriptVietnamese,
    japanese: t.fontScriptJapanese,
    korean: t.fontScriptKorean,
    chineseSimplified: t.fontScriptChineseSimplified,
    chineseTraditional: t.fontScriptChineseTraditional,
    thai: t.fontScriptThai,
    arabic: t.fontScriptArabic,
    hebrew: t.fontScriptHebrew,
    devanagari: t.fontScriptDevanagari,
  }

  /** Имена шрифтов проекта — чтобы не показывать одно семейство дважды. */
  const ownNames = useMemo(
    () => new Set(projectFonts.map((font) => font.name)),
    [projectFonts],
  )

  const byGroup = useMemo(() => {
    const rows = library.filter(
      (font) =>
        !ownNames.has(font.family) &&
        (script === "all" || font.scripts.includes(script)),
    )
    return FONT_GROUPS.map((group) => ({
      group,
      fonts: rows.filter((font) => font.group === group),
    })).filter((item) => item.fonts.length > 0)
  }, [library, ownNames, script])

  const choose = (choice: FontChoice) => {
    onChange(choice)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="h-9 w-full justify-between text-[13px] font-normal"
        >
          <span className="truncate" style={{ fontFamily: `"${value}"` }}>
            {value}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[20rem] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={t.fontSearch} />

          {/* Фильтр по письменности: шрифт без нужных букв нарисует не то, и
              знать об этом надо до выбора, а не по готовому ролику. */}
          <div className="flex flex-wrap gap-1 border-b border-border/60 px-2 py-1.5">
            <Button
              type="button"
              size="sm"
              variant={script === "all" ? "default" : "outline"}
              onClick={() => setScript("all")}
              className="h-6 px-2 text-[11px] font-normal"
            >
              {t.fontScriptAll}
            </Button>
            {SCRIPT_ORDER.filter((item) =>
              library.some((font) => font.scripts.includes(item)),
            ).map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={script === item ? "default" : "outline"}
                onClick={() => setScript(item)}
                className="h-6 px-2 text-[11px] font-normal"
              >
                {scriptLabels[item]}
              </Button>
            ))}
          </div>

          {/* Список высокий — шрифт выбирают ГЛАЗАМИ, и чем больше лиц видно
              сразу, тем меньше листать. Прокрутка колёсиком — своя, см. эффект
              выше. */}
          <CommandList ref={listRef} className="max-h-[min(560px,55vh)]">
            <CommandEmpty>{t.fontNothingFound}</CommandEmpty>

            {projectFonts.length > 0 ? (
              <CommandGroup heading={t.fontInProject}>
                {projectFonts.map((font) => (
                  <CommandItem
                    key={`own-${font.name}`}
                    value={font.name}
                    onSelect={() =>
                      choose({ family: font.name, url: font.url, inProject: true })
                    }
                  >
                    <FontRow
                      family={font.name}
                      url={font.url}
                      eager={font.loadable}
                    />
                    {font.name === value ? (
                      <Check className="ml-2 h-3.5 w-3.5 shrink-0" />
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {byGroup.map(({ group, fonts }) => (
              <CommandGroup key={group} heading={groupLabels[group]}>
                {fonts.map((font) => (
                  <CommandItem
                    key={font.family}
                    value={font.family}
                    onSelect={() =>
                      choose({
                        family: font.family,
                        url: libraryFaceUrl(font.family),
                        inProject: false,
                      })
                    }
                  >
                    <FontRow
                      family={font.family}
                      url={libraryFaceUrl(font.family)}
                      // Иероглифическое семейство в списке своим лицом не
                      // рисуем: одно начертание — несколько мегабайт.
                      eager={!font.heavy}
                    >
                      {font.replaces ? (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {t.fontInstead} {font.replaces}
                        </span>
                      ) : null}
                      {font.heavy ? (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {t.fontHeavy}
                        </span>
                      ) : null}
                    </FontRow>
                    {font.family === value ? (
                      <Check className="ml-2 h-3.5 w-3.5 shrink-0" />
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
