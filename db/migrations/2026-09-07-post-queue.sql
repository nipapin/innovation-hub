-- Автопостинг: очередь публикаций, реестр опубликованного и состояние обхода.
-- Разбор и обоснования — docs/SOCIAL_POSTING_PLAN.md §3.
--
-- Миграция ничего не включает: таблицы появляются пустыми, обход по расписанию
-- выключен (`scan_interval_min = 0`), и до первого включения администратором
-- поведение сайта не меняется.

-- ── Очередь публикаций ──────────────────────────────────────────────────────
--
-- Отдельная таблица, а не `tasks`: у задачи обработки исполнитель — машина с
-- лицензией AE, и на этом держатся её аренда, повторы и гейт по деньгам. У
-- публикации исполнитель сам сайт, аренды нет вовсе, а «повторить» значит
-- совсем другое: площадка могла принять файл и не опубликовать его.
CREATE TABLE IF NOT EXISTS post_jobs (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Файл на момент постановки. Оба поля намеренно: `file_id` — живая связь с
  -- каталогом (по ней видно, что файл переименовали), `source_key` —
  -- неизменная идентичность в R2, по которой считается дедуп. Файл могут
  -- удалить из каталога до того, как очередь до него дойдёт, и тогда останется
  -- ключ и внятная ошибка вместо строки без адресата.
  file_id        TEXT REFERENCES project_files(id) ON DELETE SET NULL,
  source_key     TEXT NOT NULL,

  -- Какая нода-источник породила задачу. Нужна, чтобы показать в админке, из
  -- какого маршрута она пришла.
  finder_id      TEXT NOT NULL DEFAULT '',

  platform       TEXT NOT NULL CHECK (platform IN ('vk', 'youtube', 'telegram')),
  -- Аккаунт из сейфа. Без внешнего ключа намеренно, как у `vendor_usage`:
  -- аккаунт человек может убрать, а история публикаций остаётся.
  account_id     TEXT NOT NULL,

  -- Куда публикуем: `{ "kind": "profile" }` либо `{ "kind": "group", "id": …,
  -- "name": … }`. Объект, а не строка, потому что у площадок разные цели:
  -- сообщество VK, канал Telegram, плейлист YouTube.
  target         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Заголовок, описание и теги ПОСЛЕ резолва масок. Резолв делается один раз,
  -- при постановке: маски вроде $projectName опираются на состояние проекта, и
  -- пересчитывать их при повторе через сутки значило бы опубликовать не то,
  -- что видел человек, ставя задачу.
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Что сделать с исходником после успешной публикации: оставить, удалить или
  -- перенести в папку. Решение принимает нода публикации (`afterPost`), а у
  -- старых графов — галочка `deleteAfter` у Finder'а.
  --
  -- Значение запоминается У ЗАДАЧИ, а не читается из графа при исполнении:
  -- граф между постановкой и публикацией могли поменять, а удаление
  -- необратимо. Файл должен уехать туда, куда его отправляли, ставя задачу.
  after_post     TEXT NOT NULL DEFAULT 'keep'
                   CHECK (after_post IN ('keep', 'delete', 'move')),
  -- Куда переносить при `move`. Путь внутри проекта; пусто — переносить некуда.
  after_post_folder TEXT NOT NULL DEFAULT '',
  -- Проект-получатель, когда путь начинался с `../` (соседний проект того же
  -- человека). NULL — переносим внутри своего проекта.
  --
  -- Разрешается РОВНО ОДИН уровень вверх: выше лежат чужие папки, и «подняться
  -- на два» дало бы графу доступ туда, куда его автору его никто не давал.
  -- Проект резолвится по имени ПРИ ПОСТАНОВКЕ и запоминается id: имя могут
  -- поменять, пока задача ждёт очереди, и тогда файл уехал бы не туда.
  after_post_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,

  status         TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped')),
  attempts       INTEGER NOT NULL DEFAULT 0,
  max_attempts   INTEGER NOT NULL DEFAULT 3,
  error          TEXT,

  -- Аренда на один тик крона. Не для парка машин (исполнитель один), а против
  -- наложения тиков: длинная заливка переживает интервал крона, и без аренды
  -- следующий тик взял бы ту же задачу и залил файл второй раз.
  lease_expires_at TIMESTAMPTZ,

  external_id    TEXT,
  external_url   TEXT,
  published_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS post_jobs_queue_idx
  ON post_jobs (status, created_at)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS post_jobs_project_idx
  ON post_jobs (project_id, created_at DESC);

-- Дедуп живых задач: повторный обход не должен ставить вторую задачу по тому
-- же файлу на тот же аккаунт. Завершённые под ограничение не попадают — по
-- файлу можно осознанно повторить публикацию.
CREATE UNIQUE INDEX IF NOT EXISTS post_jobs_active_idx
  ON post_jobs (project_id, source_key, platform, account_id)
  WHERE status IN ('queued', 'running');

-- ── Реестр опубликованного ──────────────────────────────────────────────────
--
-- Главное требование: один файл не уезжает на одну площадку дважды, даже если
-- очередь перезапустилась, задача повторилась или файл переиндексировали.
--
-- Ключ «файл + площадка + аккаунт» — ровно такой же, как в программе
-- (`postedFileSet` в `src/PROCESSING/autoPost/postLog.ts` считает по файлу и
-- платформе). Один файл в два сообщества VK — две законные строки; тот же файл
-- в то же сообщество второй раз — нет.
--
-- Файл здесь по КЛЮЧУ, а не по `file_id`: файл могут убрать из каталога после
-- публикации (в том числе мы сами, по `after_post`), и реестр обязан пережить
-- это — иначе после удаления файл снова стал бы «неопубликованным».
CREATE TABLE IF NOT EXISTS post_ledger (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_key  TEXT NOT NULL,
  platform    TEXT NOT NULL,
  account_id  TEXT NOT NULL,
  post_job_id TEXT REFERENCES post_jobs(id) ON DELETE SET NULL,
  external_id  TEXT,
  external_url TEXT,
  posted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, source_key, platform, account_id)
);

-- Интервал между публикациями считается по этому индексу: «когда мы последний
-- раз постили этим аккаунтом на эту площадку».
CREATE INDEX IF NOT EXISTS post_ledger_pace_idx
  ON post_ledger (platform, account_id, posted_at DESC);

-- ── Состояние обхода ────────────────────────────────────────────────────────
--
-- Синглтон по образцу `automation_scan_state`: у постинга свой цикл, свой
-- период и своя кнопка. Смешивать их с обходом IN нельзя — там интервал в
-- четверть часа, здесь темп задают сами маршруты, поминутно.
CREATE TABLE IF NOT EXISTS post_scan_state (
  id                TEXT PRIMARY KEY DEFAULT 'singleton',
  -- Идёт ли постинг вообще. Выключено по умолчанию: миграция не должна
  -- начинать публиковать в чей-то VK самим фактом применения.
  is_running        BOOLEAN NOT NULL DEFAULT FALSE,
  started_at        TIMESTAMPTZ,
  started_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Период обхода папок-источников, минуты. 0 — по таймеру не ходить; разовый
  -- прогон кнопкой при этом остаётся. Одно поле без отдельного тумблера — как
  -- у обхода IN (docs/PIPELINE.md §3.1): «включён, но раз в сутки» от
  -- «выключен» содержательно не отличается.
  scan_interval_min INTEGER NOT NULL DEFAULT 5,
  scanned_at        TIMESTAMPTZ,
  last_created      INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT post_scan_state_singleton_chk CHECK (id = 'singleton'),
  CONSTRAINT post_scan_state_interval_chk
    CHECK (scan_interval_min = 0 OR scan_interval_min BETWEEN 1 AND 1440)
);

INSERT INTO post_scan_state (id) VALUES ('singleton')
  ON CONFLICT (id) DO NOTHING;

-- ── Пауза аккаунта после отказа площадки ────────────────────────────────────
--
-- Живёт у аккаунта, а не у задачи: при 429, флуд-контроле или капче площадка
-- ограничивает АККАУНТ целиком, и откладывать один файл бессмысленно — очередь
-- продолжит долбить лимит следующим. Так же это устроено в программе
-- (`writeCooldown` / `readCooldownUntil` в `autoPost/postLog.ts`).
ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS cooldown_until  TIMESTAMPTZ;
ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS cooldown_reason TEXT;
