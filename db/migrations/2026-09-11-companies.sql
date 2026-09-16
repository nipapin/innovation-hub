-- Компания как сущность. Этап 3 плана docs/COMPANY_ACCOUNTS_PLAN.md (§3, §15).
--
-- Компания — слой поверх пользователей, а не разрез базы: в таблицах работы
-- (проекты, файлы, задачи, деньги) новых колонок нет и не будет, компания
-- выводится через владельца. Разбор — docs/COMPANY_ACCOUNTS_PLAN.md §2.
--
-- На этом этапе компания ещё ничего не открывает — консоли (/company) нет,
-- это этап 4. Здесь только модель: сущность, служебный кошелёк, роли, теги.
CREATE TABLE IF NOT EXISTS companies (
  id             TEXT PRIMARY KEY,
  -- Латинский идентификатор: уходит в префикс хранилища и в адреса.
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  -- Служебный аккаунт, на котором лежат деньги компании (§7.3 плана).
  wallet_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  -- Домен, по которому резолвится оформление страницы входа. NULL — общий адрес.
  domain         TEXT UNIQUE,
  -- Оформление и набор разделов: форма меняется вместе с интерфейсом, поэтому
  -- JSONB, а не колонки. Тот же приём, что у billing_settings.
  branding       JSONB NOT NULL DEFAULT '{}'::jsonb,
  features       JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- person — человек; company_wallet — служебный аккаунт кошелька компании: без
-- пароля, без входа, не показывается ни в одном списке людей (listUsers(),
-- searchUsers()).
ALTER TABLE users ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'person';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_kind_check;
ALTER TABLE users
  ADD CONSTRAINT users_kind_check CHECK (kind IN ('person', 'company_wallet'));

-- NULL = общий раздел, то есть сайт ровно такой, каким работает сейчас.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE RESTRICT;

-- Роль внутри компании — вторая ось, независимая от users.role (§4 плана).
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_role TEXT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_company_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_company_role_check
    CHECK (company_role IN ('member', 'admin', 'owner'));

-- Роль в компании есть ровно у тех, кто в компании.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_company_role_pair;
ALTER TABLE users
  ADD CONSTRAINT users_company_role_pair
    CHECK ((company_id IS NULL) = (company_role IS NULL));

CREATE INDEX IF NOT EXISTS users_company_idx ON users (company_id)
  WHERE company_id IS NOT NULL;

-- Теги прав внутри компании. Компания выводится через человека: отдельная
-- колонка была бы вторым ответом на вопрос «в какой он компании».
CREATE TABLE IF NOT EXISTS company_capabilities (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability  TEXT NOT NULL,
  granted_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, capability)
);

-- Журнал компании читается из её консоли на этапе 4; компанию пишем с первого
-- дня, потому что историю задним числом не восстановить (§12.3 плана).
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS company_id TEXT;
CREATE INDEX IF NOT EXISTS admin_audit_log_company_idx
  ON admin_audit_log (company_id, created_at DESC) WHERE company_id IS NOT NULL;
