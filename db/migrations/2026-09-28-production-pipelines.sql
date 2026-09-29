-- Пайплайны производства: вся модель данных сразу. План — docs/PRODUCTION_PLAN.md.
--
-- Уровни (§2.1 плана):
--   пайплайн (рельсы)  → этапы пайплайна (по проекту-папке на этап) + версии структуры
--   ролик              → этапы ролика (подпапка ролика в проекте этапа + свой чат)
--
-- Код живёт в пространстве `production`, а не `pipeline`: слово `pipeline` в
-- базе и в коде уже принадлежит очереди автообработки (tasks, lib/pipeline/).
--
-- company_id нет ни в одной таблице: компания выводится через владельца, как
-- везде (docs/COMPANY_ACCOUNTS_PLAN.md §16).
--
-- Ссылки на людей и файлы из истории (журнал, сообщения, сдачи, пометки) —
-- ON DELETE SET NULL: история переживает удаление аккаунта и чистку корзины.
-- Ссылки «кто назначен» и «кто в чате» — CASCADE: назначение без человека
-- ничего не значит.
--
-- Миграция только добавляет. Существующее меняется в одном месте —
-- project_members (ступень commenter и происхождение участия), и там же
-- существующие строки остаются валидными: role не трогается, via = 'share'.

-- ─── Участие в проекте ──────────────────────────────────────────────────────

-- commenter — между viewer и editor: читает всё, пишет в чат и ставит пометки,
-- файлы не трогает (§6.2 плана). Нужен проверяющим этапов.
ALTER TABLE project_members DROP CONSTRAINT IF EXISTS project_members_role_check;
ALTER TABLE project_members
  ADD CONSTRAINT project_members_role_check
    CHECK (role IN ('viewer', 'commenter', 'editor', 'full'));

-- Откуда взялось участие. production снимает только автор пайплайна: иначе
-- этап молча теряет исполнителя (COMPANY_ACCOUNTS_PLAN.md §8.4).
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS via TEXT NOT NULL DEFAULT 'share';
ALTER TABLE project_members DROP CONSTRAINT IF EXISTS project_members_via_check;
ALTER TABLE project_members
  ADD CONSTRAINT project_members_via_check
    CHECK (via IN ('share', 'production', 'mention'));

-- ─── Пайплайн ───────────────────────────────────────────────────────────────

-- Оригинал пайплайна. graph — текущая структура в редакторе; revision растёт на
-- каждую запись и держит оптимистическую блокировку (UPDATE … WHERE revision =
-- $base), как у общих словарей. Зафиксированные версии — в
-- production_pipeline_versions: ролики привязаны к ним, а не к оригиналу (§3.5).
CREATE TABLE IF NOT EXISTS production_pipelines (
  id               TEXT PRIMARY KEY,
  -- Владелец всех папок пайплайна и плательщик за обработку (§2.2).
  owner_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  graph            JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision         INTEGER NOT NULL DEFAULT 0,
  -- NULL — черновик, ещё ни разу не активирован.
  current_version  INTEGER,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'active', 'archived')),
  -- Настройки, которые правятся на месте и новой версии не создают: срок
  -- хранения версий файлов (§4.5) и т. п. Нормы сроков лежат в графе у этапов.
  settings         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Из какого пайплайна сделан дубль — это другой пайплайн со своими папками.
  duplicated_from  TEXT REFERENCES production_pipelines(id) ON DELETE SET NULL,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at     TIMESTAMPTZ,
  archived_at      TIMESTAMPTZ,
  -- Папки пайплайна ушли в архив вслед за ним — после последнего ролика (§3.5).
  folders_archived_at TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT production_pipelines_version_chk
    CHECK ((status = 'draft') = (current_version IS NULL) OR status = 'archived')
);

CREATE INDEX IF NOT EXISTS production_pipelines_owner_idx
  ON production_pipelines (owner_user_id, status)
  WHERE deleted_at IS NULL;

-- Зафиксированная структура. Строка не меняется никогда: по ней идут ролики.
CREATE TABLE IF NOT EXISTS production_pipeline_versions (
  pipeline_id  TEXT NOT NULL REFERENCES production_pipelines(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL CHECK (version >= 1),
  graph        JSONB NOT NULL,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pipeline_id, version)
);

-- Папка этапа. Одна на ноду во всех версиях: id ноды сохраняется между версиями,
-- поэтому этап, который есть и в v1, и в v2, работает с той же папкой.
-- project_id SET NULL, а не RESTRICT: RESTRICT заблокировал бы удаление
-- аккаунта, у которого есть проекты. Этап без папки — ошибка, которую видно.
CREATE TABLE IF NOT EXISTS production_pipeline_steps (
  pipeline_id  TEXT NOT NULL REFERENCES production_pipelines(id) ON DELETE CASCADE,
  node_id      TEXT NOT NULL,
  project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pipeline_id, node_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS production_pipeline_steps_project_idx
  ON production_pipeline_steps (project_id)
  WHERE project_id IS NOT NULL;

-- Люди этапов. Настройка на месте, а не часть версии: смена людей действует и
-- на идущие ролики (§3.5). launcher — у ноды «Старт»: кто может запускать ролики.
CREATE TABLE IF NOT EXISTS production_pipeline_people (
  pipeline_id  TEXT NOT NULL REFERENCES production_pipelines(id) ON DELETE CASCADE,
  node_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL
                 CHECK (role IN ('launcher', 'executor', 'reviewer', 'watcher')),
  added_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pipeline_id, node_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS production_pipeline_people_user_idx
  ON production_pipeline_people (user_id);

-- ─── Ролик ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS production_runs (
  id                  TEXT PRIMARY KEY,
  pipeline_id         TEXT NOT NULL REFERENCES production_pipelines(id) ON DELETE CASCADE,
  -- По какой версии идёт ролик. Не меняется.
  pipeline_version    INTEGER NOT NULL,
  name                TEXT NOT NULL,
  -- Имя подпапки ролика во всех этапах: IN/<folder_name>, OUT/<folder_name>, …
  folder_name         TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'done', 'cancelled')),
  -- Ветка ролика (§4.6): от какого ролика и с какого этапа. В первой версии NULL.
  parent_run_id       TEXT REFERENCES production_runs(id) ON DELETE SET NULL,
  branched_from_node  TEXT,
  -- Срок ролика по нормам этапов, пересчитывается на каждом событии (§4.8).
  due_at              TIMESTAMPTZ,
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at         TIMESTAMPTZ,
  cancelled_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  archived_at         TIMESTAMPTZ,
  FOREIGN KEY (pipeline_id, pipeline_version)
    REFERENCES production_pipeline_versions (pipeline_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS production_runs_folder_idx
  ON production_runs (pipeline_id, lower(folder_name));

-- «Сколько роликов в производстве» на карточке пайплайна и запрет удаления.
CREATE INDEX IF NOT EXISTS production_runs_active_idx
  ON production_runs (pipeline_id, pipeline_version)
  WHERE status = 'active';

-- Этап ролика: статус, кто взял, сроки. Чат этапа привязан к этой строке.
CREATE TABLE IF NOT EXISTS production_run_steps (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
  node_id         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting', 'ready', 'in_progress', 'in_review',
                                      'changes_requested', 'approved', 'inherited')),
  ready_at        TIMESTAMPTZ,
  -- ready_at + норма этапа; пересчитывается при правке норм (§4.8).
  due_at          TIMESTAMPTZ,
  taken_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  taken_at        TIMESTAMPTZ,
  taken_how       TEXT CHECK (taken_how IN ('button', 'auto', 'implicit')),
  approved_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  -- Этап исходного ролика, чей результат унаследован веткой (§4.6).
  inherited_from  TEXT REFERENCES production_run_steps(id) ON DELETE SET NULL,
  UNIQUE (run_id, node_id)
);

-- «Мои задачи» и снятие этапа с ушедшего исполнителя (§4.2).
CREATE INDEX IF NOT EXISTS production_run_steps_taken_idx
  ON production_run_steps (taken_by)
  WHERE status IN ('in_progress', 'in_review', 'changes_requested');

-- Просрочки: только незавершённые этапы со сроком.
CREATE INDEX IF NOT EXISTS production_run_steps_due_idx
  ON production_run_steps (due_at)
  WHERE due_at IS NOT NULL AND status NOT IN ('approved', 'inherited');

-- ─── Сдачи и ревью ──────────────────────────────────────────────────────────

-- Сдача на проверку: v1, v2, … Для машины submitted_by = NULL, а task_id
-- указывает задачу конвейера, из отчёта которой взяты файлы (§5.1).
CREATE TABLE IF NOT EXISTS production_submissions (
  id               TEXT PRIMARY KEY,
  run_step_id      TEXT NOT NULL REFERENCES production_run_steps(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL CHECK (version >= 1),
  submitted_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  task_id          TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'changes_requested')),
  decided_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at       TIMESTAMPTZ,
  -- Файлы версии удалены по сроку хранения; запись и пометки остаются (§4.5).
  files_purged_at  TIMESTAMPTZ,
  UNIQUE (run_step_id, version)
);

-- Файл сдачи — копия в VERSIONS/<ролик>/vN. file_id SET NULL: после удаления по
-- сроку строка остаётся, чтобы пометки к ней было к чему привязать.
CREATE TABLE IF NOT EXISTS production_submission_files (
  id             TEXT PRIMARY KEY,
  submission_id  TEXT NOT NULL REFERENCES production_submissions(id) ON DELETE CASCADE,
  file_id        TEXT REFERENCES project_files(id) ON DELETE SET NULL,
  -- Имя и путь на момент сдачи: переживают удаление файла.
  name           TEXT NOT NULL,
  rel_path       TEXT NOT NULL DEFAULT '',
  proxy_file_id  TEXT REFERENCES project_files(id) ON DELETE SET NULL,
  origin         TEXT NOT NULL CHECK (origin IN ('machine', 'tool', 'manual')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS production_submission_files_submission_idx
  ON production_submission_files (submission_id);

-- Цепочка происхождения: из какого файла сделан какой (§5.3).
CREATE TABLE IF NOT EXISTS production_file_links (
  id            BIGSERIAL PRIMARY KEY,
  from_file_id  TEXT REFERENCES project_files(id) ON DELETE SET NULL,
  to_file_id    TEXT REFERENCES project_files(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('submitted', 'approved', 'propagated')),
  run_step_id   TEXT REFERENCES production_run_steps(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS production_file_links_to_idx
  ON production_file_links (to_file_id) WHERE to_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS production_file_links_from_idx
  ON production_file_links (from_file_id) WHERE from_file_id IS NOT NULL;

-- Пометка ревью: текст + якорь (время, диапазон, область, фрагмент текста) +
-- рисунок вектором в координатах 0..1 (§8). Ветка ответов — через parent_id.
CREATE TABLE IF NOT EXISTS production_review_comments (
  id                  TEXT PRIMARY KEY,
  submission_file_id  TEXT NOT NULL REFERENCES production_submission_files(id) ON DELETE CASCADE,
  parent_id           TEXT REFERENCES production_review_comments(id) ON DELETE CASCADE,
  author_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  body                TEXT NOT NULL DEFAULT '',
  anchor              JSONB NOT NULL DEFAULT '{}'::jsonb,
  shapes              JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolved_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at           TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS production_review_comments_file_idx
  ON production_review_comments (submission_file_id, created_at);

-- ─── Чат этапа ──────────────────────────────────────────────────────────────
--
-- Отдельный канал, не project_chat_messages: тот — технический чат проекта с
-- зеркалом в YouGile, этот — рабочая переписка этапа ролика, без YouGile (§7).

CREATE TABLE IF NOT EXISTS production_messages (
  id           BIGSERIAL PRIMARY KEY,
  run_step_id  TEXT NOT NULL REFERENCES production_run_steps(id) ON DELETE CASCADE,
  -- NULL у системных сообщений и у удалённых авторов.
  author_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL DEFAULT 'text'
                 CHECK (kind IN ('text', 'system', 'review_ref')),
  body         TEXT NOT NULL DEFAULT '',
  -- Вложения (id файлов в CHAT/<ролик>), событие для системного, пометка для review_ref.
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  reply_to     BIGINT REFERENCES production_messages(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at    TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS production_messages_step_idx
  ON production_messages (run_step_id, id);

-- Участник чата. Прочтение — отметкой на человека: «кто прочитал сообщение» —
-- это участники с last_read_message_id >= id, без строки на пару
-- «сообщение × человек» (§7.2).
CREATE TABLE IF NOT EXISTS production_chat_members (
  run_step_id           TEXT NOT NULL REFERENCES production_run_steps(id) ON DELETE CASCADE,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- production — назначен в пайплайне; invite / mention — позван в чат (§6.1).
  via                   TEXT NOT NULL CHECK (via IN ('production', 'invite', 'mention')),
  notify                TEXT NOT NULL DEFAULT 'all'
                          CHECK (notify IN ('all', 'mentions', 'none')),
  -- Выключается само у остальных исполнителей, когда этап взяли (§4.2).
  following             BOOLEAN NOT NULL DEFAULT TRUE,
  last_read_message_id  BIGINT NOT NULL DEFAULT 0,
  invited_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
  joined_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at               TIMESTAMPTZ,
  PRIMARY KEY (run_step_id, user_id)
);

-- Список «мои ролики и этапы» и счётчики непрочитанного.
CREATE INDEX IF NOT EXISTS production_chat_members_user_idx
  ON production_chat_members (user_id)
  WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS production_message_reactions (
  message_id  BIGINT NOT NULL REFERENCES production_messages(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 32),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- ─── Журнал ─────────────────────────────────────────────────────────────────
--
-- Каждый переход статуса пишет сюда в той же транзакции, что и сам переход.
-- Системные сообщения чата и статистика по этапам строятся отсюда.
CREATE TABLE IF NOT EXISTS production_events (
  id             BIGSERIAL PRIMARY KEY,
  pipeline_id    TEXT REFERENCES production_pipelines(id) ON DELETE CASCADE,
  run_id         TEXT REFERENCES production_runs(id) ON DELETE CASCADE,
  run_step_id    TEXT REFERENCES production_run_steps(id) ON DELETE CASCADE,
  -- NULL — сайт сам (автостарт, сбор входов, снятие с ушедшего исполнителя).
  actor_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS production_events_run_idx
  ON production_events (run_id, id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS production_events_step_idx
  ON production_events (run_step_id, id) WHERE run_step_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS production_events_pipeline_idx
  ON production_events (pipeline_id, id) WHERE pipeline_id IS NOT NULL;
