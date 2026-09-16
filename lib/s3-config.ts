export function getS3Bucket(): string {
  const bucket = process.env.AWS_S3_BUCKET
  if (!bucket) throw new Error("AWS_S3_BUCKET is not set")
  return bucket
}

function safeSegment(value: string, label: string): string {
  const segment = value.trim()
  if (!segment || segment.includes("/") || segment.includes("\\") || segment === "." || segment === "..") {
    throw new Error(`${label} must be a single non-empty key segment.`)
  }
  return segment
}

/**
 * Корень проекта в хранилище: `projects/{storageOwnerId}/{projectId}/`.
 *
 * Первый сегмент — `projects.storage_owner_id`, а НЕ текущий владелец: у
 * переданного другому человеку проекта они расходятся, и ключи остаются на
 * месте (docs/ADMIN_WORKSPACE_PLAN.md §5). Передавать сюда `ownerId` нельзя —
 * у такого проекта получится ключ, по которому ничего не лежит.
 */
export function projectObjectPrefix(
  storageOwnerId: string,
  projectId: string,
): string {
  return `projects/${safeSegment(storageOwnerId, "Storage owner ID")}/${safeSegment(projectId, "Project ID")}/`
}

export function userMetaObjectKey(userId: string): string {
  return `projects/${safeSegment(userId, "User ID")}/user-meta.json`
}

export function buildProjectObjectKey(
  storageOwnerId: string,
  projectId: string,
  relativePath: string,
): string {
  const relative = relativePath.replace(/^\/+/, "").replace(/\.\./g, "_")
  return `${projectObjectPrefix(storageOwnerId, projectId)}${relative}`
}

/**
 * Builds a non-project object key at the bucket root. Project objects must use
 * `buildProjectObjectKey`, so they are always isolated by user and project.
 */
export function buildS3ObjectKey(relativePath: string): string {
  return relativePath.replace(/^\/+/, "").replace(/\.\./g, "_")
}

/**
 * Supports the new `projects/{userId}/{projectId}/…` layout plus legacy app-owned keys
 * while R2 migration is in progress. Access to project keys is authorized
 * separately by the media route.
 */
export function isAllowedMediaObjectKey(key: string): boolean {
  const segments = key.split("/")
  if (
    segments.length >= 4 &&
    segments[0] === "projects" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      segments[1] ?? "",
    ) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      segments[2] ?? "",
    )
  ) {
    return true
  }
  return (
    key.startsWith("admin/") ||
    key.startsWith("feature-suggestions/") ||
    // Логотипы компаний (docs/THEMING_PLAN.md §6.1). Открыты без сессии
    // осознанно: логотип рисуется на СТРАНИЦЕ ВХОДА, когда компания определена
    // по домену, — то есть его обязан увидеть тот, кто ещё не вошёл. Это тот же
    // класс, что `admin/`: публичное оформление, а не чужие файлы.
    key.startsWith("companies/") ||
    key.startsWith("innohub/") ||
    key.startsWith("ffworks/")
  )
}

function joinUrlBase(base: string, key: string): string {
  const b = base.replace(/\/+$/, "")
  const k = key.split("/").map(encodeURIComponent).join("/")
  return `${b}/${k}`
}

export function appMediaProxyPathForKey(key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/")
  return `/api/media/${encoded}`
}

const LEGACY_STORAGE_HOST_SUFFIXES = [
  "twcstorage.ru",
  "amazonaws.com",
  "r2.cloudflarestorage.com",
]

function decodeKeyPath(keyPath: string): string {
  return keyPath
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join("/")
}

function isLegacyStorageHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return LEGACY_STORAGE_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  )
}

/**
 * Path-style object URL: https://endpoint/bucket/key…
 * Returns the object key, or null when the path is not bucket/key.
 */
function keyFromPathStyleUrl(
  mediaUrl: URL,
  preferredBucket?: string,
): string | null {
  const segments = mediaUrl.pathname.split("/").filter(Boolean)
  if (segments.length < 2) return null

  const [bucketSegment, ...keySegments] = segments
  if (preferredBucket && bucketSegment !== preferredBucket) {
    // Still accept foreign bucket names from legacy hosts — the key is what
    // we store under /api/media and look up in the *current* bucket.
  }
  void bucketSegment
  const key = decodeKeyPath(keySegments.join("/"))
  return key || null
}

/**
 * Converts stored media URLs to a stable same-origin app path when possible.
 * Fixes absolute localhost / wrong-host `/api/media/...` URLs left in the DB
 * after local uploads, and maps private object-storage URLs back through the
 * app proxy (including older absolute object-storage hosts after a migration).
 */
export function normalizeMediaDisplayUrl(rawUrl: string): string {
  const value = rawUrl.trim()
  if (!value) return value
  if (value.startsWith("/api/media/")) {
    return value
  }

  try {
    const mediaUrl = new URL(value)
    // Absolute app-proxy links (e.g. https://localhost:3000/api/media/...) must
    // become relative so they work on any host (prod included).
    if (mediaUrl.pathname.startsWith("/api/media/")) {
      return `${mediaUrl.pathname}${mediaUrl.search}`
    }

    const endpoint = process.env.AWS_ENDPOINT_URL?.trim().replace(/\/+$/, "")
    const bucket = process.env.AWS_S3_BUCKET?.trim()
    const publicBase = process.env.NEXT_PUBLIC_S3_PUBLIC_BASE_URL?.trim()

    let matchesConfiguredHost = false
    if (endpoint) {
      try {
        const endpointUrl = new URL(endpoint)
        matchesConfiguredHost =
          endpointUrl.protocol === mediaUrl.protocol &&
          endpointUrl.host === mediaUrl.host
      } catch {
        matchesConfiguredHost = false
      }
    }
    if (publicBase) {
      try {
        const publicUrl = new URL(publicBase)
        if (
          publicUrl.protocol === mediaUrl.protocol &&
          publicUrl.host === mediaUrl.host
        ) {
          matchesConfiguredHost = true
        }
      } catch {
        // ignore malformed public base
      }
    }

    if (!matchesConfiguredHost && !isLegacyStorageHost(mediaUrl.hostname)) {
      return value
    }

    // Prefer path-style /{bucket}/{key}. For CDN bases that already include
    // the bucket, fall back to the whole pathname as the key.
    const pathKey = keyFromPathStyleUrl(mediaUrl, bucket)
    if (pathKey) {
      return appMediaProxyPathForKey(pathKey)
    }

    const rawPathKey = decodeKeyPath(mediaUrl.pathname)
    if (rawPathKey) {
      return appMediaProxyPathForKey(rawPathKey)
    }

    return value
  } catch {
    return value
  }
}

/**
 * Public URL for an object when you serve or proxy the bucket at a fixed HTTPS base.
 * Set `NEXT_PUBLIC_S3_PUBLIC_BASE_URL` (no trailing slash), e.g. CDN or static website endpoint.
 *
 * ВТОРАЯ ПЕРЕМЕННАЯ — ЗАСЛОН, А НЕ БЮРОКРАТИЯ.
 *
 * «Базовый адрес задан» и «по этому адресу что-то отдаётся» — разные вещи, а
 * проверить второе неоткуда: код узнаёт об этом не при настройке, а недели
 * спустя, битой картинкой у первого, кто откроет страницу. Записанный в базу
 * мёртвый адрес переживает починку CDN — чинить придётся и данные.
 *
 * Так и случилось: `NEXT_PUBLIC_S3_PUBLIC_BASE_URL` стоял, CDN отвечал 403 на
 * всё, и первая же новая загрузка записала недоступный адрес. До этого никто не
 * замечал, потому что весь прежний контент заливался раньше, чем переменную
 * добавили.
 *
 * Поэтому адрес отдаётся только когда раздачу ПОДТВЕРДИЛИ явно:
 *
 *     NEXT_PUBLIC_S3_PUBLIC_BASE_URL=https://cdn.example.com
 *     S3_PUBLIC_BASE_CONFIRMED=1     # проверено: объект по этому адресу открывается
 *
 * Без подтверждения все вызывающие уходят на `/api/media/…` — он работает по
 * построению, потому что ходит в тот же бакет, куда мы пишем.
 *
 * ПЕРЕД ТЕМ КАК ПОДТВЕРЖДАТЬ — ПРОВЕРЬТЕ, ЧЕЙ ЭТО БАКЕТ.
 *
 * Публичный домен на бакете открывает его ЦЕЛИКОМ, а не те папки, ссылки на
 * которые строит этот код. В одном бакете с `admin/` и `companies/` лежит
 * `projects/` — рабочие материалы клиентов, которые сегодня отдаются только
 * через `/api/media/…`, и тот на каждый запрос проверяет сессию и
 * `projects.access`. Подтверждение раздачи снимет эту проверку со всего бакета
 * разом: кто узнал ключ, тот качает, бессрочно и без входа.
 *
 * Поэтому CDN включается не подтверждением, а сначала РАЗДЕЛЕНИЕМ бакетов:
 * публичное оформление — в отдельный, материалы проектов — в закрытый.
 *
 * Состояние на 2026-09-14: `cdn.ffworks.pro` указывает на прежнее хранилище
 * (Timeweb), зона домена обслуживается не Cloudflare, а привязка своего домена
 * к бакету R2 требует и того, и другого. То есть подтверждать сейчас нечего —
 * по этому адресу не отдаётся ничего.
 */
export function publicObjectUrlForKey(key: string): string | null {
  const base = process.env.NEXT_PUBLIC_S3_PUBLIC_BASE_URL?.trim()
  if (!base) return null

  const confirmed = process.env.S3_PUBLIC_BASE_CONFIRMED?.trim()
  if (confirmed !== "1" && confirmed !== "true") return null

  return joinUrlBase(base, key)
}
