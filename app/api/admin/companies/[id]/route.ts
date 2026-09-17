import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import {
  deleteCompany,
  findCompanyById,
  patchCompanyFeatures,
  setCompanyActive,
} from "@/lib/repositories/companies"
import {
  AUTOMATION_ENABLED_KEY,
  BILLING_FREE_KEY,
  CHAT_YOUGILE_SYNC_KEY,
  COMPANY_SECTIONS_KEY,
  COMPANY_TOOLS_KEY,
} from "@/lib/company-features"
import { isCompanySectionKey } from "@/lib/company-sections"
import { findTool } from "@/lib/tools/registry"

export const runtime = "nodejs"

/**
 * Два независимых выключателя, поэтому оба необязательные и приходят порознь.
 *
 * `isActive` — компания как сущность: закрывает консоль и оформление входа.
 * `automationEnabled` — слежение конвейера за её проектами
 * (docs/COMPANY_PIPELINE_PLAN.md §5).
 *
 * Слить их в один было бы соблазнительно и неверно: «перестать обрабатывать» на
 * время разбирательства с оплатой и «закрыть компанию» — разные решения, и
 * первое принимают куда чаще второго. Выключателем обработки распоряжаемся мы, а
 * не компания: это управление установкой, в отличие от флага «только свои
 * машины», который стоит в её собственной консоли (§6).
 */
const patchSchema = z
  .object({
    isActive: z.boolean().optional(),
    automationEnabled: z.boolean().optional(),
    /**
     * Дублирование переписки проектов в наш YouGile
     * (docs/COMPANY_SETUP_PANEL_PLAN.md §2.6).
     *
     * Сам чат проектов выключателя не имеет намеренно: он есть у всех и продаже
     * не подлежит. Здесь решается только судьба зеркала.
     */
    chatYouGileSync: z.boolean().optional(),
    /**
     * Работа за наш счёт (docs/COMPANY_SETUP_PANEL_PLAN.md §3).
     *
     * Своим ключом и своей записью в журнале, а не вместе с набором: набор
     * отвечает, что компании видно, а этот — кто платит. Вопросы к ним задают
     * разные люди и в разное время.
     */
    billingFree: z.boolean().optional(),
    /**
     * Набор проданного — docs/COMPANY_SETUP_PANEL_PLAN.md §2.
     *
     * `null` означает «набор не задан», то есть «всё, что есть на установке», и
     * записывается в JSONB именно как null: читатель (`readCompanyFeatures`)
     * видит не-массив и отвечает «не задан». Отдельной операции «удалить ключ»
     * поэтому не нужно, а отличить «не задан» от «продано ничего» (пустой
     * список) по-прежнему можно — и это два разных решения.
     *
     * Ключи проверяются по реестрам, а не принимаются любыми: опечатка в ключе
     * тихо вычеркнула бы инструмент из набора, и заметили бы это по жалобе
     * компании, у которой он пропал.
     */
    companyTools: z
      .array(z.string())
      .refine(
        (keys) => keys.every((key) => findTool(key) !== null),
        "Unknown tool key.",
      )
      .nullable()
      .optional(),
    companySections: z
      .array(z.string())
      .refine((keys) => keys.every(isCompanySectionKey), "Unknown section key.")
      .nullable()
      .optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "Nothing to change.",
  )

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }

  const audit = auditFrom(request, auth)
  let company = await findCompanyById(id)
  if (!company) {
    return NextResponse.json({ message: "Company not found." }, { status: 404 })
  }

  if (parsed.data.automationEnabled !== undefined) {
    company =
      (await patchCompanyFeatures({
        companyId: id,
        patch: { [AUTOMATION_ENABLED_KEY]: parsed.data.automationEnabled },
      })) ?? company
    await audit({
      action: parsed.data.automationEnabled
        ? "company.automation_enabled"
        : "company.automation_disabled",
      targetType: "company",
      targetId: company.id,
      targetLabel: company.title,
      companyId: company.id,
    })
  }

  if (parsed.data.billingFree !== undefined) {
    company =
      (await patchCompanyFeatures({
        companyId: id,
        patch: { [BILLING_FREE_KEY]: parsed.data.billingFree },
      })) ?? company
    await audit({
      action: parsed.data.billingFree
        ? "company.billing_free_enabled"
        : "company.billing_free_disabled",
      targetType: "company",
      targetId: company.id,
      targetLabel: company.title,
      companyId: company.id,
    })
  }

  if (parsed.data.chatYouGileSync !== undefined) {
    company =
      (await patchCompanyFeatures({
        companyId: id,
        patch: { [CHAT_YOUGILE_SYNC_KEY]: parsed.data.chatYouGileSync },
      })) ?? company
    await audit({
      action: parsed.data.chatYouGileSync
        ? "company.chat_sync_enabled"
        : "company.chat_sync_disabled",
      targetType: "company",
      targetId: company.id,
      targetLabel: company.title,
      companyId: company.id,
    })
  }

  /**
   * Оба набора — одной записью и одной строкой журнала: правятся они одним
   * сохранением, и разбивать их на два события значило бы дважды отвечать на
   * один вопрос «что у компании поменялось».
   */
  if (
    parsed.data.companyTools !== undefined ||
    parsed.data.companySections !== undefined
  ) {
    const patch: Record<string, unknown> = {}
    if (parsed.data.companyTools !== undefined) {
      patch[COMPANY_TOOLS_KEY] = parsed.data.companyTools
    }
    if (parsed.data.companySections !== undefined) {
      patch[COMPANY_SECTIONS_KEY] = parsed.data.companySections
    }
    company = (await patchCompanyFeatures({ companyId: id, patch })) ?? company
    await audit({
      action: "company.sets_changed",
      targetType: "company",
      targetId: company.id,
      targetLabel: company.title,
      companyId: company.id,
      meta: patch,
    })
  }

  if (parsed.data.isActive !== undefined) {
    company = (await setCompanyActive(id, parsed.data.isActive)) ?? company
    await audit({
      action: parsed.data.isActive ? "company.enabled" : "company.disabled",
      targetType: "company",
      targetId: company.id,
      targetLabel: company.title,
      companyId: company.id,
    })
  }

  return NextResponse.json(company)
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const company = await findCompanyById(id)
  if (!company) {
    return NextResponse.json({ message: "Company not found." }, { status: 404 })
  }

  const result = await deleteCompany(id)
  if (!result.ok) {
    const messages: Record<string, string> = {
      "has-members": "Move all people out of this company before deleting it.",
      "wallet-has-ledger":
        "This company's wallet has money history. Deleting it would erase the ledger.",
      "wallet-has-dependents":
        "This company's wallet still pays for someone. Reassign them first.",
      "not-found": "Company not found.",
    }
    return NextResponse.json(
      { message: messages[result.reason], code: result.reason },
      { status: result.reason === "not-found" ? 404 : 409 },
    )
  }

  await auditFrom(request, auth)({
    action: "company.deleted",
    targetType: "company",
    targetId: id,
    targetLabel: company.title,
  })

  return NextResponse.json({ message: "Company deleted." })
}
