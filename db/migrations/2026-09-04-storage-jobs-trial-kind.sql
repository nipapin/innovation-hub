-- Выдача тестового периода как вид работы хранилища.
--
-- Тип `trial-provision` появился в коде (lib/storage/jobs.ts) вместе с
-- биллингом, а в перечислении на таблице его не оказалось: вставка работы
-- падала на CHECK уже ПОСЛЕ того, как строка гранта закоммичена. Человек
-- видел ошибку, грант оставался в `provisioning`, копировать было некому, и
-- карточка вечно показывала «проекты копируются».
--
-- Перечисление, а не свободный текст: неизвестный вид работы обязан ломаться
-- на вставке, а не тихо лежать в очереди, которую никто не разберёт.
ALTER TABLE storage_jobs DROP CONSTRAINT IF EXISTS storage_jobs_kind_check;

ALTER TABLE storage_jobs ADD CONSTRAINT storage_jobs_kind_check
  CHECK (kind IN ('copy', 'move', 'purge', 'recatalog', 'trial-provision'));
