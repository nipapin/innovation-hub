/**
 * Тема оформления — docs/THEMING_PLAN.md §5.
 *
 * Чистый модуль: без базы и без `next/headers`, потому что его импортируют и
 * серверный layout, и клиентский переключатель. Одно определение допустимых
 * значений, а не по копии на слой.
 */
export const THEME_COOKIE = "theme"

/**
 * Три значения, а не два. `system` — умолчание: `prefers-color-scheme` уже знает
 * ответ, и спрашивать человека о том, что известно, незачем.
 */
export const THEME_CHOICES = ["system", "light", "dark"] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return (
    typeof value === "string" &&
    (THEME_CHOICES as readonly string[]).includes(value)
  )
}

/**
 * Скрипт, проставляющий `data-theme` до первой отрисовки.
 *
 * Нужен ровно для `system`: выбранную тему сервер знает из куки и ставит в
 * разметку сам, а системную знает только браузер. Без этого скрипта светлой
 * системной теме предшествовал бы тёмный кадр — заметно на каждой загрузке.
 *
 * Инлайном в <head>, а не эффектом React: эффект выполняется после гидратации,
 * то есть после первой отрисовки, и вспышка случится всё равно.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var m=document.cookie.match(/(?:^|; )theme=([^;]*)/);
var c=m?decodeURIComponent(m[1]):'system';
var t=c==='system'?(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):c;
document.documentElement.setAttribute('data-theme',t);
}catch(e){}})()`
