/**
 * Мелкие UI-предпочтения: свёрнутость панелей, выбранная вкладка, режим списка.
 *
 * Храним в куках, а не в localStorage (решение 2026-09-17): куку при желании
 * читает и серверный компонент — первый кадр может прийти уже с учётом выбора
 * (так работает тема, см. `lib/theme.ts`), localStorage до гидратации недоступен
 * в принципе. Плата — значения ездят с каждым запросом, поэтому здесь только
 * короткие строки, и ничего чувствительного: это оформление, а не данные.
 *
 * Кука ставится на клиенте, `document.cookie`, без похода на сервер — отклик
 * на действие обязан быть мгновенным, а один и тот же человек на двух машинах
 * волен смотреть по-разному.
 *
 * Реестр всех таких настроек — docs/UI_PREFS.md: новый ключ сначала туда.
 */

const MAX_AGE_YEAR = 60 * 60 * 24 * 365

/** Читает куку по имени. На сервере (нет `document`) всегда `null`. */
export function readUiPref(name: string): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

/** Пишет куку на год. Имя — из реестра docs/UI_PREFS.md, значение — короткое. */
export function writeUiPref(name: string, value: string): void {
  if (typeof document === "undefined") return
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE_YEAR}; samesite=lax`
}
