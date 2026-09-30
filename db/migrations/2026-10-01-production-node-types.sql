-- Типы нод и папки этапов по решениям 2026-09-30 — docs/PRODUCTION_PLAN.md §3.1, §3.4, §4.5.
--
-- * Роль `editor` у ноды «Старт»: кто может править пайплайн, включая архив.
-- * Папка-проект этапа теперь выбирается в ноде, и несколько этапов (или
--   пайплайнов) могут писать в одну папку. Проект этапа ролика запоминается в
--   `production_run_steps.paths` при открытии этапа, поэтому уникальность
--   «один проект — один этап» больше не нужна.
-- * Пояс того, кто запустил ролик: маски времени ($runTime, $HH, …) считаются
--   по его часам, а этапы открываются позже, на сервере в UTC.
-- * Отметки чистки по сроку хранения: варианты и промежуточные финалы удаляются
--   один раз, через N дней после сдачи ролика.
--
-- Только расширение: существующие строки остаются валидными.

ALTER TABLE production_pipeline_people DROP CONSTRAINT IF EXISTS production_pipeline_people_role_check;
ALTER TABLE production_pipeline_people
  ADD CONSTRAINT production_pipeline_people_role_check
    CHECK (role IN ('launcher', 'editor', 'executor', 'reviewer', 'watcher'));

DROP INDEX IF EXISTS production_pipeline_steps_project_idx;

ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS tz_offset_min INTEGER NOT NULL DEFAULT 0;
ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS variants_purged_at TIMESTAMPTZ;
ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS finals_purged_at TIMESTAMPTZ;

-- Чистка ищет сданные ролики, у которых ещё что-то не вычищено.
CREATE INDEX IF NOT EXISTS production_runs_purge_idx
  ON production_runs (finished_at)
  WHERE status = 'done' AND (variants_purged_at IS NULL OR finals_purged_at IS NULL);
