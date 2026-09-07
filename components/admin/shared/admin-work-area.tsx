"use client"

import Link from "next/link"

import { FullMode } from "@/components/account/workspace/full-mode"
import { SimpleProject } from "@/components/account/workspace/simple-mode"
import { DensitySwitch } from "@/components/account/workspace/workspace-topbar"
import { useWorkspace } from "@/components/account/workspace/workspace-context"

/**
 * Рабочая область админских инструментов — правая часть и «Папок», и «Чатов».
 *
 * Оба инструмента показывают ОДНО И ТО ЖЕ: содержимое чужого проекта. Разница
 * только в том, по какому признаку его выбирают — по владельцу или по
 * пришедшему сообщению. Поэтому правая часть у них общая: разойдись она на две
 * копии, и любая правка в работе с файлами делалась бы дважды.
 *
 * Кабинетную `WorkspaceTopbar` здесь не переиспользуешь: в ней «Обработка» —
 * индикатор задач ТОГО, кто смотрит, и рядом с чужой папкой админ видел бы свои
 * собственные задачи. Из неё взят только переключатель вида.
 */
export function AdminWorkArea({
  owner,
  ownerHref,
}: {
  owner?: string | null
  /**
   * Куда ведёт почта владельца. В «Чатах» — на его папки: разговор часто
   * кончается тем, что нужно посмотреть ОСТАЛЬНЫЕ его проекты, а колонка слева
   * про переписку, а не про людей. В «Папках» ссылки нет — человек уже там.
   */
  ownerHref?: string | null
}) {
  const { selected, density } = useWorkspace()

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/[0.07] px-3 md:px-5">
        {/* Чей проект открыт. В «Чатах» это единственное место, где видно
            владельца. */}
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          {owner && ownerHref ? (
            <Link
              href={ownerHref}
              className="truncate text-ws-3 underline-offset-2 hover:text-ws-1 hover:underline"
            >
              {owner}
            </Link>
          ) : owner ? (
            <span className="truncate text-ws-3">{owner}</span>
          ) : null}
          {owner && selected ? <span className="shrink-0 text-ws-5">/</span> : null}
          {selected ? (
            <span className="truncate font-medium text-ws-1">{selected.name}</span>
          ) : null}
        </div>
        <DensitySwitch />
      </header>

      {/*
        Упрощённый вид — это взгляд на проект глазами клиента: IN, OUT и ничего
        лишнего. Полный — файловый менеджер со всем деревом, включая служебные
        папки. Пока проект не выбран, показывать нечего в обоих видах, и
        приглашение выбрать даёт FullMode.
      */}
      {selected && density === "simple" ? <SimpleProject /> : <FullMode />}
    </main>
  )
}
