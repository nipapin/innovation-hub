import type { WorkspaceSource } from "@/components/account/workspace/types"

/**
 * Источник данных инструмента «Папки пользователей».
 *
 * Отличия от кабинетного (components/account/workspace/source.ts):
 *
 *   — список проектов запрашивается по выбранному пользователю, а не по
 *     владельцу сессии, и включает архивные;
 *   — дерево приходит вместе со служебной папкой options — админ работает
 *     именно с ней;
 *   — чат смотрится со стороны команды, и «прочитано» отмечается своей
 *     колонкой (projects.chat_team_last_read_at), а не владельческой;
 *   — разрешена и работа с файлами (ступень 1), и распоряжение проектом
 *     (ступень 2) — последнее только при теге `projects.manage`, см. `canManage`.
 *
 * Почему адреса файловых мутаций ведут в `/api/admin/workspaces/*`, а не в
 * `/api/storage/v1/*`, где те же операции уже открыты по `projects.access`:
 * рабочая область шлёт кабинетные тела запросов (`{name, folderPath}`), а v1
 * ждёт свои. Переучить её на две формы значило бы размазать знание о протоколе
 * по компонентам — ровно то, ради чего WorkspaceSource и заводили. Роуты здесь
 * тонкие и зовут те же `writeFolderCreate` / `writeRename` / `writeFileDelete`.
 *
 * Курсор дерева и архив папки берутся из `/api/storage/v1` без переходника:
 * там тела наши, а сам эндпоинт пускает по тегу `projects.access`
 * (lib/storage/auth.ts#canReachAnyProject).
 */
/**
 * @param canManage у администратора есть тег `projects.manage` — ступень 2.
 *   Приходит параметром, а не читается внутри: источник — чистая функция без
 *   доступа к сессии, и подмешивать в него запрос за правами значило бы
 *   завести второе место, где решается, кому что можно. Сервер проверяет тег
 *   сам; здесь мы лишь не рисуем кнопку, которая всё равно вернёт 403.
 * @param basePath на какой странице живёт рабочая область. Инструментов на этом
 *   источнике два — «Папки» и «Чаты», — и выбор проекта обязан оставлять
 *   человека там, где он работает, а не перебрасывать в соседний раздел.
 * @param canCreateProject заводить проект отсюда. По умолчанию — как `canManage`,
 *   но в «Чатах» отдельного владельца не выбирают: там кнопка «Новый проект»
 *   вела бы в отказ «пользователь не выбран».
 */
export function createWorkspaceSource({
  userId,
  canManage,
  basePath = "/admin/workspaces",
  canCreateProject = canManage,
}: {
  userId: string | null
  canManage: boolean
  basePath?: string
  canCreateProject?: boolean
}): WorkspaceSource {
  return {
    // Область — проекты выбранного пользователя. Сменился пользователь,
    // сменился ключ, список проектов перечитывается.
    scopeKey: `workspaces:${userId ?? "none"}`,
    // Разделов в админке нет: показываем все проекты пользователя сразу,
    // включая архивные — они помечены на карточке.
    splitByTab: false,
    pageUrl: ({ id, tab }) => {
      const params = new URLSearchParams()
      if (userId) params.set("user", userId)
      if (id) params.set("id", id)
      if (tab !== "projects") params.set("tab", tab)
      const qs = params.toString()
      return qs ? `${basePath}?${qs}` : basePath
    },
    projectsUrl: () =>
      userId
        ? `/api/admin/workspaces/projects?userId=${encodeURIComponent(userId)}`
        : "/api/admin/workspaces/projects",
    driveUrl: (projectId) => `/api/admin/workspaces/projects/${projectId}/drive`,
    treeCursorUrl: (projectId) =>
      `/api/storage/v1/tree?projectId=${encodeURIComponent(projectId)}`,
    projectUrl: (projectId) => `/api/admin/workspaces/projects/${projectId}`,
    folderUrl: (projectId) =>
      `/api/admin/workspaces/projects/${projectId}/drive`,
    fileUrl: (projectId, fileId) =>
      `/api/admin/workspaces/projects/${projectId}/files/${encodeURIComponent(fileId)}`,
    // Байты идут мимо Next, как в кабинете: presign → PUT в R2 → notify.
    // Прокси-роут для заливки не нужен вовсе — см. directUpload ниже.
    uploadUrl: (projectId) => `/api/admin/workspaces/projects/${projectId}/drive`,
    moveUrl: () => "/api/storage/v1/rename",
    archivePlanUrl: (params) => `/api/storage/v1/archive/plan?${params.toString()}`,
    archivePartUrl: (params) => `/api/storage/v1/archive?${params.toString()}`,
    descriptionMdUrl: (projectId) =>
      `/api/admin/workspaces/projects/${projectId}/description`,
    chatUrl: (projectId) => `/api/admin/workspaces/projects/${projectId}/chat`,
    // Отметка «прочитано» со стороны команды. Одна на проект: сайт отвечает
    // клиенту от лица команды, и открытый чат гасит счётчик и в «Папках», и в
    // разделе «Чаты», откуда сюда чаще всего и приходят.
    chatReadUrl: (projectId) =>
      `/api/admin/workspaces/projects/${projectId}/chat/read`,
    chatPerspective: "team",
    transferUrl: (projectId) =>
      `/api/admin/workspaces/projects/${projectId}/transfer`,
    showServiceFolders: true,
    directUpload: true,
    can: {
      // Ступень 2 — распоряжение чужим проектом.
      createProject: canCreateProject,
      deleteProject: canManage,
      renameProject: canManage,
      archiveProject: canManage,
      shareProject: canManage,
      transferProject: canManage,
      // Ступень 1: работа с файлами в чужой папке.
      upload: true,
      createFolder: true,
      renameItem: true,
      deleteItem: true,
      move: true,
      // Пауза — общий с пользователем тумблер; параметры обработки не
      // открываем (у источника нет exposedOptionsUrl).
      writeSettings: true,
      // Чат — та же переписка с другой стороны: команда пишет.
      writeChat: true,
      // Описание — это как раз то, что команда пишет клиенту.
      editDescription: true,
    },
  }
}
