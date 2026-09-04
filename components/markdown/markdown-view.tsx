"use client"

import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import type { Element } from "hast"

import {
  descriptionSanitizeSchema,
  ownContentSanitizeSchema,
} from "@/lib/markdown/description-format"
import { cn } from "@/lib/utils"
import { MermaidBlock } from "./mermaid-block"

/**
 * Единый просмотрщик описания проекта (`options/description.md`).
 *
 * ⚠️ Порядок плагинов критичен: remark-gfm → rehype-raw → rehype-sanitize.
 * Если санитайз встанет раньше rehype-raw, разметка либо не разберётся, либо
 * пролезет непроверенной. Санитайз обязателен именно на рендере, а не только на
 * сохранении: файл приходит из программы и мог быть отредактирован кем угодно —
 * доверенным содержимым он не является ни для одной из сторон (контракт §6).
 *
 * Оформление — классы `.md-body` (типографика) и `.md-palette` (имена цветов из
 * файла → токены) в app/globals.css. Одним и тем же компонентом рисуется и
 * панель описания, и модалка, и превью в редакторе: иначе «как вижу» и «как
 * сохранится» разъезжались бы.
 */

/** Текст и язык фенса из hast-узла `<pre>`: `<pre><code class="language-x">`. */
function fenceInfo(node: Element | undefined): { lang: string; text: string } | null {
  const code = node?.children?.find(
    (child): child is Element => child.type === "element" && child.tagName === "code",
  )
  if (!code) return null

  const classes = code.properties?.className
  const list = Array.isArray(classes) ? classes.map(String) : []
  const lang = list.find((c) => c.startsWith("language-"))?.slice("language-".length) ?? ""

  const text = code.children
    .map((child) => (child.type === "text" ? child.value : ""))
    .join("")
    .replace(/\n$/, "")

  return { lang, text }
}

/**
 * Набор рендереров. Фабрика, а не константа, из-за ссылок: описание проекта
 * приходит из файла и ведёт наружу, а справка — наш собственный текст, и ссылка
 * на соседнюю статью должна открываться в этой же вкладке. Два готовых набора
 * лежат ниже — на каждый рендер новый объект не создаётся.
 */
function buildComponents(ownContent: boolean): Components {
  return {
    // Обёртка с прокруткой: широкая таблица иначе растянет всю страницу, а из
    // markdown такую обёртку задать нельзя — её ставит только рендерер (§8).
    table: ({ node, ...props }) => (
      <div className="md-table-wrap">
        <table {...props} />
      </div>
    ),

    // Картинка без src — это вырезанный санитайзером мусор, а не картинка.
    // next/image для `data:`-URI не годится (контракт §4), поэтому обычный <img>.
    img: ({ node, src, alt, ...props }) =>
      src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={String(src)} alt={alt ?? ""} {...props} />
      ) : null,

    // Ссылки из описания ведут наружу: новая вкладка и никакого доступа к
    // window.opener. Внутренняя ссылка (`/help/…`) — только в режиме
    // `ownContent`, то есть когда текст наш, а не из чужого файла.
    a: ({ node, href, ...props }) =>
      ownContent && typeof href === "string" && href.startsWith("/") ? (
        <a href={href} {...props} />
      ) : (
        <a href={href} {...props} target="_blank" rel="noopener noreferrer nofollow" />
      ),

    // Диаграмма перехватывается на `pre`, а не на `code`: контейнер схемы —
    // блочный элемент, внутри <pre> ему делать нечего. Незнакомый язык фенса
    // остаётся обычным блоком кода (§5).
    pre: ({ node, children, ...props }) => {
      const fence = fenceInfo(node)
      if (fence && fence.lang === "mermaid" && fence.text.trim()) {
        return <MermaidBlock chart={fence.text} />
      }
      return <pre {...props}>{children}</pre>
    },
  }
}

const componentsForeign = buildComponents(false)
const componentsOwn = buildComponents(true)

export interface MarkdownViewProps {
  children: string
  className?: string
  /** Ширина колонки текста; контейнер при этом тянется. */
  measure?: number | string
  /** Базовый кегль: остальная типографика считается от него в `em`. */
  fontSize?: number
  /**
   * Текст написан нами (статьи справки из `content/help/`), а не пришёл из
   * файла проекта. Даёт две поблажки, и обе — только для своего текста:
   * ссылка на свою страницу (`/help/…`) открывается в этой же вкладке, а
   * картинке разрешён путь от корня сайта (`ownContentSanitizeSchema`).
   */
  ownContent?: boolean
}

export function MarkdownView({
  children,
  className,
  measure,
  fontSize,
  ownContent = false,
}: MarkdownViewProps) {
  // Кегль и ширина колонки — CSS-переменные, а не классы: значения приходят
  // числом из настройки просмотра (как в simple-mode.tsx с `--in-width`).
  const style = {
    ...(measure === undefined
      ? {}
      : { "--md-measure": typeof measure === "number" ? `${measure}px` : measure }),
    ...(fontSize === undefined ? {} : { "--md-font-size": `${fontSize}px` }),
  } as React.CSSProperties

  return (
    <div className={cn("md-body md-palette", className)} style={style}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          [
            rehypeSanitize,
            ownContent ? ownContentSanitizeSchema : descriptionSanitizeSchema,
          ],
        ]}
        components={ownContent ? componentsOwn : componentsForeign}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
