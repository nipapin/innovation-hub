import "dotenv/config"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import { Client } from "pg"
import { readConnectionConfig, resolvePgSsl } from "./pg-connection.mjs"
import { usersEmailConflictTarget } from "./lib/users-email-conflict.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, "..")
const schemaPath = join(projectRoot, "db", "schema.sql")

let config
try {
  config = readConnectionConfig()
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}

const client = new Client({
  user: config.user,
  password: config.password,
  host: config.host,
  port: config.port,
  database: config.database,
  ssl: resolvePgSsl(),
})

const sampleVideos = [
  {
    title: "The Future of Artificial Intelligence",
    description:
      "Explore how AI is reshaping industries, from healthcare to creative arts. This deep dive covers the latest breakthroughs in machine learning, natural language processing, and autonomous systems that are defining the next era of human-computer interaction.",
    thumbnail:
      "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&h=600&fit=crop",
    videoUrl:
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    duration: "12:34",
    category: "AI",
    sortOrder: 10,
  },
  {
    title: "Designing for the Next Billion Users",
    description:
      "A look at how product design is evolving to meet the needs of emerging markets. Learn about accessibility-first approaches, offline capabilities, and culturally aware interfaces that connect people across the globe.",
    thumbnail:
      "https://images.unsplash.com/photo-1559028012-481c04fa702d?w=600&h=600&fit=crop",
    videoUrl:
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    duration: "8:15",
    category: "Design",
    sortOrder: 20,
  },
  {
    title: "Sustainable Tech: Building a Greener Future",
    description:
      "How the tech industry is tackling climate change through sustainable innovation. From renewable energy-powered data centers to carbon-neutral supply chains, discover the green revolution happening in Silicon Valley and beyond.",
    thumbnail:
      "https://images.unsplash.com/photo-1497435334941-8c899ee9e8e9?w=600&h=600&fit=crop",
    videoUrl:
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    duration: "15:42",
    category: "Sustainability",
    sortOrder: 30,
  },
]

const sampleIdeas = [
  {
    title: "AI-Powered Video Summarization",
    description:
      "Automatically generate concise summaries of long-form video content using machine learning algorithms.",
    category: "AI/ML",
    sortOrder: 10,
  },
  {
    title: "Interactive Video Annotations",
    description:
      "Allow viewers to add timestamps, notes, and collaborative comments directly on video timelines.",
    category: "UX",
    sortOrder: 20,
  },
  {
    title: "Real-time Translation Overlay",
    description:
      "Implement live subtitle translation for multilingual accessibility in video content.",
    category: "Accessibility",
    sortOrder: 30,
  },
]

async function ensureAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD
  const adminFullName = process.env.ADMIN_FULL_NAME ?? "Platform Admin"

  if (!adminEmail || !adminPassword) {
    console.warn("ADMIN_EMAIL/ADMIN_PASSWORD not set; skipping admin upsert.")
    return
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10)
  const id = randomUUID()
  const email = adminEmail.toLowerCase()

  // SUPERADMIN, а не ADMIN: на чистой базе это единственный аккаунт, и с него
  // раздаются роли и права остальным. Заведись он обычным админом — раздать
  // доступ было бы некому, а починить это можно было бы только руками в базе.
  await client.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, 'SUPERADMIN', TRUE)
     ${await usersEmailConflictTarget(client)} DO UPDATE
       SET full_name     = EXCLUDED.full_name,
           password_hash = EXCLUDED.password_hash,
           role          = 'SUPERADMIN',
           is_active     = TRUE,
           updated_at    = NOW()`,
    [id, adminFullName, email, passwordHash],
  )
  console.log(`Superadmin upserted: ${email}`)
}

async function seedVideos() {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM videos`)
  if (rows[0].count > 0) {
    console.log("videos table already has data, skipping seed.")
    return
  }
  for (const v of sampleVideos) {
    await client.query(
      `INSERT INTO videos (
          id, title, description, thumbnail, video_url, duration, category,
          is_published, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        v.title,
        v.description,
        v.thumbnail,
        v.videoUrl,
        v.duration,
        v.category,
        true,
        v.sortOrder,
      ],
    )
  }
  console.log(`Seeded ${sampleVideos.length} videos.`)
}

async function seedIdeas() {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM ideas`)
  if (rows[0].count > 0) {
    console.log("ideas table already has data, skipping seed.")
    return
  }
  for (const i of sampleIdeas) {
    await client.query(
      `INSERT INTO ideas (
          id, title, description, thumbnail, video_url, duration, category,
          is_published, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        i.title,
        i.description,
        "",
        "",
        "",
        i.category,
        true,
        i.sortOrder,
      ],
    )
  }
  console.log(`Seeded ${sampleIdeas.length} ideas.`)
}

async function resetTables() {
  await client.query(`
    DROP TABLE IF EXISTS "Idea"  CASCADE;
    DROP TABLE IF EXISTS "Video" CASCADE;
    DROP TABLE IF EXISTS "User"  CASCADE;
    DROP TABLE IF EXISTS push_subscriptions CASCADE;
    DROP TABLE IF EXISTS project_messages CASCADE;
    DROP TABLE IF EXISTS project_files CASCADE;
    DROP TABLE IF EXISTS project_chat_messages CASCADE;
    DROP TABLE IF EXISTS project_media CASCADE;
    DROP TABLE IF EXISTS projects CASCADE;
    DROP TABLE IF EXISTS ideas   CASCADE;
    DROP TABLE IF EXISTS videos  CASCADE;
    DROP TABLE IF EXISTS users   CASCADE;
  `)
  console.log("Dropped legacy and current tables.")
}

async function main() {
  await client.connect()
  console.log("Connected to PostgreSQL.")

  if (process.argv.includes("--reset")) {
    await resetTables()
  }

  const schema = readFileSync(schemaPath, "utf8")
  await client.query(schema)
  console.log("Schema applied.")

  await ensureAdmin()
  await seedVideos()
  await seedIdeas()
}

main()
  .then(async () => {
    await client.end()
    console.log("Done.")
  })
  .catch(async (error) => {
    console.error(error)
    await client.end().catch(() => {})
    process.exit(1)
  })
