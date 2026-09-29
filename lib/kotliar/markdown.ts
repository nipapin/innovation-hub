/**
 * Markdown публичной странички. Это не контракт `description.md`: там картинки
 * только base64 и общая схема с десктоп-клиентом. Здесь обычный markdown, а
 * картинки и файлы — только ссылками `/files/{id}`.
 */

import { defaultSchema } from "rehype-sanitize"
import type { Options as SanitizeSchema } from "rehype-sanitize"
import { toHtml } from "hast-util-to-html"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import rehypeSanitize from "rehype-sanitize"
import { unified } from "unified"

const FILE_HREF = /^\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PAGE_HREF = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/
const HASH_HREF = /^#[\w.-]+$/
const HTTP_HREF = /^https?:\/\//i
const MAILTO_HREF = /^mailto:/i

export const kotliarSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [["src", FILE_HREF], "alt", "title"],
    a: [
      ["href", FILE_HREF, PAGE_HREF, HASH_HREF, HTTP_HREF, MAILTO_HREF],
      "title",
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
  },
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize, kotliarSanitizeSchema)

export function kotliarMarkdownToHtml(markdown: string): string {
  const tree = processor.runSync(processor.parse(markdown))
  return toHtml(tree as never)
}

export function kotliarFileMarkdown(file: {
  id: string
  originalName: string
  contentType: string
}): string {
  const href = `/files/${file.id}`
  const alt = file.originalName.replace(/[[\]()]/g, "")
  if (file.contentType.startsWith("image/")) {
    return `![${alt}](${href})`
  }
  return `[${alt}](${href})`
}
