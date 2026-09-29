-- fal.ai и OpenRouter в списке сервисов для своих ключей.
--
-- «Мои ключи» предлагают только то, что лежит в `vendor_services` (активное,
-- с выдачей `keys`, без владельца) — список сервисов, с которыми мы работаем,
-- а не «любой вендор». До сих пор там был один ComfyUI.
--
-- Учёток не заводим: наших ключей к этим сервисам нет, сервис без учётки —
-- законное состояние (2026-09-02-vendor-accounts.sql). Клиент подключает свой.
--
-- Слаги — навсегда: по ним машина просит ключ, а настройки проекта ищут учётки
-- человека. Плагин конвейера для этих вендоров обязан спрашивать ровно их.
--
-- `secret_fields` пустой — одно поле `apiKey`. У fal это вся строка
-- `key_id:key_secret` целиком, у OpenRouter — `sk-or-…`.
--
-- ON CONFLICT: если сервис уже завели руками в админке, миграция его не трогает.
INSERT INTO vendor_services (
  id, slug, name, base_url, billing_model, currency, delivery
) VALUES
  (gen_random_uuid()::text, 'fal', 'fal.ai', 'https://fal.run', 'prepaid', 'USD', 'keys'),
  (gen_random_uuid()::text, 'openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'prepaid', 'USD', 'keys')
ON CONFLICT (slug) DO NOTHING;
