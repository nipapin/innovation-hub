import { z } from "zod"
import { pipelineGraphSchema } from "./graph"

/**
 * Тела запросов к пайплайнам. Отдельно от роутов: их же читает редактор, чтобы
 * отправлять ровно то, что сервер примет.
 */

/**
 * Настройки, которые правятся на месте и новой версии не создают (§3.5).
 * Срок хранения вариантов — §4.5: по умолчанию после завершения ролика.
 */
export const pipelineSettingsSchema = z.object({
  retention: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("after-run") }),
      z.object({ mode: z.literal("days"), days: z.number().int().min(1).max(3650) }),
      z.object({ mode: z.literal("never") }),
    ])
    .default({ mode: "after-run" }),
})

export type PipelineSettings = z.infer<typeof pipelineSettingsSchema>

export const DEFAULT_PIPELINE_SETTINGS: PipelineSettings = { retention: { mode: "after-run" } }

const nameSchema = z.string().trim().min(1).max(120)

/**
 * Создание. Имя ноды «Старт» приходит с клиента — на его языке:
 * сервер языка человека не знает, а это данные пайплайна, не подписи интерфейса.
 */
export const createPipelineSchema = z.object({
  name: nameSchema,
  startName: nameSchema,
})

/**
 * Сохранение черновика. `revision` — та, на которой человек начал править:
 * разошлась с базой — 409, а не молча перетёртая чужая правка.
 */
export const updatePipelineSchema = z
  .object({
    revision: z.number().int().min(0),
    name: nameSchema.optional(),
    graph: pipelineGraphSchema.optional(),
    settings: pipelineSettingsSchema.optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.graph !== undefined ||
      body.settings !== undefined ||
      body.archived !== undefined,
    { message: "Nothing to update." },
  )

export type UpdatePipelineInput = z.infer<typeof updatePipelineSchema>
