/**
 * Пересобирает docs/DB_SCHEMA.html из живой базы.
 *
 * Только чтение: скрипт ходит в pg_catalog и pg_stat_*, ничего не меняет.
 * Схема и миграции остаются источником правды для DDL — эта страница показывает
 * то, что на сервере получилось на самом деле, включая размеры и статистику
 * обращений к индексам, которых в SQL-файлах нет.
 *
 * Вёрстка и описания таблиц живут в scripts/lib/db-schema-template.html:
 * скрипт подставляет туда JSON и больше ничего о разметке не знает. Новая
 * таблица без описания попадёт в область «Без области» — это сигнал дописать
 * её в шаблон, а не молчаливая пропажа.
 *
 *   npm run db:schema-doc
 */
import "dotenv/config"
import { Client } from "pg"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readConnectionConfig, resolvePgSsl } from "./pg-connection.mjs"

/** Один Client не умеет параллельные запросы — гоняем по очереди. */
const sequential = async (thunks) => {
  const out = []
  for (const thunk of thunks) out.push(await thunk())
  return out
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const TEMPLATE = join(ROOT, "scripts", "lib", "db-schema-template.html")
const OUTPUT = join(ROOT, "docs", "DB_SCHEMA.html")

/** Что ограничивает рост таблицы — то, чего из статистики не видно. */
const GROWTH_LIMITS = {
  storage_changes: "ничем: журнал пишется вечно",
  visitor_events: "ничем: нет ретеншена",
  project_files: "числом файлов в проектах",
  storage_snapshots: "проект × день",
  admin_audit_log: "активностью админов",
  tasks: "payload jsonb, уходит в TOAST",
  processing_stats: "числом обработок",
  project_chat_messages: "перепиской по проектам",
}

/** Колонка со временем создания — по ней меряется темп прироста. */
const GROWTH_CLOCK = {
  visitor_events: "created_at",
  storage_changes: "created_at",
  project_files: "created_at",
  storage_snapshots: "taken_at",
  tasks: "created_at",
  processing_stats: "imported_at",
  project_chat_messages: "created_at",
  admin_audit_log: "created_at",
}

const shortType = (t) =>
  t
    .replace("timestamp with time zone", "timestamptz")
    .replace("character varying", "varchar")
    .replace("double precision", "float8")
    .replace(/^boolean$/, "bool")

const shortDefault = (v) => {
  if (!v) return null
  if (/^nextval/.test(v)) return "serial"
  return v.replace(/::[a-z ]+(\[\])?/g, "")
}

async function main() {
  const client = new Client({ ...readConnectionConfig(), ssl: resolvePgSsl() })
  await client.connect()

  const q = (sql) => () => client.query(sql)
  const [cols, cons, idx, sizes, settings, version, dbSize, files, idxStats, io] = await sequential([
      q(`
        SELECT c.relname AS table_name, a.attname AS column_name,
               format_type(a.atttypid, a.atttypmod) AS data_type,
               a.attnotnull AS not_null,
               pg_get_expr(d.adbin, d.adrelid) AS default_expr
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
         WHERE n.nspname = 'public' AND c.relkind = 'r'
         ORDER BY c.relname, a.attnum`),
      q(`
        SELECT con.contype, cl.relname AS table_name, pg_get_constraintdef(con.oid) AS def
          FROM pg_constraint con
          JOIN pg_class cl ON cl.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = cl.relnamespace
         WHERE n.nspname = 'public'`),
      q(`SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public'`),
      q(`
        SELECT c.relname AS table_name,
               pg_total_relation_size(c.oid) AS total_bytes,
               (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid) AS index_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'
         ORDER BY pg_total_relation_size(c.oid) DESC`),
      q(`
        SELECT name, setting, unit FROM pg_settings
         WHERE name IN ('data_directory','block_size','segment_size','shared_buffers',
                        'work_mem','effective_cache_size','max_connections','wal_segment_size')`),
      q(`SELECT current_setting('server_version') AS v`),
      q(`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`),
      q(`
        SELECT c.relname, pg_relation_filepath(c.oid) AS filepath,
               pg_relation_size(c.oid) AS heap_bytes,
               pg_total_relation_size(c.oid) - pg_relation_size(c.oid)
                 - COALESCE(pg_total_relation_size(c.reltoastrelid), 0) AS index_bytes,
               (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid) AS index_count,
               t.relname AS toast_table
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_class t ON t.oid = c.reltoastrelid
         WHERE n.nspname = 'public' AND c.relkind = 'r'
         ORDER BY pg_relation_size(c.oid) DESC LIMIT 1`),
      q(`
        SELECT relname, indexrelname, idx_scan, pg_relation_size(indexrelid) AS bytes
          FROM pg_stat_user_indexes WHERE idx_scan = 0
         ORDER BY pg_relation_size(indexrelid) DESC`),
      q(`SELECT sum(heap_blks_read) AS read, sum(heap_blks_hit) AS hit FROM pg_statio_user_tables`),
  ])

  const setting = (name) => settings.rows.find((r) => r.name === name)
  const mb = (bytes) =>
    bytes >= 1073741824 ? `${+(bytes / 1073741824).toFixed(1)} ГБ` : `${Math.round(bytes / 1048576)} МБ`
  const pretty = (name) => {
    const s = setting(name)
    if (!s) return "?"
    const n = Number(s.setting)
    if (s.unit === "8kB") return mb(n * 8192)
    if (s.unit === "kB") return mb(n * 1024)
    if (s.unit === "B") return mb(n)
    return s.setting
  }

  // ---- колонки, ключи, ограничения ----
  const byTable = {}
  for (const c of cols.rows) (byTable[c.table_name] ||= []).push(c)

  const pk = {}, fk = {}, uniq = {}, enums = {}, tableChecks = {}
  for (const c of cons.rows) {
    const t = c.table_name
    if (c.contype === "p") {
      const m = c.def.match(/PRIMARY KEY \(([^)]+)\)/)
      if (m) pk[t] = new Set(m[1].split(",").map((s) => s.trim()))
    } else if (c.contype === "f") {
      const m = c.def.match(/FOREIGN KEY \(([^)]+)\) REFERENCES ([a-z_]+)\(([^)]+)\)(.*)$/)
      if (m) {
        const od = /ON DELETE (CASCADE|SET NULL|RESTRICT)/.exec(m[4])
        ;((fk[t] ||= {}))[m[1].trim()] = {
          table: m[2],
          col: m[3].trim(),
          onDelete: od ? od[1] : "NO ACTION",
        }
      }
    } else if (c.contype === "u") {
      const m = c.def.match(/UNIQUE \(([^)]+)\)/)
      const list = m ? m[1].split(",").map((s) => s.trim()) : []
      if (list.length === 1) (uniq[t] ||= new Set()).add(list[0])
    } else if (c.contype === "c") {
      const en = c.def.match(/\(?([a-z_]+) = ANY \(ARRAY\[(.+?)\]\)\)?/)
      if (en) ((enums[t] ||= {}))[en[1]] = [...en[2].matchAll(/'([^']*)'/g)].map((x) => x[1])
      else (tableChecks[t] ||= []).push(c.def.replace(/^CHECK /, "").replace(/::[a-z ]+/g, ""))
    }
  }
  for (const i of idx.rows) {
    const m = i.indexdef.match(/CREATE UNIQUE INDEX .* ON public\.([a-z_]+) USING btree \(([a-z_]+)\)\s*$/)
    if (m) (uniq[m[1]] ||= new Set()).add(m[2])
  }

  const meta = new Map(sizes.rows.map((r) => [r.table_name, r]))
  const tables = {}
  for (const name of Object.keys(byTable).sort()) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM public."${name}"`)
    tables[name] = {
      rows: rows[0].n,
      bytes: Number(meta.get(name).total_bytes),
      indexes: Number(meta.get(name).index_count),
      checks: tableChecks[name] || [],
      cols: byTable[name].map((c) => ({
        n: c.column_name,
        t: shortType(c.data_type),
        nn: c.not_null,
        d: shortDefault(c.default_expr),
        pk: (pk[name] || new Set()).has(c.column_name),
        u: (uniq[name] || new Set()).has(c.column_name),
        fk: (fk[name] || {})[c.column_name] || null,
        enum: (enums[name] || {})[c.column_name] || null,
      })),
    }
  }

  // ---- темп прироста ----
  const growth = []
  for (const [table, clock] of Object.entries(GROWTH_CLOCK)) {
    if (!tables[table] || !tables[table].rows) continue
    const { rows } = await client.query(`
      SELECT count(*)::int AS n,
             GREATEST(EXTRACT(epoch FROM (max(${clock}) - min(${clock}))) / 86400, 1) AS days
        FROM public."${table}"`)
    const { n, days } = rows[0]
    const perDay = n / Number(days)
    const bytesPerRow = Math.round(tables[table].bytes / n)
    growth.push({
      table,
      days: Math.round(Number(days)),
      perDay,
      bytesPerRow,
      fiveYearBytes: Math.round(perDay * 365 * 5 * bytesPerRow),
      limit: GROWTH_LIMITS[table] || "",
    })
  }
  growth.sort((a, b) => b.perDay - a.perDay)

  const applied = await client
    .query(`SELECT count(*)::int AS n FROM schema_migrations`)
    .then((r) => r.rows[0].n)
    .catch(() => 0)

  const sample = files.rows[0]
  const filepath = sample.filepath || "base/?/?"
  const hit = Number(io.rows[0].hit || 0)
  const read = Number(io.rows[0].read || 0)
  const now = new Date()

  const payload = {
    meta: {
      server: `PostgreSQL ${version.rows[0].v.split(" ")[0]}`,
      host: readConnectionConfig().host,
      database: readConnectionConfig().database,
      takenAt: now.toISOString().slice(0, 10),
      takenAtHuman: now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }),
      // data_directory читается только суперпользователем — иначе стандартный путь Debian/Ubuntu
      dataDirectory: `${
        setting("data_directory")?.setting ||
        `/var/lib/postgresql/${version.rows[0].v.split(".")[0]}/main`
      }/`,
      dbSize: dbSize.rows[0].s.replace("kB", "КБ").replace("MB", "МБ").replace("GB", "ГБ"),
      blockSize: `${Number(setting("block_size").setting) / 1024} КБ`,
      segmentSize: `${(Number(setting("segment_size").setting) * 8192) / 1073741824} ГБ`,
      walSegment: `${Number(setting("wal_segment_size").setting) / 1048576} МБ`,
      sharedBuffers: pretty("shared_buffers"),
      workMem: pretty("work_mem"),
      effectiveCacheSize: pretty("effective_cache_size"),
      maxConnections: Number(setting("max_connections").setting),
      cacheHit: hit + read ? +((hit / (hit + read)) * 100).toFixed(1) : "—",
      migrations: applied,
      // грубо: на таблицу приходятся heap + fsm + vm + toast и по файлу на индекс
      fileCount:
        sizes.rows.reduce((a, r) => a + Number(r.index_count) + 4, 0) -
        (Number(sample.index_count) + 4),
      sample: {
        table: sample.relname,
        dir: `${filepath.split("/").slice(0, -1).join("/")}/`,
        node: filepath.split("/").pop(),
        heapBytes: Number(sample.heap_bytes),
        indexBytes: Number(sample.index_bytes),
        indexes: Number(sample.index_count),
        toast: sample.toast_table || "pg_toast_…",
      },
    },
    totals: {
      tables: Object.keys(tables).length,
      rows: Object.values(tables).reduce((a, t) => a + t.rows, 0),
      bytes: sizes.rows.reduce((a, r) => a + Number(r.total_bytes), 0),
      fks: cons.rows.filter((c) => c.contype === "f").length,
      indexes: idx.rows.length,
    },
    growth,
    // Первичные ключи и индексы на почти пустых таблицах отбрасываем: ноль
    // обращений там ничего не доказывает, а список превращается в шум.
    unusedIndexes: idxStats.rows
      .filter(
        (r) =>
          !/_pkey$/.test(r.indexrelname) &&
          Number(r.bytes) >= 24576 &&
          (tables[r.relname]?.rows || 0) >= 100,
      )
      .map((r) => ({ table: r.relname, index: r.indexrelname, bytes: Number(r.bytes) })),
    tables,
  }

  const html = readFileSync(TEMPLATE, "utf8").replace(
    "__DATA__",
    JSON.stringify(payload).replace(/<\//g, "<\\/"),
  )
  writeFileSync(OUTPUT, html)

  await client.end()
  console.log(
    `docs/DB_SCHEMA.html — ${payload.totals.tables} таблиц, ${payload.totals.rows} строк, ` +
      `${payload.totals.fks} связей, ${payload.totals.indexes} индексов`,
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
