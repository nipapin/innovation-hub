"use client"

import { useEffect, useMemo, useState } from "react"

import { useI18n } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  convertCodec,
  convertKind,
  CONVERT_AUDIO_FORMATS,
  CONVERT_FORMATS,
  CONVERT_IMAGE_FORMATS,
  CONVERT_VIDEO_FORMATS,
  mergeConvertValue,
  parseConvertValue,
  type ConvertFormat,
  type ConvertQuality,
  type ConvertSize,
  type ConvertValue,
} from "@/lib/options/convert"
import { cn } from "@/lib/utils"
import { FieldGroup } from "./modal-fields"

/**
 * Конвертация файла — docs/CONVERT_CONTROL_PLAN.md.
 *
 * В программе это редактор ЦЕПОЧКИ: два десятка видеофильтров и тринадцать
 * аудио, 3777 строк интерфейса. Клиенту отданы четыре выбора — формат,
 * качество, размер кадра и звук. Фильтры и кодеки остаются автору графа.
 *
 * Превью здесь нет и быть не может: клиент выбирает СВОЙСТВА ФАЙЛА, а картинка
 * в mp4 и в mov выглядит одинаково. Вместо него — карточка результата словами.
 */

const STAGE_MAX = 300

/** Ряд кнопок-вариантов. Тот же приём, что у заготовок титров. */
function ChoiceRow<T extends string>({
  options,
  value,
  labels,
  onChange,
}: {
  options: readonly T[]
  value: T
  labels: Record<T, string>
  onChange: (next: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((item) => (
        <Button
          key={item}
          type="button"
          size="sm"
          variant={item === value ? "default" : "outline"}
          onClick={() => onChange(item)}
          className="text-[12px] font-normal"
        >
          {labels[item]}
        </Button>
      ))}
    </div>
  )
}

/**
 * Что получится — словами.
 *
 * Кодек показывается, хотя и не правится: клиент должен видеть, чем файл будет
 * пересобран. Особенно когда автор поставил `copy` — тогда перекодирования не
 * будет вовсе, и «максимальное качество» ни на что не повлияет.
 */
function ResultCard({
  value,
  codec,
  qualityLabel,
  sizeLabel,
}: {
  value: ConvertValue
  codec: string | null
  qualityLabel: string
  sizeLabel: string
}) {
  const { t } = useI18n()
  const kind = convertKind(value.format)
  return (
    <div
      style={{ width: STAGE_MAX, height: STAGE_MAX }}
      className="flex shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-border/60 bg-foreground/[0.03] p-6 text-center"
    >
      <span className="font-mono text-[28px] font-semibold uppercase text-foreground">
        {value.format}
      </span>
      {/* Три рода — три разные карточки. Показывать «кодек · 1080p» у mp3
          значило бы обещать то, чего в звуковом файле нет. */}
      {kind === "video" ? (
        <span className="text-[13px] text-muted-foreground">
          {`${codec ?? "—"} · ${sizeLabel}`}
        </span>
      ) : kind === "image" ? (
        <span className="text-[13px] text-muted-foreground">{sizeLabel}</span>
      ) : (
        <span className="text-[13px] text-muted-foreground">{t.cvAudioOnly}</span>
      )}
      <span className="text-[13px] text-muted-foreground">{qualityLabel}</span>
      {kind === "video" ? (
        <span className="text-[13px] text-muted-foreground">
          {value.audio ? t.cvWithAudio : t.cvNoAudio}
        </span>
      ) : null}
      {codec === "copy" && kind === "video" ? (
        <span className="mt-1 text-[11px] leading-snug text-amber-400">
          {t.cvCopyNote}
        </span>
      ) : null}
    </div>
  )
}

export function ConvertControl({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled: boolean
  onChange: (next: string) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ConvertValue>(() => parseConvertValue(value))

  useEffect(() => {
    if (open) setDraft(parseConvertValue(value))
  }, [open, value])

  const codec = useMemo(() => convertCodec(value), [value])

  const qualityLabels: Record<ConvertQuality, string> = {
    draft: t.cvQualityDraft,
    normal: t.cvQualityNormal,
    high: t.cvQualityHigh,
    max: t.cvQualityMax,
    custom: t.cvQualityCustom,
  }
  const sizeLabels: Record<ConvertSize, string> = {
    source: t.cvSizeSource,
    "1080": "1080p",
    "720": "720p",
    "480": "480p",
  }
  const formatLabels = Object.fromEntries(
    CONVERT_FORMATS.map((item) => [item, item.toUpperCase()]),
  ) as Record<ConvertFormat, string>

  const summary = useMemo(() => {
    const parsed = parseConvertValue(value)
    return `${parsed.format.toUpperCase()} · ${qualityLabels[parsed.quality]} · ${
      sizeLabels[parsed.size]
    }`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, t])

  const kind = convertKind(draft.format)
  const set = (patch: Partial<ConvertValue>) =>
    setDraft((prev) => ({ ...prev, ...patch }))

  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ws-4">
        {summary}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="h-8 shrink-0 text-[13px] font-normal"
      >
        {t.cvConfigure}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t.cvTitle}</DialogTitle>
            <DialogDescription>{t.cvHint}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 sm:flex-row">
            <ResultCard
              value={draft}
              codec={codec}
              qualityLabel={qualityLabels[draft.quality]}
              sizeLabel={sizeLabels[draft.size]}
            />

            <div className="min-w-0 flex-1 space-y-5">
              {/* Форматы разбиты по роду, а не свалены в один ряд из десяти
                  кнопок: выбирают сначала «во что вообще» — в ролик, картинку
                  или звук, — и только потом расширение. */}
              <FieldGroup title={t.cvFormat}>
                <div className="space-y-2">
                  {(
                    [
                      ["cvKindVideo", CONVERT_VIDEO_FORMATS],
                      ["cvKindImage", CONVERT_IMAGE_FORMATS],
                      ["cvKindAudio", CONVERT_AUDIO_FORMATS],
                    ] as const
                  ).map(([labelKey, list]) => (
                    <div key={labelKey} className="flex flex-wrap items-center gap-1.5">
                      <span className="w-[72px] shrink-0 text-[11px] text-muted-foreground">
                        {t[labelKey]}
                      </span>
                      <ChoiceRow<ConvertFormat>
                        options={list}
                        value={draft.format}
                        labels={formatLabels}
                        onChange={(format) => set({ format })}
                      />
                    </div>
                  ))}
                </div>
              </FieldGroup>

              <FieldGroup title={t.cvQuality}>
                {/* «Своё» показываем ТОЛЬКО когда числа автора ни с чем не
                    совпали: это не вариант выбора, а честное «здесь стоят
                    другие значения». Нажать на него нельзя — он исчезнет сам,
                    как только выбрать любую заготовку. */}
                <ChoiceRow<ConvertQuality>
                  options={
                    draft.quality === "custom"
                      ? (["custom", "draft", "normal", "high", "max"] as const)
                      : (["draft", "normal", "high", "max"] as const)
                  }
                  value={draft.quality}
                  labels={qualityLabels}
                  onChange={(quality) =>
                    quality === "custom" ? undefined : set({ quality })
                  }
                />
              </FieldGroup>

              {/* Кадра у звукового выхода нет, дорожки — у картинки. Разделы
                  выбираются расширением, и показывать неприменимое значило бы
                  обещать несбыточное. */}
              {kind === "audio" ? null : (
                <FieldGroup title={t.cvSize}>
                  <ChoiceRow<ConvertSize>
                    options={["source", "1080", "720", "480"]}
                    value={draft.size}
                    labels={sizeLabels}
                    onChange={(size) => set({ size })}
                  />
                </FieldGroup>
              )}

              {kind === "video" ? (
                <FieldGroup title={t.cvAudio}>
                  <ChoiceRow<"on" | "off">
                    options={["on", "off"]}
                    value={draft.audio ? "on" : "off"}
                    labels={{ on: t.cvWithAudio, off: t.cvNoAudio }}
                    onChange={(next) => set({ audio: next === "on" })}
                  />
                </FieldGroup>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t.cvCancel}
            </Button>
            <Button
              onClick={() => {
                onChange(mergeConvertValue(value, draft))
                setOpen(false)
              }}
            >
              {t.cvApply}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
