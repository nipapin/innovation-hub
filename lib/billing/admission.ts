import { query } from "@/lib/db"
import { chooseWallet, grantCoversProject, getFunds, type Funds } from "@/lib/billing/funds"
import { minAdmitCents } from "@/lib/billing/pricing"
import { rateForPair } from "@/lib/billing/settings"
import type { PayUnitProblem } from "@/lib/billing/pay-unit"
import type { PayMeter, PayPair, Wallet } from "@/lib/billing/types"

/**
 * Допуск: можно ли брать этот элемент в работу.
 *
 * Четвёртое условие конвейера — после гейта админа, паузы и архива. Стоит в
 * одной точке, там, где кандидат превращается в задачу: через неё проходят обе
 * линии сборки, событийная и страховочный обход.
 *
 * Кого гейт касается:
 *
 *   освобождён от оплаты   →  никогда (админ, демо-аккаунт, партнёр)
 *   проект покрыт подарком →  всегда: подарок это конечные деньги
 *   остальные              →  только при включённом рубильнике
 *
 * Рубильник выключен по умолчанию не из осторожности, а по арифметике: балансы
 * нулевые, тарифа нет, и первое же включение остановило бы обработку у всех.
 */

/**
 * Почему проект остановлен. Причины разные, потому что разное действие человека:
 * при `no-funds` он пополняет баланс, при `no-vendor-key` — подключает ключ на
 * «Моих ключах», при `payer-no-funds` — идёт к тому, кто платит за его работу:
 * пополнить чужой кошелёк он не может. Свести их в одну значило бы показать
 * кнопку «пополнить» там, где деньги ни при чём или не его.
 */
export type PauseReason =
  | "no-funds"
  | "trial-over"
  | "no-vendor-key"
  | "payer-no-funds"

export type Admission =
  | {
      ok: true
      wallet: Wallet | null
      grantId: string | null
      estimateCents: number
      /** Гейт этого владельца не касается — считаем, но не отказываем. */
      exempt: boolean
    }
  | {
      ok: false
      reason: "insufficient-funds" | PayUnitProblem
      /** Ставить ли проект на паузу и с какой надписью. */
      pauseReason: PauseReason | null
    }

export type AdmissionInput = {
  ownerId: string
  projectId: string
  /** Разрешённая единица; null — не разрешилась, причина в `payUnitProblem`. */
  pair: PayPair | null
  meter: PayMeter | null
  payUnitProblem: PayUnitProblem | null
  estimateCents: number
  funds: Funds
  ownerBillingExempt: boolean
  /**
   * За владельца платит другой (`users.payer_user_id`). Нужен только для
   * причины остановки: деньги кончились не у него.
   */
  ownerHasPayer: boolean
}

export function admitItem(input: AdmissionInput): Admission {
  const { settings } = input.funds

  const coveredByGrant = input.funds.grants.some((g) =>
    grantCoversProject(g, input.projectId),
  )
  const gated =
    !input.ownerBillingExempt &&
    (coveredByGrant || settings.enforceForOwnProjects)

  if (input.payUnitProblem || !input.pair) {
    // Тарифицировать нечем. Пока гейт не касается этого владельца — работаем
    // как раньше: молча остановить конвейер из-за незаполненного поля хуже, чем
    // обработать бесплатно и показать проблему списком (В4).
    if (!gated) {
      return { ok: true, wallet: null, grantId: null, estimateCents: 0, exempt: input.ownerBillingExempt }
    }
    return {
      ok: false,
      reason: input.payUnitProblem ?? "no-pay-unit",
      // Паузу не ставим: это ошибка настройки, а не отсутствие денег. Проект,
      // остановленный за пустое поле, выглядел бы как проблема с оплатой.
      pauseReason: null,
    }
  }

  const rate = rateForPair(settings, input.pair) ?? 0
  const threshold = minAdmitCents({
    minUnits: settings.minAdmitUnits[input.meter ?? "sec"],
    unitRateCents: rate,
  })

  const choice = chooseWallet({
    funds: input.funds,
    projectId: input.projectId,
    estimateCents: input.estimateCents,
    minAdmitCents: threshold,
  })

  if (choice.ok) {
    return {
      ok: true,
      wallet: choice.wallet,
      grantId: choice.grantId,
      estimateCents: input.estimateCents,
      exempt: input.ownerBillingExempt,
    }
  }

  if (!gated) {
    // Денег нет, но гейт этого владельца не касается: резерв не пишем, работу
    // не блокируем.
    return { ok: true, wallet: null, grantId: null, estimateCents: 0, exempt: input.ownerBillingExempt }
  }

  return {
    ok: false,
    reason: "insufficient-funds",
    // «Тестовый период завершён» и «нет средств» — разные надписи для человека,
    // хотя механика одна. Первая уместна, только если подарок у него был. У
    // того, за кого платят, — третья: кошелёк не его, и пополнять не ему.
    pauseReason: input.ownerHasPayer
      ? "payer-no-funds"
      : coveredByGrant
        ? "trial-over"
        : "no-funds",
  }
}

/**
 * Остановить проект: пауза + записанная причина.
 *
 * Пауза пишется ТОЛЬКО через `setProjectPaused` — он владеет обоими
 * хранилищами (`options/folderState.json` и `projects.is_paused`) и кладёт
 * событие в журнал, чтобы машина узнала. Причина — отдельной колонкой: без неё
 * остановка неотличима от той, что сделал сам пользователь, и тумблер нечем
 * было бы удержать.
 */
export async function setPausedReason(
  projectId: string,
  reason: PauseReason | null,
): Promise<void> {
  await query(`UPDATE projects SET paused_reason = $2 WHERE id = $1`, [
    projectId,
    reason,
  ])
}

/**
 * Можно ли снять паузу, поставленную биллингом.
 *
 * Спрашивается при попытке включить тумблер. Причина снимается сама, как только
 * деньги появились: заставлять человека нажимать что-то ещё после пополнения
 * незачем.
 */
export async function canResume(input: {
  projectId: string
  ownerId: string
}): Promise<{ allowed: boolean; reason: PauseReason | null }> {
  const result = await query<{
    pausedReason: PauseReason | null
    exempt: boolean
    payerId: string
  }>(
    `SELECT p.paused_reason AS "pausedReason",
            COALESCE(u.billing_exempt, FALSE) AS exempt,
            COALESCE(u.payer_user_id, u.id) AS "payerId"
       FROM projects p
       JOIN users u ON u.id = p.user_id
      WHERE p.id = $1`,
    [input.projectId],
  )
  const row = result.rows[0]
  if (!row?.pausedReason) return { allowed: true, reason: null }
  if (row.exempt) return { allowed: true, reason: row.pausedReason }

  // Деньги — у кошелька, который платит за владельца, а не у самого владельца:
  // иначе сотрудника с пустым личным кошельком не пустило бы никогда.
  const funds = await getFunds(row.payerId)
  const giftAvailable = funds.grants.some(
    (g) => grantCoversProject(g, input.projectId) && g.availableCents > 0,
  )
  const allowed = giftAvailable || funds.availableOwnCents > 0
  return { allowed, reason: row.pausedReason }
}
