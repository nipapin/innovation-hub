-- Публичная страничка kotliar.ffworks.pro: страницы и файлы одного сайта.
-- Не общая фича аккаунтов — правит только KOTLIAR_SITE_OWNER_ID.

CREATE TABLE IF NOT EXISTS kotliar_pages (
  id         TEXT PRIMARY KEY,
  -- Пустая строка — главная на /.
  slug       TEXT NOT NULL DEFAULT '',
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS kotliar_pages_slug_idx ON kotliar_pages (slug);
CREATE INDEX IF NOT EXISTS kotliar_pages_sort_idx
  ON kotliar_pages (sort_order, created_at);

CREATE TABLE IF NOT EXISTS kotliar_files (
  id            TEXT PRIMARY KEY,
  page_id       TEXT NOT NULL REFERENCES kotliar_pages(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  s3_key        TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kotliar_files_page_idx
  ON kotliar_files (page_id, created_at);
