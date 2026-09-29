import type { KotliarFile, KotliarPage } from "@/lib/repositories/kotliar"

export function serializeKotliarFile(file: KotliarFile) {
  return {
    id: file.id,
    pageId: file.pageId,
    originalName: file.originalName,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt.toISOString(),
  }
}

export function serializeKotliarPage(
  page: KotliarPage,
  files?: KotliarFile[],
) {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    body: page.body,
    sortOrder: page.sortOrder,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
    ...(files ? { files: files.map(serializeKotliarFile) } : {}),
  }
}
