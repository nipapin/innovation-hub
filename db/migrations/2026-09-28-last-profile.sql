-- Куда пускать после входа — туда, где человек работал в прошлый раз.
-- docs/MULTI_COMPANY_PROFILES_PLAN.md §17.6.
--
-- Колонка на ВХОДЕ, а не кука в браузере: с другого устройства человек должен
-- попасть туда же, а аккаунт, заведённый компанией, — в компанию с первого же
-- входа, когда никакого браузера с кукой ещё не было.
--
-- NULL — «Личное», то есть сам вход. Код читает колонку отдельным запросом и
-- переживает её отсутствие (lib/repositories/users.ts, readLastProfileId), поэтому
-- эта миграция не обязана опережать код: применять её можно в любой момент.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_profile_id TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Кто пришёл из компании, тот с первого входа в ней: сотрудники, переведённые на
-- подпрофили (2026-09-28-login-profiles-split.sql), и новые аккаунты, заведённые
-- консолью компании. Для обоих след в журнале компании ведёт на подпрофиль.
-- Уже выбранное человеком не трогаем.
UPDATE users l
   SET last_profile_id = s.id
  FROM users s
 WHERE s.login_user_id = l.id
   AND s.is_active
   AND l.last_profile_id IS NULL
   AND EXISTS (
     SELECT 1
       FROM admin_audit_log a
      WHERE a.target_id = s.id
        AND (
          a.action = 'company.member_split'
          OR (a.action = 'company.member_added' AND a.meta ->> 'newAccount' = 'true')
        )
   );
