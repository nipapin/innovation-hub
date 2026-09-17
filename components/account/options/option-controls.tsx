"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronsUpDown, Upload, X } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/account/i18n"
import {
  isUploadCancelled,
  uploadProjectFileDirect,
} from "@/lib/project-direct-upload"
import { ASSETS_FOLDER_NAME } from "@/lib/storage/keys"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  clampForFormat,
  formatNumeric,
  parseNumeric,
  parseTimecodeInput,
  secondsToTimecode,
} from "@/lib/options/numeric-format"
import type { ExposedOption, ExposedOptionValue } from "@/lib/options/types"
import { cn } from "@/lib/utils"
import { OverlayControl } from "./overlay-control"
import { VideoAdjustControl } from "./video-adjust-control"
import { TitleControl } from "./title-control"
import { ConvertControl } from "./convert-control"

/**
 * Семь контролов вкладки настроек — по одному на `controlType`, которому автор
 * графа может поставить галочку «показать на сайте».
 *
 * Ничего не додумываем: границы, шаг, формат, список вариантов и режим ручного
 * ввода приходят из `options.json` такими, какими их задали в программе. Если в
 * слайдере разрешён ввод за пределами min/max — здесь он тоже разрешён.
 * Раскладка повторяет ноду (`NODE_WIN/nodes/properties/*`): имя с подсказкой
 * сверху, контрол под ним, у чекбокса — в одной строке.
 */

type ControlProps = {
  option: ExposedOption
  value: ExposedOptionValue
  disabled: boolean
  onChange: (value: ExposedOptionValue) => void
  /**
   * Нужен ровно одному контролу — выбору файла: он единственный не правит
   * значение, а грузит файл в проект, и без проекта грузить некуда.
   */
  projectId: string
  /** Словарь расширений конвейера: проверка файла до заливки. */
  fileTypes: Record<string, string[]>
  /**
   * Записать значение сразу, не дожидаясь кнопки «Сохранить». Пользуется только
   * выбор файла: файл уже в проекте, и путь обязан попасть в граф тем же
   * действием.
   */
  commit: (value: ExposedOptionValue) => Promise<void>
}

/** Моноширинное поле: цифры не должны прыгать при наборе. */
const numericInput = "h-8 text-right font-mono text-[13px]"

export function CheckboxControl({ value, disabled, onChange }: ControlProps) {
  return (
    <Switch
      checked={value === true}
      disabled={disabled}
      onCheckedChange={(checked) => onChange(checked)}
    />
  )
}

export function SliderControl({
  option,
  value,
  disabled,
  onChange,
}: ControlProps) {
  const cfg = option.numeric!
  const current = typeof value === "number" ? value : cfg.min
  const [text, setText] = useState(() => formatNumeric(current, cfg))

  // Значение могло прийти снаружи — после сохранения сервер отдаёт зажатое.
  useEffect(() => setText(formatNumeric(current, cfg)), [current, cfg])

  const commitText = () => {
    const parsed = parseNumeric(text, cfg, cfg.allowManualOverride)
    if (parsed === null) {
      setText(formatNumeric(current, cfg)) // мусор на входе — откат
      return
    }
    setText(formatNumeric(parsed, cfg))
    onChange(parsed)
  }

  return (
    <div className="flex items-center gap-3">
      {option.showMinMax ? (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatNumeric(cfg.min, cfg)}
        </span>
      ) : null}

      <Slider
        // Ручной ввод может увести значение за границы — сам бегунок за рельсу
        // при этом не уезжает, как и в программе.
        value={[clampForFormat(current, cfg)]}
        min={cfg.min}
        max={cfg.max}
        step={cfg.step}
        disabled={disabled}
        onValueChange={([next]) => onChange(clampForFormat(next!, cfg))}
        className="flex-1"
      />

      {option.manualInput ? (
        <Input
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
          }}
          className={cn(numericInput, cfg.format === "timecode" ? "w-24" : "w-16")}
        />
      ) : (
        <span className="min-w-[3rem] shrink-0 text-right font-mono text-[13px]">
          {formatNumeric(current, cfg)}
        </span>
      )}

      {option.showMinMax ? (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatNumeric(cfg.max, cfg)}
        </span>
      ) : null}
    </div>
  )
}

export function ValueRangeControl({
  option,
  value,
  disabled,
  onChange,
}: ControlProps) {
  const cfg = option.numeric!
  const [low, high] = Array.isArray(value)
    ? [Number(value[0]), Number(value[1])]
    : [cfg.min, cfg.max]
  const [lowText, setLowText] = useState(() => formatNumeric(low, cfg))
  const [highText, setHighText] = useState(() => formatNumeric(high, cfg))

  useEffect(() => {
    setLowText(formatNumeric(low, cfg))
    setHighText(formatNumeric(high, cfg))
  }, [low, high, cfg])

  /** lo ≤ hi — как в ноде: пара всегда отсортирована. */
  const commit = (nextLow: number, nextHigh: number) => {
    onChange([Math.min(nextLow, nextHigh), Math.max(nextLow, nextHigh)])
  }

  const commitText = (edge: 0 | 1, raw: string) => {
    const parsed = parseNumeric(raw, cfg, cfg.allowManualOverride)
    if (parsed === null) {
      setLowText(formatNumeric(low, cfg))
      setHighText(formatNumeric(high, cfg))
      return
    }
    commit(edge === 0 ? parsed : low, edge === 0 ? high : parsed)
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={lowText}
        disabled={disabled}
        onChange={(e) => setLowText(e.target.value)}
        onBlur={(e) => commitText(0, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
        }}
        className={cn(
          numericInput,
          "text-center",
          cfg.format === "timecode" ? "w-24" : "w-16",
        )}
      />

      <Slider
        value={[clampForFormat(low, cfg), clampForFormat(high, cfg)]}
        min={cfg.min}
        max={cfg.max}
        step={cfg.step}
        disabled={disabled}
        onValueChange={([nextLow, nextHigh]) => commit(nextLow!, nextHigh!)}
        className="flex-1"
      />

      <Input
        value={highText}
        disabled={disabled}
        onChange={(e) => setHighText(e.target.value)}
        onBlur={(e) => commitText(1, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
        }}
        className={cn(
          numericInput,
          "text-center",
          cfg.format === "timecode" ? "w-24" : "w-16",
        )}
      />
    </div>
  )
}

export function TimecodeControl({ value, disabled, onChange }: ControlProps) {
  const seconds = typeof value === "number" ? value : 0
  const [text, setText] = useState(() => secondsToTimecode(seconds))

  useEffect(() => setText(secondsToTimecode(seconds)), [seconds])

  const commit = () => {
    const parsed = Math.max(0, parseTimecodeInput(text))
    setText(secondsToTimecode(parsed))
    onChange(parsed)
  }

  return (
    <Input
      value={text}
      disabled={disabled}
      placeholder="00:00:00"
      onChange={(e) => {
        // Допускаем ровно то, из чего складывается таймкод.
        if (/^[0-9.,:\s]*$/.test(e.target.value)) setText(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
      }}
      className={cn(numericInput, "w-28 text-left")}
    />
  )
}

export function TextEditControl({
  option,
  value,
  disabled,
  onChange,
}: ControlProps) {
  return (
    <Textarea
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      rows={4}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "min-h-[80px] resize-y text-[13px]",
        // Подсветки синтаксиса на сайте нет, но код в пропорциональном шрифте
        // читать невозможно — для не-plaintext оставляем моноширинный.
        option.language && option.language !== "plaintext" ? "font-mono" : null,
      )}
    />
  )
}

export function DdmControl({
  option,
  value,
  disabled,
  onChange,
}: ControlProps) {
  const { t } = useI18n()
  const current = typeof value === "string" ? value : ""

  // freeInput — своё значение помимо списка; в графе такие ddm встречаются
  // там, где вариант нельзя перечислить заранее.
  if (option.freeInput) {
    return (
      <Input
        value={current}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-[13px]"
      />
    )
  }

  return (
    <Select
      value={current || undefined}
      disabled={disabled || option.options.length === 0}
      onValueChange={(next) => onChange(next)}
    >
      <SelectTrigger className="h-8 text-[13px]">
        <SelectValue placeholder={t.optionsSelect} />
      </SelectTrigger>
      <SelectContent>
        {option.options.map((item) => (
          <SelectItem key={item} value={item} className="text-[13px]">
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function AutocompleteControl({
  option,
  value,
  disabled,
  onChange,
}: ControlProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const selected = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []

  const pick = (item: string) => {
    if (!option.multiSelect) {
      onChange([item])
      setOpen(false)
      return
    }
    if (selected.includes(item) && !option.allowDuplicates) {
      onChange(selected.filter((s) => s !== item))
      return
    }
    onChange([...selected, item])
  }

  const remove = (index: number) =>
    onChange(selected.filter((_, i) => i !== index))

  const trimmed = query.trim()
  // optionsOnly — своё значение вписать нельзя, только выбрать из списка.
  const canCreate =
    !option.optionsOnly && trimmed !== "" && !option.options.includes(trimmed)

  return (
    <div className="space-y-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((item, index) => (
            <span
              key={`${item}-${index}`}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-[hsl(var(--surface-2))] px-2 py-0.5 text-xs"
            >
              {item}
              {disabled ? null : (
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  aria-label={item}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : null}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            className="h-8 w-full justify-between text-[13px] font-normal"
          >
            {t.optionsSelect}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[14rem] p-0" align="start">
          <Command>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={t.optionsSelect}
              className="text-[13px]"
            />
            <CommandList>
              <CommandEmpty>{t.optionsNothingFound}</CommandEmpty>
              <CommandGroup>
                {option.options.map((item) => (
                  <CommandItem
                    key={item}
                    value={item}
                    onSelect={() => pick(item)}
                    className="text-[13px]"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-3.5 w-3.5",
                        selected.includes(item) ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {item}
                  </CommandItem>
                ))}
                {canCreate ? (
                  <CommandItem
                    value={trimmed}
                    onSelect={() => {
                      pick(trimmed)
                      setQuery("")
                    }}
                    className="text-[13px]"
                  >
                    <Check className="mr-2 h-3.5 w-3.5 opacity-0" />
                    {trimmed}
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** Контрол по `controlType`: тем же ключом, каким он назван в графе. */
/**
 * Учётка внешнего сервиса (пункт 7 запроса клиента).
 *
 * Варианты знает не граф, а сайт: это учётки ЭТОГО человека по ЭТОМУ сервису.
 * Поэтому список тянется запросом, а не приходит в `option.options` — и по той
 * же причине рядом стоит ссылка на «Мои ключи»: подключить ключ отсюда нельзя,
 * он один на все проекты и живёт в своём разделе.
 *
 * ⚠️ В значении лежит МЕТКА, а не секрет. Секрет наружу не отдаётся никогда,
 * даже владельцу: попади он в `options.json`, он оказался бы и в зеркале
 * проекта на каждой машине парка.
 */
function VendorAccountControl({ option, value, disabled, onChange }: ControlProps) {
  const { t } = useI18n()
  const [labels, setLabels] = useState<string[] | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch("/api/account/vendor-keys", { cache: "no-store" })
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as {
          accounts: { label: string; serviceSlug: string }[]
        }
        if (!alive) return
        setLabels(
          body.accounts
            .filter((a) => a.serviceSlug === option.service)
            .map((a) => a.label),
        )
      } catch {
        // Список не загрузился — показываем пустой. Ронять всю вкладку настроек
        // из-за одного контрола нельзя: остальные параметры к ключам отношения
        // не имеют.
        if (alive) setLabels([])
      }
    })()
    return () => {
      alive = false
    }
  }, [option.service])

  const current = typeof value === "string" ? value : ""
  const known = labels ?? []
  // Метка, которой больше нет в списке: учётку отозвали, а в проекте она
  // осталась. Показываем её отдельным пунктом, иначе поле молча опустело бы, и
  // человек не понял бы, почему обработка встала.
  const orphan = current !== "" && !known.includes(current)

  return (
    <div className="space-y-1.5">
      <Select
        value={current}
        disabled={disabled || labels === null}
        onValueChange={(next) => onChange(next)}
      >
        <SelectTrigger className="h-8 text-[13px]">
          <SelectValue placeholder={t.optionsAccountPick} />
        </SelectTrigger>
        <SelectContent>
          {orphan ? (
            <SelectItem value={current}>
              {current} — {t.optionsAccountMissing}
            </SelectItem>
          ) : null}
          {known.map((label) => (
            <SelectItem key={label} value={label}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <a
        href="/account/vendor-keys"
        className="inline-block text-[11px] text-ws-4 underline-offset-2 hover:underline"
      >
        {labels !== null && known.length === 0
          ? t.optionsAccountNone
          : t.optionsAccountManage}
      </a>
    </div>
  )
}

/** Расширение имени файла: без точки, в нижнем регистре. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

/**
 * Знает ли конвейер файл с таким расширением.
 *
 * Словарь — общий список расширений из настроек конвейера. Пустой означает
 * «проверить нечем» (настройки не прочитались), и тогда запрещать нечего:
 * отказ выглядел бы поломкой выбора файла.
 *
 * Расширения нормализуем на сравнении, а не доверяем источнику: словарь правят
 * руками в админке, и туда легко попадает `.PNG`.
 */
function isKnownFileType(
  name: string,
  dictionary: Record<string, string[]>,
): boolean {
  const lists = Object.values(dictionary)
  if (lists.length === 0) return true

  const ext = extensionOf(name)
  // Файл без расширения тип определить не даёт: в программе он резолвится по
  // расширению и попадает в «files».
  if (!ext) return false

  return lists.some((list) =>
    list.some((item) => item.replace(/^\.+/, "").toLowerCase() === ext),
  )
}

/**
 * Выбор файла (`pathNavigator` в программе).
 *
 * Единственный контрол, который значение не правит, а СОЗДАЁТ: файл лежит на
 * компьютере клиента, и путь появляется только после загрузки его в проект. В
 * ноде это выбор файла на машине; здесь машины нет, поэтому «выбрать» значит
 * «залить».
 *
 * Выбрал файл — и он сразу залит и сразу записан в граф, без кнопки
 * «Сохранить». Иначе состояния разъезжаются: файл уже лежит в `Assets/`, а
 * путь к нему остался бы в черновике, и уход со страницы оставлял бы в проекте
 * файл, о котором граф не знает.
 *
 * Тип проверяется ДО заливки, по словарю типов проекта: неподдерживаемый файл
 * иначе доехал бы до хранилища и молча ничего не дал — обработка его просто не
 * подхватит, и причину человек не узнает.
 */
function PathNavigatorControl({
  value,
  disabled,
  projectId,
  fileTypes,
  commit,
}: ControlProps) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [percent, setPercent] = useState<number | null>(null)

  const current = typeof value === "string" ? value : ""
  const fileName = current.slice(current.lastIndexOf("/") + 1)
  const busy = percent !== null

  /**
   * Фильтр системного диалога — из того же словаря конвейера: неподходящий файл
   * лучше не дать выбрать, чем отказать после выбора.
   *
   * Это подсказка, а не запрет (в диалоге можно переключиться на «все файлы»),
   * поэтому проверка при заливке остаётся. Пустой словарь — фильтра нет, иначе
   * диалог не дал бы выбрать ничего.
   */
  const accept = [
    ...new Set(
      Object.values(fileTypes)
        .flat()
        .map((item) => `.${item.replace(/^\.+/, "").toLowerCase()}`),
    ),
  ].join(",")

  const upload = async (file: File) => {
    if (!isKnownFileType(file.name, fileTypes)) {
      toast.error(t.optionsFileUnsupported)
      return
    }
    setPercent(0)
    try {
      const uploaded = await uploadProjectFileDirect({
        projectId,
        file,
        folderPath: ASSETS_FOLDER_NAME,
        // Перезаписываем ТОЛЬКО файл этого свойства. Одноимённый файл другого
        // слота — чужой, затирать его нельзя: там сработает обычное правило
        // хранилища с « (2)», а под каким именем файл лёг, скажет ответ.
        overwrite:
          `${ASSETS_FOLDER_NAME}/${file.name}`.toLowerCase() ===
          current.toLowerCase(),
        onProgress: setPercent,
      })
      await commit(`${ASSETS_FOLDER_NAME}/${uploaded.name}`)
    } catch (error) {
      // Отмену не показываем: человек сам нажал, и тост сообщил бы ему то, что
      // он только что сделал.
      if (!isUploadCancelled(error)) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : t.optionsFileFailed,
        )
      }
    } finally {
      setPercent(null)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-mono text-[13px]",
          fileName ? "text-ws-2" : "text-ws-4",
        )}
      >
        {busy
          ? `${t.optionsFileUploading} ${percent}%`
          : fileName || t.optionsFileEmpty}
      </span>

      <input
        ref={inputRef}
        type="file"
        accept={accept || undefined}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Сбрасываем поле сразу: выбрав тот же файл второй раз, человек ждёт
          // повторной заливки, а события на одинаковом значении не будет.
          e.target.value = ""
          if (file) void upload(file)
        }}
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className="h-8 shrink-0 gap-1.5 text-[13px] font-normal"
      >
        <Upload className="h-3.5 w-3.5" />
        {fileName ? t.optionsFileReplace : t.optionsFileUpload}
      </Button>
    </div>
  )
}

/**
 * Наложение объекта на кадр. Обёртка над модалкой: сюда приходит строка с JSON,
 * обратно уходит она же — разбор и слияние живут в lib/options/overlay.ts.
 *
 * Референс в рамке — файл из ноды-источника: путь даёт обход ребра графа
 * (lib/options/overlay-reference.ts), ссылку — слой хранилища. Пусто, когда
 * источник не файл или не найден; рамка тогда остаётся пустой.
 */
function OverlaySettingsControl({ option, value, disabled, onChange }: ControlProps) {
  return (
    <OverlayControl
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      onChange={onChange}
      referenceUrl={option.referenceUrl}
    />
  )
}

/**
 * Смена формата кадра. Обёртка над модалкой: строка с JSON туда и обратно,
 * разбор и слияние — lib/options/video-adjust.ts.
 */
function VideoAdjustSettingsControl({ value, disabled, onChange }: ControlProps) {
  return (
    <VideoAdjustControl
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      onChange={onChange}
    />
  )
}

/**
 * Титры. Обёртка над модалкой: строка с JSON туда и обратно, разбор и слияние —
 * lib/options/title.ts.
 */
function TitleSettingsControl({
  value,
  disabled,
  projectId,
  onChange,
}: ControlProps) {
  return (
    <TitleControl
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      projectId={projectId}
      onChange={onChange}
    />
  )
}

/**
 * Конвертация файла. Обёртка над модалкой: строка с JSON туда и обратно, разбор
 * и слияние — lib/options/convert.ts.
 */
function ConvertSettingsControl({ value, disabled, onChange }: ControlProps) {
  return (
    <ConvertControl
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      onChange={onChange}
    />
  )
}

export const OPTION_CONTROLS: Record<
  ExposedOption["control"],
  (props: ControlProps) => React.ReactNode
> = {
  checkbox: CheckboxControl,
  slider: SliderControl,
  timecode: TimecodeControl,
  valueRange: ValueRangeControl,
  ddm: DdmControl,
  autocomplete: AutocompleteControl,
  textedit: TextEditControl,
  vendorAccount: VendorAccountControl,
  pathNavigator: PathNavigatorControl,
  overlaySettings: OverlaySettingsControl,
  videoAdjustment: VideoAdjustSettingsControl,
  titleSettings: TitleSettingsControl,
  convertSettings: ConvertSettingsControl,
}

/** Значение строкой — для заблокированных полей и подписей. */
export function formatOptionValue(
  option: ExposedOption,
  value: ExposedOptionValue,
  emptyLabel: string,
): string {
  if (typeof value === "boolean") return value ? "✓" : "—"
  if (typeof value === "number") {
    if (option.control === "timecode") return secondsToTimecode(value)
    return option.numeric ? formatNumeric(value, option.numeric) : String(value)
  }
  if (Array.isArray(value)) {
    if (option.control === "valueRange" && option.numeric) {
      const [low, high] = value as [number, number]
      return `${formatNumeric(low, option.numeric)} — ${formatNumeric(high, option.numeric)}`
    }
    return value.length ? (value as string[]).join(", ") : emptyLabel
  }
  return value.trim() ? value : emptyLabel
}
