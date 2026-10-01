-- Набор «Личного» — то же, что `companies.features`, но для всех, кто вне
-- команды. Одна строка на установку.
--
-- Раньше человеку без команды подставлялись жёсткие умолчания («всё
-- включено»), и выключить ему что-то можно было только на всей установке —
-- вместе со всеми командами. Читает строку `findCompanyFeaturesForUser`
-- (lib/repositories/companies.ts), правит админка «Команд».
--
-- Ключи — подмножество ключей команды: `companyTools` и `production`. Разделов
-- консоли, кошелька и зеркала чата у «Личного» нет.
--
-- «Производство» в «Личном» выключено с самого начала: раздел пока для команд.
-- Код без этой таблицы считает так же (lib/repositories/personal-features.ts),
-- поэтому порядок миграции и кода не важен.
CREATE TABLE IF NOT EXISTS personal_features (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  features   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT personal_features_singleton_chk CHECK (id = 'singleton')
);

INSERT INTO personal_features (id, features)
VALUES ('singleton', '{"production": false}'::jsonb)
ON CONFLICT (id) DO NOTHING;
