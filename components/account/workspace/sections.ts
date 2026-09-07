import type { Dictionary } from "@/components/account/i18n"
import type { ProjectTab } from "./workspace-context"

/** Заголовок раздела списка проектов. */
export function sectionHeading(tab: ProjectTab, t: Dictionary): string {
  switch (tab) {
    case "shared":
      return t.sharedTab
    case "tools":
      return t.toolsTab
    case "archive":
      return t.archiveTab
    case "trash":
      return t.trashTab
    default:
      return t.projectsHeading
  }
}

/** Что писать, когда в разделе ничего нет. */
export function sectionEmptyText(tab: ProjectTab, t: Dictionary): string {
  switch (tab) {
    case "shared":
      return t.emptyShared
    case "tools":
      return t.emptyTools
    case "archive":
      return t.emptyArchive
    case "trash":
      return t.emptyTrash
    default:
      return t.emptyProjects
  }
}
