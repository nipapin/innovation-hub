import { z } from "zod"
import { slugify } from "@/lib/slug"

export const KOTLIAR_RESERVED_SLUGS = new Set([
  "files",
  "api",
  "account",
  "admin",
  "company",
  "login",
  "register",
  "kotliar-site",
  "_next",
  "favicon.ico",
])

export const KOTLIAR_BODY_MAX = 200_000
export const KOTLIAR_TITLE_MAX = 200
export const KOTLIAR_SLUG_MAX = 80

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function normalizeKotliarSlug(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === "") return ""
  const slug = slugify(trimmed)
  if (!slug || slug.length > KOTLIAR_SLUG_MAX) return null
  if (!slugPattern.test(slug)) return null
  if (KOTLIAR_RESERVED_SLUGS.has(slug)) return null
  return slug
}

export const kotliarPageCreateSchema = z.object({
  title: z.string().trim().min(1).max(KOTLIAR_TITLE_MAX),
  slug: z.string().max(KOTLIAR_SLUG_MAX).optional(),
  body: z.string().max(KOTLIAR_BODY_MAX).optional(),
})

export const kotliarPageUpdateSchema = z.object({
  title: z.string().trim().min(1).max(KOTLIAR_TITLE_MAX).optional(),
  slug: z.string().max(KOTLIAR_SLUG_MAX).optional(),
  body: z.string().max(KOTLIAR_BODY_MAX).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})
