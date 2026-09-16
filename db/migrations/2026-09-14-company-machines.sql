-- Машины компании. Этап 1 плана docs/COMPANY_PIPELINE_PLAN.md.
--
-- NULL — наша машина, то есть парк ровно такой, каким работает сейчас.
-- Заполнено — машина стоит у клиента и видит ТОЛЬКО проекты его людей.
--
-- Зачем колонка, а не роль: `users.role` — ось САЙТА (USER/ADMIN/SUPERADMIN), и
-- «машина компании» на ней не выражается. Любое значение оттуда либо даёт
-- слишком много (ADMIN открывает всю площадку), либо отнимает нужное (USER
-- сводит машину к проектам того, кто её регистрировал). Принадлежность машины —
-- отдельный вопрос, и у него отдельное поле.
--
-- ON DELETE RESTRICT: удалить компанию, у которой остались машины, нельзя —
-- сначала их отзывают. Каскад тихо превратил бы машину клиента в машину с
-- доступом к общему разделу, то есть расширил бы права удалением строки.
ALTER TABLE remote_computers
  ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS remote_computers_company_idx
  ON remote_computers (company_id)
  WHERE company_id IS NOT NULL AND revoked_at IS NULL;
