import { query, withTransaction } from "@/lib/db"
import { getFunds } from "@/lib/billing/funds"
import { closeGrant } from "@/lib/billing/grants"
import { recordTransaction, splitShortfall } from "@/lib/billing/ledger"
import { minAdmitCents, priceCharge } from "@/lib/billing/pricing"
import { readLatestRate } from "@/lib/billing/rates"
import { rateForPair } from "@/lib/billing/settings"
import { readBillingSettings } from "@/lib/billing/settings"
import {
  BYTES_PER_UNIT,
  breakdownTotal,
  isPayBase,
  isPayMeter,
  payPair,
  type PayBase,
  type PayMeter,
  type Wallet,
} from "@/lib/billing/types"
import { usageCentsForTask } from "@/lib/vault/usage"

/**
 * Списание по факту — из строки архива обработок.
 *
 * Почему единственный путь именно этот, а не отчёт машины (`taskDone`):
 * в отчёте есть `totalCost` и список файлов, но нет хронометража результата.
 * Строка архива несёт всё сразу — `outSec`, `renderSec`, `out[]`, `totalCost`,
 * — и связана с задачей сквозным `item_id = tasks.id`. Второй путь дал бы
 * второй источник правды при том же наборе полей минус один.
 *
 * Проход отдельный, а не внутри импорта: упавшее списание не должно мешать
 * импорту, а незавершённое подхватится следующим проходом. Идемпотентность
 * держит уникальный индекс по `task_id`, а не порядок вызовов.
 */

const SETTLE_LIMIT = 200

export type SettleResult = {
  considered: number
  charged: number
  exempt: number
  skipped: number
  /** Ждут поля `srcSec` от машины — не ошибка, но и не «бесплатно». */
  awaitingSrcSec: number
  errors: number
}

type UnbilledRow = {
  taskId: string
  projectId: string
  ownerId: string
  /**
   * Чей кошелёк платит: плательщик владельца или сам владелец
   * (docs/COMPANY_ACCOUNTS_PLAN.md §7). Списание и остаток подарка — отсюда,
   * а освобождение от оплаты — по-прежнему у владельца (§7.6).
   */
  payerId: string
  billingExempt: boolean
  payWallet: Wallet | null
  payGrantId: string | null
  status: string
  outSec: number | null
  srcSec: number | null
  renderSec: number | null
  outCount: number
  totalCost: string | null
  payBase: string | null
  payMeter: string | null
  sourceUnits: string | null
  /** Логические пути результата, присланные машиной в taskDone. */
  outFiles: string[] | null
}

/**
 * Обработки, по которым ещё не списано.
 *
 * `item_id = tasks.id` работает только для задач, созданных после появления
 * сквозного идентификатора (docs/PIPELINE.md §15). Более старые сюда не попадут
 * никогда — и это правильно: связать их с задачей можно было бы только
 * гаданием, а гадать деньгами нельзя.
 */
async function listUnbilled(limit: number): Promise<UnbilledRow[]> {
  const result = await query<UnbilledRow>(
    `SELECT t.id                     AS "taskId",
            t.project_id             AS "projectId",
            p.user_id                AS "ownerId",
            COALESCE(u.payer_user_id, u.id) AS "payerId",
            COALESCE(u.billing_exempt, FALSE) AS "billingExempt",
            t.pay_wallet             AS "payWallet",
            t.pay_grant_id           AS "payGrantId",
            ps.status,
            ps.out_sec               AS "outSec",
            ps.src_sec               AS "srcSec",
            ps.render_sec            AS "renderSec",
            COALESCE(jsonb_array_length(ps.out_paths), 0) AS "outCount",
            ps.total_cost::text      AS "totalCost",
            t.payload #>> '{description,payBase}'  AS "payBase",
            t.payload #>> '{description,payMeter}' AS "payMeter",
            t.payload #>> '{description,sourceUnits}' AS "sourceUnits",
            t.payload -> 'outFiles' AS "outFiles"
       FROM processing_stats ps
       JOIN tasks t    ON t.id = ps.item_id
       JOIN projects p ON p.id = t.project_id
       JOIN users u    ON u.id = p.user_id
      WHERE NOT EXISTS (
              SELECT 1 FROM billing_transactions b
               WHERE b.task_id = t.id AND b.kind IN ('charge', 'exempt')
            )
      ORDER BY ps.ended_at ASC NULLS LAST
      LIMIT $1`,
    [limit],
  )
  return result.rows
}

/**
 * Количество единиц по факту.
 *
 * `source × sec` берётся из `srcSec` — поля схемы v2. Пока машина его не шлёт,
 * значение приходит пустым: тогда возвращаем `null`, и обработка остаётся
 * несписанной до появления поля. Списать её нулём было бы хуже — забытая
 * правка в программе выглядела бы как решение раздавать бесплатно.
 */
/**
 * Объём результата — из КАТАЛОГА, а не из архива.
 *
 * В строке архива размеров выходных файлов нет, зато `taskDone` присылает их
 * логические пути (`OUT/08 August/clip.mp4`), а сами файлы машина заливает в
 * хранилище — значит размеры лежат в `project_files`. Сопоставляем по пути.
 *
 * Недостающая строка (файл удалили) в сумму не попадает: считать по тому, чего
 * уже нет, мы всё равно не можем, а выдумывать размер — хуже, чем недосчитать.
 */
async function outputBytes(
  projectId: string,
  outFiles: string[] | null,
): Promise<number | null> {
  if (!outFiles || outFiles.length === 0) return null

  const folders: string[] = []
  const names: string[] = []
  for (const path of outFiles) {
    const clean = String(path).replace(/^\/+/, "")
    const cut = clean.lastIndexOf("/")
    folders.push(cut < 0 ? "" : clean.slice(0, cut))
    names.push(cut < 0 ? clean : clean.slice(cut + 1))
  }

  const result = await query<{ bytes: string }>(
    `SELECT COALESCE(SUM(f.size_bytes), 0)::text AS bytes
       FROM project_files f
       JOIN unnest($2::text[], $3::text[]) AS want(folder, name)
         ON lower(f.folder_path) = lower(want.folder)
        AND lower(f.name) = lower(want.name)
      WHERE f.project_id = $1
        AND f.is_folder = FALSE
        AND f.deleted_at IS NULL`,
    [projectId, folders, names],
  )
  const bytes = Number(result.rows[0]?.bytes ?? 0)
  return bytes > 0 ? bytes : null
}

function unitsFor(row: UnbilledRow, base: PayBase, meter: PayMeter | null): number | null {
  if (base === "fixed") return 1
  if (base === "output" && meter === "sec") return row.outSec ?? null
  if (base === "output" && meter === "count") return row.outCount
  if (base === "render" && meter === "sec") return row.renderSec ?? null
  if (base === "source" && meter === "sec") return row.srcSec ?? null
  if (base === "source" && meter === "bytes") {
    // sourceUnits для объёма сборка уже посчитала в мегабайтах.
    const raw = row.sourceUnits == null ? null : Number(row.sourceUnits)
    return raw != null && Number.isFinite(raw) ? raw : null
  }
  if (base === "source") {
    // Количество исходников сборка задачи посчитала заранее и положила в
    // description: после обработки папки в каталоге уже может не быть тех
    // файлов (их переносит postProcess), и пересчитать её задним числом нечем.
    const raw = row.sourceUnits == null ? null : Number(row.sourceUnits)
    return raw != null && Number.isFinite(raw) ? raw : null
  }
  return null
}

export async function settleUnbilled(limit = SETTLE_LIMIT): Promise<SettleResult> {
  const out: SettleResult = {
    considered: 0,
    charged: 0,
    exempt: 0,
    skipped: 0,
    awaitingSrcSec: 0,
    errors: 0,
  }

  const rows = await listUnbilled(limit)
  if (rows.length === 0) return out
  out.considered = rows.length

  const { settings } = await readBillingSettings()
  const vendorRate = await readLatestRate(settings.vendorCurrency)

  for (const row of rows) {
    try {
      // Упавшая обработка не тарифицируется — то же правило, что в архиве.
      // Резерв с неё снялся статусом задачи, отпускать нечего.
      if (row.status !== "done") {
        out.skipped++
        continue
      }
      if (!isPayBase(row.payBase)) {
        // Оси не разрешились на сборке. Гейт денег их отсечёт раньше, чем сюда
        // дойдёт; пока он выключен — обработка бесплатна и видна в unpriced.
        out.skipped++
        continue
      }
      const base = row.payBase
      const meter = base === "fixed" ? null : isPayMeter(row.payMeter) ? row.payMeter : null
      if (base !== "fixed" && meter == null) {
        out.skipped++
        continue
      }

      // Объём выхода — единственная мера, которой нет в самой строке архива:
      // за ней надо сходить в каталог по путям из отчёта машины.
      const units =
        base === "output" && meter === "bytes"
          ? await outputBytes(row.projectId, row.outFiles).then((bytes) =>
              bytes == null ? null : bytes / BYTES_PER_UNIT,
            )
          : unitsFor(row, base, meter)
      if (units == null) {
        // Отдельный счётчик, а не общий «пропущено»: «нечем тарифицировать» и
        // «ждём поле из программы» — разные состояния, и второе чинится не
        // здесь.
        if (base === "source" && meter === "sec") out.awaitingSrcSec++
        else out.skipped++
        continue
      }

      const pair = payPair(base, meter)
      const unitRateCents = rateForPair(settings, pair)
      if (unitRateCents == null) {
        // Ставки нет — это не «бесплатно», а «не назначено». Молча списать ноль
        // значило бы сделать забытую ставку осознанным решением.
        out.skipped++
        continue
      }

      // Себестоимость по строкам потребления, если нода их прислала. Нет строк
      // — прежний путь через `total_cost` из архива: парк переходит на новый
      // контракт не одномоментно, и до перехода списание должно работать как
      // работало (docs/VENDOR_SERVICES_PLAN.md, С5).
      const vendorCentsFromUsage = await usageCentsForTask(row.taskId)

      const priced = priceCharge({
        base,
        meter,
        units,
        unitRateCents,
        marginPct: settings.marginPct,
        vendorCentsFromUsage,
        vendorAmount: row.totalCost == null ? null : Number(row.totalCost),
        vendorCurrency: settings.vendorCurrency,
        vendorRate: vendorRate?.rate ?? null,
        vendorRateSource: vendorRate?.source ?? null,
        fxAdjustPct: settings.fxAdjustPct,
      })

      const total = breakdownTotal(priced.breakdown)

      // Освобождённый от оплаты: сумма считается полностью, движения нет.
      // Освобождение от ОПЛАТЫ не освобождает от УЧЁТА — работа админа тратит
      // те же деньги на внешних сервисах, и без этой строки отчёт занижал бы
      // расход ровно на нашу собственную работу.
      if (row.billingExempt) {
        await recordTransaction({
          userId: row.payerId,
          projectId: row.projectId,
          taskId: row.taskId,
          wallet: row.payWallet ?? "own",
          grantId: row.payGrantId,
          kind: "exempt",
          amountCents: 0,
          breakdown: priced.breakdown,
          terms: priced.terms,
          comment: "Работа без оплаты",
        })
        out.exempt++
        continue
      }

      const wallet: Wallet = row.payWallet ?? "own"

      // Подарочный ниже нуля не уходит: сколько осталось — столько и платит,
      // разницу пишем себе. Свой уходит в минус — там это долг, а не убыток,
      // и закроется первым пополнением.
      let covered = total
      if (wallet === "gift") {
        const funds = await getFunds(row.payerId)
        const grant = funds.grants.find((g) => g.grantId === row.payGrantId)
        const remaining = grant?.remainingCents ?? funds.balances.gift
        covered = Math.max(0, Math.min(total, remaining))
      }

      const { paid, absorbed } = splitShortfall(priced.breakdown, covered)

      await withTransaction(async (client) => {
        await recordTransaction(
          {
            userId: row.payerId,
            projectId: row.projectId,
            taskId: row.taskId,
            wallet,
            grantId: row.payGrantId,
            kind: "charge",
            amountCents: -covered,
            breakdown: paid,
            terms: priced.terms,
          },
          client,
        )

        if (breakdownTotal(absorbed) > 0) {
          await recordTransaction(
            {
              userId: row.payerId,
              projectId: row.projectId,
              // task_id здесь есть: уникальный индекс ограничивает только
              // charge и exempt, а writeoff — вторая строка по той же работе, и
              // без ссылки на задачу её пришлось бы искать по времени.
              taskId: row.taskId,
              wallet,
              grantId: row.payGrantId,
              kind: "writeoff",
              amountCents: 0,
              breakdown: absorbed,
              terms: priced.terms,
              comment: "Не покрыто кошельком",
            },
            client,
          )
        }
      })

      out.charged++

      // Хвост подарка. Остатка не хватает даже на минимальный кусок работы —
      // формально грант не исчерпан, фактически на него ничего не купить, и в
      // кабинете он повиснет непонятной строкой. Проверяем здесь, потому что
      // ставка и мера уже в руках: в другом месте их пришлось бы добывать
      // заново, а без них порог «10 секунд» не перевести в деньги.
      if (wallet === "gift" && row.payGrantId) {
        const after = await getFunds(row.payerId)
        const grant = after.grants.find((g) => g.grantId === row.payGrantId)
        if (grant) {
          const threshold = minAdmitCents({
            minUnits: settings.minAdmitUnits[meter ?? "sec"],
            unitRateCents: unitRateCents,
          })
          if (grant.remainingCents < threshold) {
            await closeGrant({
              grantId: grant.grantId,
              status: "exhausted",
              remainingCents: Math.max(0, grant.remainingCents),
              comment: "Остатка не хватает на минимальную обработку",
            })
          }
        }
      }
    } catch (error) {
      out.errors++
      console.error("[billing] списание не прошло", row.taskId, error)
    }
  }

  return out
}

/**
 * Закрыть подарки, у которых вышел срок.
 *
 * Отдельно от списания: срок истекает по календарю, а не по факту обработки, и
 * ждать чужого прогона, чтобы погасить остаток, неправильно. Остаток гасится
 * строкой — молча стёртые деньги были бы дырой в ленте.
 */
export async function closeExpiredGrants(): Promise<number> {
  const result = await query<{ grantId: string; remaining: string }>(
    `SELECT g.id AS "grantId",
            COALESCE((
              SELECT SUM(b.amount_cents) FROM billing_transactions b
               WHERE b.grant_id = g.id
            ), 0)::text AS remaining
       FROM billing_grants g
      WHERE g.status = 'active'
        AND g.expires_at IS NOT NULL
        AND g.expires_at <= NOW()`,
  )

  for (const row of result.rows) {
    await closeGrant({
      grantId: row.grantId,
      status: "expired",
      remainingCents: Math.max(0, Number(row.remaining)),
      comment: "Срок подарка истёк",
    })
  }
  return result.rows.length
}
