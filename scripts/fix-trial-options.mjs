/**
 * Починка пробных проектов, у которых настройки уехали в «options (2)».
 *
 * Что чинит. Выдача тестового периода ставила проект на паузу ДО копирования, а
 * пауза пишет `options/folderState.json` — и заводит под него папку `options`.
 * Копирование, наткнувшись на занятое имя, разрешало конфликт по общему
 * правилу: заводило `options (2)` и клало настройки шаблона туда. Вдобавок
 * обычная копия кладёт объект под ключ `options/<uuid>-options.json`, а сайт и
 * сборщик задач читают `options.json` по фиксированному адресу
 * `options/options.json`. Итог: проект виден в кабинете и невидим для
 * конвейера — пропускается с причиной `no-options`.
 *
 * Причина устранена в lib/storage/job-runner.ts; этот скрипт приводит в порядок
 * копии, выданные до правки.
 *
 * Что делает: переносит `options.json` и `description.md` на канонические
 * ключи, переносит остальные файлы из «options (2)» в «options» и убирает
 * пустую папку. Строки каталога и объекты в R2 двигаются вместе.
 *
 * Запуск:
 *   node scripts/fix-trial-options.mjs           # только показать план
 *   node scripts/fix-trial-options.mjs --apply   # выполнить
 */
import "dotenv/config"
import { randomUUID } from "node:crypto"
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { Client } from "pg"
import { readConnectionConfig, resolvePgSsl } from "./pg-connection.mjs"

const APPLY = process.argv.includes("--apply")

const bucket = process.env.AWS_S3_BUCKET
if (!bucket) {
  console.error("AWS_S3_BUCKET не задан.")
  process.exit(1)
}
const s3 = new S3Client({
  region: process.env.AWS_REGION?.trim() || "auto",
  endpoint: process.env.AWS_ENDPOINT_URL?.trim() || undefined,
  credentials: {
    accessKeyId: process.env.S3_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey:
      process.env.S3_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "",
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
})

const SIDECARS = new Set(["options.json", "description.md"])

async function moveObject(from, to) {
  if (from === to) return
  await s3.send(
    new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${from}`, Key: to }),
  )
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: from }))
}

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch {
    return false
  }
}

const db = new Client({ ...readConnectionConfig(), ssl: resolvePgSsl() })
await db.connect()

// Проекты, у которых есть папка с именем вида «options (N)».
const broken = await db.query(`
  SELECT DISTINCT p.id, p.name, p.storage_owner_id AS "storageOwnerId", f.name AS folder
    FROM project_files f
    JOIN projects p ON p.id = f.project_id
   WHERE f.is_folder AND f.deleted_at IS NULL AND f.folder_path = ''
     AND f.name ~ '^options \\([0-9]+\\)$'
   ORDER BY p.name`)

if (broken.rows.length === 0) {
  console.log("Проектов с лишней папкой options (N) не найдено.")
  await db.end()
  process.exit(0)
}

for (const project of broken.rows) {
  console.log(`\n=== ${project.name} (${project.id}) — папка «${project.folder}»`)
  const files = await db.query(
    `SELECT id, name, folder_path, s3_key, is_folder
       FROM project_files
      WHERE project_id = $1 AND deleted_at IS NULL
        AND (folder_path = $2 OR folder_path LIKE $2 || '/%')
      ORDER BY is_folder DESC, name`,
    [project.id, project.folder],
  )

  const prefix = `projects/${project.storageOwnerId}/${project.id}`
  for (const file of files.rows) {
    const destFolder = file.folder_path.replace(
      project.folder,
      "options",
    )
    if (file.is_folder) {
      console.log(`  папка   ${file.folder_path}/${file.name} → ${destFolder}/${file.name}`)
      if (APPLY) {
        await db.query(`UPDATE project_files SET folder_path = $2 WHERE id = $1`, [
          file.id,
          destFolder,
        ])
      }
      continue
    }

    const canonical = SIDECARS.has(file.name.toLowerCase())
    const destKey = canonical
      ? `${prefix}/options/${file.name}`
      : `${prefix}/${destFolder}/${randomUUID()}-${file.name}`

    console.log(`  файл    ${file.name}`)
    console.log(`          ${file.s3_key}`)
    console.log(`       →  ${destKey}`)

    if (!APPLY) continue

    if (canonical && (await objectExists(destKey))) {
      console.log("          канонический ключ уже занят — пропускаю")
      continue
    }
    await moveObject(file.s3_key, destKey)
    await db.query(
      `UPDATE project_files SET folder_path = $2, s3_key = $3 WHERE id = $1`,
      [file.id, destFolder, destKey],
    )
  }

  // Пустая «options (N)» больше не нужна.
  const folderRow = await db.query(
    `SELECT id FROM project_files
      WHERE project_id = $1 AND folder_path = '' AND name = $2 AND is_folder`,
    [project.id, project.folder],
  )
  console.log(`  убрать пустую папку «${project.folder}»`)
  if (APPLY && folderRow.rows[0]) {
    await db.query(`UPDATE project_files SET deleted_at = NOW() WHERE id = $1`, [
      folderRow.rows[0].id,
    ])
  }
}

console.log(
  APPLY
    ? "\nГотово. Проверьте проект в кабинете: настройки должны лежать в options."
    : "\nЭто был показ плана. Повторите с --apply, чтобы выполнить.",
)
await db.end()
