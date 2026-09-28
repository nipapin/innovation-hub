-- Один вход — несколько компаний: подпрофили. docs/MULTI_COMPANY_PROFILES_PLAN.md §3.1.
--
-- Подпрофиль — строка users с login_user_id → основной профиль (вход). У входа
-- email, пароль и Google; у подпрофиля — ровно одна компания и ничего для входа.
--
-- Эта миграция только ДОБАВЛЯЕТ структуру и совместима с кодом до плана: все
-- существующие строки получают login_user_id = NULL, то есть остаются входами, а
-- уникальность email среди них та же, что была. Поэтому её применяют ДО кода,
-- который читает login_user_id: без колонки такой код кладёт вход на сайт.
--
-- Перевод нынешних сотрудников компаний и запрет компании у входа — отдельной
-- миграцией 2026-09-28-login-profiles-split.sql, которая едет ВМЕСТЕ с кодом:
-- до нового кода прежний поиск по email нашёл бы на одну почту две строки.

-- Подпрофиль: рабочее место человека в компании под его единым входом.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS login_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS users_login_user_idx
  ON users (login_user_id) WHERE login_user_id IS NOT NULL;

-- Подпрофиль: всегда человек, всегда в компании, всегда рядовой на сайте и без
-- собственных средств входа. Войти в него можно только переключателем.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_subprofile_chk;
ALTER TABLE users ADD CONSTRAINT users_subprofile_chk CHECK (
  login_user_id IS NULL
  OR (
    kind = 'person'
    AND company_id IS NOT NULL
    AND role = 'USER'
    AND password_hash IS NULL
    AND provider_account_id IS NULL
    AND login_user_id <> id
  )
);

-- В одной компании у входа не больше одного подпрофиля.
CREATE UNIQUE INDEX IF NOT EXISTS users_subprofile_company_idx
  ON users (login_user_id, company_id) WHERE login_user_id IS NOT NULL;

-- email уникален среди ВХОДОВ, а не среди всех строк: у подпрофиля email — копия
-- рабочей почты (§3.3 плана). Новый индекс ставится раньше, чем снимается старое
-- ограничение, — уникальность не пропадает ни на миг.
CREATE UNIQUE INDEX IF NOT EXISTS users_login_email_idx
  ON users (email) WHERE login_user_id IS NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
