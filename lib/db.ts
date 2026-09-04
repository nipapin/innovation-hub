import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

type ConnectionConfig = {
  user: string
  password: string
  host: string
  port: number
  database: string
}

function isLocalPgHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return h === "localhost" || h === "127.0.0.1" || h === "::1"
}

function readEnvConnectionConfig(): ConnectionConfig {
  const direct = {
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
  }

  if (direct.user && direct.password && direct.host && direct.database) {
    return {
      user: direct.user,
      password: direct.password,
      host: direct.host,
      port: Number(direct.port || "5432"),
      database: direct.database,
    }
  }

  const connectionString = process.env.DB_CONNECTION_STRING
  if (!connectionString) {
    throw new Error(
      "Database connection is not configured. Set PGUSER/PGPASSWORD/PGHOST/PGPORT/PGDATABASE or DB_CONNECTION_STRING.",
    )
  }

  const parsed = new URL(connectionString)
  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    host: parsed.hostname,
    port: Number(parsed.port || "5432"),
    database: parsed.pathname.replace(/^\//, ""),
  }
}

function sslModeFromConnectionString(): string | null {
  const cs = process.env.DB_CONNECTION_STRING
  if (!cs) return null
  try {
    return new URL(cs).searchParams.get("sslmode")
  } catch {
    return null
  }
}

/** PEM from Vercel/env (use literal newlines or \\n in the secret). */
function readCaFromEnv(): string | undefined {
  const raw = process.env.PGSSL_CA ?? process.env.DATABASE_SSL_CA
  if (!raw?.trim()) return undefined
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw
}

/**
 * SSL for `pg`:
 * - Opt out first: PGSSLMODE=no-verify / PGSSL_NO_VERIFY=1 (self-signed Timeweb etc.)
 *   or PGSSLMODE=disable / DATABASE_SSL=false. These win over leftover CAs.
 * - Custom CA file: PGSSLROOTCERT or ~/.cloud-certs/root.crt (e.g. Yandex Cloud).
 *   Auto cloud-cert is skipped for localhost / 127.0.0.1 so local Postgres
 *   without TLS does not fail with "server does not support SSL".
 * - Custom CA PEM on Vercel: PGSSL_CA or DATABASE_SSL_CA (paste root bundle).
 * - Encrypted without CA (self-signed chain): PGSSLMODE=require / VERCEL / sslmode=require
 *   uses TLS with rejectUnauthorized:false unless PGSSL_REJECT_UNAUTHORIZED=1 or sslmode=verify-full.
 */
function resolveSsl(host: string): PoolConfig["ssl"] | undefined {
  const local = isLocalPgHost(host)
  const fromUrl = sslModeFromConnectionString()
  const mode =
    process.env.PGSSLMODE ??
    fromUrl ??
    (!local && process.env.VERCEL ? "require" : undefined)

  if (mode === "disable" || process.env.DATABASE_SSL === "false") {
    return undefined
  }

  if (
    mode === "no-verify" ||
    process.env.PGSSL_NO_VERIFY === "1"
  ) {
    return { rejectUnauthorized: false }
  }

  // Local Postgres typically has no TLS. Skip SSL unless explicitly requested.
  if (
    local &&
    process.env.DATABASE_SSL !== "true" &&
    mode !== "require" &&
    mode !== "verify-ca" &&
    mode !== "verify-full"
  ) {
    return undefined
  }

  const explicitPath = process.env.PGSSLROOTCERT
  const defaultCloudPath = join(homedir(), ".cloud-certs", "root.crt")

  let certPath: string | undefined
  if (explicitPath) {
    certPath = explicitPath
  } else if (!local && existsSync(defaultCloudPath)) {
    // Do not auto-apply a cloud CA when talking to local Postgres.
    certPath = defaultCloudPath
  }

  if (certPath) {
    if (!existsSync(certPath)) {
      throw new Error(
        `PostgreSQL root certificate not found at ${certPath} (PGSSLROOTCERT).`,
      )
    }
    return {
      ca: readFileSync(certPath, "utf8"),
      rejectUnauthorized: true,
    }
  }

  const caPem = readCaFromEnv()
  if (caPem) {
    return { ca: caPem, rejectUnauthorized: true }
  }

  const strictVerify =
    process.env.PGSSL_REJECT_UNAUTHORIZED === "1" ||
    process.env.PGSSL_REJECT_UNAUTHORIZED === "true" ||
    mode === "verify-full" ||
    fromUrl === "verify-full"

  if (
    mode === "require" ||
    mode === "verify-ca" ||
    mode === "verify-full" ||
    process.env.DATABASE_SSL === "true"
  ) {
    return { rejectUnauthorized: strictVerify }
  }

  return undefined
}

const config = readEnvConnectionConfig()

/** Remote managed Postgres (e.g. Timeweb twc1.net) often needs >8s to connect from dev machines. */
function defaultConnectionTimeoutMs(host: string): number {
  return isLocalPgHost(host) ? 8_000 : 30_000
}

const globalForPg = globalThis as unknown as { pgPool?: Pool }

/**
 * On serverless (Vercel) each warm container reuses the module instance,
 * so we cache the pool on globalThis to avoid leaking connections across
 * invocations. Keep `max` small: each concurrent container holds its own
 * pool, and the upstream DB has a hard cap on `max_connections`.
 */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const pool: Pool =
  globalForPg.pgPool ??
  new Pool({
    ...config,
    max: readPositiveInt("PG_POOL_MAX", 3),
    idleTimeoutMillis: readPositiveInt("PG_POOL_IDLE_MS", 10_000),
    connectionTimeoutMillis: process.env.PG_POOL_CONN_MS
      ? readPositiveInt("PG_POOL_CONN_MS", 8_000)
      : defaultConnectionTimeoutMs(config.host),
    ssl: resolveSsl(config.host),
  })

globalForPg.pgPool = pool

/**
 * Обработчик ошибок пула. Без него короткий обрыв сети роняет весь процесс.
 *
 * `pg` эмитит `error` на пуле, когда ломается **простаивающий** клиент — база
 * закрыла соединение, сеть мигнула, сервер перезагрузился. Такая ошибка не
 * привязана ни к одному `await`, поэтому без слушателя это unhandled `error`
 * event, а он в Node означает падение процесса целиком.
 *
 * Для этого приложения цена особенно велика: под pm2 живут фоновые циклы
 * (`runner.ts`, `chat-push-poller`), они держат простаивающие соединения между
 * тиками — то есть ровно та ситуация, в которой пул и эмитит error.
 *
 * Гасить ошибку здесь безопасно: сам пул выбрасывает сломанного клиента и на
 * следующий запрос открывает новое соединение. Логируем, чтобы обрывы были видны,
 * а не только их следствия.
 */
pool.on("error", (error) => {
  console.error("[db] простаивающее соединение оборвалось", error)
})

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
) {
  return pool.query<T>(text, params as never[])
}

/**
 * Запрос в переданной транзакции или сам по себе.
 *
 * Нужен там, где одна и та же вставка иногда обязана лечь рядом с соседней
 * (грант тестового периода и работа копирования шаблонов — либо обе, либо ни
 * одной), а иногда живёт отдельно и своей транзакции не заслуживает.
 */
export function queryVia(client?: PoolClient) {
  return <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ) => (client ? client.query<T>(text, params as never[]) : query<T>(text, params))
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
