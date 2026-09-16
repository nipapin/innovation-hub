# UI Tokens — палитра, типографика и общие CSS-элементы

Справочник по дизайн-токенам проекта. Правила их применения — в [UI_GUIDE.md](./UI_GUIDE.md).

**Главное правило:** цвет, радиус, тень и типографический стиль в компоненте задаются
только через токен или производную от него утилиту. Хардкод `#hex` / `rgba()` — ошибка ревью.

---

## 1. Где живут токены

| Файл | Что содержит |
|---|---|
| `app/globals.css` | `:root { --* }` — источник истины по значениям; `@layer base` (фон body, дефолтный border); `@layer utilities` — композитные утилиты |
| `tailwind.config.ts` | Маппинг переменных в Tailwind-классы (`colors`, `borderRadius`, `boxShadow`, `backgroundImage`, `keyframes`, `animation`, `fontFamily`) |
| `components.json` | Конфиг shadcn CLI: `cssVariables: true`, `baseColor: neutral`, префикса нет |

> ⚠️ `styles/globals.css` — **мёртвый файл** (светлая тема shadcn по умолчанию), нигде не импортируется. Не редактируйте его, изменения ни на что не повлияют.

Формат значений — компоненты HSL без обёртки: `--primary: 214 88% 66%`. Поэтому в CSS их
всегда оборачивают: `hsl(var(--primary))`, а с прозрачностью — `hsl(var(--primary) / 0.25)`.

**Тема одна — тёмная.** Значения лежат прямо в `:root`, класса `.dark` нет, `darkMode: ['class']`
в конфиге остался от шаблона. Варианты `dark:` не пишем.

---

## 2. Цветовые токены

### 2.1. База

| Токен | HSL | Tailwind | Назначение |
|---|---|---|---|
| `--background` | `226 31% 7%` | `bg-background` | Фон приложения (поверх — градиент из `@layer base`) |
| `--foreground` | `210 33% 96%` | `text-foreground` | Основной текст |
| `--card` | `225 24% 11%` | `bg-card` | Фон карточки |
| `--card-foreground` | `214 20% 90%` | `text-card-foreground` | Текст на карточке |
| `--popover` | `225 24% 11%` | `bg-popover` | Фон поповера/меню |
| `--popover-foreground` | `214 20% 90%` | `text-popover-foreground` | Текст в поповере |
| `--border` | `224 18% 23%` | `border-border` | Все разделители и рамки |
| `--input` | `224 18% 23%` | `border-input` | Рамка полей ввода |
| `--ring` | `214 88% 66%` | `ring-ring` | Кольцо фокуса |
| `--radius` | `0.75rem` | — | База шкалы радиусов |

### 2.2. Смысловые роли

| Токен | HSL | Tailwind | Назначение |
|---|---|---|---|
| `--primary` | `214 88% 66%` | `bg-primary`, `text-primary` | Ключевое действие, активное состояние, акцент бренда |
| `--primary-foreground` | `224 44% 11%` | `text-primary-foreground` | Текст на `primary` |
| `--secondary` | `225 17% 16%` | `bg-secondary` | Второстепенная кнопка/плашка |
| `--secondary-foreground` | `214 23% 84%` | `text-secondary-foreground` | Текст на `secondary`; вторичный текст |
| `--muted` | `225 18% 14%` | `bg-muted` | Приглушённый фон |
| `--muted-foreground` | `215 13% 65%` | `text-muted-foreground` | Вторичный текст, подписи, плейсхолдеры |
| `--accent` | `214 88% 66%` | `bg-accent` | Ховер-подсветка в меню (равен `primary`) |
| `--accent-foreground` | `220 38% 10%` | `text-accent-foreground` | Текст на `accent` |
| `--destructive` | `0 84% 60%` | `bg-destructive`, `text-destructive` | Удаление, ошибки |
| `--destructive-foreground` | `0 0% 98%` | `text-destructive-foreground` | Текст на `destructive` |
| `--success` | `150 72% 47%` | `text-success`, `bg-success` | Успех, «активно», «подключено» |
| `--warning` | `40 90% 58%` | `text-warning` | Предупреждение, «на паузе» |
| `--info` | `204 94% 60%` | `text-info` | Информационные подсказки |

### 2.3. Поверхности (шкала высоты)

Фон приложения → панель → карточка → приподнятый блок:

| Токен | HSL | Tailwind | Где |
|---|---|---|---|
| `--surface-overlay` | `220 35% 6%` | `bg-surface-overlay` | Самый глубокий слой: подложка списков, оверлеи |
| `--background` | `226 31% 7%` | `bg-background` | Холст страницы |
| `--surface-1` | `225 30% 9%` | `bg-surface-1` | Сайдбар, боковые панели, поля ввода в воркспейсе |
| `--surface-2` | `225 24% 12%` | `bg-surface-2` | Панели, карточки контента |
| `--surface-3` | `224 20% 16%` | `bg-surface-3` | Ховер/приподнятый элемент, контекстное меню |

### 2.4. Рабочая область (`/account`, `/admin`)

Отдельная шкала для рабочего инструмента: плотный тёмно-синий интерфейс, который
не должен зависеть от палитры публичного сайта. Все значения перенесены один в один
из макета «FF Works — Workspace».

| Токен | HSL | Tailwind | Назначение |
|---|---|---|---|
| `--ws-well` | `220 37% 6%` | `bg-ws-well` | Самый глубокий слой: колонка проектов, подложка окна превью |
| `--ws-panel` | `226 26% 9.5%` | `bg-ws-panel` | Панели и области (файловая, IN / OUT, нижняя) |
| `--ws-control` | `220 32% 9%` | `bg-ws-control` | Строки, карточки файлов, инпуты, сегменты |
| `--ws-raised` | `222 30% 12%` | `bg-ws-raised` | Контекстное меню, диалоги |
| `--ws-hover` | `221 31% 13%` | `bg-ws-hover` | Ховер приподнятых элементов, пузырь чата |
| `--ws-text-1` | `217 31% 95%` | `text-ws-1` | Основной текст |
| `--ws-text-2` | `220 14% 79%` | `text-ws-2` | Вторичный текст, пункты меню |
| `--ws-text-3` | `220 10% 64%` | `text-ws-3` | Подписи, неактивные вкладки |
| `--ws-text-4` | `221 9% 42%` | `text-ws-4` | Мета файлов, плейсхолдеры, счётчики |
| `--ws-text-5` | `224 13% 33%` | `text-ws-5` | Служебные подписи, разделители-глифы, пустые состояния |
| `--ws-accent` | `211 68% 62%` | `text-ws-accent` | Заголовки секций, акцент панели IN |
| `--ws-action` | `217 89% 53%` | `bg-ws-action` | Главная кнопка действия |
| `--ws-action-hover` | `217 81% 46%` | `hover:bg-ws-action-hover` | Её ховер |
| `--ws-select` | `212 74% 52%` | `bg-ws-select/…` | Выделение: подсветки, активные сегменты, маркер |
| `--ws-out` | `153 60% 53%` | `text-ws-out` | Статус «активен», акцент панели OUT |

Правило то же: оттенки набираются прозрачностью (`bg-ws-select/[0.16]`,
`border-ws-accent/35`), новых цветов не заводим.

### 2.5. Сайдбар

Отдельный набор, чтобы навигацию можно было перекрасить, не трогая контент:

| Токен | HSL | Tailwind |
|---|---|---|
| `--sidebar-background` | `226 28% 9%` | `bg-sidebar` |
| `--sidebar-foreground` | `214 20% 88%` | `text-sidebar-foreground` |
| `--sidebar-primary` | `214 88% 66%` | `bg-sidebar-primary` |
| `--sidebar-primary-foreground` | `224 44% 11%` | `text-sidebar-primary-foreground` |
| `--sidebar-accent` | `225 22% 15%` | `bg-sidebar-accent` |
| `--sidebar-accent-foreground` | `214 20% 88%` | `text-sidebar-accent-foreground` |
| `--sidebar-border` | `224 18% 20%` | `border-sidebar-border` |
| `--sidebar-ring` | `214 88% 66%` | `ring-sidebar-ring` |

### 2.6. Данные и категории

Для графиков, тегов, иконок типов файлов — только эти пять, по кругу:

| Токен | HSL | Tailwind | Цвет |
|---|---|---|---|
| `--chart-1` | `214 88% 66%` | `text-chart-1` | синий (= primary) |
| `--chart-2` | `276 90% 72%` | `text-chart-2` | фиолетовый |
| `--chart-3` | `174 75% 45%` | `text-chart-3` | бирюзовый |
| `--chart-4` | `42 95% 58%` | `text-chart-4` | янтарный |
| `--chart-5` | `344 88% 63%` | `text-chart-5` | розовый |

Соответствие для иконок типов файлов задано в `components/account/workspace/format.ts`
(`fileIconClass`): папка → `text-ws-2`, изображение → `text-ws-out`, видео → `text-ws-accent`,
аудио → `text-warning`, прочее → `text-ws-3`.

### 2.7. Как получать оттенки

Новых цветов не заводим — набираем прозрачностью от существующего токена:

| Приём | Пример | Где применяется |
|---|---|---|
| Заливка-подсветка | `bg-primary/10`, `bg-primary/15` | активный пункт меню, иконка в кружке |
| Рамка-акцент | `border-primary/30`, `border-primary/40` | активная карточка, логотип |
| Приглушённая рамка | `border-border/60`, `border-border/80` | панели, разделители |
| Полупрозрачная поверхность | `bg-card/40`, `bg-card/80`, `bg-surface-2/80` | стеклянные блоки |
| Нейтральный оверлей | `bg-white/[0.03]`, `border-white/10`, `hover:bg-white/5` | подсветка на тёмном фоне (легитимно, это не цвет) |
| Текст пониженной яркости | `text-foreground/90`, `text-muted-foreground/70` | иерархия текста |
| Инлайн-цвет из токена | `shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]` | точечные тени/градиенты |

---

## 3. Типографика

### 3.1. Семейства

| Утилита | Переменная | Шрифт | Где подключается | Применение |
|---|---|---|---|---|
| `font-sans` | `--font-inter` | Inter | `app/layout.tsx` | Текст по умолчанию (`body`) |
| `font-display` | `--font-space-grotesk` | Space Grotesk | `app/layout.tsx` | Заголовки, крупные числа, логотип |
| — | `--font-ibm-plex` | IBM Plex Sans (400/500/600/700, latin + cyrillic) | `app/account/layout.tsx`, `app/admin/layout.tsx` | Весь workspace/админка — задаётся шеллом через `style={{ fontFamily: "var(--font-ibm-plex), …" }}` |

> IBM Plex не зарегистрирован в `tailwind.config.ts`. Внутри workspace он наследуется от шелла — отдельный класс ставить не нужно. Если понадобится точечно, стоит добавить в конфиг семейство `workspace: ['var(--font-ibm-plex)', 'sans-serif']`.

### 3.2. Типографические утилиты (публичный сайт)

Определены в `app/globals.css`, `@layer utilities`:

| Класс | Раскрывается в | Назначение |
|---|---|---|
| `type-display` | `font-display text-5xl font-semibold leading-[1.02] tracking-[-0.02em] text-balance md:text-6xl xl:text-7xl` | Герой-заголовок лендинга |
| `type-h1` | `font-display text-4xl font-semibold leading-[1.06] tracking-[-0.02em] text-balance md:text-5xl` | Заголовок страницы |
| `type-h2` | `font-display text-3xl font-semibold leading-[1.1] tracking-[-0.015em] text-balance md:text-4xl xl:text-5xl` | Заголовок секции |
| `type-body` | `text-base leading-relaxed text-muted-foreground md:text-lg` | Абзац описания |
| `type-eyebrow` | `text-xs uppercase tracking-[0.2em] text-muted-foreground md:text-sm` | Надзаголовок над секцией |
| `text-balance` | `text-wrap: balance` | Балансировка переносов в заголовках |

### 3.3. Типографика приложения (workspace / админка)

Утилит нет, стиль собирается классами. Канонические сочетания:

| Роль | Классы |
|---|---|
| Заголовок страницы (`h1`) | `font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl` |
| Eyebrow над `h1` | `text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/80` |
| Описание страницы | `max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-[15px]` |
| Заголовок секции в сайдбаре | `text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70` |
| Заголовок карточки | `text-2xl font-semibold leading-none tracking-tight` (`CardTitle`) |
| Метка над значением | `text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground` |
| Крупное число | `font-display text-3xl font-semibold tracking-tight tabular-nums md:text-[34px]` |
| Основной текст интерфейса | `text-sm` (14px) — базовый размер плотных экранов |
| Подпись/мета | `text-xs text-muted-foreground` |

Правила: числа всегда `tabular-nums`; трекинг у капса — `tracking-[0.18em]…[0.22em]`;
у крупных заголовков — отрицательный (`tracking-tight`).

---

## 4. Радиусы

Шкала строится от `--radius: 0.75rem`:

| Класс | Значение | Применение |
|---|---|---|
| `rounded-sm` | `calc(0.75rem - 4px)` = **8px** | Мелкие плашки, сегменты |
| `rounded-md` | `calc(0.75rem - 2px)` = **10px** | Кнопки, инпуты (дефолт shadcn) |
| `rounded-lg` | `var(--radius)` = **12px** | Карточки, панели |
| `rounded-lgx` | `calc(0.75rem + 4px)` = **16px** | Крупные панели |
| `rounded-xl` | `calc(0.75rem + 8px)` = **20px** | Иконки-контейнеры, пункты навигации |
| `rounded-2xl` | **16px** (дефолт Tailwind, не переопределён) | Карточки статистики, пустые состояния |
| `rounded-3xl` | **24px** (дефолт) | Крупные декоративные блоки |
| `rounded-full` | `9999px` | Аватары, пилюли, круглые кнопки |

> ⚠️ Ловушка: `rounded-xl` (20px) **больше**, чем `rounded-2xl` (16px), потому что переопределён только `xl`. Не полагайтесь на «чем больше цифра, тем круглее» — сверяйтесь с таблицей.

---

## 5. Тени и подсветка

| Класс | Значение | Применение |
|---|---|---|
| `shadow-glow` | `0 10px 44px -20px hsl(var(--primary) / 0.55)` | Главная CTA-кнопка лендинга |
| `shadow-glow-soft` | `0 10px 30px -18px hsl(var(--primary) / 0.35)` | Кнопка в хедере, мягкий акцент |
| `shadow-panel` | `0 16px 60px -34px hsl(218 80% 60% / 0.45)` | Крупная всплывающая панель |
| `shadow-ws-panel` | `0 3px 12px rgb(0 0 0 / 0.22)` | Панели и группы рабочей области |
| `shadow-ws-menu` | `0 18px 44px rgb(0 0 0 / 0.55)` | Контекстное меню |
| `shadow-ws-inset` | `inset 0 1px 0 rgb(255 255 255 / 0.08)` | Верхний блик выбранной карточки проекта |
| `shadow-sm` | дефолт Tailwind | Карточки (`Card`) |
| `shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]` | инлайн | Внутренняя рамка активного пункта меню |
| `shadow-[0_18px_44px_rgba(0,0,0,0.55)]` | инлайн | Контекстное меню (плавающий слой) |

Стеклянные поверхности — `backdrop-blur-xl` + полупрозрачный фон
(`bg-background/70`, `bg-surface-1/85`, `bg-white/[0.03]`).

---

## 6. Градиенты и фоновые паттерны

| Источник | Значение | Применение |
|---|---|---|
| `bg-hero-grid` | две линейные сетки по `hsl(var(--border)/0.3)`, шаг 1px | Фоновая сетка героя |
| `bg-spotlight` | `radial-gradient(closest-side at 50% 50%, hsl(var(--primary) / 0.25), transparent 70%)` | Пятно света под элементом |
| `body` (в `@layer base`) | два радиальных пятна (primary 0.17, фиолетовый 0.14) + вертикальный градиент, `background-attachment: fixed` | Глобальный фон публичного сайта |
| `.spotlight-band::before` | радиальный градиент сверху секции | Подсветка верха секции |
| `.noise-overlay::after` | точечный паттерн 3×3px, `opacity 0.08`, `mix-blend-mode: soft-light` | Плёнка «шума» на крупных блоках |

> Фон `body` фиксированный и виден на публичных страницах. Workspace перекрывает его сплошным `bg-background` на уровне шелла — это осознанно: в рабочем инструменте градиент мешает.

---

## 7. Анимации

| Класс | Определение | Применение |
|---|---|---|
| `animate-accordion-down` / `-up` | 0.2s ease-out, по `--radix-accordion-content-height` | Radix Accordion / Collapsible |
| `animate-float` | `float 8s ease-in-out infinite` (±10px по Y) | Декор лендинга |
| `animate-glow` | `glow 4s ease-in-out infinite` (opacity 0.45↔0.85) | Пульсирующая подсветка |
| `animate-spin` | Tailwind | Спиннеры (`Loader2`) |
| `animate-pulse` | Tailwind | Скелетоны, плейсхолдеры |
| `transition-colors` | — | Ховеры по умолчанию |
| `transition-all duration-300 ease-out` | — | Кнопки |
| `active:scale-[0.98]` | — | Отклик на нажатие |

Плагин `tailwindcss-animate` подключён и даёт `animate-in` / `fade-in-0` / `zoom-in-95` и т. п. —
их использует Radix-разметка в `components/ui/*`.

Framer Motion — только на публичном сайте, обычно через `MotionReveal`
(`opacity 0 → 1`, `y 18 → 0`, `0.6s`, `ease [0.22, 1, 0.36, 1]`, `viewport once`).

---

## 8. Композитные утилиты

Всё из `app/globals.css`, `@layer utilities`. Это и есть «зафиксированные общие элементы CSS».

| Класс | Раскрывается в | Применение |
|---|---|---|
| `section-shell` | `mx-auto w-full max-w-7xl px-6 lg:px-10` | Контейнер контента публичного сайта |
| `section-space` | `py-16 md:py-24 lg:py-32` | Вертикальный ритм секции |
| `section-space-tight` | `py-12 md:py-16 lg:py-20` | Уплотнённая секция |
| `premium-glass` | `border border-white/10 bg-white/[0.03] backdrop-blur-xl` | Стеклянная панель |
| `premium-card` | `rounded-2xl border border-border/80 bg-[hsl(var(--surface-2))]/80 shadow-[0_12px_60px_-28px_hsl(220_90%_65%_/_0.35)]` | Карточка с мягким свечением |
| `spotlight-band` | `relative overflow-hidden` + `::before` с радиальным градиентом | Секция с подсветкой сверху |
| `noise-overlay` | `::after` с точечным паттерном | Текстура поверх блока |
| `divider-line` | `h-px w-full bg-gradient-to-r from-transparent via-border to-transparent` | Затухающий разделитель |
| `scrollbar-elegant` | тонкий скроллбар (6px, `hsl(var(--border)/0.6)`, Firefox + WebKit) | **Любой** внутренний скролл-контейнер |
| `type-*`, `text-balance` | см. [§3.2](#32-типографические-утилиты-публичный-сайт) | Типографика |

---

## 9. Рецепты (готовые сочетания классов)

Копируйте отсюда, чтобы новые экраны совпадали с существующими.

**Панель контента**
```
rounded-lgx border border-border/60 bg-surface-1
```

**Карточка (общая)**
```
rounded-lg border bg-card text-card-foreground shadow-sm        ← примитив <Card>
```

**Карточка с ховером (статистика, список)**
```
group relative overflow-hidden rounded-2xl border border-border/70 bg-card/80 p-5
transition-colors hover:border-border
```

**Пустое состояние**
```
flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed
border-border/80 bg-card/40 px-6 py-16 text-center
```

**Загрузка (блок)**
```
flex items-center justify-center rounded-2xl border border-border/70 bg-card/40 py-16
text-sm text-muted-foreground        + <Loader2 className="mr-2 h-4 w-4 animate-spin" />
```

**Поле поиска** (обёртка `relative`)
```
icon:  pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground
input: h-10 rounded-xl border-border/70 bg-card/40 pl-9 text-sm
       placeholder:text-muted-foreground/70 focus-visible:bg-card
```

**Пункт навигации**
```
базовый:  group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm
          font-medium transition-colors
активный: bg-primary/12 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]
обычный:  text-muted-foreground hover:bg-white/[0.04] hover:text-foreground
маркер:   absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary
```

**Иконка в квадрате (внутри пункта меню / карточки)**
```
flex h-8 w-8 items-center justify-center rounded-lg border transition-colors
активная: border-primary/40 bg-primary/15 text-primary
обычная:  border-transparent bg-white/[0.03] text-muted-foreground
```

**Иконочная кнопка**
```
flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-surface-1
text-muted-foreground hover:bg-surface-2 hover:text-foreground
```

**Сегментированный переключатель** (контейнер / активный / обычный)
```
контейнер: flex gap-0.5 rounded-md border border-border/60 bg-surface-1 p-[3px]
активный:  rounded-md px-2.5 py-1 text-xs bg-primary/30 text-foreground
обычный:   rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground
```

**Пилюля / кикер**
```
inline-flex rounded-full border border-border/80 bg-surface-2/80 px-3 py-1
text-xs uppercase tracking-[0.14em] text-muted-foreground
```

**Счётчик-бейдж**
```
rounded-md border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[10px]
font-semibold tabular-nums text-muted-foreground
активный: border-primary/30 bg-primary/15 text-primary
```

**Шапка страницы** (`AdminPageHeader` / `AccountPageHeader`)
```
flex flex-col gap-4 border-b border-border/60 pb-6
md:flex-row md:items-end md:justify-between
```

**Липкая шапка сайта**
```
sticky top-0 z-50 w-full border-b border-border/40 bg-background/70 backdrop-blur-xl
```

**Разделитель**
```
h-px bg-border/60                     ← простой
divider-line                          ← затухающий по краям
```

**Скроллящийся список внутри панели**
```
min-h-0 flex-1 overflow-y-auto scrollbar-elegant
```

---

## 10. Как добавить токен

1. **Убедитесь, что он нужен.** Сначала попробуйте существующий токен + прозрачность
   (`bg-primary/15`) или соседний шаг шкалы поверхностей. Новый токен оправдан только
   для новой **смысловой роли**, а не нового оттенка.
2. **Добавьте переменную** в `:root` в `app/globals.css`, в формате HSL-компонент:
   `--surface-4: 224 18% 20%;`. Имя — по роли, не по цвету (`--surface-4`, `--danger-soft`,
   а не `--dark-blue-2`).
3. **Пропишите маппинг** в `tailwind.config.ts` → `theme.extend.colors`:
   `'surface': { 4: 'hsl(var(--surface-4))' }` — иначе Tailwind-класса не появится.
4. **Задокументируйте** здесь: строка в соответствующей таблице с назначением.
5. Если добавляете **композитную утилиту** — в `@layer utilities` в `app/globals.css`
   и строку в [§8](#8-композитные-утилиты). Критерии — в [UI_GUIDE.md §7.4](./UI_GUIDE.md#74-когда-заводить-утилиту-в-globalscss).

---

## 11. Таблица миграции: хардкод → токен

**Переведено 2026-09-11:** `workspace-shell.tsx`, `dashboard-page.tsx`,
`profile-page.tsx`, `processing-indicator.tsx` — 174 вхождения. Хардкод в этих
зонах больше не проходит: его ловит `npm run color:check`.

Таблица ниже остаётся справочником соответствий — по ней переводят новое и
сверяют старое (в скобках — фактический HSL хардкода); большинство хардкодов
совпадает с токенами `--ws-*` из [§2.4](#24-рабочая-область-account-admin).

### Текст — нейтральная шкала (hue ≈ 217–224)

| Хардкод | ≈ HSL | Замена |
|---|---|---|
| `#eef1f6` | `217 31% 95%` | `text-foreground` |
| `#c3c8d2` | `220 14% 79%` | `text-secondary-foreground` |
| `#9aa0ac` | `220 10% 64%` | `text-muted-foreground` |
| `#8b909c` | `222 8% 58%` | `text-muted-foreground/90` |
| `#7c8290` | `222 8% 53%` | `text-muted-foreground/80` |
| `#626875` | `221 9% 42%` | `text-muted-foreground/65` |
| `#4a5060` | `224 13% 33%` | `text-muted-foreground/50` |
| `#3a4050` | `224 16% 27%` | `text-border` (разделители, слеши в хлебных крошках) |

### Поверхности

| Хардкод | ≈ HSL | Замена |
|---|---|---|
| `hsl(226 31% 7%)` | точное совпадение | `bg-background` |
| `#0a0e16` | `220 37% 6%` | `bg-surface-overlay` |
| `hsl(226 28% 9%)` | точное совпадение | `bg-sidebar` |
| `#0b0f18`, `#0d121c`, `#10151f` | `220 32–37% 8–9%` | `bg-surface-1` |
| `hsl(226 26% 9.5%)` | — | `bg-surface-1` |
| `#131926`, `hsl(226 26% 11%)` | `221 33% 11%` | `bg-surface-2` (или `bg-card`) |
| `#141b28`, `#151d2b` | `218 34% 13%` | `bg-surface-3` (ховер/приподнятый слой) |

### Синие акценты (все — семейство `--primary`, hue 211–217)

| Хардкод | ≈ HSL | Замена |
|---|---|---|
| `#1d6ff2` (кнопка действия) | `217 89% 53%` | `bg-primary text-primary-foreground` |
| `#175fd6` (её ховер) | `217 81% 46%` | `hover:bg-primary/90` |
| `#2f80ed` (маркер активного пункта) | `214 84% 56%` | `bg-primary` |
| `#3b8bf0` | `213 86% 59%` | `bg-primary` |
| `#6aa5e8` (иконка активного пункта) | `212 73% 66%` | `text-primary` |
| `#5b9be0` (заголовок секции) | `211 68% 62%` | `text-primary` |
| `#7fb0f0`, `#8fb8ea` | `214 79% 72%` | `text-primary/90` |
| `#7fb6ff` (активная вкладка моб.) | — | `text-primary` |
| `rgba(45,131,206,0.16)` | `208 64% 49% / 16%` | `bg-primary/15` |
| `rgba(45,131,206,0.35)` | — | `bg-primary/30` |
| `rgba(91,155,224,0.28…0.45)` | — | `border-primary/30` … `border-primary/40` |
| градиент `#1f3a63 → #16273f` (логотип) | — | `bg-gradient-to-br from-primary/25 to-primary/10` |
| градиент `#7fb0f0 → #4a7fd6` (аватар) | — | `bg-gradient-to-br from-primary/90 to-primary` |

### Семантические

| Хардкод | ≈ HSL | Замена |
|---|---|---|
| `#3ecf8e`, `#40c48a` | `153 60% 53%` | `text-success` |
| `rgba(62,207,142,0.1 / 0.4)` | — | `bg-success/10`, `border-success/40` |
| `#f0b73a` | `41 86% 58%` | `text-warning` |
| `#5ed4c0` | `170 58% 60%` | `text-chart-3` |
| `#4a9be8` (иконка видео) | `207 76% 60%` | `text-chart-1` |
| `#c9ccd3` (иконка папки) | — | `text-muted-foreground` |
| `#8b93a3` (иконка файла) | — | `text-muted-foreground/70` |
| `#ff4d00` / `#e04400` (ошибки, опасная кнопка) | `18 100% 50%` | `text-destructive` / `bg-destructive hover:bg-destructive/90`. **Решение 2026-09-11: принят красный `--destructive`** — опасная кнопка в профиле стала краснее прежнего оранжево-красного. Вернуть оттенок можно токеном `--danger-accent: 18 100% 50%`, правка в одном месте |

### Рамки

| Хардкод | Замена |
|---|---|
| `border-white/[0.07]`, `border-white/[0.08]`, `border-white/10` | `border-border/60` — для структурных рамок и разделителей |
| `bg-white/5`, `bg-white/[0.03]`, `bg-white/[0.04]` | оставляем как есть: это нейтральный оверлей подсветки, а не цвет |
| `rgba(0,0,0,0.55)` в тени контекстного меню | оставить инлайн или завести `shadow-menu` в конфиге |

### Что осталось за таблицей

Три места держат свой цвет осознанно, и проверка их пропускает по списку в
`scripts/color-check.mjs`:

| место | почему |
|---|---|
| `components/admin/pipeline/task-steps.tsx` | порт `STEP_COLOR` из `LOG_WIN/utils.ts`: цвета шагов совпадают с десктопной программой значение в значение |
| `components/account/tools/voice/*`, `tools/srt/*` | палитра редакторов озвучки и титров — своё решение, отдельно от токенов сайта |
| `bg-white/…`, `border-white/…` | нейтральные оверлеи, а не цвет бренда; их разбирает этап светлой темы ([THEMING_PLAN.md §4.3](./THEMING_PLAN.md)) |

Проверка: `npm run color:check`.
