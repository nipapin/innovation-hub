import { NextResponse, type NextRequest } from "next/server"
import { requireCompanyApi } from "@/lib/company-auth"
import { findCompanyById } from "@/lib/repositories/companies"
import { listCompanyKeys } from "@/lib/repositories/company-console"

export const runtime = "nodejs"

/**
 * Учётки внешних сервисов компании — план §11.
 *
 * Отдаются только МЕТКИ и состояние: сами ключи не покидают сейф ни здесь, ни
 * при настройке узла у сотрудника. Заведение и правку учёток на этом шаге не
 * открываем — они живут в «Сервисах» нашей админки, где рядом стоит вся работа
 * с секретами; дублировать её в консоли значило бы завести второе место, куда
 * можно положить чужой ключ.
 */
export async function GET(request: NextRequest) {
  const auth = await requireCompanyApi(request, "keys.manage")
  if (auth instanceof NextResponse) return auth

  const company = await findCompanyById(auth.companyId)
  if (!company) {
    return NextResponse.json({ message: "Company not found." }, { status: 404 })
  }

  const keys = await listCompanyKeys(company.walletUserId)
  return NextResponse.json({
    keys: keys.map((key) => ({
      ...key,
      createdAt: key.createdAt.toISOString(),
    })),
  })
}
