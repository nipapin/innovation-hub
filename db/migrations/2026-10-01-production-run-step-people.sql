-- Люди конкретного этапа конкретного ролика — «+» на рабочем месте.
-- Добавляются поверх людей пайплайна и только в этот этап: в других роликах
-- их нет. Нужен человек везде — правят пайплайн.
CREATE TABLE IF NOT EXISTS production_run_step_people (
  run_step_id  TEXT NOT NULL REFERENCES production_run_steps(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('executor', 'reviewer')),
  added_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_step_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS production_run_step_people_user_idx
  ON production_run_step_people (user_id);
