import {
  permissionsFor,
  type ProjectAccessRole,
} from "@/lib/project-roles"

import type { Project, WorkspaceCapabilities } from "./types"

/**
 * Права на конкретный проект в рабочей области.
 *
 * Матрица не своя: она берётся из lib/project-roles.ts — того же модуля, по
 * которому проверяют роуты. Здесь только два перевода: роль из карточки проекта
 * и права роли в термины интерфейса.
 *
 * Зачем отдельный слой: `source.can` описывает зону (кабинет / админский
 * «Конвейер»), но не проект. Расшаренный проект приходит с ролью, и читателю
 * нельзя показывать те же кнопки, что владельцу, даже если зона их разрешает.
 * Поэтому право = потолок зоны И то, что даёт роль. Роль не поднимает потолок
 * зоны (в «Конвейере» загрузки нет ни у кого), зона не отменяет ограничение
 * роли.
 */
export function projectRole(project: Project): ProjectAccessRole {
  // Проект в корзине открыт только на чтение, кем бы человек в нём ни был.
  // Тот же зажим стоит на сервере (lib/project-access.ts#resolveProjectAccess),
  // и здесь он не «на всякий случай»: без него интерфейс рисовал бы владельцу
  // заливку, переименование и паузу, а роуты отвечали бы на них отказом.
  if (project.deletedAt) return "viewer"
  if (!project.sharedWithMe) return "owner"
  if (project.memberRole === "full") return "full"
  if (project.memberRole === "editor") return "editor"
  // Расшаренный проект без внятной роли — читатель: неизвестное право не может
  // быть больше самого узкого.
  return "viewer"
}

/** Права роли в терминах интерфейса, до пересечения с правами зоны. */
function capabilitiesForRole(role: ProjectAccessRole): WorkspaceCapabilities {
  const p = permissionsFor(role)
  return {
    // Создание проекта к конкретному проекту не относится: решает зона.
    createProject: true,
    deleteProject: p.deleteProject,
    renameProject: p.renameProject,
    archiveProject: p.archiveProject,
    shareProject: p.manageMembers,
    // Передача идёт вместе с удалением, а не с расшариванием: и то и другое
    // отнимает папку у владельца, и полного доступа для этого мало
    // (lib/project-roles.ts — «переносить между клиентами»).
    transferProject: p.deleteProject,
    upload: p.writeFiles,
    createFolder: p.writeFiles,
    renameItem: p.writeFiles,
    deleteItem: p.writeFiles,
    move: p.writeFiles,
    writeSettings: p.writeSettings,
    writeChat: p.writeChat,
    // Описание пишет команда, а не участник: право остаётся за зоной.
    editDescription: true,
  }
}

/**
 * Права на проект: потолок зоны, срезанный ролью. `null` — проект не выбран,
 * остаётся один потолок зоны (пункты вроде «создать проект»).
 */
export function projectCapabilities(
  base: WorkspaceCapabilities,
  project: Project | null,
): WorkspaceCapabilities {
  if (!project) return base
  const role = capabilitiesForRole(projectRole(project))
  const out = {} as WorkspaceCapabilities
  for (const key of Object.keys(base) as Array<keyof WorkspaceCapabilities>) {
    out[key] = base[key] && role[key]
  }
  return out
}
