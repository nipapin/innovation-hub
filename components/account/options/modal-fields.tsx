"use client"

import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"

/**
 * Поля модалок тяжёлых контролов — общие для наложения и смены формата.
 *
 * Вынесены отдельно, потому что обе модалки должны выглядеть одинаково: человек
 * открывает их в одном списке настроек, одну за другой, и разный вид одного и
 * того же ползунка читался бы как «это другой продукт».
 */

/**
 * Подпись, значение и шкала.
 *
 * Значение показывается ВСЕГДА, а не в подсказке при перетаскивании: ползунок с
 * диапазоном в тысячу пикселей без числа рядом не даёт попасть в нужное, а
 * попадать приходится — раскладка потом уезжает в реальный ролик.
 */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (value: number) => string
  onChange: (next: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-[12px] text-muted-foreground">{label}</Label>
        <span className="font-mono text-[12px] text-foreground">
          {format ? format(value) : Math.round(value)}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => onChange(next ?? value)}
      />
    </div>
  )
}

/** Заголовок группы настроек: «Кадр», «Фон», «Положение». */
export function FieldGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  )
}
