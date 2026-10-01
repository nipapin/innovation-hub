-- Пауза пайплайна: новые ролики не запускаются, идущие доживают.
-- Не статус, а отметка поверх `active`: версии, папки и люди не меняются, и
-- «Возобновить» просто снимает её. NULL — запуски открыты.
ALTER TABLE production_pipelines ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
