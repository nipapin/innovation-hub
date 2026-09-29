import { buildS3ObjectKey } from "@/lib/s3-config"
import { safeBaseFileName } from "@/lib/s3-upload-policy"

export const KOTLIAR_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const KOTLIAR_PDF_MAX_BYTES = 25 * 1024 * 1024

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])

export function resolveKotliarContentType(file: {
  name: string
  type: string
}): string | null {
  const t = file.type.trim().toLowerCase()
  if (t === "application/pdf" || IMAGE_TYPES.has(t)) return t

  const lower = file.name.toLowerCase()
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".pdf")) return "application/pdf"
  return null
}

export function kotliarMaxBytesFor(contentType: string): number {
  return contentType === "application/pdf"
    ? KOTLIAR_PDF_MAX_BYTES
    : KOTLIAR_IMAGE_MAX_BYTES
}

export function kotliarObjectKey(
  pageId: string,
  fileId: string,
  fileName: string,
): string {
  return buildS3ObjectKey(
    `ffworks/kotliar/${pageId}/${fileId}-${safeBaseFileName(fileName)}`,
  )
}
