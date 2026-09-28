-- Перевод нынешних сотрудников компаний на подпрофили.
-- docs/MULTI_COMPANY_PROFILES_PLAN.md §3.4.
--
-- Едет ВМЕСТЕ с кодом плана, а не раньше. Старый код ищет человека по email без
-- оглядки на подпрофили, и после этого шага на одну почту у сотрудника станет две
-- строки — вход и подпрофиль; какую он найдёт, решал бы порядок строк на диске.
-- Схемная половина (2026-09-28-login-profiles.sql) такого не делает и уходит
-- раньше.
--
-- Руками в общий раздел сотрудников не выводим: компания проекта выводится через
-- владельца, и выведенный человек увёл бы туда проекты, заведённые в компании.
-- Поэтому наоборот: СТАРАЯ строка остаётся в компании со всеми проектами,
-- задачами, деньгами, ключами и журналом и становится подпрофилем, а вход —
-- НОВАЯ строка без компании. Для компании не меняется ничего.
--
-- Перед применением — npm run db:backup.
--
-- Повторный запуск ничего не делает: строк сотрудников без login_user_id после
-- первого прохода не остаётся.

CREATE TEMP TABLE login_split ON COMMIT DROP AS
SELECT u.id                  AS profile_id,
       gen_random_uuid()::text AS login_id,
       u.email,
       u.provider_account_id,
       u.company_id
  FROM users u
 WHERE u.kind = 'person'
   AND u.company_id IS NOT NULL
   AND u.login_user_id IS NULL;

-- 1. Вход. Почта — временная заглушка: настоящая сейчас занята старой строкой,
--    которая ещё числится входом, а уникальность почты среди входов не должна
--    пропадать ни на миг. Google-привязка — по той же причине позже.
INSERT INTO users (
  id, full_name, contact_name, email, password_hash, role, is_active,
  auth_provider, provider_account_id, must_change_password, kind,
  created_at, updated_at
)
SELECT s.login_id,
       u.full_name,
       u.contact_name,
       'split-' || s.login_id || '@login.invalid',
       u.password_hash,
       u.role,
       u.is_active,
       u.auth_provider,
       NULL,
       u.must_change_password,
       'person',
       u.created_at,
       NOW()
  FROM login_split s
  JOIN users u ON u.id = s.profile_id;

-- 2. Старая строка — подпрофиль: без средств входа и рядовой на сайте. Роль сайта
--    уехала на вход шагом выше: админка доступна из «Личного», в профиле компании
--    он рядовой (COMPANY_ACCOUNTS_PLAN.md §4).
UPDATE users u
   SET login_user_id        = s.login_id,
       password_hash        = NULL,
       auth_provider        = 'local',
       provider_account_id  = NULL,
       must_change_password = FALSE,
       role                 = 'USER',
       updated_at           = NOW()
  FROM login_split s
 WHERE u.id = s.profile_id;

-- 3. Теперь почта свободна среди входов — отдаём её входу вместе с Google.
UPDATE users l
   SET email               = s.email,
       provider_account_id = s.provider_account_id
  FROM login_split s
 WHERE l.id = s.login_id;

-- 4. То, что принадлежит человеку, а не рабочему месту: теги админки сайта идут
--    за ролью сайта, ссылка сброса пароля — за паролем, подписка push — за
--    браузером, который не должен терять уведомления при переключении (§9.4).
UPDATE admin_capabilities ac
   SET user_id = s.login_id
  FROM login_split s
 WHERE ac.user_id = s.profile_id;

UPDATE password_resets pr
   SET user_id = s.login_id
  FROM login_split s
 WHERE pr.user_id = s.profile_id;

UPDATE push_subscriptions ps
   SET user_id = s.login_id
  FROM login_split s
 WHERE ps.user_id = s.profile_id;

-- 5. След в журнале компании: историю задним числом не восстановить, а вопрос
--    «откуда у сотрудника второй аккаунт» зададут именно в консоли компании.
INSERT INTO admin_audit_log (actor_id, actor_email, action, target_type, target_id, company_id, meta)
SELECT NULL,
       'migration',
       'company.member_split',
       'user',
       s.profile_id,
       s.company_id,
       jsonb_build_object('loginUserId', s.login_id, 'email', s.email)
  FROM login_split s;

-- 6. Вход всегда без компании: компания — только у подпрофиля.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_login_no_company_chk;
ALTER TABLE users ADD CONSTRAINT users_login_no_company_chk CHECK (
  login_user_id IS NOT NULL OR kind <> 'person' OR company_id IS NULL
);
