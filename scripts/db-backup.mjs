import "dotenv/config"
import { spawn } from "node:child_process"
import { createReadStream, createWriteStream, statSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { createGzip } from "node:zlib"
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { libpqSslMode, readConnectionConfig } from "./pg-connection.mjs"

// Снимает дамп базы и кладёт его в R2 поколениями.
//
//   node scripts/db-backup.mjs              — снять, залить, почистить старые
//   node scripts/db-backup.mjs --out d.sql.gz — снять в локальный файл, без R2
//   node scripts/db-backup.mjs --keep 30    — держать 30 дней вместо 14
//   node scripts/db-backup.mjs --check      — что лежит в R2 и не устарело ли
//
// ── Почему так, а не иначе
//
// НЕ копия файлов базы. Файлы Postgres меняются во время копирования, и копия
// «на живую» выходит битой. `pg_dump` читает согласованным снимком и пишет
// текст команд — снимать можно на работающей базе.
//
// НЕ один перезаписываемый файл. Испорченные данные, замеченные через сутки,
// затёрли бы единственную копию собой. Поэтому файл на запуск, с датой в имени,
// и чистка по возрасту.
//
// СНАЧАЛА во временный файл, потом в R2. Заливать поток прямо из pg_dump
// заманчиво, но упади он на середине — в хранилище останется обрезанный объект,
// выглядящий как нормальная копия. Проверяем код возврата и размер, и только
// потом заливаем.
//
// Дамп содержит ШИФРОТЕКСТ сейфа, а не секреты: ключ живёт в VAULT_MASTER_KEY,
// в окружении. Значит сам по себе дамп не утечка — но и восстановить по нему
// секреты без того же ключа нельзя. Ключ хранится отдельно и НЕ рядом с дампами.

const args = process.argv.slice(2)
const checkOnly = args.includes("--check")
const outPath = valueOf("--out")
const keepDays = Number(valueOf("--keep") ?? "14")
const PREFIX = "system/db-backups/"
const MIN_DUMP_BYTES = 4096
/** Старше этого — считаем, что расписание сломалось. Сутки плюс запас. */
const STALE_HOURS = 30

function valueOf(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

/** `2026-09-08T14-32` — сортируется как строка, читается человеком. */
function stamp() {
  return new Date().toISOString().slice(0, 16).replace(":", "-")
}

function runPgDump(config, targetPath) {
  // --no-owner / --no-privileges: у провайдера свой владелец ролей, и при
  // восстановлении в другую базу чужие GRANT'ы только мешают.
  const dumpArgs = [
    "--no-owner",
    "--no-privileges",
    "--format=plain",
    "--host", config.host,
    "--port", String(config.port),
    "--username", config.user,
    "--dbname", config.database,
  ]

  const env = { ...process.env, PGPASSWORD: config.password, PGSSLMODE: libpqSslMode(config.host) }

  return new Promise((resolve, reject) => {
    const child = spawn("pg_dump", dumpArgs, { env })
    const gzip = createGzip()
    const out = createWriteStream(targetPath)
    let stderr = ""

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (error) => {
      reject(
        error.code === "ENOENT"
          ? new Error(
              "pg_dump не найден. Поставьте клиент Postgres: на сервере это " +
                "`apt install postgresql-client`, на macOS — `brew install libpq`.",
            )
          : error,
      )
    })
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`pg_dump вышел с кодом ${code}.\n${stderr.trim()}`))
    })

    pipeline(child.stdout, gzip, out).catch(reject)
  })
}

function s3Client() {
  const bucket = process.env.AWS_S3_BUCKET
  if (!bucket) fail("AWS_S3_BUCKET не задан.")

  const accessKeyId =
    process.env.S3_KEY_ID ?? process.env.AWS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? ""
  const secretAccessKey =
    process.env.S3_SECRET_KEY ?? process.env.AWS_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? ""
  if (!accessKeyId || !secretAccessKey) {
    fail("Нет ключей S3: задайте S3_KEY_ID и S3_SECRET_KEY.")
  }

  const endpoint = process.env.AWS_ENDPOINT_URL?.trim()
  if (endpoint && /twcstorage\.ru/i.test(endpoint)) {
    fail(
      "AWS_ENDPOINT_URL смотрит на Timeweb. Копия базы не должна лежать у того же " +
        "провайдера, что и сама база — используйте endpoint Cloudflare R2.",
    )
  }

  return {
    bucket,
    client: new S3Client({
      region: process.env.AWS_REGION?.trim() || "auto",
      endpoint: endpoint || undefined,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
  }
}

/** Чистка по возрасту. Удаляем только свой префикс и только старое. */
async function rotate(client, bucket, days) {
  if (!Number.isFinite(days) || days <= 0) return 0
  const edge = Date.now() - days * 24 * 60 * 60 * 1000
  const stale = []
  let token

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: PREFIX,
        ContinuationToken: token,
      }),
    )
    for (const object of page.Contents ?? []) {
      if (object.LastModified && object.LastModified.getTime() < edge) {
        stale.push({ Key: object.Key })
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)

  for (let i = 0; i < stale.length; i += 1000) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: stale.slice(i, i + 1000) },
      }),
    )
  }
  return stale.length
}

/**
 * Что лежит в хранилище и насколько свежее.
 *
 * Нужен потому, что упавший cron выглядит ровно как отработавший: вывода нет в
 * обоих случаях, а лог никто не читает. Выход ненулевой, если свежей копии нет
 * — значит команду можно повесить на любое оповещение, не переписывая её.
 */
async function check() {
  const { client, bucket } = s3Client()
  const found = []
  let token
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX, ContinuationToken: token }),
    )
    for (const object of page.Contents ?? []) found.push(object)
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)

  if (found.length === 0) {
    console.error(`Копий нет вовсе: в ${bucket}/${PREFIX} пусто.`)
    process.exit(1)
  }

  found.sort((a, b) => b.LastModified - a.LastModified)
  const newest = found[0]
  const ageHours = (Date.now() - newest.LastModified.getTime()) / 3600000
  const total = found.reduce((sum, o) => sum + Number(o.Size ?? 0), 0)

  console.log(`копий          : ${found.length}`)
  console.log(`суммарно       : ${(total / 1024 / 1024).toFixed(1)} МБ`)
  console.log(`самая свежая   : ${newest.Key.slice(PREFIX.length)}`)
  console.log(`снята          : ${ageHours.toFixed(1)} ч назад`)
  console.log(`размер         : ${(Number(newest.Size ?? 0) / 1024).toFixed(0)} КБ`)

  if (ageHours > STALE_HOURS) {
    console.error(
      `\nСвежей копии нет: последняя старше ${STALE_HOURS} ч. ` +
        `Проверьте расписание (deploy/cron-ffworks) и /var/log/ffworks-db-backup.log.`,
    )
    process.exit(1)
  }
  console.log("\nСвежая копия есть.")
}

async function main() {
  if (checkOnly) return check()

  const config = readConnectionConfig()
  const name = `${stamp()}.sql.gz`
  const localPath = outPath ?? join(tmpdir(), `db-backup-${name}`)

  console.log(`Снимаю дамп базы «${config.database}» → ${localPath}`)
  await runPgDump(config, localPath)

  const size = statSync(localPath).size
  if (size < MIN_DUMP_BYTES) {
    fail(
      `Дамп подозрительно мал (${size} байт). Это почти наверняка обрыв, а не ` +
        `пустая база — не заливаю, чтобы не выдать обрезок за копию.`,
    )
  }
  console.log(`Готово: ${(size / 1024 / 1024).toFixed(1)} МБ`)

  if (outPath) {
    console.log("Ключ VAULT_MASTER_KEY в дамп не входит — сохраните его отдельно.")
    return
  }

  const { client, bucket } = s3Client()
  const key = `${PREFIX}${name}`
  await new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: createReadStream(localPath),
      ContentType: "application/gzip",
    },
  }).done()
  console.log(`Залито: ${key}`)

  unlinkSync(localPath)

  const removed = await rotate(client, bucket, keepDays)
  console.log(
    removed > 0
      ? `Удалено копий старше ${keepDays} дней: ${removed}`
      : `Копий старше ${keepDays} дней нет`,
  )
  console.log(
    "Напоминание: секреты в дампе зашифрованы VAULT_MASTER_KEY, который живёт " +
      "только в .env. Храните его отдельно от дампов.",
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
