import { z } from "zod"
import { USER_ROLES } from "@/lib/admin-roles"

/**
 * Admin payloads can carry either:
 *  - a fully-qualified URL ("https://cdn.example.com/x.jpg"), or
 *  - an app-relative media-proxy path ("/api/media/<prefix>/<key>"), which is
 *    what the listing endpoints emit when they normalise direct-bucket URLs.
 *
 * Without this allowance, editing legacy rows fails Zod validation on PATCH
 * because the dialog round-trips the relative path back to the API.
 */
const mediaUrlSchema = z
  .string()
  .min(1, "Media URL is required.")
  .refine(
    (value) => {
      const trimmed = value.trim()
      if (trimmed.startsWith("/api/media/")) return true
      try {
        const parsed = new URL(trimmed)
        return parsed.protocol === "http:" || parsed.protocol === "https:"
      } catch {
        return false
      }
    },
    "Must be an http(s) URL or an /api/media/... path.",
  )

const tagsSchema = z
  .array(z.string().min(1).max(80))
  .min(1, "Add at least one tag.")
  .max(20)

export const videoCreateSchema = z.object({
  title: z.string().min(2),
  description: z.string().min(10),
  thumbnail: mediaUrlSchema,
  videoUrl: mediaUrlSchema,
  duration: z.string().min(2),
  tags: tagsSchema,
  isPublished: z.boolean().default(true),
})

export const videoUpdateSchema = videoCreateSchema.partial()

/** Same shape as `mediaUrlSchema` but allows the empty string. Used for ideas
 * where media is optional — we still want to validate non-empty values. */
const optionalMediaUrlSchema = z
  .string()
  .refine(
    (value) => {
      if (value === "") return true
      const trimmed = value.trim()
      if (trimmed.startsWith("/api/media/")) return true
      try {
        const parsed = new URL(trimmed)
        return parsed.protocol === "http:" || parsed.protocol === "https:"
      } catch {
        return false
      }
    },
    "Must be empty, an http(s) URL or an /api/media/... path.",
  )

export const ideaCreateSchema = z.object({
  title: z.string().min(2),
  description: z.string().min(1),
  thumbnail: optionalMediaUrlSchema.default(""),
  videoUrl: optionalMediaUrlSchema.default(""),
  duration: z.string().default(""),
  tags: tagsSchema,
  isPublished: z.boolean().default(true),
})

export const ideaUpdateSchema = ideaCreateSchema.partial()

export const reorderSchema = z.object({
  id: z.string().min(1),
  direction: z.enum(["up", "down"]),
})

export const reorderBulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
})

export const userCreateSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters.").max(120),
  email: z.string().email("Enter a valid email address.").max(254),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(72, "Password must be at most 72 characters."),
  role: z.enum(USER_ROLES).default("USER"),
  isActive: z.boolean().default(true),
})

/** Update lets admins rename, change email, optionally rotate the password,
 * promote/demote, and toggle active. Empty/omitted password = keep existing. */
export const userUpdateSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  email: z.string().email().max(254).optional(),
  password: z.string().min(8).max(72).optional(),
  role: z.enum(USER_ROLES).optional(),
  isActive: z.boolean().optional(),
})

/**
 * Slug уходит в email служебного кошелька, в адреса и в будущем в префикс
 * хранилища (docs/COMPANY_ACCOUNTS_PLAN.md §9) — только латиница, цифры и дефис.
 */
export const companyCreateSchema = z.object({
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters.")
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, digits and hyphens."),
  title: z.string().min(2, "Title must be at least 2 characters.").max(120),
})

export const companyTransferSchema = z.object({
  userId: z.string().min(1),
  companyRole: z.enum(["member", "admin", "owner"]),
})
