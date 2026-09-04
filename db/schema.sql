CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN', 'SUPERADMIN')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent migration: support OAuth providers (Google, ...) alongside local
-- email + password accounts. OAuth-only users have no password, so we drop the
-- NOT NULL constraint on password_hash and add provider columns.
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local';
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_account_id TEXT;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Имя для статистики обработки: должно совпадать со строкой, которой человек
-- подписывается при локальной обработке (статистика группируется по contact).
-- NULL — берём full_name. См. db/migrations/2026-08-17-upload-attribution.sql.
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_name TEXT;

-- One Google `sub` (or any provider's account id) maps to at most one user;
-- partial unique index lets multiple rows have NULL provider_account_id.
CREATE UNIQUE INDEX IF NOT EXISTS users_provider_account_idx
  ON users (auth_provider, provider_account_id)
  WHERE provider_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS videos (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  thumbnail    TEXT NOT NULL,
  video_url    TEXT NOT NULL,
  duration     TEXT NOT NULL,
  category     TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS videos_published_sort_idx
  ON videos (is_published, sort_order, created_at);

CREATE TABLE IF NOT EXISTS ideas (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  category     TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent migration: ideas grew media fields so the admin uses one unified
-- "content" form for both kinds. Defaults are empty strings to keep existing
-- rows valid and the public renderer (which still ignores these for ideas)
-- unaffected.
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS thumbnail TEXT NOT NULL DEFAULT '';
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS video_url TEXT NOT NULL DEFAULT '';
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS duration  TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS ideas_published_sort_idx
  ON ideas (is_published, sort_order, created_at);

-- Multi-tag support (replaces single category over time; category kept for transition)
ALTER TABLE videos ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE ideas  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

UPDATE videos SET tags = ARRAY[category]
 WHERE tags = '{}' AND category IS NOT NULL AND category <> '';

UPDATE ideas SET tags = ARRAY[category]
 WHERE tags = '{}' AND category IS NOT NULL AND category <> '';

CREATE INDEX IF NOT EXISTS videos_tags_gin ON videos USING GIN (tags);
CREATE INDEX IF NOT EXISTS ideas_tags_gin  ON ideas  USING GIN (tags);

-- Remembered values for admin combobox fields (scoped per field)
CREATE TABLE IF NOT EXISTS tag_suggestions (
  field_scope  TEXT NOT NULL,
  value        TEXT NOT NULL,
  usage_count  INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (field_scope, value)
);

CREATE INDEX IF NOT EXISTS tag_suggestions_scope_value_idx
  ON tag_suggestions (field_scope, lower(value));

-- Page-view tracking for the admin "Visitors" dashboard. Each row is a single
-- client-side navigation reported by VisitorTracker. user_id is a soft
-- reference (no FK) so deleting a user does not blow away historical visits;
-- user_email/user_full_name are denormalized for the same reason. fingerprint
-- is a stable short hash of ip+UA+Accept-Language used to group anonymous
-- sessions.
CREATE TABLE IF NOT EXISTS visitor_events (
  id              TEXT PRIMARY KEY,
  path            TEXT NOT NULL,
  query_string    TEXT NOT NULL DEFAULT '',
  method          TEXT NOT NULL DEFAULT 'GET',
  user_id         TEXT,
  user_email      TEXT,
  user_full_name  TEXT,
  fingerprint     TEXT NOT NULL,
  user_agent      TEXT NOT NULL DEFAULT '',
  ip              TEXT NOT NULL DEFAULT '',
  referer         TEXT NOT NULL DEFAULT '',
  language        TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS visitor_events_created_at_idx
  ON visitor_events (created_at DESC);
CREATE INDEX IF NOT EXISTS visitor_events_fingerprint_idx
  ON visitor_events (fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS visitor_events_user_idx
  ON visitor_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS visitor_events_path_idx
  ON visitor_events (path);

-- User wallet balance (display-only for now; top-up is a stub in the UI).
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_cents INTEGER NOT NULL DEFAULT 0;

-- Client cabinet: each user gets a Google Drive folder (named by email).
ALTER TABLE users ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;

-- Конвейер: админский гейт уровня пользователя (/admin/pipeline, колонка 1).
-- Гасит слежение за всеми проектами пользователя, не меняя флаги проектов.
-- Расшаренный проект гейтится флагом владельца — projects.user_id это владелец.
--
-- По умолчанию TRUE: пользователь участвует в обработке, а гейт нужен, чтобы
-- кого-то исключить. Так же устроено в десктопном приложении — папка
-- отслеживается, пока её явно не выключили.
ALTER TABLE users ADD COLUMN IF NOT EXISTS automation_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ALTER COLUMN automation_enabled SET DEFAULT TRUE;

-- ===== FF Works workspace: projects, files, chat =====
-- Legacy installs already have `projects` with user_id / drive_folder_id.
-- Fresh installs get the full CREATE; existing DBs pick up columns via ALTER.
--
-- Тумблер слежения один — is_paused. Он же зеркало options/folderState.json
-- (enabled = NOT is_paused); обоими хранилищами владеет
-- lib/project-automation.ts#setProjectPaused. Колонка is_active удалена
-- миграцией 2026-08-13-pipeline-automation.sql: она дублировала смысл
-- is_paused и была с ней сварена, из-за чего пауза и автоматизация меняли
-- друг друга. Поле isActive в ответах машинам осталось и считается как
-- NOT is_paused.
CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  group_name   TEXT NOT NULL DEFAULT 'personal',
  is_paused    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS group_name TEXT NOT NULL DEFAULT 'personal';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS yougile_chat_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS chat_last_read_at TIMESTAMPTZ;
-- Статус «в архиве» отдельно от group_name: обработчики пропускают такие проекты.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Где лежат байты проекта, в отличие от того, кому он принадлежит.
-- Ключи в R2 — `projects/{storage_owner_id}/{projectId}/…` и не меняются
-- никогда; владение живёт в user_id и меняется при передаче проекта другому
-- человеку. Читается через COALESCE(storage_owner_id, user_id), поэтому строка
-- без значения ведёт себя как до миграции.
-- См. db/migrations/2026-08-28-project-storage-owner.sql.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS storage_owner_id TEXT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS projects_user_archived_idx
  ON projects (user_id, is_archived, created_at DESC);

CREATE INDEX IF NOT EXISTS projects_deleted_idx
  ON projects (user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Logical client grouping (UI hierarchy). Does not change R2 key layout.
CREATE TABLE IF NOT EXISTS clients (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clients_user_idx
  ON clients (user_id, created_at DESC);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_client_idx
  ON projects (client_id)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS projects_owner_idx
  ON projects (user_id, group_name, created_at DESC);

CREATE INDEX IF NOT EXISTS projects_user_created_idx
  ON projects (user_id, created_at DESC);

-- Google Drive is the source of truth for which projects exist (see
-- lib/project-drive.ts#listUserProjectsFromDrive): every Drive folder scan
-- upserts by drive_folder_id, so a unique index prevents two concurrent
-- requests from ever creating duplicate rows for the same Drive folder.
CREATE UNIQUE INDEX IF NOT EXISTS projects_drive_folder_id_idx
  ON projects (drive_folder_id)
  WHERE drive_folder_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_files (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  folder_path   TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL,
  is_folder     BOOLEAN NOT NULL DEFAULT FALSE,
  s3_key        TEXT,
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  content_type  TEXT NOT NULL DEFAULT '',
  etag          TEXT,
  content_hash  TEXT,
  origin_mtime  INTEGER,
  -- Кто принёс файл. Перезапись переносит атрибуцию на нового заливщика; записи
  -- машин парка (rc_) её не трогают. Отсюда конвейер берёт description.contact.
  uploaded_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at    TIMESTAMPTZ,
  deleted_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seq      BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_files_folder_s3_chk
    CHECK (
      (is_folder = TRUE  AND s3_key IS NULL) OR
      (is_folder = FALSE AND s3_key IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS storage_changes (
  seq          BIGSERIAL PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  op           TEXT NOT NULL CHECK (op IN ('put', 'delete', 'move')),
  size         BIGINT,
  etag         TEXT,
  content_hash TEXT,
  event_time   INTEGER NOT NULL,
  event_id     TEXT UNIQUE,
  -- Кто совершил запись. Нужен конвейеру: для папки виток запускает не заливщик
  -- файла, а тот, кто снял `-` с имени, то есть актор move-события.
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS storage_changes_project_seq_idx
  ON storage_changes (project_id, seq);

CREATE INDEX IF NOT EXISTS storage_changes_key_idx
  ON storage_changes (key);

CREATE INDEX IF NOT EXISTS storage_changes_seq_idx
  ON storage_changes (seq);

CREATE TABLE IF NOT EXISTS machine_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS machine_tokens_user_idx
  ON machine_tokens (user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS remote_computers (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  token_hash          TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'idle'
                        CHECK (status IN ('idle', 'busy', 'error')),
  current_project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  current_task        TEXT,
  -- Какую задачу машина держит — связью, а не строкой: current_task остаётся
  -- человекочитаемой меткой операции, а продление аренды требует ссылки.
  current_task_id     TEXT,
  -- UUID машины, сгенерированный ей один раз при первом запуске. По нему машина
  -- заводит себя сама, без ручного создания в админке. Hostname для этого не
  -- годится: дефолтные имена маков совпадают, а на совпадении ломается архив
  -- статистики — две машины пишут в один объект, и заливка затирает строки.
  machine_uuid        TEXT,
  -- Каким `mch_`-токеном машина зашла. Модель такого токена — «один токен, много
  -- машин», и без этой связи вопрос «кто подключён по этому токену» неотвечаем.
  -- У `rc_`-компьютеров NULL: там токен свой у каждого.
  registered_token_id TEXT REFERENCES machine_tokens(id) ON DELETE CASCADE,
  -- Два разных признака, сводить в один нельзя: машина может быть на связи и
  -- синхронизировать файлы, но обработку не вести.
  last_seen_at        TIMESTAMPTZ,   -- любое обращение со своим UUID
  last_claim_at       TIMESTAMPTZ,   -- воркер опрашивает очередь
  last_heartbeat_at   TIMESTAMPTZ,
  meta                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at          TIMESTAMPTZ
);

-- Одна строка на UUID среди неотозванных: отозвав компьютер, ту же машину можно
-- завести заново.
CREATE UNIQUE INDEX IF NOT EXISTS remote_computers_machine_uuid_idx
  ON remote_computers (machine_uuid)
  WHERE machine_uuid IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS remote_computers_token_idx
  ON remote_computers (registered_token_id)
  WHERE registered_token_id IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS remote_computers_active_idx
  ON remote_computers (created_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS remote_computers_heartbeat_idx
  ON remote_computers (last_heartbeat_at DESC NULLS LAST)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS project_files_unique_name_idx
  ON project_files (project_id, lower(folder_path), lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS project_files_trash_idx
  ON project_files (project_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS project_files_project_folder_idx
  ON project_files (project_id, folder_path);

CREATE INDEX IF NOT EXISTS project_files_s3_key_idx
  ON project_files (s3_key)
  WHERE s3_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS project_files_created_at_idx
  ON project_files (project_id, created_at DESC)
  WHERE is_folder = FALSE;

CREATE TABLE IF NOT EXISTS storage_jobs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('copy','move','purge','recatalog','trial-provision')),
  state        TEXT NOT NULL CHECK (state IN ('queued','running','done','failed','cancelled')),
  total        INTEGER NOT NULL DEFAULT 0,
  done         INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  event_id     TEXT UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS storage_jobs_state_idx
  ON storage_jobs (state, created_at)
  WHERE state IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS storage_jobs_user_idx
  ON storage_jobs (user_id, created_at DESC);

-- Инструменты пользователя: экземпляры из каталога (lib/tools/registry.ts).
-- Каталог живёт в коде, здесь только то, что человек добавил себе, и его настройки.
CREATE TABLE IF NOT EXISTS user_tools (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_key       TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT '',
  settings       JSONB NOT NULL DEFAULT '{}'::jsonb,
  source         JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_tools_owner_idx
  ON user_tools (user_id, sort_order, created_at)
  WHERE deleted_at IS NULL;

-- Расшаривание проекта. Роли: viewer читает, editor правит файлы и настройки,
-- full вдобавок расшаривает проект дальше и отправляет в архив. Владельца здесь
-- нет: он живёт в projects.user_id, и строка на него сделала бы два источника
-- правды о том, кто хозяин папки. Матрица прав — lib/project-access.ts.
CREATE TABLE IF NOT EXISTS project_members (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  invited_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT project_members_role_check CHECK (role IN ('viewer', 'editor', 'full'))
);

CREATE INDEX IF NOT EXISTS project_members_user_idx
  ON project_members (user_id);

-- Кто кого позвал: с делегированием владелец должен видеть в диалоге
-- «Поделиться», откуда взялся человек, которого он сам не приглашал.
CREATE INDEX IF NOT EXISTS project_members_invited_by_idx
  ON project_members (invited_by)
  WHERE invited_by IS NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- ===== Конвейер: сканер и очередь задач =====

-- Состояние сканера. Основная линия — событийная: любая запись в хранилище уже
-- журналируется в storage_changes (lib/storage/write-path.ts#journal), поэтому
-- «что нового появилось в IN» — это выборка по seq > last_seq. Строка одна.
--
-- Вторая линия — страховочный обход каталога (lib/pipeline/sweep.ts), поля
-- sweep_*. Он нужен потому, что курсор двигается независимо от того, создалась
-- задача или нет: любой пропуск в событийной линии окончательный, и файл остаётся
-- лежать в IN, пока его кто-нибудь не перезалил. Обход идёт по project_files,
-- сравнивает элементы IN с уже созданными задачами и добирает разницу.
-- Расписание — одно поле sweep_interval_min: период в минутах, 0 значит «по
-- таймеру не ходить». Отдельного тумблера нет: рядом с периодом он был бы вторым
-- переключателем на то же решение.
--
-- is_running — включено ли слежение. Живёт в базе, а не в памяти процесса:
-- закрытая страница не должна останавливать конвейер, перезапуск процесса
-- должен его возобновлять, и все админы должны видеть одно состояние. Обход
-- подчинён этому же флагу: «Стоп» значит, что задачи не появляются вообще.
CREATE TABLE IF NOT EXISTS automation_scan_state (
  id           TEXT PRIMARY KEY DEFAULT 'singleton',
  last_seq     BIGINT NOT NULL DEFAULT 0,
  is_running   BOOLEAN NOT NULL DEFAULT FALSE,
  started_at   TIMESTAMPTZ,
  started_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  last_created INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  scanned_at   TIMESTAMPTZ,
  sweep_interval_min INTEGER NOT NULL DEFAULT 15,
  swept_at           TIMESTAMPTZ,
  last_swept         INTEGER NOT NULL DEFAULT 0,
  last_sweep_error   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT automation_scan_state_singleton_chk CHECK (id = 'singleton'),
  CONSTRAINT automation_scan_state_sweep_interval_chk
    CHECK (sweep_interval_min = 0 OR sweep_interval_min BETWEEN 1 AND 1440)
);

INSERT INTO automation_scan_state (id, last_seq)
VALUES ('singleton', 0)
ON CONFLICT (id) DO NOTHING;

-- Очередь задач. payload — объект для обработки в форме десктопного движка
-- (processingQueue + шаги по ключам + description). Внутри НЕТ presigned URL и
-- локальных путей: только идентичность файлов, байты машина берёт экшеном
-- presign — иначе задача, простоявшая час, приезжает с истёкшими ссылками.
CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id    TEXT REFERENCES project_files(id) ON DELETE SET NULL,
  source_key        TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'claimed', 'running', 'done', 'failed')),
  claimed_by        TEXT REFERENCES remote_computers(id) ON DELETE SET NULL,
  claimed_at        TIMESTAMPTZ,
  lease_expires_at  TIMESTAMPTZ,
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  error             TEXT,
  -- Какая машина последней держала задачу. Отдельно от claimed_by, потому что
  -- тот зануляется на каждом терминальном переходе (на нём держится аренда), и
  -- имя машины исчезало ровно у упавшей задачи — там, где оно и нужно.
  last_machine_id   TEXT REFERENCES remote_computers(id) ON DELETE SET NULL,
  -- Когда исходник унесли из IN в папку ошибок. NULL — файл всё ещё в IN.
  -- Путь не храним: папка ошибок одна на проект и переименовывается на дату
  -- последней ошибки, записанное имя устарело бы на следующем падении.
  quarantined_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_queue_idx
  ON tasks (status, created_at)
  WHERE status IN ('queued', 'claimed', 'running');

CREATE INDEX IF NOT EXISTS tasks_project_idx
  ON tasks (project_id, created_at DESC);

-- Дедуп: повторные put-события по одному файлу (перезапись, reindex, повторный
-- notify) не должны плодить вторую живую задачу. Завершённые и упавшие под
-- ограничение не попадают — по файлу можно прогнать обработку заново.
CREATE UNIQUE INDEX IF NOT EXISTS tasks_active_source_idx
  ON tasks (project_id, source_key)
  WHERE status IN ('queued', 'claimed', 'running');

-- Обход каталога спрашивает «была ли по этому элементу задача вообще» — включая
-- done и failed, иначе он переоткрывал бы уже обработанное. Частичный индекс
-- выше для этого вопроса не годится.
CREATE INDEX IF NOT EXISTS tasks_source_key_idx
  ON tasks (project_id, source_key);

-- Индекс под сборщик протухших аренд на тике runner.ts. Без него это скан
-- таблицы каждые 15 секунд.
CREATE INDEX IF NOT EXISTS tasks_lease_idx
  ON tasks (lease_expires_at)
  WHERE status IN ('claimed', 'running');

-- Прогресс выполнения, самоочищающийся: появилась задача — шаги видны,
-- завершилась — строки удаляются. Разбор падения идёт по tasks.error и логам
-- машины, поэтому историю шагов держать незачем.
CREATE TABLE IF NOT EXISTS task_progress (
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_id    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'running'
               CHECK (status IN ('running', 'done', 'error')),
  message    TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, step_id)
);

-- Общие словари: типы файлов с расширениями, цвета типов нод и типов данных,
-- пользовательские маски путей. Синглтон — словарь принадлежит системе обработки,
-- а не клиенту, который заливает файлы в проект. Подробно — docs/SETTINGS_SYNC.md.
--
-- revision растёт на КАЖДУЮ запись, даже если содержимое не изменилось: это
-- счётчик версии для оптимистической блокировки (UPDATE … WHERE revision = $base),
-- а не хеш состояния.
CREATE TABLE IF NOT EXISTS automation_settings (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  revision   BIGINT NOT NULL DEFAULT 1,
  domains    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT automation_settings_singleton_chk CHECK (id = 'singleton')
);

INSERT INTO automation_settings (id, revision, domains)
VALUES ('singleton', 1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS project_messages (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  sender_role   TEXT NOT NULL CHECK (sender_role IN ('user', 'team')),
  text          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_by_user  BOOLEAN NOT NULL DEFAULT FALSE,
  read_by_team  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS project_messages_project_idx
  ON project_messages (project_id, created_at ASC);

CREATE INDEX IF NOT EXISTS project_messages_unread_user_idx
  ON project_messages (project_id)
  WHERE sender_role = 'team' AND read_by_user = FALSE;

CREATE TABLE IF NOT EXISTS project_media (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    BIGINT,
  drive_file_id TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_media_project_created_idx
  ON project_media (project_id, created_at DESC);

-- Per-project chat, mirrored two-way with YouGile: 'client' rows come from
-- the site (pushed to YouGile via the REST API), 'team' rows arrive via the
-- YouGile webhook (chat_message-created from a non-bot author), 'system' is
-- reserved for future in-chat notices.
CREATE TABLE IF NOT EXISTS project_chat_messages (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_type         TEXT NOT NULL CHECK (sender_type IN ('client', 'team', 'system')),
  sender_user_id      TEXT,
  sender_name         TEXT NOT NULL,
  body                TEXT NOT NULL,
  yougile_message_id  TEXT,
  delivered           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_chat_messages_project_created_idx
  ON project_chat_messages (project_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS project_chat_messages_yougile_id_idx
  ON project_chat_messages (yougile_message_id) WHERE yougile_message_id IS NOT NULL;

-- Web Push subscriptions (one user can have several, one per browser/device).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_idx
  ON push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON push_subscriptions (user_id);

-- Архив обработок с машин и курсоры его импорта. Обоснование и правила —
-- db/migrations/2026-08-20-processing-stats.sql, docs/PIPELINE.md §14.
CREATE TABLE IF NOT EXISTS processing_stats (
  item_id        TEXT PRIMARY KEY,
  project_id     TEXT REFERENCES projects(id) ON DELETE SET NULL,
  schema_version INTEGER NOT NULL,
  status         TEXT NOT NULL,
  project_name   TEXT NOT NULL DEFAULT '',
  main_folder    TEXT NOT NULL DEFAULT '',
  cur_item       TEXT NOT NULL DEFAULT '',
  in_type        TEXT,
  out_type       TEXT,
  registered_at  TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  out_sec        INTEGER,
  render_sec     INTEGER,
  out_paths      JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_cost     NUMERIC(12, 6),
  machine        TEXT,
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS processing_stats_ended_idx
  ON processing_stats (ended_at);
CREATE INDEX IF NOT EXISTS processing_stats_project_ended_idx
  ON processing_stats (project_id, ended_at);
CREATE INDEX IF NOT EXISTS processing_stats_machine_idx
  ON processing_stats (machine);

CREATE TABLE IF NOT EXISTS stats_import_state (
  s3_key         TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lines_imported INTEGER NOT NULL DEFAULT 0,
  etag           TEXT,
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ежедневные срезы состояний: объём и число файлов на проект за день.
-- Подробности и обоснование — db/migrations/2026-08-20-storage-snapshots.sql.
-- Гранулярность одна (проект × день), срез пользователя — SUM по его проектам.
-- Внешних ключей нет: история переживает удаление проекта и пользователя.
CREATE TABLE IF NOT EXISTS storage_snapshots (
  day        DATE NOT NULL,
  project_id TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  files      INTEGER NOT NULL DEFAULT 0,
  bytes      BIGINT  NOT NULL DEFAULT 0,
  taken_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (day, project_id)
);

CREATE INDEX IF NOT EXISTS storage_snapshots_owner_day_idx
  ON storage_snapshots (owner_id, day);

CREATE INDEX IF NOT EXISTS storage_snapshots_day_idx
  ON storage_snapshots (day);

-- Idempotent data migration: admin uploads used to bake an absolute origin into
-- media URLs via `new URL(..., request.url)`, so local runs left values like
-- `https://localhost:3000/api/media/...` in the DB. Strip any host and keep the
-- stable same-origin path so prod (and any other deploy) serves them correctly.
UPDATE videos
SET thumbnail = regexp_replace(thumbnail, '^https?://[^/]+(/api/media/.*)$', '\1'),
    updated_at = NOW()
WHERE thumbnail ~ '^https?://[^/]+/api/media/';

UPDATE videos
SET video_url = regexp_replace(video_url, '^https?://[^/]+(/api/media/.*)$', '\1'),
    updated_at = NOW()
WHERE video_url ~ '^https?://[^/]+/api/media/';

UPDATE ideas
SET thumbnail = regexp_replace(thumbnail, '^https?://[^/]+(/api/media/.*)$', '\1'),
    updated_at = NOW()
WHERE thumbnail ~ '^https?://[^/]+/api/media/';

UPDATE ideas
SET video_url = regexp_replace(video_url, '^https?://[^/]+(/api/media/.*)$', '\1'),
    updated_at = NOW()
WHERE video_url ~ '^https?://[^/]+/api/media/';
