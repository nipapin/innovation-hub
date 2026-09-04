# UI Guide — как строится интерфейс в этом проекте

Обязательно к прочтению перед написанием любого UI-кода (человеком или LLM).
Справочник по цветам, шрифтам, радиусам и готовым CSS-рецептам вынесен отдельно:
[UI_TOKENS.md](./UI_TOKENS.md).

Документ описывает **фактическое** состояние кодовой базы, а не желаемое.
Раздел [17. Антипаттерны и техдолг](#17-антипаттерны-и-техдолг) честно перечисляет
места, где код расходится с правилами, — при рефакторинге ориентируйтесь на правила.

---

## 0. TL;DR — 13 жёстких правил

1. **Tailwind utility-first.** Никаких `.css`-файлов, CSS-модулей, styled-components, `style={{}}` (исключение — вычисляемая геометрия: координаты контекстного меню, ширины из props).
2. **Цвет — только через семантический токен**: `bg-card`, `text-muted-foreground`, `border-border`, `bg-primary/15`. Хардкод `#hex` / `rgba()` в новом коде запрещён.
3. **Тема одна — тёмная.** Токены лежат в `:root`. Варианты `dark:` не пишем.
4. **Базовые примитивы берём из `components/ui/*`** (shadcn/ui поверх Radix). Свою кнопку/инпут/диалог не пишем.
5. **Каждый компонент принимает `className`** и склеивает его через `cn()` последним аргументом.
6. **`"use client"` — как можно ниже по дереву.** `layout.tsx` и `page.tsx` — серверные: auth, редиректы, первичные данные.
7. **Именованные экспорты, `PascalCase` компонент, `kebab-case` файл.** `export default` — только для `page.tsx` / `layout.tsx` (требование Next.js).
8. **Варианты компонента — через `cva`**, а не через цепочки тернарников в JSX.
9. **Пользовательские строки в `/account` и `/admin` — только через словарь** (`useI18n()` / `useAdminI18n()`), ru + en. Строка — это не только текст в JSX: `aria-label`, `title`, `placeholder`, тосты, `confirm()` и локаль в `toLocale*` тоже (см. [§13](#13-интернационализация)).
10. **Иконки — только `lucide-react`.** Размер: `h-4 w-4` в примитивах, `h-5 w-5` в навигации.
11. **Ошибка API → `toast.error()`** (sonner). Не `alert()`, не молчаливый `return`.
12. **Скролл-контейнеры соблюдают цепочку** `overflow-hidden` → `min-h-0 flex-1` → `overflow-y-auto` (см. [§8](#8-layout-и-контракт-скролла)).
13. **Вход в справку — иконка сразу после названия инструмента**, без подписи, с чипом `F1`. Ставится пропом `help` у `AdminPageHeader` / `AccountPageHeader` — не своей вёрсткой и не в другом месте шапки. Объяснение отдельного параметра — знак «?» (`<HelpDot>`) вплотную к нему. Полный контракт — [HELP_SYSTEM.md](./HELP_SYSTEM.md).

---

## 1. Стек

| Слой | Технология | Версия | Заметки |
|---|---|---|---|
| Фреймворк | Next.js App Router | 16.2 | RSC включены, `--turbo` в dev |
| UI-рантайм | React | 19.2 | |
| Язык | TypeScript | 5.7, `strict: true` | алиас `@/*` → корень репо |
| Стили | Tailwind CSS | **3.4** (`tailwind.config.ts`) | не v4; `@theme` не используем |
| Компоненты | shadcn/ui (`components.json`) | style `default`, baseColor `neutral`, `cssVariables: true` | 45 примитивов в `components/ui` |
| Примитивы | Radix UI | — | доступность, порталы, фокус-менеджмент |
| Варианты | `class-variance-authority` + `clsx` + `tailwind-merge` | — | обёртка `cn()` в `lib/utils.ts` |
| Иконки | `lucide-react` | 0.544 | |
| Анимации | `tailwindcss-animate` + `framer-motion` | — | framer — только для лендинга |
| Тосты | `sonner` | смонтирован в `app/layout.tsx` | `position="top-right" richColors closeButton` |
| Формы | `react-hook-form` + `zod` + `@hookform/resolvers` | — | схемы в `lib/*-schemas.ts` |
| Спец. | `react-resizable-panels`, `@dnd-kit`, `embla-carousel`, `vaul`, `cmdk`, `input-otp`, `react-day-picker` | — | подключены точечно |

**Чего в проекте нет и не заводим:** CSS-in-JS, CSS-модули, SCSS, MUI/AntD/Chakra, Redux/Zustand/Jotai, react-query/SWR, Storybook. Состояние — локальный `useState` + React Context; данные — «голый» `fetch` к `/api/*`.

---

## 2. Карта репозитория (UI-часть)

```
app/
  layout.tsx              корневой layout: шрифты Inter + Space Grotesk, Toaster, VisitorTracker
  globals.css             ЕДИНСТВЕННЫЙ подключённый CSS: токены + композитные утилиты
  page.tsx                публичный лендинг (RSC)
  about|videos|video|contact|suggest|login|register/
  account/layout.tsx      auth-гейт + WorkspaceShell (+ шрифт IBM Plex Sans)
  account/{dashboard,projects,profile,security,danger}/
  admin/layout.tsx        admin-гейт + WorkspaceShell + AdminShell
  admin/{content,users,visitors,remote-access}/
  api/                    route handlers (в этом гайде не рассматриваются)

components/
  ui/                     L1: 45 примитивов shadcn (button, card, dialog, form, resizable…)
  landing/                L2/L3: section-shell, section-heading, motion-reveal, feature-suggestion-*
  admin/
    shell/                admin-shell, admin-page-header, nav-config (+ admin-sidebar* — мёртвый код, см. §17)
    shared/               stat-card, empty-state, loading-block, search-input
    data/                 admin-data-context — единый провайдер данных админки
    {content,users,visitors,overview,remote-access}/   фичевые секции
    admin-dict.ts         словарь админки
    admin-types.ts        доменные типы UI админки
  account/
    workspace-shell.tsx   сайдбар + мобильный drawer для /account и /admin
    workspace/            страница проектов: контекст данных, топбар, колонка проектов,
                          файловый браузер (список/плитка/колонки), превью
                          (закладка нижней панели + окно по пробелу), нижняя панель,
                          контекстное меню, режимы full/simple, мобильный вид
    dashboard-page.tsx, profile-page.tsx
    shell/, sections/     шапка страницы и секции
    i18n.tsx              базовый словарь ru/en + I18nProvider
  header.tsx, footer-section.tsx, video-card.tsx, video-player.tsx …  публичный сайт

lib/
  utils.ts                cn()
  *-schemas.ts            zod-схемы, общие для формы и API
  domain-types.ts         UserRole и прочие общие типы
  hooks/                  клиентские хуки

styles/globals.css        ⚠️ МЁРТВЫЙ ФАЙЛ (нигде не импортируется) — см. §17
tailwind.config.ts        маппинг CSS-переменных в Tailwind-классы
components.json           конфиг shadcn CLI
```

---

## 3. Четыре слоя UI

Зависимости идут строго **сверху вниз**. Слой не импортирует ничего из слоёв ниже по списку.

| Слой | Что это | Где | Правила |
|---|---|---|---|
| **L0 — Токены** | CSS-переменные + их Tailwind-маппинг | `app/globals.css`, `tailwind.config.ts` | Меняем осознанно: правка токена меняет весь продукт |
| **L1 — Примитивы** | Кнопки, инпуты, диалоги, таблицы | `components/ui/*` | Без бизнес-логики, без `fetch`, без словарей. Только токены и `cva` |
| **L2 — Общие блоки** | `EmptyState`, `LoadingBlock`, `SearchInput`, `StatCard`, `SectionShell`, `SectionHeading`, `MotionReveal`, `*PageHeader` | `components/admin/shared/*`, `components/landing/*`, `components/*/shell/*` | Композиция L1, всё содержимое — через props |
| **L3 — Фичи** | `projects-section`, `content-grid`, `users-content`, `workspace-page` | `components/<area>/…` | Знают про API и домен. Не переопределяют примитивы, а конфигурируют их |
| **L4 — Роутинг/оболочки** | `layout.tsx`, `page.tsx`, `*Shell` | `app/**`, `components/**/shell` | Auth, редиректы, загрузка данных на сервере, каркас страницы |

**Куда класть новый компонент:**

```
Переиспользуется в 3+ фичах и не знает про домен?      → L2 (…/shared/)
Радиксовый примитив, которого ещё нет?                  → L1 (components/ui/, через shadcn CLI)
Иначе                                                   → L3, рядом с фичей
```

---

## 4. Три зоны интерфейса

Продукт визуально делится на три зоны. **Не смешивайте их стилистику.**

| | Публичный сайт | Workspace (`/account`) | Админка (`/admin`) |
|---|---|---|---|
| Роуты | `/`, `/about`, `/videos`, `/video/[id]`, `/contact`, `/suggest`, `/login`, `/register` | `/account/**` | `/admin/**` |
| Каркас | `Header` + контент + `FooterSection` | `WorkspaceShell` (сайдбар 248px / 72px collapsed + mobile drawer) | `WorkspaceShell` → `AdminShell` (центрированный `max-w-7xl`) |
| Шрифт | Inter (`font-sans`) + Space Grotesk (`font-display`) | IBM Plex Sans (`--font-ibm-plex`, подключается в `app/account/layout.tsx`) | то же, что workspace |
| Плотность | Просторно: `section-space` (`py-16 md:py-24 lg:py-32`), `max-w-7xl` | Плотно: высоты 34–52px, шрифт 11–16px, панели без внешних отступов | Средняя: `px-4 py-8 md:px-8 md:py-10` |
| Тон | Маркетинговый: градиенты, `spotlight-band`, `premium-card`, reveal-анимации | Утилитарный: плоские панели, тонкие бордеры, никаких анимаций появления | Утилитарный + карточки статистики |
| Язык | Английский, строки прямо в JSX | ru/en через `useI18n()` | ru/en через `useAdminI18n()` |
| Скролл | Скроллится страница | Скроллятся внутренние панели, `h-dvh` фиксирован | Скроллится `AdminShell` |

Служебные экраны (`/login`, `/register`) — публичная зона, но верстаются как `Card` по центру, без хедера-лендинга.

---

## 5. Server vs Client Components

**Серверный по умолчанию.** `"use client"` добавляем только когда нужен `useState`/`useEffect`/обработчик события/браузерный API. Сейчас 60 из 144 `.tsx` — клиентские.

Канонический раскол — «серверная страница + клиентское тело»:

```tsx
// app/account/projects/page.tsx  — server
import { Suspense } from "react"
import { WorkspacePageClient } from "@/components/account/workspace-page"

export const dynamic = "force-dynamic"   // страница за авторизацией → не пререндерим

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center">Loading…</div>}>
      <WorkspacePageClient />
    </Suspense>
  )
}
```

Правила:

- **Auth и редиректы — в `layout.tsx`**, не в компоненте: `const user = await getCurrentUser(); if (!user) redirect("/login")`.
- Клиентское тело страницы называем `*-page.tsx` (экспорт `XxxPageClient`) или `*-content.tsx` в админке.
- `export const dynamic = "force-dynamic"` — на всех страницах за авторизацией.
- Компонент, использующий `useSearchParams()`, **обязан** быть завёрнут в `<Suspense>` (иначе Next валит билд).
- Публичные данные грузим на сервере с `unstable_cache` + тегами (см. `app/page.tsx`), а не `fetch`-ом из клиента.
- Тяжёлые provider'ы (`I18nProvider`, `AdminDataProvider`) монтируем один раз в шелле, а не на каждой странице.

---

## 6. Анатомия компонента

### 6.1. Простой компонент (L2/L3)

```tsx
// components/admin/shared/empty-state.tsx
type Props = {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}

export function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/80 bg-card/40 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="font-display text-lg font-semibold text-foreground">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}
```

Что здесь канонично:

- тип пропсов называется `Props` (локальный) или `XxxProps` (если экспортируется);
- именованный экспорт, `function`, без `React.FC`;
- слоты приходят как `React.ReactNode` (`icon`, `action`) — компонент не решает, что внутри;
- никакого `fetch`, никакого словаря — строки приходят снаружи.

### 6.2. Компонент с вариантами (`cva`)

Ветвление классов оформляем через `cva`, а не тернарниками в JSX:

```tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium " +
  "ring-offset-background transition-all duration-300 ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 " +
  "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: { default: "bg-primary text-primary-foreground hover:bg-primary/90", /* … */ },
      size:    { default: "h-10 px-4 py-2", sm: "h-9 rounded-md px-3", /* … */ },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
)
```

Порядок в базовой строке `cva`: **раскладка → геометрия → типографика → цвет → transition → состояния (`focus-visible:`, `disabled:`) → селекторы потомков (`[&_svg]:`)**.

### 6.3. Примитив L1 (`components/ui/*`)

```tsx
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => (
    <input type={type} ref={ref} className={cn("flex h-10 w-full rounded-md …", className)} {...props} />
  ),
)
Input.displayName = "Input"
export { Input }
```

- `forwardRef` обязателен (Radix прокидывает ref через `asChild`);
- `displayName` обязателен;
- пропсы расширяют нативные: `React.ComponentProps<"input">` / `React.HTMLAttributes<HTMLDivElement>`;
- `className` — **последний** аргумент `cn()`, чтобы вызывающая сторона могла переопределить;
- добавлять примитивы предпочтительно через shadcn CLI (`components.json` уже настроен), потом править под токены.

### 6.4. Полиморфизм — `asChild`, а не `as`

Кнопка-ссылка делается так (Radix `Slot` уже встроен в `Button`):

```tsx
<Button variant="ghost" asChild>
  <Link href="/about">About</Link>
</Button>
```

### 6.5. Соглашения по именованию

| Сущность | Соглашение | Пример |
|---|---|---|
| Файл | `kebab-case.tsx` | `admin-sidebar-link.tsx` |
| Компонент | `PascalCase`, именованный экспорт | `AdminSidebarLink` |
| Клиентское тело страницы | `*-page.tsx` / `*-content.tsx` | `workspace-page.tsx`, `users-content.tsx` |
| Оболочка | `*-shell.tsx` | `admin-shell.tsx` |
| Конфиг навигации | `nav-config.ts` | элементы меню + `isItemActive()` |
| Словарь | `i18n.tsx` / `*-dict.ts` | `admin-dict.ts` |
| Типы фичи | `*-types.ts` | `admin-types.ts` |
| Контекст | `*-context.tsx` | `admin-data-context.tsx` |

---

## 7. CSS-модель

### 7.1. Четыре уровня — берём всегда самый верхний из подходящих

| # | Уровень | Когда | Пример |
|---|---|---|---|
| 1 | **Семантический токен** | всегда для цвета, радиуса, тени | `bg-card`, `text-muted-foreground`, `rounded-lg`, `shadow-glow` |
| 2 | **Стандартная утилита Tailwind** | раскладка, отступы, типографика | `flex items-center gap-3 px-4 py-2 text-sm` |
| 3 | **Композитная утилита из `globals.css`** | повторяющийся смысловой блок (секция, типографический стиль, стеклянная панель) | `section-shell`, `type-h2`, `premium-card`, `scrollbar-elegant` |
| 4 | **Arbitrary value `[...]`** | только когда точного значения нет в шкале | `h-[38px]`, `grid-cols-[repeat(auto-fill,minmax(190px,1fr))]`, `shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]` |

**Про уровень 4.** Arbitrary values разрешены для **геометрии** (высоты, ширины, трек-грида, точечные тени) и **запрещены для цвета в виде хардкода**. Если цвет всё же надо задать инлайном — берите его из токена:

```tsx
// ✅ можно
className="shadow-[0_12px_60px_-28px_hsl(var(--primary)/0.35)]"
className="bg-[hsl(var(--surface-2))]/80"

// ❌ нельзя
className="bg-[#10151f] text-[#9aa0ac] border-[rgba(91,155,224,0.28)]"
```

### 7.2. Прозрачность вместо новых цветов

Оттенки набираются модификатором прозрачности от существующего токена — это главный приём палитры проекта:

```
bg-primary/15   border-primary/30   text-primary/80
bg-card/40      border-border/60    bg-white/[0.03]
```

`bg-white/[0.03]` / `border-white/10` — легитимный приём для «подсветки» поверхности на тёмном фоне (используется в шелле, сайдбаре, hover-состояниях). Это не хардкод цвета, а нейтральный оверлей.

### 7.3. Порядок классов

Пишем в одном порядке — так диффы читаемы:

```
позиция → раскладка → размеры → отступы → бордер/радиус → фон → типографика → цвет текста → эффекты → transition → состояния (hover:/focus-visible:/disabled:) → адаптив (md:/lg:) → селекторы потомков
```

Пример из `admin-sidebar-link.tsx`:

```
"group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors"
```

### 7.4. Когда заводить утилиту в `globals.css`

Добавляем в `@layer utilities`, если выполняются **все** условия:

1. сочетание встречается ≥ 3 раз в разных фичах;
2. у него есть имя на языке дизайна («секция», «дисплейный заголовок», «стеклянная панель»);
3. это чистый CSS без структуры (иначе — React-компонент).

Если нужна разметка (обёртка, вложенные блоки) — делаем компонент L2, а не утилиту. Ср. `SectionShell` (компонент) поверх `.section-shell` + `.section-space` (утилиты).

### 7.5. `cn()` — единственный способ склеивать классы

```tsx
import { cn } from "@/lib/utils"   // twMerge(clsx(...))

className={cn(
  "rounded-xl px-3 py-2.5 text-sm transition-colors",
  active ? "bg-primary/12 text-foreground" : "text-muted-foreground hover:bg-white/[0.04]",
  className,                                   // всегда последним
)}
```

`twMerge` разруливает конфликты (`p-4` + `p-6` → `p-6`), поэтому конкатенация строк через `+` или шаблонные литералы для условных классов **не используется**.

### 7.6. Что запрещено

- отдельные `.css`/`.scss`/`.module.css` файлы;
- `style={{ color: … }}` для цвета (для координат/размеров, вычисляемых в рантайме, — можно: `style={{ left: menu.x, top: menu.y }}`);
- `!important` / `!` -префикс Tailwind;
- глобальные селекторы по тегам вне `@layer base`;
- `dark:`-варианты (тема одна);
- собственные `@media`-запросы вместо брейкпоинтов Tailwind.

---

## 8. Layout и контракт скролла

### 8.1. Публичная страница — скроллится документ

```tsx
<Header />                                  {/* sticky top-0 z-50 backdrop-blur-xl */}
<SectionShell id="features">…</SectionShell> {/* section-space + section-shell */}
<FooterSection />
```

`.section-shell` = `mx-auto w-full max-w-7xl px-6 lg:px-10` — единая ширина контента на всём публичном сайте.

### 8.2. Workspace — скроллятся панели, не документ

Шелл фиксирует высоту вьюпорта, дальше скролл живёт только во внутренних контейнерах:

```tsx
<div className="flex h-dvh w-full overflow-hidden">        {/* 1. фиксируем высоту */}
  <aside className="hidden shrink-0 lg:flex w-[248px]">…</aside>
  <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
    <div className="h-[58px] shrink-0 …">…</div>           {/* 2. шапка не сжимается */}
    <div className="min-h-0 flex-1 overflow-hidden">       {/* 3. min-h-0 — обязательно */}
      {children}
    </div>
  </div>
</div>
```

**Правило, которое ломают чаще всего:** flex-потомок по умолчанию имеет `min-height: auto` и не даёт родителю сжаться. Любой `flex-1`, внутри которого будет скролл, обязан нести `min-h-0` (и `min-w-0` для горизонтальной оси). Скроллящийся лист — самый глубокий элемент: `min-h-0 flex-1 overflow-y-auto`.

Кастомный скроллбар: класс `scrollbar-elegant` (тонкий, полупрозрачный).

### 8.3. Изменяемые размеры панелей

Многопанельные экраны — `react-resizable-panels` через обёртку `components/ui/resizable.tsx`:

```tsx
<ResizablePanelGroup direction="horizontal" className="h-full">
  <ResizablePanel defaultSize={22} minSize={15} maxSize={40}>{list}</ResizablePanel>
  <ResizableHandle withHandle className="bg-white/10" />
  <ResizablePanel defaultSize={78} minSize={40}>{main}</ResizablePanel>
</ResizablePanelGroup>
```

Группы можно вкладывать (в воркспейсе: горизонтальная «список | контент», внутри неё вертикальная «файлы / нижняя панель»).

### 8.4. Шкала z-index

Соблюдайте существующие уровни, не изобретайте новые:

| Уровень | Что | Класс |
|---|---|---|
| 0 | декоративные псевдоэлементы (`spotlight-band::before`) | `z-0` |
| 10–40 | локальные наложения внутри секции | `z-10` |
| 50 | sticky-хедер, мобильный drawer, оверлеи Radix | `z-50` |
| 120 | контекстное меню воркспейса (поверх всего) | `z-[120]` |

Тосты монтируются порталом sonner и всегда сверху.

---

## 9. Адаптивность

- **Mobile-first.** Базовые классы — мобильные, `md:`/`lg:` уточняют вверх.
- Фактическое использование брейкпоинтов: `md:` 100, `sm:` 82, `lg:` 26, `xl:` 9, `2xl:` 2. То есть основной перелом — `md` (768px), а `lg` (1024px) отделяет мобильный шелл от десктопного.
- **Граница «мобильный/десктопный шелл» — `lg`**: сайдбар `hidden lg:flex`, мобильная шапка `lg:hidden`, drawer `lg:hidden`.
- Для сложных экранов допустимо рендерить **два дерева** (`hidden lg:flex` + `flex lg:hidden`), но только если мобильный и десктопный UX действительно разные (как в воркспейсе: master-detail через drill-down против трёх панелей). В остальных случаях — один DOM и адаптивные классы.
- Ширина контента: публичный сайт — `max-w-7xl`, админка — `max-w-7xl`, лендинговые текстовые блоки — `max-w-3xl` / `max-w-2xl`.
- Скрытие вторичных элементов на узких экранах: `hidden sm:inline`, `hidden md:flex`. Ничего критичного для сценария так прятать нельзя.

---

## 10. Состояния UI

Каждый экран, который грузит данные, обязан покрыть четыре состояния.

| Состояние | Как делаем | Готовое |
|---|---|---|
| Загрузка (блок) | центрированный `Loader2` с `animate-spin` | `<LoadingBlock />` (админка) |
| Загрузка (кнопка) | `disabled` + спиннер вместо/рядом с текстом | см. `login-form.tsx`, `create-project-button.tsx` |
| Загрузка (плейсхолдер) | `animate-pulse` на блоке нужного размера | `components/ui/skeleton.tsx` |
| Пусто | иконка + заголовок + описание + опциональное действие | `<EmptyState />` |
| Ошибка | `toast.error(data.message ?? "Failed")` | sonner |
| Ошибка формы | текст под полем + `text-destructive` | `<FormMessage />` |
| Отключено | `disabled:opacity-50 disabled:pointer-events-none` | встроено в `Button` |

Канонический порядок ветвления:

```tsx
{loading ? <LoadingBlock />
  : items.length === 0 ? <EmptyState … />
  : <Grid items={items} />}
```

Различайте «пусто, потому что нет данных» и «пусто, потому что фильтр ничего не нашёл» — тексты должны быть разные.

---

## 11. Формы

Стек: `react-hook-form` + `zodResolver` + примитивы `components/ui/form.tsx`.

**Схема — одна на клиент и сервер**, живёт в `lib/<feature>-schemas.ts` и импортируется и формой, и route handler'ом. Это гарантирует одинаковую валидацию с обеих сторон.

```tsx
const form = useForm<LoginInput>({
  resolver: zodResolver(loginSchema),
  defaultValues: { email: "", password: "" },
})

<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
    <FormField
      control={form.control}
      name="email"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Email</FormLabel>
          <FormControl>
            <Input type="email" autoComplete="email" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
    {serverError ? <p className="text-sm font-medium text-destructive">{serverError}</p> : null}
    <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
      {form.formState.isSubmitting ? (<><Loader2 className="h-4 w-4 animate-spin" />Signing in…</>) : "Sign In"}
    </Button>
  </form>
</Form>
```

Правила:

- ошибки поля — `<FormMessage />`, ошибки сервера — отдельный `serverError` state, отрисованный над кнопкой;
- блокируем сабмит через `form.formState.isSubmitting`, а не собственным флагом;
- всегда указываем `autoComplete` и `type` у инпутов;
- расстояние между полями — `space-y-4`, форма живёт внутри `Card`/`CardContent` на служебных страницах.

---

## 12. Данные в клиентских компонентах

Абстракции нет намеренно: обычный `fetch` к внутреннему API + локальный state.

```tsx
const load = useCallback(async () => {
  setLoading(true)
  try {
    const res = await fetch("/api/projects")
    if (!res.ok) return
    const data = await res.json()
    setProjects((data.projects ?? []).map(mapProject))
  } finally {
    setLoading(false)
  }
}, [])

useEffect(() => { void load() }, [load])
```

Правила:

- загрузчик — `useCallback`, вызывается из `useEffect` через `void`;
- `setLoading(false)` — только в `finally`;
- ответ API прогоняем через маппер (`mapProject`), а не кладём сырой JSON в state — API и UI-модель развязаны;
- мутация: `PATCH`/`POST` → при успехе обновляем state локально (`setProjects(prev => …)`), полный перезапрос только если иначе не сойдётся;
- ошибки: `toast.error(data.message ?? "Failed")`;
- **общие для нескольких экранов данные — в Context-провайдере** (`AdminDataProvider` держит videos/ideas/users, диалоги подтверждения и мутации), а не дублируются в каждом компоненте;
- поллинг — `window.setInterval` в `useEffect` с обязательной очисткой; в воркспейсе используется дельта-синк (`/api/storage/v1/delta?since=cursor`, интервал 4 c) — новый поллинг делайте по этому же образцу, а не «перезапрос всего каждые N секунд»;
- крупные загрузки (файлы) — `XMLHttpRequest`, потому что нужен прогресс и потоковая отправка.

---

## 13. Интернационализация

### 13.1. Где лежат словари

Два файла, и выбор между ними — по зоне, а не по вкусу:

| словарь | хук | зона |
|---|---|---|
| `components/account/i18n.tsx` | `useI18n()` → `{ t, lang, setLang }` | `/account`, общие компоненты воркспейса |
| `components/admin/admin-dict.ts` | `useAdminI18n()` → `t` | `/admin` |

- Провайдер один: `I18nProvider` в `i18n.tsx` монтируется внутри `WorkspaceShell` и покрывает обе зоны. `useAdminI18n()` берёт `lang` из него же.
- Язык — в `localStorage` под ключом `ffworks-lang`, переключатель RU/EN в подвале сайдбара.
- Оба словаря — плоский объект `{ ru: {...}, en: {...} }`; ключи `camelCase`, сгруппированы комментариями по смыслу.
- Строки с подстановкой — через `tf(t.key, { vars })`, шаблон вида `"в очереди {queued}"`. Склеивать перевод из кусков в JSX нельзя: в другом языке порядок слов другой.
- Админскому компоненту иногда нужны оба хука: `useAdminI18n()` за текстом и `useI18n()` за `lang` для форматирования. Это норма, а не дубль.

### 13.2. Что считается пользовательской строкой

Не только текст в JSX. Всё это тоже:

- `aria-label`, `title`, `alt`, `placeholder`
- тексты тостов (`toast.success` / `toast.error`) и сообщений об ошибках, включая фолбэк к `data?.message ?? …`
- `window.confirm()` / `window.alert()` — но их и самих лучше не заводить, см. [§17](#не-делать)
- локаль в `toLocaleDateString` / `toLocaleTimeString` / `toLocaleString`: `lang === "ru" ? "ru-RU" : "en-GB"`. Хардкод `"ru-RU"` даёт русскую дату в англоязычном интерфейсе

Именно эта часть чаще всего и утекает: текст в разметке переводят, а `aria-label` рядом — нет.

### 13.3. Как заводить ключ

Сначала ключ в **оба** словаря, потом использование. Парность держит тип:

```ts
export type AdminDict = (typeof adminDict)[Lang]
```

Ключ, добавленный только в `ru`, ломает `tsc` на месте использования — то есть забыть перевод не выйдет, но и добавлять его надо до первого `t.newKey`, а не после.

### 13.4. Ключи в файлах, которые словарь не импортируют

Если подписи нужны в файле вне зоны UI — конфиг навигации, доменные типы, что-то с серверным импортом, — он хранит **ключ**, а не текст:

- `components/admin/shell/nav-config.ts` → `labelKey`
- `lib/settings-types.ts` → `DOMAIN_LABELS` с ключами `settingsDomain*`

Причина не в стиле: `lib/settings-types.ts` импортируется и серверным репозиторием, а словарь — клиентский модуль. Положи туда готовый текст — получишь либо непереводимую подпись, либо клиентский код в серверном бандле.

### 13.5. Форматирование

Хелперы — в `i18n.tsx`: `formatBalance(cents, lang)`, `avatarInitials()`, `greetingForHour()`, `tf()`.

Публичный сайт сейчас англоязычный и словаря не имеет — см. техдолг в [§17](#текущий-техдолг-документируем-чтобы-не-копировать).

### 13.6. Проверка

```bash
npm run i18n:check
```

Ищет кириллицу в `components/account`, `components/admin`, `app/account`, `app/admin`
вне комментариев и вне самих словарей. Ненулевой код возврата — есть хардкод.

Проверка появилась не от недоверия: правило §13 существовало и раньше, но раздел
«Конвейер» был написан целиком на хардкоде и прошёл ревью — рядом лежали такие же
файлы, и на глаз это не выделялось. Одного правила в документе оказалось мало.

Легальные исключения перечислены в `scripts/i18n-check.mjs` списком, а не
подавлением файла целиком: локаль `"ru-RU"` в `toLocale*` и переключатель языка,
где название языка пишется на нём самом.

**Чего проверка не ловит:** захардкоженный **английский**. Отличить `"Save changes"`
в JSX от обычного идентификатора автоматически нельзя, поэтому файл, написанный
целиком по-английски, проходит молча — например
[project-automation-panel.tsx](../components/account/sections/project-automation-panel.tsx).
Проверка закрывает частый случай, а не все; английский остаётся на ревью.

---

## 14. Иконки, анимация, движение

**Иконки** — только `lucide-react`. Размеры: `h-4 w-4` внутри примитивов и бейджей (в `Button` это зашито через `[&_svg]:size-4`), `h-5 w-5` в навигации и шапках, `h-[18px] w-[18px]` в плотных панелях воркспейса. Декоративные иконки помечаем `aria-hidden`.

**Микроанимации** — Tailwind-переходы: `transition-colors` (наведение), `transition-all duration-300 ease-out` (кнопки), `active:scale-[0.98]` (нажатие), `animate-spin` (загрузка), `animate-pulse` (скелетоны), `animate-accordion-down/up` (Radix Accordion). Кастомные кейфреймы `float` и `glow` заведены в `tailwind.config.ts` для декора лендинга.

**Framer Motion** — **только для публичного сайта**, и в основном через готовый `MotionReveal`:

```tsx
<MotionReveal delay={0.1}>
  <SectionHeading eyebrow="How it works" title="…" />
</MotionReveal>
// initial opacity 0 / y 18 → whileInView, viewport once, 0.6s, ease [0.22,1,0.36,1]
```

В воркспейсе и админке анимаций появления нет — это рабочий инструмент, лишнее движение мешает.

---

## 15. Доступность

Что уже соблюдается и должно соблюдаться дальше:

- интерактив — на `<button type="button">` / `<Link>`, а не на `div` с `onClick`;
- у иконочных кнопок обязателен `aria-label` (или видимый текст в `sr-only`);
- фокус: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` — уже в примитивах, не отключайте `outline` без замены;
- модалки/поповеры/меню — только Radix-примитивы (`dialog`, `dropdown-menu`, `sheet`, `alert-dialog`): фокус-ловушка, `Esc`, aria-роли уже внутри;
- декоративные элементы — `aria-hidden`;
- заголовки идут по иерархии: `h1` — один на страницу (в `*PageHeader`), секции — `h2`;
- контраст: серые тексты берём из шкалы токенов; для основного текста не опускаемся ниже `text-muted-foreground`.

Подтверждения и ввод имени — только через `AlertDialog` / `Dialog`; нативные `confirm()` и `prompt()` в UI не используются (общая пара диалогов живёт в `components/account/workspace/workspace-dialogs.tsx`).

---

## 16. Чеклисты

### Новый компонент

- [ ] Определён слой (L1/L2/L3) и правильная папка
- [ ] Именованный экспорт, файл в `kebab-case`
- [ ] Пропсы типизированы (`type Props = {…}`), слоты — `React.ReactNode`
- [ ] Принимает и прокидывает `className` через `cn(..., className)`
- [ ] `"use client"` — только если реально нужен
- [ ] Цвета — токены, ни одного `#hex`
- [ ] Варианты — через `cva`, если их больше двух
- [ ] Строки локализованы (для `/account`, `/admin`) — включая `aria-label`, `title`, `placeholder`, тосты и локаль в `toLocale*`
- [ ] Ключи заведены в **оба** словаря, ru и en
- [ ] `npm run i18n:check` проходит
- [ ] Иконки `lucide`, с корректным размером и `aria-*`
- [ ] Состояния loading/empty/error покрыты или явно не нужны

### Новая страница

- [ ] `page.tsx` серверный; `export const dynamic = "force-dynamic"`, если за авторизацией
- [ ] Auth-гейт в `layout.tsx` соответствующей зоны
- [ ] Заголовок через `AccountPageHeader` / `AdminPageHeader` / `SectionHeading`
- [ ] Клиентское тело вынесено в `*-page.tsx` / `*-content.tsx`
- [ ] `useSearchParams()` обёрнут в `<Suspense>`
- [ ] Контракт скролла соблюдён (`min-h-0` в цепочке)
- [ ] Проверено на `sm` / `md` / `lg`
- [ ] Пункт добавлен в `nav-config.ts` (админка) с `labelKey`, а не строкой
- [ ] Есть статья справки о разделе и `help="<id>"` в шапке — или осознано, что раздел объяснять нечем
- [ ] `npm run help:check` проходит

### Ревью CSS

- [ ] Нет новых `#hex` / `rgba()`
- [ ] Arbitrary values — только геометрия
- [ ] Нет `dark:`, `!important`, инлайновых цветов
- [ ] Повторяющийся паттерн вынесен в утилиту или компонент
- [ ] z-index — из существующей шкалы

---

## 17. Антипаттерны и техдолг

### Не делать

| ❌ | ✅ |
|---|---|
| `className="bg-[#10151f] text-[#9aa0ac]"` | `className="bg-surface-1 text-muted-foreground"` |
| `<div onClick={…}>` | `<button type="button" onClick={…}>` |
| `confirm("Удалить?")` / `prompt("Имя")` | `<AlertDialog>` / `<Dialog>` с полем |
| `className={"base " + (a ? "x" : "y")}` | `cn("base", a ? "x" : "y")` |
| Свой `<button className="…">` вместо `Button` | `<Button variant="…">` |
| Тернарники классов на 5 веток в JSX | `cva` |
| `"use client"` на `page.tsx` целиком | клиентское тело отдельным компонентом |
| Хардкод строк в `/account`, `/admin` | ключ в словаре + `t.key` |
| `aria-label="Закрыть"`, `title="Обновить"`, `placeholder="Поиск"` | `aria-label={t.close}` — атрибуты тоже переводятся |
| `toLocaleTimeString("ru-RU", …)` | `toLocaleTimeString(lang === "ru" ? "ru-RU" : "en-GB", …)` |
| `` toast.error(`Нет связи (${status})`) `` | `toast.error(tf(t.someError, { status }))` |
| Текст подписи в конфиге или доменном типе | ключ словаря (`labelKey`, `DOMAIN_LABELS`), см. [§13.4](#134-ключи-в-файлах-которые-словарь-не-импортируют) |
| Новый файл `*.css` | утилита в `@layer utilities` или компонент |

### Текущий техдолг (документируем, чтобы не копировать)

| Место | Проблема | Куда двигаться |
|---|---|---|
| `components/account/workspace-shell.tsx` (54), `dashboard-page.tsx` (50), `profile-page.tsx` (44) | ~148 хардкод-цветов (`#eef1f6`, `#0d121c`, `rgba(45,131,206,…)`) — экраны верстались от макета в обход токенов | Заменять на токены `--ws-*` по таблице миграции в [UI_TOKENS.md](./UI_TOKENS.md#11-таблица-миграции-хардкод--токен). Страница проектов уже переведена — берите её за образец |
| `styles/globals.css` | Мёртвый файл: светлая тема по умолчанию от shadcn, нигде не импортируется. Подключён только `app/globals.css` | Удалить, чтобы никто не правил его по ошибке |
| `package.json` | `@tailwindcss/postcss@4` в devDependencies, при этом `postcss.config.mjs` использует плагин Tailwind v3 | Убрать неиспользуемую зависимость либо осознанно мигрировать на v4 |
| `app/admin/layout.tsx` + `components/admin/shell/` | `WorkspaceShell` (сайдбар) оборачивает `AdminShell` (свой контейнер) — два каркаса вложены друг в друга. При этом цепочка `admin-topbar` → `admin-mobile-sidebar` → `admin-sidebar` → `admin-sidebar-link` / `admin-sidebar-user` **не смонтирована ни на одном роуте** (`AdminTopbar` нигде не используется). Живой из этой папки только `admin-page-header.tsx` и `nav-config.ts` | Оставить один шелл для админки, мёртвую цепочку сайдбара удалить |
| `components/account/dashboard-page.tsx`, `profile-page.tsx` | Крупные монолитные клиентские компоненты | Разбить по секциям, как сделано в `components/account/workspace/` и `components/admin/` |
| `components/theme-provider.tsx` | Обёртка над `next-themes` не смонтирована; `next-themes` реально нужен только `ui/sonner.tsx` | Удалить обёртку либо ввести переключение темы осознанно |
| Публичный сайт | Строки не локализованы, словаря нет | При появлении требования — расширить `i18n.tsx` на публичную зону |

---

## 18. Смежная документация

- [UI_TOKENS.md](./UI_TOKENS.md) — палитра, типографика, радиусы, тени, композитные утилиты, рецепты, таблица миграции
- [STORAGE_API.md](./STORAGE_API.md) — API файлового хранилища, которое использует воркспейс
- [STORAGE_SYNC_CONTRACT.md](./STORAGE_SYNC_CONTRACT.md) — правила синхронизации (дельта-поллинг в UI)
- [REMOTE_ACCESS_API.md](./REMOTE_ACCESS_API.md) — API раздела `/admin/remote-access`
- [HELP_SYSTEM.md](./HELP_SYSTEM.md) — справка: реестр тем, статьи, два вида якорей, права
