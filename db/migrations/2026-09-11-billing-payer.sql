-- Общий кошелёк: кто за кого платит. Этап 1 плана docs/COMPANY_ACCOUNTS_PLAN.md (§7).
--
-- NULL — человек платит сам, как было до этой миграции. Заполнено — задачи его
-- проектов резервируются и списываются с кошелька указанного пользователя:
-- остаток, подарки и лимит овердрафта берутся у плательщика.
--
-- Колонка стоит на том, ЗА КОГО платят, а не списком на плательщике: резерв
-- живых задач обязан считаться по проектам всех, за кого платит кошелёк, одним
-- запросом (lib/billing/funds.ts, liveReserves). С колонкой это один JOIN по
-- COALESCE(payer_user_id, id), и список подчинённых не нужен вовсе.
--
-- Связь не зависит от компаний: в общем разделе один человек может платить за
-- коллегу, а у сотрудника компании плательщиком станет кошелёк компании.
--
-- ON DELETE RESTRICT: плательщика, пока он за кого-то платит, удалить нельзя.
-- Каскад снёс бы вместе с ним ленту, где лежат списания чужих проектов, а
-- SET NULL молча пересадил бы людей на их пустые личные кошельки.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payer_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;

-- Самого себя плательщиком не назначить.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_payer_not_self;
ALTER TABLE users
  ADD CONSTRAINT users_payer_not_self CHECK (payer_user_id IS DISTINCT FROM id);

-- «За кого он платит» — вопрос удаления и экрана акций.
CREATE INDEX IF NOT EXISTS users_payer_idx ON users (payer_user_id)
  WHERE payer_user_id IS NOT NULL;

-- Цепочек нет, в обе стороны:
--   * плательщик сам платит за себя — у него payer_user_id пуст;
--   * тот, за кого уже платят, сам ни за кого не платит.
-- Иначе COALESCE в запросах о деньгах давал бы только один уровень, и рекурсию
-- пришлось бы городить в каждом из них.
--
-- CHECK это не выразит — условие смотрит на соседние строки, — поэтому триггер.
-- Строка плательщика берётся FOR UPDATE: две встречные смены («A платит за B» и
-- «B платит за C») без блокировки прошли бы обе, и цепочка A → B → C сложилась
-- бы из двух разрешённых по отдельности шагов. С блокировкой вторая дождётся
-- первой и увидит её результат.
--
-- Ту же проверку делает lib/billing/payer.ts заранее, чтобы ответить человеку
-- причиной. Триггер — страховка на случай, когда проверка не успела.
CREATE OR REPLACE FUNCTION users_payer_no_chain() RETURNS trigger AS $$
DECLARE
  payer_of_payer TEXT;
BEGIN
  IF NEW.payer_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.payer_user_id IS NOT DISTINCT FROM OLD.payer_user_id THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT payer_user_id INTO payer_of_payer
    FROM users
   WHERE id = NEW.payer_user_id
   FOR UPDATE;
  IF payer_of_payer IS NOT NULL THEN
    RAISE EXCEPTION 'payer % pays through another payer', NEW.payer_user_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'users_payer_no_chain';
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE payer_user_id = NEW.id) THEN
    RAISE EXCEPTION 'user % already pays for others', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'users_payer_no_chain';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_payer_no_chain ON users;
CREATE TRIGGER users_payer_no_chain
  BEFORE INSERT OR UPDATE OF payer_user_id ON users
  FOR EACH ROW EXECUTE PROCEDURE users_payer_no_chain();

-- Причина остановки для того, за кого платят: деньги кончились не у него, и
-- «пополните баланс» отправило бы его туда, где он ничего не может.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_paused_reason_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_paused_reason_check
  CHECK (paused_reason IN ('no-funds', 'trial-over', 'no-vendor-key', 'payer-no-funds'));
