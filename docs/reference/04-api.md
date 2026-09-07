# 04 — API: полный справочник эндпоинтов

101 route-файл. Ниже — все, с методами, авторизацией и назначением.
Подробные тела запросов для storage-части — в `docs/STORAGE_API.md`.

**Обозначения авторизации:**

| Метка | Что проверяется | Где |
| --- | --- | --- |
| `—` | ничего | — |
| `session` | cookie `inhub_session` | `verifySessionToken` |
| `user` | сессия + аккаунт активен | `requireUserApi` (`lib/admin-auth.ts`) |
| `admin` | сессия + активен + `role === ADMIN` | `requireAdminApi` |
| `storage` | сессия **или** `Bearer mch_…` **или** `Bearer rc_…` | `requireStorageApi` (`lib/storage/auth.ts`) |
| `rc` | `rc_…` в теле запроса | `authenticateComputerToken` |
| `secret` | `Bearer $CRON_SECRET` **или** сессия админа | внутри роута |
| `token=` | shared secret в query | вебхук YouGile |

---

## Аутентификация

| Эндпоинт | Методы | Auth | Назначение |
| --- | --- | --- | --- |
| `/api/auth/signup` | POST | — | Регистрация: имя, email, пароль (8–72). Создаёт пользователя, ставит cookie, не блокируясь пишет `user-meta.json` в R2. `23505` → 409. |
| `/api/auth/signin` | POST | — | Вход. Отдельно обрабатывает OAuth-аккаунт без пароля («войдите через Google»), заблокированный аккаунт (403) и устаревшую схему БД (внятное 500). |
| `/api/auth/signout` | POST | — | Удаляет cookie. |
| `/api/auth/session` | GET | session | Кто я: `authenticated`, `userId`, `email`, `fullName`, `role`. |
| `/api/auth/google` | GET | — | Старт OAuth: генерирует `state`, кладёт его и `next` в cookie с путём `/api/auth/google`, редиректит в Google. Не настроен → 501. |
| `/api/auth/google/callback` | GET | — | Обмен кода, сверка `state`, требование `email_verified`. Связывает Google с существующим локальным аккаунтом по email (пароль не затирается) либо создаёт новый. Ошибки → `/login?error=…`. |

---

## Кабинет: аккаунт

| Эндпоинт | Методы | Auth | Назначение |
| --- | --- | --- | --- |
| `/api/account` | DELETE | user | Удалить свой аккаунт. |
| `/api/account/profile` | GET, PATCH | user | Профиль; PATCH меняет имя и `contact_name`. |
| `/api/account/password` | POST | user | Смена пароля. |
| `/api/account/stats` | GET | user | Сводка для дашборда `/account`: баланс, число проектов и файлов, хронометраж, столбцы графика. Параметр `?range=day\|week\|month`. |
| `/api/account/statistics` | GET | user | Полная статистика со скоупом «только своё». Оси — в query (`breakdown`, `period`, `projectId`); `userId` игнорируется, а разрезы по людям и машинам сервер сводит к разрезу по проектам. |
| `/api/account/machine-tokens` | GET, POST, DELETE | user | Токены `mch_…`. Сырой токен показывается один раз. Отзыв токена отзывает и машины, ходившие под ним. |
| `/api/account/push-subscription` | POST, DELETE | user | Регистрация / снятие подписки Web Push. |
| `/api/account/balance` | GET | user | Кошельки, доступное с учётом резерва и «на что ещё хватит» по мерам (видео, файлы, объём, запуски). Питает виджет баланса и разбор на кошельке. |
| `/api/account/spending` | GET | user | Расход за период: итоги, лента по дням, разрез по проектам и по заливщикам. `?period=day\|week\|month\|year`, `?projectId=`. |
| `/api/account/transactions` | GET | user | Движение средств по кошелькам, страницами по курсору. `?wallet=all\|own\|gift`, `?cursor=<время>\|<id>`. Курсор — пара «время, id»: OFFSET на растущей ленте показал бы строку дважды. |
| `/api/account/trial` | GET, POST | user | Состояние тестового периода и его активация. POST отвечает `202`: пробные проекты ещё копируются. |
| `/api/account/promos` | GET | user | Акции этого человека: начислено, потрачено, остаток, срок, проекты. Плюс не взятое предложение тестового периода. |

⚠️ `stats` и `statistics` — разные вещи с почти одинаковыми именами
(см. [14](./14-improvements.md#12-именование-путающее-эндпоинты)).

---

## Кабинет: инструменты

| Эндпоинт | Методы | Auth | Назначение |
| --- | --- | --- | --- |
| `/api/account/tools` | GET, POST | user | Список экземпляров инструментов; POST добавляет по `toolKey` из каталога кода. |
| `/api/account/tools/[id]` | PATCH, DELETE | user | Имя, настройки, подключённый источник, порядок, отметка открытия. `settings` и `source` **сливаются** с сохранёнными, а не заменяют. DELETE — мягкое. |
| `/api/account/tools/[id]/document` | PUT | user | Запись `dialog.json` в папку задачи. Имя файла фиксировано контрактом. |

---

## Кабинет: проекты

| Эндпоинт | Методы | Auth | Назначение |
| --- | --- | --- | --- |
| `/api/projects` | GET, POST | user | GET: свои + расшаренные + удалённые (корзина), `?archived=true\|false\|all`. Каждый блок в своём `try` — упавшая часть не рушит список. POST: создаёт проект и пишет `project-meta.json` в R2; если R2 недоступен — откат строки и 503. |
| `/api/projects/[id]` | GET, PATCH, DELETE | user | Переименование (`full`), пауза/архив (`editor`/`full`), удаление в корзину (только владелец). |
| `/api/projects/unread-counts` | GET | user | Непрочитанное по всем проектам одним запросом — для значков. |
| `/api/projects/[id]/drive` | GET, POST | user | Дерево файлов из Postgres + состояние автоматизации + разобранные параметры. POST создаёт папку. |
| `/api/projects/[id]/drive/files/[fileId]` | GET, PATCH, DELETE | user | Скачать / переименовать / удалить элемент. |
| `/api/projects/[id]/drive/folder-state` | PATCH | user | Тумблер слежения: перезапись `options/folderState.json` + зеркало в Postgres. |
| `/api/projects/[id]/drive/options` | PATCH | user | Правки параметров, отданных на сайт. Границы и списки проверяются на сервере. |
| `/api/projects/[id]/description` | GET | user | Развёрнутое описание (`options/description.md`). **Только чтение** — пишет админский роут. |
| `/api/projects/[id]/files` | GET, POST, PATCH, DELETE | user | Файлы проекта. |
| `/api/projects/[id]/files/presign` | POST | user | Presigned PUT для загрузки из браузера напрямую в R2. |
| `/api/projects/[id]/media` | GET, POST | user | Материалы проекта. POST — приём уведомления о загруженных байтах. |
| `/api/projects/[id]/media/[mediaId]` | DELETE | user | Удалить материал. |
| `/api/projects/[id]/members` | GET, POST, PATCH, DELETE | user | Расшаривание: приглашение по email (создаёт аккаунт с временным паролем, если нужно, и отправляет письмо), смена роли, отзыв доступа. Самый большой роут кабинета — 468 строк. |
| `/api/projects/[id]/chat` | GET, POST | user | Чат проекта. GET по пути тянет новое из YouGile. POST отправляет в YouGile и пишет строку. Есть rate limit. |
| `/api/projects/[id]/chat/read` | POST | user | Сбросить значок непрочитанного. |
| `/api/projects/[id]/messages` | GET, POST | user | 🔧 **Старый чат** на таблице `project_messages`. Из интерфейса не вызывается. |

---

## Публичные и полупубличные

| Эндпоинт | Методы | Auth | Назначение |
| --- | --- | --- | --- |
| `/api/videos` | GET | — | Страница каталога с курсором: `limit`, `cursor`, `tags`, `q`. |
| `/api/videos/tags` | GET | — | Список тегов для фильтров. |
| `/api/media/[...key]` | GET, HEAD | session (для ключей проектов) | Прокси к R2. По умолчанию 307 на presigned GET (час, кешируется приватно на полчаса). С `?raw=1` — стримит тело: оптимизатор картинок Next не умеет ходить по редиректу. Ключ жёстко ограничен разрешёнными префиксами; путь проверяется на traversal до и после декодирования; для ключей `projects/{userId}/…` требуется владелец или админ. |
| `/api/visitors/track` | POST | session (опц.) | Приём события посещения. Отсекает `/api/`, `/_next/`, `/admin`. Отпечаток — `sha256(ip\|UA\|Accept-Language)`, первые 16 символов. **Всегда отвечает `{ok:true}`**, даже на мусор: трекинг не должен ломать страницу. |
| `/api/push/vapid-public-key` | GET | — | Публичный VAPID-ключ для `pushManager.subscribe`. |
| `/api/feature-suggestions` | POST | user | ⚠️ Валидация + honeypot + rate limit (3 / 10 мин), затем **503**: доставка не подключена. |
| `/api/feature-suggestions/upload` | POST | user | Загрузка вложения в префикс `feature-suggestions/`. Работает — но заявка выше не уходит, поэтому объекты остаются сиротами. |
| `/api/video-orders` | POST | user | ⚠️ То же: валидация, honeypot, rate limit, проверка существования видео → **503**. |
| `/api/tag-suggestions` | GET, POST, DELETE | admin | Словарь подсказок тегов. |

---

## Админка

| Эндпоинт | Методы | Назначение |
| --- | --- | --- |
| `/api/admin/videos` | GET, POST | Список и создание. POST зовёт `revalidateTag("published-videos")`. |
| `/api/admin/videos/[id]` | PATCH, DELETE | Правка и удаление. |
| `/api/admin/videos/reorder` | POST | Сдвиг на одну позицию (`direction`). |
| `/api/admin/videos/reorder-bulk` | POST | Порядок целиком — после drag-and-drop. |
| `/api/admin/ideas` | GET, POST | То же для идей. ⚠️ Без `revalidateTag`. |
| `/api/admin/ideas/[id]` | PATCH, DELETE | То же для идей. |
| `/api/admin/ideas/reorder` | POST | То же для идей. ⚠️ Bulk-варианта нет. |
| `/api/admin/upload` | POST | Заливка потоком через сервер в R2 (`@aws-sdk/lib-storage`). Не требует CORS на бакете, даёт прогресс через `XHR.upload`. `maxDuration: 300`. |
| `/api/admin/upload/presign` | POST | Presigned PUT напрямую из браузера. Требует CORS на бакете (`pnpm s3:set-cors`). `ContentType` намеренно не подписывается — иначе браузер обязан прислать байт-в-байт тот же заголовок. |
| `/api/admin/users` | GET, POST | Список и создание пользователя. |
| `/api/admin/users/[id]` | PATCH, DELETE | Роль, активность, сброс пароля, удаление. |
| `/api/admin/visitors` | GET | Лента посещений. |
| `/api/admin/statistics` | GET | Статистика без скоупа. |
| `/api/admin/statistics/import` | POST | Разовый импорт архива обработок из R2. Долгий — `maxDuration` поднят. |
| `/api/admin/machines` | GET | Токены доступа вместе с машинами под ними — один список для страницы. |
| `/api/admin/machines/[id]` | DELETE | Отзыв `mch_`-токена админом, без проверки владельца: список общий, значит и стоп-кран общий. Машины под токеном отзываются вместе с ним. |
| `/api/admin/computers` | GET, POST | Парк машин: список активных, регистрация. |
| `/api/admin/computers/[id]` | PATCH, DELETE | Имя/описание; DELETE — отзыв. |
| `/api/admin/computers/[id]/rotate-token` | POST | Ротация токена, сырой возвращается один раз. |
| `/api/admin/settings` | GET, PATCH | Общие словари для браузера. |

### Конвейер

| Эндпоинт | Методы | Назначение |
| --- | --- | --- |
| `/api/admin/workspaces/users` | GET, PATCH | Колонка 1: пользователи и гейт `automation_enabled`. GET — по `projects.access`, PATCH — по `pipeline.operate`. |
| `/api/admin/workspaces/projects` | GET | Колонка 2: проекты выбранного пользователя, включая архивные. |
| `/api/admin/workspaces/projects/[id]` | PATCH | Тумблер слежения (тот же, что у пользователя). Больше ничего этот роут не принимает. Тег — `pipeline.operate`: это гейт обработки. |
| `/api/admin/workspaces/projects/[id]/drive` | GET, POST | Колонка 3: дерево целиком, вместе с `options`. POST — создать папку. |
| `/api/admin/workspaces/projects/[id]/files/[fileId]` | GET, PATCH, DELETE | Содержимое файла для превью и сайдкаров; переименование и удаление. |
| `/api/admin/workspaces/projects/[id]/description` | GET, PUT | Описание проекта — бриф от команды клиенту. |
| `/api/admin/workspaces/projects/[id]/chat` | GET, POST | Тот же чат, со стороны команды. |
| `/api/admin/workspaces/projects/[id]/chat/read` | POST | Отметка «команда прочитала» (`projects.chat_team_last_read_at`). Одна на проект: сайт отвечает клиенту от лица команды. |
| `/api/admin/chats` | GET | Раздел «Чаты»: все переписки сайта, свежие сверху. Параметры `q`, `limit`, `offset`; удалённые проекты исключены. |
| `/api/admin/chats/unread` | GET | Число на значке раздела «Чаты» — сколько сообщений клиентов ждут ответа по всему сайту. |
| `/api/admin/pipeline/state` | GET, PATCH | Состояние конвейера; PATCH включает/выключает слежение и меняет период обхода. |
| `/api/admin/pipeline/collect` | POST | Разовая событийная сборка задач. |
| `/api/admin/pipeline/sweep` | POST | Разовый обход папок IN. |
| `/api/admin/pipeline/tasks` | GET, PATCH, DELETE | Очередь: снимок с двумя зонами и счётчиками; отмена и удаление задачи. |

---

## Storage API (`/api/storage/v1`)

Поверхность для десктоп-клиента. Авторизация — `storage`. Полные тела — в
`docs/STORAGE_API.md`.

| Эндпоинт | Методы | Назначение |
| --- | --- | --- |
| `/capabilities` | GET | Что умеет сервер: `apiVersion: 1`, `protocol: 2`, multipart, rename, move, copy, sharing, clients, originMtime, contentHash, trash. |
| `/projects` | GET, POST, DELETE | Каталог проектов пользователя (с `userId` и email владельца — от них зависит раскладка папок у клиента), создание, мягкое удаление. |
| `/project-rename` | POST | Переименовать проект. |
| `/project-state` | POST | Пауза или архив. |
| `/project-restore` | POST | Вернуть из корзины. |
| `/tree` | GET | Дерево проекта (`?projectId=&prefix=`) + текущий курсор журнала. |
| `/delta` | GET | Изменения с `?since=`, до 5000 за раз, флаг `truncated`, если запрошенный курсор старше окна хранения (90 дней). |
| `/presign` | POST | Presigned PUT или GET. |
| `/notify` | POST | «Байты доехали»: создаёт строку каталога и запись в журнал. Принимает `originMtime` и `contentHash`. |
| `/mkdir` | POST | Создать папку; поле `ensurePath` создаёт всю цепочку родителей. |
| `/rename` | POST | Переименовать или переместить. Ключ в R2 **не меняется**. |
| `/copy` | POST | Копирование файлов и папок. Много работы — уходит в фоновую задачу. |
| `/archive/plan` | GET | Состав архивов папки: части, их размеры и `version`. Ничего не занимает на сервере. |
| `/archive` | GET | Одна часть архива потоком, `store`-ZIP с точным `Content-Length`. Папка изменилась — 409 по `version`. |
| `/object` | DELETE | Удалить элемент в корзину. |
| `/reindex` | POST | Полная сверка: `LIST` по R2 против каталога. |
| `/sidecars` | GET, PUT | Три служебных файла: `folderState.json`, `options.json`, `description.md`. |
| `/settings` | GET, PUT | Общие словари; оптимистическая блокировка по `revision`, конфликт → 409. |
| `/trash` | GET | Содержимое корзины проекта. |
| `/trash/restore` | POST | Восстановить из корзины. |
| `/jobs/[id]` | GET | Прогресс фоновой работы. |
| `/queue` | POST | Очередь задач для десктопа (`mch_…`). Логика общая с `POST /api/v1`. |
| `/vault` | POST | Сейф для десктопа (`mch_…`): `action: "keys"` — ключи внешних сервисов по версиям, `action: "usage"` — потребление в единицах. Логика общая с экшенами `vendorKeys` / `vendorUsage`. |
| `/multipart/create` | POST | Начать многочастную заливку. |
| `/multipart/presign-part` | POST | Ссылка на часть. |
| `/multipart/complete` | POST | Собрать части. |
| `/multipart/abort` | POST | Отменить. |

---

## Машинный RPC (`POST /api/v1`)

Одна точка входа. Тело: `{ action, props, token }`. Токен только `rc_…`.
Конвейер разбора: авторизация → поиск экшена в реестре → zod-схема → выполнение.

Реестр — `lib/machine-api/registry.ts`. Документация для админки — отдельный
список `lib/machine-api/catalog.ts`, и при загрузке модуля в dev-режиме реестр
**громко сверяется с каталогом** и пишет в консоль расхождения в обе стороны.
Слить их в один нельзя: каталог импортирует клиентский компонент, а реестр тянет
`pg`.

### 35 экшенов

| Группа | Экшены |
| --- | --- |
| Компьютер | `me`, `heartbeat` |
| Возможности | `capabilities` |
| Проекты | `projects`, `createProject`, `projectRename`, `projectState`, `deleteProject`, `restoreProject` |
| Чтение | `tree`, `delta`, `getSidecar` |
| Запись | `presign`, `notify`, `mkdir`, `rename`, `copy`, `deleteObject`, `reindex`, `putSidecar`, `getJob` |
| Multipart | `multipartCreate`, `multipartPresignPart`, `multipartComplete`, `multipartAbort` |
| Словари | `getSettings`, `putSettings` |
| Сейф | `vendorKeys`, `vendorUsage` |
| Очередь | `machinePing`, `claimTask`, `taskProgress`, `taskDone`, `taskFailed`, `releaseTask` |

`GET /api/v1` отвечает 405 с подсказкой. `maxDuration: 120`.

### Устаревшие роуты

| Эндпоинт | Ответ |
| --- | --- |
| `/api/remote/v1/me` | 410 + текст «используйте `POST /api/v1` с `action: "me"`» |
| `/api/remote/v1/heartbeat` | 410, то же |

---

## Служебные

| Эндпоинт | Методы | Auth | Назначение |
| --- | --- | --- | --- |
| `/api/cron/storage-jobs` | POST | secret | Разобрать до 20 фоновых работ + вычистить просроченную корзину файлов и проектов. |
| `/api/cron/storage-purge` | POST | secret | Вычистить корзину + снять суточный срез + импортировать архив обработок + выгрузить месячную копию. |
| `/api/webhooks/yougile` | POST | `token=` | Приём `chat_message-created`. Пропускает эхо собственных сообщений по `botUserId`, дедуплицирует по `yougile_message_id`. **Всегда отвечает 2xx.** |
| `/api/admin/services` | GET, POST | `services.manage` | Внешние сервисы: список и заведение. Секрет наружу не отдаётся ни одним методом — только версия и подсказка «••••4f21». |
| `/api/admin/services/[id]` | PATCH, DELETE | `services.manage` | Правка сервиса; DELETE переводит в `revoked`, а не удаляет строку: по ней посчитан прошлый расход. |
| `/api/admin/services/[id]/secret` | POST, DELETE | `services.manage` | POST — ротация (новая версия, старая остаётся живой); DELETE — погасить прежние версии. |
| `/api/admin/services/[id]/prices` | POST | `services.manage` | Новая цена меры. Всегда добавление: прошлые строки нужны прошлым списаниям. |

⚠️ Оба cron-роута чистят корзину, а второй ещё и дублирует работу часового
тика статистики. Разбор — [14](./14-improvements.md#7-cron-роуты).
