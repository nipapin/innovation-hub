"use client"

import { KeyRound, MoreHorizontal, Trash2, KeyRound as Rotate } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import { useI18n, type Lang } from "@/components/account/i18n"
import { cn } from "@/lib/utils"
import type { AccessTokenDto, WorkerState } from "./types"

/**
 * Токен доступа и машины под ним — одной строкой на токен.
 *
 * Порядок чтения сверху вниз: первая строка — токен, который завели и один раз
 * скопировали в машину. Под ней — машины, которые этим токеном обращаются.
 * Токен сам по себе «в сети» не бывает, поэтому на его строке нет ни статуса, ни
 * времени сигнала: это свойства машины, а не ключа.
 *
 * Нет машин — так и написано во второй строке. Токен есть, никто им не ходит.
 */

function fmt(iso: string | null, lang: Lang): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleTimeString(lang === "ru" ? "ru-RU" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/** Точка «машина стучится на сайт»: любое обращение по API. */
function LinkDot({ on, hint }: { on: boolean; hint: string }) {
  return (
    <span title={hint} className="relative flex h-2.5 w-2.5 shrink-0">
      {on ? (
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/50" />
      ) : null}
      <span
        className={cn(
          "relative inline-flex h-2.5 w-2.5 rounded-full",
          on ? "bg-emerald-400" : "bg-muted-foreground/30",
        )}
      />
    </span>
  )
}

/**
 * Точка состояния воркера. Четыре состояния, а не флаг:
 *
 *   серый          — выключен
 *   моргает зелёным — включён, спрашивает задачи, но их нет
 *   горит зелёным   — задача в работе
 *   красный         — ошибка
 *
 * «Выключен» и «включён, но задач нет» — разные вещи, и по одному индикатору их
 * не различить: молчащая очередь выглядела бы как выключенный воркер.
 */
function WorkerDot({ state, hint }: { state: WorkerState; hint: string }) {
  const color =
    state === "error"
      ? "bg-destructive"
      : state === "off"
        ? "bg-muted-foreground/30"
        : "bg-emerald-400"

  return (
    <span title={hint} className="relative flex h-2.5 w-2.5 shrink-0">
      {/* Моргает только «в поиске»: обработка — ровный свет, чтобы разница между
          «ищет» и «работает» читалась без подписи. */}
      {state === "searching" ? (
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/50" />
      ) : null}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", color)} />
    </span>
  )
}

export function AccessTokenRow({
  token,
  canRotateToken,
  onRotateToken,
  onRevoke,
}: {
  token: AccessTokenDto
  canRotateToken: boolean
  onRotateToken: () => void
  onRevoke: () => void
}) {
  const t = useAdminI18n()
  const { lang } = useI18n()

  const workerLabel: Record<WorkerState, string> = {
    off: t.workerOff,
    searching: t.workerSearching,
    processing: t.workerProcessing,
    error: t.workerError,
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="truncate font-medium text-foreground">{token.name}</p>
        <span className="truncate text-xs text-muted-foreground">
          {token.ownerEmail}
        </span>
        {token.description ? (
          <span
            title={token.description}
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground/80 before:mr-2 before:content-['·']"
          >
            {token.description}
          </span>
        ) : null}
        {token.projectId ? (
          <Badge variant="outline" className="text-[10px]">
            {t.tokenScoped}
          </Badge>
        ) : null}
        {token.machines.length > 1 ? (
          <Badge variant="secondary" className="text-[10px]">
            {tf(t.tokenMachineCount, { count: token.machines.length })}
          </Badge>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="ml-auto h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">{t.actions}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {/* Обновление токена — только у компьютеров: значение `mch_` мы
                видели один раз при выпуске и заменить его нечем. Отзыв есть у
                обоих, иначе брошенный токен убрать со страницы нельзя. */}
            {token.canRotate ? (
              <>
                <DropdownMenuItem
                  onClick={onRotateToken}
                  disabled={!canRotateToken}
                >
                  <Rotate className="h-4 w-4" />
                  {t.remoteRotateToken}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem
              onClick={onRevoke}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              {token.kind === "computer"
                ? t.remoteRevokeConfirm
                : t.tokenRevokeConfirm}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="border-t border-border/50">
        {token.machines.length === 0 ? (
          <p className="px-4 py-2.5 pl-[34px] text-xs text-muted-foreground">
            {t.tokenNoMachines}
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {token.machines.map((machine) => (
              <li
                key={machine.id}
                className="flex items-center gap-3 px-4 py-2.5 pl-[34px]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-foreground">
                    {machine.machineUuid ?? machine.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {machine.machineUuid ? `${machine.name} · ` : ""}
                    {machine.currentProjectName ?? t.machineNoTask}
                  </p>
                </div>

                <span className="flex shrink-0 items-center gap-3">
                  <span className="flex items-center gap-1.5">
                    <LinkDot
                      on={machine.seen}
                      hint={tf(t.machineSeenHint, {
                        time: fmt(machine.lastSeenAt, lang),
                      })}
                    />
                    <span className="hidden text-[11px] text-muted-foreground sm:inline">
                      {machine.seen ? t.machineOnline : t.machineOffline}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <WorkerDot
                      state={machine.worker}
                      hint={tf(t.machineClaimHint, {
                        time: fmt(machine.lastClaimAt, lang),
                      })}
                    />
                    <span className="hidden text-[11px] text-muted-foreground sm:inline">
                      {workerLabel[machine.worker]}
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
