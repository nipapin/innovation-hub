"use client"

import { ToolsWorkspace } from "@/components/account/tools/tools-workspace"
import { ArchiveDialog } from "./archive-dialog"
import { ClipboardPanel } from "./clipboard-panel"
import { WorkspaceContextMenu } from "./context-menu"
import { PreviewDialog } from "./file-preview"
import { FullMode } from "./full-mode"
import { MobileWorkspace } from "./mobile-view"
import { MoveDialog } from "./move-dialog"
import { ProjectsColumn } from "./projects-column"
import { ShareDialog } from "./share-dialog"
import { TrashBanner } from "./trash-banner"
import { TrialBanner } from "./trial-banner"
import { AllProjectsPage, SimpleProject } from "./simple-mode"
import { WorkspaceProvider, useWorkspace } from "./workspace-context"
import { WorkspaceDialogs } from "./workspace-dialogs"
import { WorkspaceTopbar } from "./workspace-topbar"

function WorkspaceLayout() {
  const { density, selected, projectTab } = useWorkspace()

  /**
   * Раздел «Инструменты» — своё дерево компонентов, но внутри того же провайдера:
   * ему нужны и режим области, и список проектов (из них выбирается папка).
   */
  if (projectTab === "tools") return <ToolsWorkspace />

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      {/* Десктоп: колонка проектов (только полный режим) + рабочая область */}
      <div className="hidden h-full min-w-0 flex-1 lg:flex">
        {density === "full" ? <ProjectsColumn /> : null}
        <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <WorkspaceTopbar />
          <TrialBanner />
          <TrashBanner />
          {density === "full" ? (
            <FullMode />
          ) : selected ? (
            <SimpleProject />
          ) : (
            <AllProjectsPage />
          )}
        </main>
      </div>

      {/* Мобильный: одна колонка, навигация через нижние табы */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden lg:hidden">
        <WorkspaceTopbar />
        <TrialBanner />
        <TrashBanner />
        <MobileWorkspace />
      </main>

      <ClipboardPanel />
      <WorkspaceContextMenu />
      <MoveDialog />
      <ArchiveDialog />
      <PreviewDialog />
      <ShareDialog />
      <WorkspaceDialogs />
    </div>
  )
}

export function WorkspacePageClient() {
  return (
    <WorkspaceProvider>
      <WorkspaceLayout />
    </WorkspaceProvider>
  )
}
