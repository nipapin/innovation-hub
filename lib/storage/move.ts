import type { ProjectFileRecord } from "@/lib/domain-types"
import { copySingleFile, type CopyPlanItem } from "@/lib/storage/copy"
import { StorageWriteError } from "@/lib/storage/errors"
import { isCanonicalSidecar, isOptionsFolderRow } from "@/lib/storage/keys"
import { writeFileDelete, type StorageActor } from "@/lib/storage/write-path"

/**
 * Перенос между проектами: копия в проект-получатель, оригинал — в корзину.
 *
 * Внутри проекта перенос — одна запись в базе (`writeRename`), объект в R2
 * остаётся на месте. Между проектами так не выйдет: ключ объекта начинается с
 * адреса хранилища владельца, а у другого проекта он может быть другим. Поэтому
 * байты едут серверным `CopyObject`, как при копировании
 * (docs/BACKEND_PLAN.md §6).
 *
 * Порядок — сначала копия целиком, потом удаление. Упадёт посередине — в
 * худшем случае останется лишняя копия, но оригинал не пропадёт. Удаление
 * мягкое, в корзину, так что и оно обратимо.
 */

/**
 * Что нельзя переносить — то же, что `writeRename` не даёт переносить внутри
 * проекта: служебную папку `options` и канонические сайдкары. Проверяем до
 * первой копии: от удаления мы узнали бы об этом, когда копия уже легла в
 * другой проект.
 */
export function assertMovableAcrossProjects(
  roots: { folderPath: string; name: string; isFolder: boolean }[],
  destFolderPath: string,
): void {
  const destFolder = destFolderPath.replace(/^\/+|\/+$/g, "")
  for (const root of roots) {
    if (isOptionsFolderRow(root) || isCanonicalSidecar(root.folderPath, root.name)) {
      throw new StorageWriteError(
        `"${root.name}" cannot be moved: project automation reads it at a fixed key.`,
        403,
      )
    }
    // Строка копии легла бы на канонический адрес, а объект — под свой ключ:
    // сайт читает сайдкар по ключу и такой копии не увидит.
    if (isCanonicalSidecar(destFolder, root.name)) {
      throw new StorageWriteError(
        `"${root.name}" in "${destFolder}" is reserved for project automation.`,
        403,
      )
    }
  }
}

/**
 * Ключ события журнала для одной из половин переноса. Без приставки копия и
 * удаление одного файла получили бы одинаковый `eventId`: обе половины
 * называют события по id исходного файла.
 */
export function moveEventId(
  eventId: string | null | undefined,
  phase: "copy" | "delete",
  fileId: string,
): string | undefined {
  return eventId ? `${eventId}:${phase}:${fileId}` : undefined
}

/** Одиночный файл — синхронно, без работы: так же, как одиночное копирование. */
export async function moveSingleFile(input: {
  sourceProjectId: string
  sourceStorageOwnerId: string
  destProjectId: string
  destStorageOwnerId: string
  destFolderPath: string
  source: CopyPlanItem["source"]
  eventId?: string | null
  actor: StorageActor
}): Promise<ProjectFileRecord> {
  const file = await copySingleFile({
    sourceProjectId: input.sourceProjectId,
    destProjectId: input.destProjectId,
    destStorageOwnerId: input.destStorageOwnerId,
    destFolderPath: input.destFolderPath,
    source: input.source,
    eventId: moveEventId(input.eventId, "copy", input.source.id),
    actor: input.actor,
    keepUploader: true,
  })
  await writeFileDelete({
    storageOwnerId: input.sourceStorageOwnerId,
    projectId: input.sourceProjectId,
    fileId: input.source.id,
    deletedBy: input.actor.userId,
    eventId: moveEventId(input.eventId, "delete", input.source.id),
    actor: input.actor,
  })
  return file
}
