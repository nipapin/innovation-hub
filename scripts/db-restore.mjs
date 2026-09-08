import "dotenv/config"
import { spawn } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { Client } from "pg"
import { createReadStream } from "node:fs"
import { createGunzip } from "node:zlib"
import { libpqSslMode, readConnectionConfig, resolvePgSsl } from "./pg-connection.mjs"

// Restores a dump into the database configured via PG* env vars or
// DB_CONNECTION_STRING.
//
// Usage:
//   node scripts/db-restore.mjs <path-to-dump.sql[.gz]> [--yes]
//
// Without --yes it only shows the target and current contents (dry run).
//
// ── Два формата, два пути исполнения (проверено 2026-09-08)
//
// Дамп Adminer — это чистый SQL, и он проигрывается драйвером в одной
// транзакции: упало на середине — база не тронута.
//
// Дамп `pg_dump` так проиграть НЕЛЬЗЯ, и это выяснилось на живой проверке:
// начиная с PostgreSQL 18 он начинается с мета-команды `\restrict`, а данные
// едут блоками `COPY ... FROM stdin`. Ни то, ни другое не SQL — драйвер падает
// с `syntax error at or near "\"` на пятой строке. Такой дамп исполняет `psql`,
// он единственный понимает мета-команды и copy-in.
//
// Поэтому формат определяется по содержимому, а не по расширению, и pg_dump
// уходит в `psql -v ON_ERROR_STOP=1 --single-transaction` — та же гарантия
// «упало значит не тронуло», только чужими руками.

const args = process.argv.slice(2)
const confirmed = args.includes("--yes")
const dumpPath = args.find((a) => !a.startsWith("--"))

if (!dumpPath) {
  console.error("Usage: node scripts/db-restore.mjs <path-to-dump.sql> [--yes]")
  process.exit(1)
}

const isGzip = /\.gz$/i.test(dumpPath)

/**
 * Формат определяется по содержимому. Расширение врёт: `.sql` бывает и у того,
 * и у другого, а цена ошибки — падение на середине восстановления.
 */
function looksLikePgDump(text) {
  return /^\\restrict\b/m.test(text) || /^COPY .* FROM stdin;/m.test(text)
}

function readDumpHead() {
  if (isGzip) return null
  return readFileSync(dumpPath, "utf8")
}

const dumpSql = readDumpHead()

let config
try {
  config = readConnectionConfig()
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}

const client = new Client({ ...config, ssl: resolvePgSsl() })

async function printTableCounts(label) {
  const { rows: tables } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  )
  console.log(label)
  if (tables.length === 0) {
    console.log("  (no tables)")
    return
  }
  for (const t of tables) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM "${t.table_name}"`,
    )
    console.log(`  ${t.table_name}: ${rows[0].n}`)
  }
}

/**
 * Проиграть дамп через `psql`.
 *
 * Схема сносится не отдельным запросом, а первой строкой того же потока:
 * `--single-transaction` заворачивает ВСЁ, что пришло на stdin, в одну
 * транзакцию. Снеси мы схему драйвером заранее — при падении psql база
 * осталась бы пустой, то есть ровно в том состоянии, от которого этот скрипт
 * и должен защищать.
 */
function restoreWithPsql() {
  const env = {
    ...process.env,
    PGPASSWORD: config.password,
    PGSSLMODE: libpqSslMode(config.host),
  }
  const args = [
    "--single-transaction",
    "-v", "ON_ERROR_STOP=1",
    "-q",
    "--host", config.host,
    "--port", String(config.port),
    "--username", config.user,
    "--dbname", config.database,
  ]

  return new Promise((resolve, reject) => {
    const child = spawn("psql", args, { env, stdio: ["pipe", "inherit", "pipe"] })
    let stderr = ""
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
      process.stderr.write(chunk)
    })
    child.on("error", (error) => {
      reject(
        error.code === "ENOENT"
          ? new Error(
              "psql не найден. Дамп pg_dump проигрывается только им: " +
                "`apt install postgresql-client` на сервере, `brew install libpq` на macOS.",
            )
          : error,
      )
    })
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`psql вышел с кодом ${code}.\n${stderr.trim()}`))
    })

    child.stdin.write("DROP SCHEMA public CASCADE;\nCREATE SCHEMA public;\n")
    const file = createReadStream(dumpPath)
    const stream = isGzip ? file.pipe(createGunzip()) : file
    stream.on("error", reject)
    stream.pipe(child.stdin)
  })
}

async function main() {
  await client.connect()
  console.log(`Target: ${config.user}@${config.host}:${config.port}/${config.database}`)

  const viaPsql = isGzip || looksLikePgDump(dumpSql ?? "")
  const size = statSync(dumpPath).size
  console.log(
    `Dump:   ${dumpPath} (${Math.round(size / 1024)} KB, ` +
      `${viaPsql ? "формат pg_dump → psql" : "чистый SQL → драйвер"})\n`,
  )

  await printTableCounts("Current contents (will be REPLACED):")

  if (!confirmed) {
    console.log(
      "\nDry run. Re-run with --yes to drop the public schema and restore the dump.",
    )
    return
  }

  console.log("\nRestoring...")

  if (viaPsql) {
    await restoreWithPsql()
  } else {
    await client.query("BEGIN")
    try {
      await client.query("DROP SCHEMA public CASCADE")
      await client.query("CREATE SCHEMA public")
      await client.query(dumpSql)
      await client.query("COMMIT")
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {})
      throw e
    }
  }

  console.log("Restore complete.\n")
  await printTableCounts("New contents:")
}

main()
  .then(async () => {
    await client.end()
  })
  .catch(async (error) => {
    console.error(error)
    await client.end().catch(() => {})
    process.exit(1)
  })
