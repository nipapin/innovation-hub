import { query } from "@/lib/db"
import { readBalances, type Balances } from "@/lib/billing/ledger"
import { readBillingSettings } from "@/lib/billing/settings"
import type { BillingSettings, Wallet } from "@/lib/billing/types"

/**
 * Сколько у пользователя доступно и из какого кошелька платить за элемент.
 *
 * Три величины, и путать их нельзя:
 *
 *   остаток      сумма по ленте (кэш в users)
 *   резерв       оценки живых задач — деньги обещаны, но ещё не потрачены
 *   доступное    остаток − резерв, у своего кошелька плюс лимит овердрафта
 *
 * Резерв не хранится лентой: он и есть сама задача. Ушла из живых статусов —
 * резерв снят, отпускать нечего. Упала, вернули, протухла аренда, удалили
 * проект — во всех случаях само.
 */

/**
 * Окно между «задача завершилась» и «строка архива приехала».
 *
 * Резерв снимается статусом, а списание появляется только после импорта
 * `_stats` (часовой тик). В этом окне элемент не учтён ни как резерв, ни как
 * факт, и допуск выпустил бы лишнее. Поэтому завершённая задача без списания
 * продолжает держать резерв — но не вечно, иначе задача, по которой архив не
 * приедет никогда, заморозила бы деньги.
 */
const SETTLEMENT_WINDOW = "12 hours"

export type GrantFunds = {
  grantId: string
  kind: "trial" | "targeted"
  amountCents: number
  /** Остаток гранта: начисление минус списания по нему. */
  remainingCents: number
  reservedCents: number
  availableCents: number
  expiresAt: Date | null
  /** Пустой список = грант действует в любом проекте владельца. */
  projectIds: string[]
}

export type Funds = {
  balances: Balances
  reserved: Balances
  overdraftLimitCents: number
  /** Остаток минус резерв; у своего кошелька плюс овердрафт. */
  availableOwnCents: number
  availableGiftCents: number
  grants: GrantFunds[]
  settings: BillingSettings
}

type ReserveRows = { byWallet: Balances; byGrant: Map<string, number> }

/**
 * Живые резервы кошелька — по проектам всех, за кого он платит.
 *
 * Платит владелец проекта (`projects.user_id`), а не тот, кто работает в
 * расшаренном: отдал доступ — платишь ты. А за владельца может платить другой
 * (`users.payer_user_id`, docs/COMPANY_ACCOUNTS_PLAN.md §7): тогда резерв его
 * задач лежит на кошельке плательщика.
 *
 * Считать по `p.user_id = $1` здесь нельзя: у плательщика своих проектов может
 * не быть вовсе, резерв вышел бы нулевым, и допуск пропускал бы работ больше,
 * чем покрывает остаток, — тем больше, чем больше людей работают одновременно.
 */
async function liveReserves(walletUserId: string): Promise<ReserveRows> {
  const result = await query<{
    wallet: Wallet | null
    grantId: string | null
    cents: string
  }>(
    `SELECT t.pay_wallet AS wallet,
            t.pay_grant_id AS "grantId",
            COALESCE(SUM(t.estimate_cents), 0)::text AS cents
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       JOIN users o ON o.id = p.user_id
      WHERE COALESCE(o.payer_user_id, o.id) = $1
        AND t.pay_wallet IS NOT NULL
        AND (
          t.status IN ('queued', 'claimed', 'running')
          OR (
            t.status = 'done'
            AND t.updated_at > NOW() - INTERVAL '${SETTLEMENT_WINDOW}'
            AND NOT EXISTS (
              SELECT 1 FROM billing_transactions b
               WHERE b.task_id = t.id AND b.kind IN ('charge', 'exempt')
            )
          )
        )
      GROUP BY t.pay_wallet, t.pay_grant_id`,
    [walletUserId],
  )

  const byWallet: Balances = { own: 0, gift: 0 }
  const byGrant = new Map<string, number>()
  for (const row of result.rows) {
    const cents = Number(row.cents)
    if (row.wallet) byWallet[row.wallet] += cents
    if (row.grantId) {
      byGrant.set(row.grantId, (byGrant.get(row.grantId) ?? 0) + cents)
    }
  }
  return { byWallet, byGrant }
}

/**
 * Действующие подарки с остатком.
 *
 * Остаток считается по ленте, а не полем: начисление это `+amount`, списания —
 * отрицательные строки с тем же `grant_id`. Отдельный счётчик пришлось бы
 * сводить с историей, а он бы с ней расходился.
 */
async function listGrants(
  userId: string,
  reserves: ReserveRows,
): Promise<GrantFunds[]> {
  const result = await query<{
    grantId: string
    kind: "trial" | "targeted"
    amountCents: string
    remainingCents: string
    expiresAt: Date | null
    projectIds: string[] | null
  }>(
    `SELECT g.id AS "grantId",
            g.kind,
            g.amount_cents::text AS "amountCents",
            COALESCE((
              SELECT SUM(b.amount_cents)
                FROM billing_transactions b
               WHERE b.grant_id = g.id
            ), 0)::text AS "remainingCents",
            g.expires_at AS "expiresAt",
            ARRAY(
              SELECT gp.project_id
                FROM billing_grant_projects gp
               WHERE gp.grant_id = g.id
            ) AS "projectIds"
       FROM billing_grants g
      WHERE g.user_id = $1
        AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > NOW())
      ORDER BY g.expires_at ASC NULLS LAST, g.created_at ASC`,
    [userId],
  )

  return result.rows.map((row) => {
    const remaining = Number(row.remainingCents)
    const reserved = reserves.byGrant.get(row.grantId) ?? 0
    return {
      grantId: row.grantId,
      kind: row.kind,
      amountCents: Number(row.amountCents),
      remainingCents: remaining,
      reservedCents: reserved,
      availableCents: Math.max(0, remaining - reserved),
      expiresAt: row.expiresAt,
      projectIds: row.projectIds ?? [],
    }
  })
}

async function overdraftLimitFor(
  userId: string,
  settings: BillingSettings,
): Promise<number> {
  const result = await query<{ limit: string | null }>(
    `SELECT overdraft_limit_cents::text AS limit FROM users WHERE id = $1`,
    [userId],
  )
  const own = result.rows[0]?.limit
  // NULL — общий лимит из настроек. Своё значение ставится осознанно, поэтому
  // ноль у пользователя означает именно «этому не даём», а не «возьми общий».
  return own == null ? settings.overdraftLimitCents : Number(own)
}

/**
 * Деньги КОШЕЛЬКА. `userId` — тот, чей кошелёк: плательщик, а не обязательно
 * владелец проекта. Кто за кого платит — lib/billing/payer.ts; передать сюда
 * владельца, за которого платит другой, значит прочитать его пустой личный
 * кошелёк вместо настоящего.
 */
export async function getFunds(userId: string): Promise<Funds> {
  const { settings } = await readBillingSettings()
  const [balances, reserves] = await Promise.all([
    readBalances(userId),
    liveReserves(userId),
  ])
  const [grants, overdraftLimitCents] = await Promise.all([
    listGrants(userId, reserves),
    overdraftLimitFor(userId, settings),
  ])

  return {
    balances,
    reserved: reserves.byWallet,
    overdraftLimitCents,
    availableOwnCents: balances.own - reserves.byWallet.own + overdraftLimitCents,
    availableGiftCents: Math.max(0, balances.gift - reserves.byWallet.gift),
    grants,
    settings,
  }
}

/** Действует ли подарок в этом проекте. Пустой список — в любом. */
export function grantCoversProject(grant: GrantFunds, projectId: string): boolean {
  return grant.projectIds.length === 0 || grant.projectIds.includes(projectId)
}

export type WalletChoice =
  | { ok: true; wallet: "gift"; grantId: string; availableCents: number }
  | { ok: true; wallet: "own"; grantId: null; availableCents: number }
  | { ok: false; reason: "insufficient-funds" }

/**
 * Каким кошельком платить за элемент. Решается ОДИН раз, на входе, по оценке, и
 * до конца обработки не меняется.
 *
 * Два кошелька уходят в ноль по-разному, и правила у них поэтому разные:
 *
 * **Подарочный** — берём, пока хватает на минимальный осмысленный кусок работы
 * (`minAdmitCents`, это «10 секунд результата» в деньгах). Оценка может
 * оказаться больше остатка: доработаем и уйдём в ноль, разницу спишем себе.
 * Риск ограничен — граф наш, из шаблонов, и стоимость элемента известна.
 *
 * **Свой** — только если оценка влезает целиком. Щедрый хвост здесь стал бы
 * дырой: держи на балансе десять секунд и запускай часовую генерацию. Перерасход
 * на своём возможен лишь на нашу ошибку в оценке, а не на разницу «стоимость
 * минус остаток».
 */
export function chooseWallet(input: {
  funds: Funds
  projectId: string
  estimateCents: number
  /** Порог допуска в деньгах — минимум, ради которого стоит начинать. */
  minAdmitCents: number
}): WalletChoice {
  // Гранты уже отсортированы по сроку: сгорающее тратим раньше бессрочного,
  // иначе оно сгорит нетронутым, а бессрочное осталось бы лежать.
  for (const grant of input.funds.grants) {
    if (!grantCoversProject(grant, input.projectId)) continue
    if (grant.availableCents >= input.minAdmitCents) {
      return {
        ok: true,
        wallet: "gift",
        grantId: grant.grantId,
        availableCents: grant.availableCents,
      }
    }
  }

  if (input.funds.availableOwnCents >= input.estimateCents) {
    return {
      ok: true,
      wallet: "own",
      grantId: null,
      availableCents: input.funds.availableOwnCents,
    }
  }

  return { ok: false, reason: "insufficient-funds" }
}

/**
 * Учесть только что допущенную задачу в уже прочитанных деньгах.
 *
 * Конвейер читает деньги один раз на проход и держит их в кэше по кошельку
 * (lib/pipeline/scan.ts). Резерв задачи появляется в базе вместе с её строкой,
 * но кэш об этом не знает — и без этой поправки все элементы пачки допускались
 * бы по одному и тому же остатку. С общим кошельком это уже не частный случай:
 * в одну пачку попадают задачи всех, за кого платит один кошелёк.
 */
export function holdReserve(
  funds: Funds,
  hold: { wallet: Wallet | null; grantId: string | null; estimateCents: number },
): void {
  const cents = Math.max(0, Math.round(hold.estimateCents))
  if (cents === 0 || hold.wallet == null) return

  funds.reserved[hold.wallet] += cents
  if (hold.wallet === "own") {
    funds.availableOwnCents -= cents
    return
  }

  const grant = funds.grants.find((g) => g.grantId === hold.grantId)
  if (grant) {
    grant.reservedCents += cents
    grant.availableCents = Math.max(0, grant.availableCents - cents)
  }
  funds.availableGiftCents = Math.max(0, funds.availableGiftCents - cents)
}
