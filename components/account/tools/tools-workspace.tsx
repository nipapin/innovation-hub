"use client"

import { ArrowLeft, Monitor } from "lucide-react"

import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { DensitySwitch } from "@/components/account/workspace/workspace-topbar"
import { CatalogDialog } from "./catalog-dialog"
import { ToolHost } from "./tool-host"
import { NoToolSelected, ToolsColumn, ToolsGrid, useToolTitle } from "./tools-list"
import { ToolsProvider, useTools } from "./tools-context"
import { ProcessingIndicator } from "@/components/account/processing-indicator"

/**
 * Верхняя панель раздела — та же анатомия, что у рабочей области проектов:
 * стрелка назад и путь слева, режим и ссылка на сайт справа.
 */
function ToolsTopbar() {
  const { t } = useWorkspace()
  const { selected, closeTool } = useTools()
  const title = useToolTitle()

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-foreground/[0.07] px-3 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={closeTool}
          aria-label={t.toolsTab}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-foreground/10 bg-ws-control text-ws-3 hover:bg-ws-hover hover:text-ws-1"
        >
          <ArrowLeft className="h-[19px] w-[19px]" />
        </button>
        <button
          type="button"
          onClick={closeTool}
          className="hidden rounded-lg px-2 py-1 text-[16px] font-medium text-ws-3 hover:bg-foreground/5 hover:text-ws-1 sm:block"
        >
          {t.toolsTab}
        </button>
        {selected ? (
          <>
            <span className="hidden text-[16px] text-ws-5 sm:inline">/</span>
            <span className="truncate text-[15px] font-semibold text-ws-1 md:text-[16px]">
              {title(selected)}
            </span>
          </>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-3 md:gap-4">
        <DensitySwitch />
        <ProcessingIndicator />
      </div>
    </header>
  )
}

/**
 * Раздел «Инструменты». Раскладка повторяет раздел проектов, чтобы человек не
 * переучивался:
 *
 * • полный режим — колонка со списком слева, справа открытый инструмент, а пока
 *   он не выбран, приглашение выбрать (как «Выберите проект»);
 * • упрощённый — крупные карточки, открытый инструмент во всю ширину.
 *
 * Боковое меню шелла выше этого дерева и присутствует всегда.
 */
function ToolsLayout() {
  const { density } = useWorkspace()
  const { selected } = useTools()

  const area = selected ? (
    <ToolHost tool={selected} />
  ) : density === "full" ? (
    <NoToolSelected />
  ) : (
    <ToolsGrid />
  )

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      <div className="hidden h-full min-w-0 flex-1 lg:flex">
        {density === "full" ? <ToolsColumn /> : null}
        <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <ToolsTopbar />
          {area}
        </main>
      </div>

      {/*
        Узкий экран — одна колонка и без инструмента: рабочее место требует
        ширины от 1024 (§19 плана). Раньше здесь стоял тот же `ToolHost`, и обе
        ветки жили в DOM одновременно — CSS прятал одну, но не размонтировал.
        Пока это была сводка документа, разницы не было; редактор в двух копиях
        даёт два `<video>` с одним файлом (эхо через пару секунд) и два
        обработчика клавиш на окне.
      */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden lg:hidden">
        <ToolsTopbar />
        {selected ? <NarrowScreen /> : <ToolsGrid />}
      </main>

      <CatalogDialog />
    </div>
  )
}

/** Заглушка вместо инструмента на узком экране. */
function NarrowScreen() {
  const { t } = useWorkspace()
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <p className="flex max-w-[360px] flex-col items-center gap-3 text-center text-[14px] leading-relaxed text-ws-4">
        <Monitor className="h-7 w-7 text-ws-5" />
        {t.toolNeedsWideScreen}
      </p>
    </div>
  )
}

export function ToolsWorkspace() {
  return (
    <ToolsProvider>
      <ToolsLayout />
    </ToolsProvider>
  )
}
