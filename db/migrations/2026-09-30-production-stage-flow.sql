-- Этап ролика под решения 2026-09-29/30 — docs/PRODUCTION_PLAN.md §4.1, §12.
--
-- Работа над этапом ушла в чат: варианты присылают сообщениями, кнопка одна —
-- «Принято». Поэтому:
--
--   * статусов у этапа три: waiting (ждёт входов) → ready (открыт) → approved,
--     плюс inherited у веток (§4.6). in_progress, in_review и
--     changes_requested больше не бывают;
--   * «взял в работу» (taken_by / taken_at / taken_how) заменено отметкой
--     исполнителя: «я делаю этот этап», отметиться могут несколько человек, и
--     по отметке человек числится исполнителем в отчётах.
--
-- Сужение CHECK и удаление колонок безопасны: на момент миграции таблицы
-- производства пусты (проверено 2026-09-30), кода, который их читает, ещё нет.

ALTER TABLE production_run_steps DROP CONSTRAINT IF EXISTS production_run_steps_status_check;
ALTER TABLE production_run_steps
  ADD CONSTRAINT production_run_steps_status_check
    CHECK (status IN ('waiting', 'ready', 'approved', 'inherited'));

DROP INDEX IF EXISTS production_run_steps_taken_idx;
ALTER TABLE production_run_steps DROP COLUMN IF EXISTS taken_by;
ALTER TABLE production_run_steps DROP COLUMN IF EXISTS taken_at;
ALTER TABLE production_run_steps DROP COLUMN IF EXISTS taken_how;

-- Этап без исполнителей-людей открывается сам: у машинного этапа старт — это
-- постановка задачи в очередь, и отметить его некому.
ALTER TABLE production_run_steps ADD COLUMN IF NOT EXISTS auto_started_at TIMESTAMPTZ;

-- Отметка исполнителя (§4.1). Снять отметку — удалить строку; история «кто когда
-- отмечался» остаётся в production_events.
CREATE TABLE IF NOT EXISTS production_run_step_executors (
  run_step_id  TEXT NOT NULL REFERENCES production_run_steps(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_step_id, user_id)
);

-- «Мои задачи»: этапы, где человек отметился исполнителем.
CREATE INDEX IF NOT EXISTS production_run_step_executors_user_idx
  ON production_run_step_executors (user_id);

-- Принятый вариант: какой файл рабочей папки ушёл в финальную (§4.1). Сама копия
-- — запись production_file_links вида `approved`; здесь — быстрый ответ «что
-- принято на этом этапе» без обхода связей.
ALTER TABLE production_run_steps
  ADD COLUMN IF NOT EXISTS approved_file_id TEXT REFERENCES project_files(id) ON DELETE SET NULL;
