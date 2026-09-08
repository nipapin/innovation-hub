import { readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export function readConnectionConfig() {
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
      "Set PGUSER/PGPASSWORD/PGHOST/PGPORT/PGDATABASE or DB_CONNECTION_STRING.",
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

function isLocalPgHost(host) {
  const h = String(host || "").trim().toLowerCase()
  return h === "localhost" || h === "127.0.0.1" || h === "::1"
}

function sslModeFromConnectionString() {
  const cs = process.env.DB_CONNECTION_STRING
  if (!cs) return null
  try {
    return new URL(cs).searchParams.get("sslmode")
  } catch {
    return null
  }
}

function readCaFromEnv() {
  const raw = process.env.PGSSL_CA ?? process.env.DATABASE_SSL_CA
  if (!raw?.trim()) return undefined
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw
}

/**
 * @param {string} [host]
 * @returns {import('pg').ClientConfig['ssl'] | undefined}
 */
export function resolvePgSsl(host) {
  const local = isLocalPgHost(
    host ?? process.env.PGHOST ?? (() => {
      try {
        return process.env.DB_CONNECTION_STRING
          ? new URL(process.env.DB_CONNECTION_STRING).hostname
          : ""
      } catch {
        return ""
      }
    })(),
  )
  const fromUrl = sslModeFromConnectionString()
  const mode =
    process.env.PGSSLMODE ??
    fromUrl ??
    (!local && process.env.VERCEL ? "require" : undefined)

  if (mode === "disable" || process.env.DATABASE_SSL === "false") {
    return undefined
  }

  if (mode === "no-verify" || process.env.PGSSL_NO_VERIFY === "1") {
    return { rejectUnauthorized: false }
  }

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

  let certPath
  if (explicitPath) {
    certPath = explicitPath
  } else if (!local && existsSync(defaultCloudPath)) {
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

/**
 * Режим TLS для консольных утилит libpq (`pg_dump`, `psql`).
 *
 * `resolvePgSsl` отвечает драйверу `pg`, а у libpq словарь другой: `no-verify`
 * там невалиден, и утилита падает с «invalid sslmode value». Наш `no-verify`
 * означает «шифровать, но не проверять сертификат» — у libpq это `require`,
 * ровно оно и нужно для самоподписанного сертификата провайдера.
 */
export function libpqSslMode(host) {
  if (!resolvePgSsl(host)) return "disable"
  const mode = process.env.PGSSLMODE?.trim().toLowerCase()
  const known = ["allow", "prefer", "require", "verify-ca", "verify-full"]
  return mode && known.includes(mode) ? mode : "require"
}
