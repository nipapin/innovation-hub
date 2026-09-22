# 13 — Эксплуатация

---

## 1. Как поднять локально

```bash
pnpm install                # или npm ci
cp .env.example .env        # и заполнить (см. §2)
pnpm db:init                # создать схему + завести админа из ADMIN_*
pnpm dev                    # next dev --turbo, порт 3000
```

Минимум переменных, без которых не поднимется: подключение к Postgres и
`SESSION_SECRET` (в dev есть предсказуемый фолбэк, в production бросает).

Без R2 приложение стартует, но кабинет отвечает 503 на всё, что касается файлов
(`isS3Configured()`).

---

## 2. Переменные окружения

Полный список с комментариями — `.env.example`. Ниже — сводка по блокам.

### База данных

| Переменная | Обязательна | Заметка |
| --- | --- | --- |
| `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT`, `PGDATABASE` | да, либо ↓ | дискретный вариант |
| `DB_CONNECTION_STRING` | либо ↑ | `postgres://user:pass@host:5432/db?sslmode=require` |
| `PG_POOL_MAX`, `PG_POOL_IDLE_MS`, `PG_POOL_CONN_MS` | нет | тюнинг пула; таймаут коннекта поднимать для медленных удалённых хостов |

TLS (`lib/db.ts` разбирает это в строгом порядке приоритетов):

| Переменная | Значение |
| --- | --- |
| `PGSSLMODE` | `disable` \| `no-verify` \| `require` \| `verify-ca` \| `verify-full`. **Отказ от TLS проверяется первым** и перебивает оставшиеся CA |
| `PGSSL_NO_VERIFY=1`, `DATABASE_SSL=false` | то же короче |
| `PGSSLROOTCERT` | путь к CA-файлу; автоматически подхватывается `~/.cloud-certs/root.crt`, но **не** для localhost |
| `PGSSL_CA` / `DATABASE_SSL_CA` | PEM прямо в переменной (для Vercel); `\n` разворачиваются |
| `PGSSL_REJECT_UNAUTHORIZED` | явное управление проверкой |

Для локальной разработки против удалённого хоста с самоподписанным сертификатом
(Timeweb) — `PGSSLMODE=no-verify`.

### Аутентификация

| Переменная | Заметка |
| --- | --- |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_FULL_NAME` | используются `pnpm db:init` — создают или повышают до ADMIN |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | обе заданы → на `/login` и `/register` появляется кнопка Google |

Redirect URI в Google Console: `{origin}/api/auth/google/callback` для каждого
origin (localhost и прод).

### Объектное хранилище (R2)

| Переменная | Заметка |
| --- | --- |
| `AWS_S3_BUCKET` | обязательна |
| `AWS_REGION` | для R2 — `auto` |
| `AWS_ENDPOINT_URL` | `https://<accountid>.r2.cloudflarestorage.com` |
| `S3_KEY_ID` / `S3_SECRET_KEY` | принимаются также пары `AWS_KEY_ID`/`AWS_SECRET_KEY` и `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` |
| `NEXT_PUBLIC_S3_PUBLIC_BASE_URL` | публичная CDN-база, если раздача идёт напрямую |
| `ADMIN_UPLOAD_MAX_BYTES` | лимит загрузки медиа, по умолчанию 250 МБ |
| `PROJECT_MEDIA_UPLOAD_MAX_BYTES` | лимит загрузки в проект, по умолчанию 250 МБ |

### Публичный сайт и почта

| Переменная | Заметка |
| --- | --- |
| `APP_PUBLIC_URL` | база ссылок в письмах и вебхуках. На Vercel — фолбэк на `VERCEL_URL` |
| `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_CONTACT_TELEGRAM` | блок контактов на `/about`; без них блок не рисуется |
| `RESEND_API_KEY`, `RESEND_FROM` | письма. Без ключа отправка **пропускается** с предупреждением |
| `RESEND_FROM_NOREPLY` | адрес для писем без ответа (сброс пароля). Пусто — шлём с `RESEND_FROM` |
| `FEATURE_SUGGESTION_MAX_FILES` (5), `FEATURE_SUGGESTION_UPLOAD_MAX_BYTES` (25 МБ), `FEATURE_SUGGESTION_PRESIGN_SEC` (7 дней) | вложения заявок |

### YouGile

`YOUGILE_API_KEY`, `YOUGILE_COMPANY_ID`, `YOUGILE_BOT_USER_ID`,
`YOUGILE_CHAT_MEMBER_IDS`, `YOUGILE_WEBHOOK_SECRET`. Подробно —
[11](./11-integrations.md#1-yougile--чат-с-командой).

### Web Push

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
Генерация: `node -e "console.log(require('web-push').generateVAPIDKeys())"`.

### Прочее

| Переменная | Заметка |
| --- | --- |
| `CRON_SECRET` | `Bearer` для cron-роутов. **Нигде не настраивается** — критичные задачи живут в процессе |
| `GOOGLE_DRIVE_*` | legacy, только для одноразовой миграции. В рантайме не читаются |
| `TW_S3_*` | legacy Timeweb, только для скрипта миграции |

---

## 3. Миграции

```bash
pnpm db:migrate            # накатить всё непримененное
pnpm db:migrate:status     # что применено, что нет
pnpm db:init               # схема с нуля + админ
pnpm db:reset              # снести и налить заново (осторожно)
pnpm db:check              # проверка подключения и схемы
pnpm db:restore dump.sql   # восстановление из pg_dump
```

Устройство: `scripts/db-migrate.mjs` ведёт таблицу `schema_migrations`
(создаётся сама), применяет файлы `db/migrations/*.sql` в лексикографическом
порядке, **каждый в своей транзакции**.

`db/schema.sql` идемпотентен (`CREATE TABLE IF NOT EXISTS`,
`ALTER TABLE … ADD COLUMN IF NOT EXISTS`) — его можно прогонять на живой базе.

### После миграции обязательно перезапустить процесс

Пул `pg` кеширует планы запросов. Новая колонка без перезапуска даёт
`cached plan must not change result type`. Роуты это ловят и отвечают 503 с
внятной инструкцией, но лечится это только `pm2 reload all`.

---

## 4. Деплой

```bash
npm run deploy
# = git pull && npm ci && npm run db:migrate && npm run build && pm2 reload all
```

Продакшен: VPS, `nginx` → `pm2` → `next start` на `127.0.0.1:3000`.

### pm2 — `ecosystem.config.json`

```json
{ "name": "ffworks", "cwd": "/root/ffworks",
  "script": "node_modules/next/dist/bin/next", "args": "start -p 3000",
  "instances": 1, "exec_mode": "fork",
  "autorestart": true, "max_restarts": 10, "restart_delay": 5000,
  "max_memory_restart": "1G", "time": true }
```

**Один инстанс — не случайность.** В памяти процесса живут rate limit и флаги
фоновых циклов (см. [02](./02-architecture.md#7-состояние-в-памяти-процесса)).
Второй инстанс задублирует циклы и размножит лимиты.

### nginx — `deploy/nginx-ffworks.conf`

```nginx
server_name ffworks.pro www.ffworks.pro;
client_max_body_size 100m;
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```

Три заголовка **обязательны**, и вот почему:

| Заголовок | Что сломается без него |
| --- | --- |
| `X-Real-IP` / `X-Forwarded-For` | трекинг посещений и rate limit будут видеть один IP — nginx |
| `X-Forwarded-Proto` | Google OAuth соберёт `redirect_uri` с `http://` и вернёт ошибку |
| `Host` | ссылки в редиректах уедут на `127.0.0.1` |

`client_max_body_size 100m` хватает, потому что большие файлы идут presigned
PUT напрямую в R2, минуя nginx.

HTTPS — `certbot --nginx` поверх этого конфига.

### Vercel

`vercel.json` содержит только `installCommand`. **Разворачивать на Vercel
нельзя без переделки**: фоновые циклы в `instrumentation.ts` требуют
долгоживущего процесса.

---

## 5. Скрипты

### Регулярные

| Команда | Что |
| --- | --- |
| `pnpm dev` / `build` / `start` | Next |
| `pnpm lint` | `next lint` (⚠️ конфига ESLint в репозитории нет) |
| `pnpm i18n:check` | ищет захардкоженные русские строки в `/account` и `/admin` |
| `pnpm md:check` | сверяет рендерер описания с контрактом: гоняет `docs/description.example.md` через тот же конвейер и ту же схему санитайза |

### База

`db:init`, `db:reset`, `db:migrate`, `db:migrate:status`, `db:check`,
`db:restore`.

### Хранилище

| Команда | Что |
| --- | --- |
| `pnpm s3:ensure-prefix` | создать префикс в бакете |
| `pnpm s3:set-cors` | настроить CORS: presigned PUT из браузера, GET/HEAD с range для `<video>`. Origins из `--origin` или `ALLOWED_ORIGINS` |
| `pnpm s3:test-upload` | сквозная проверка presigned-PUT тем же SDK и с теми же опциями подписи, что в продакшене |
| `pnpm storage:migrate-to-r2` | одноразовый перенос legacy Timeweb и старых R2-ключей в текущую раскладку. По умолчанию read-only, `--apply` после разбора отчёта |

### Одноразовые починки данных

| Скрипт | Что |
| --- | --- |
| `storage-backfill-folder-rows.mjs` | заводит строки-папки для путей, на которых уже что-то лежит. Нужен потому, что `presign → notify` создавал строку файла с `folder_path = 'IN'`, но саму папку не заводил, а дерево строится спуском по строкам-папкам |
| `storage-options-consolidate.mjs` | сводит папку `options` каждого проекта к одному объекту на логическое имя. Раньше десктоп заливал служебные JSON обычным путём, а presign минтит `{uuid}-{имя}` — сайт читал канонический ключ, программа физический |
| `backfill-projects-to-r2.mjs` | досоздаёт `project-meta.json` для проектов, у которых его нет. Отказывается работать с Timeweb-эндпоинтом |

### Инструменты и данные

| Скрипт | Что |
| --- | --- |
| `make-dialog-fixture.mjs` | собирает тестовый комплект папки задачи. Скрипт, а не файлы в репозитории: медиа в git не место, а комплект нужен воспроизводимым |
| `build-out-folder.mjs` | собирает папку `OUT` целиком — такую, какой она должна быть после обработки |
| `check-dialog-doc.mjs` | проверка `dialog.json` по контракту, в том же порядке проверок, что и в рантайме — чтобы обе реализации ругались на одно и то же |
| `import-castanalyzer.mjs` | превращает проект Cast Analyzer Next в папку задачи редактора |

### YouGile

| Команда | Что |
| --- | --- |
| `pnpm yougile:list-users` | id / email / имя пользователей компании — чтобы выбрать `YOUGILE_BOT_USER_ID` и `YOUGILE_CHAT_MEMBER_IDS` |
| `pnpm yougile:setup-webhook` | регистрирует подписку `chat_message-created`. Запускается один раз, и снова — если менялись `APP_PUBLIC_URL` или секрет |

### Legacy (Google Drive)

`drive:oauth`, `drive:provision-users`, `migrate-drive-to-r2.mjs`.
В рантайме Drive не используется.

### Разное

`generate-promo-poster.mjs` — снимает кадр из `public/promo_video.mp4`
системным Chrome и сохраняет как `public/promo_poster.jpg`, чтобы LCP лендинга
был маленькой картинкой, а не кадром ~95 МБ видео. Требует запущенного сервера.

---

## 6. Что происходит при старте процесса

`instrumentation.ts`, только в Node-рантайме:

1. `startChatPushPoller()` — тянет ответы команды из YouGile каждые 30 с;
2. `startPipelineRunner()` — тик конвейера каждые 15 с;
3. `startStatsLoop()` — статистика раз в час, первый тик через 30 с;
4. `seedDefaultSettings()` — **без `await`**: сид не должен задерживать старт и
   тем более ронять процесс, если база ещё не поднялась.

Включённое слежение конвейера **переживает перезапуск**: флаг лежит в базе.

---

## 7. Диагностика

| Симптом | Куда смотреть |
| --- | --- |
| `column … does not exist`, `cached plan must not change result type` | миграция не накачена или процесс не перезапущен. Роуты отвечают 503 с текстом |
| Файлы не загружаются, 503 «Object storage is not configured» | `AWS_*` / `S3_*` не заданы |
| presigned PUT падает «CORS / network error» после полной загрузки тела | CORS на бакете: `pnpm s3:set-cors`. Либо в подпись попал `Content-Type` — этого быть не должно |
| Конвейер «мёртв» | нижняя полоса `/admin/pipeline`: `scanned_at` двигается на каждом тике, значит цикл жив. Рядом `last_error` |
| Файл лежит в IN, задачи нет | дождаться обхода или нажать «Обойти сейчас». Причина пропуска будет в списке `skipped` |
| Задача взята и не отпускается | аренда 15 минут, `reapExpiredLeases` вернёт её в очередь |
| Сообщения из YouGile не приходят | вебхук не срабатывает на сообщения из UI YouGile — это ожидаемо, работает поллер. Проверить `YOUGILE_API_KEY` и лимит 50 запросов/мин |
| Google OAuth: `redirect_uri_mismatch` | nginx не пробрасывает `X-Forwarded-Proto`, либо URI не добавлен в Console |
| Письма не уходят | нет `RESEND_API_KEY` — в логе `[mail] RESEND_API_KEY not set` |
| Push не приходит | нет `VAPID_*`; либо подписка удалена браузером — она снимется автоматически при 404/410 |
| Статистика пустая | архив не импортирован (`procsTotal = 0`) или снимки не копились (`volume` пуст). Разные вещи |

### Префиксы логов

`[pipeline-runner]`, `[pipeline-sweep]`, `[stats]`, `[settings]`,
`[chat-push-poller]`, `[webhooks/yougile]`, `[mail]`, `[push]`,
`[project-storage]`, `[projects]`, `[auth/signin]`, `[auth/signup]`,
`[google-oauth]`, `[visitor-track]`, `[machine-api]`.

---

## 8. Резервное копирование

| Что | Как |
| --- | --- |
| Postgres | `pg_dump`; восстановление — `pnpm db:restore dump.sql` |
| Файлы проектов | лежат в R2, отдельной копии нет |
| Архив обработок | двойной: JSONL машин внутри папок проектов **и** месячная копия в `_site/stats/` (она не зависит от папок пользователей) |
| Снимки состояний | только Postgres. Пропущенный день невосстановим |
