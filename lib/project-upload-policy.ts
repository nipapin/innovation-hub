/**
 * Allowed MIME types for workspace (project) uploads — broader than admin
 * content uploads so users can drop text, audio, JSON, etc.
 */
const PROJECT_ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  // Браузер играет их сам, без библиотек, поэтому и превью у них полноценное.
  "audio/mp4",
  "audio/aac",
  "audio/x-m4a",
  "audio/opus",
  "audio/flac",
  "text/plain",
  "text/markdown",
  "text/csv",
  // Субтитры. Без этих двух строк `.srt` и `.vtt` приезжают как
  // `application/octet-stream`, и превью не может отличить их от архива.
  "text/vtt",
  "application/x-subrip",
  "application/json",
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
])

export function isAllowedProjectContentType(contentType: string): boolean {
  return PROJECT_ALLOWED.has(contentType.trim().toLowerCase())
}

export function resolveProjectContentType(file: {
  name: string
  type: string
}): string | null {
  const t = file.type.trim().toLowerCase()
  if (t && PROJECT_ALLOWED.has(t)) return t

  const lower = file.name.toLowerCase()
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".mp4")) return "video/mp4"
  if (lower.endsWith(".webm")) return "video/webm"
  if (lower.endsWith(".mov")) return "video/quicktime"
  if (lower.endsWith(".mp3")) return "audio/mpeg"
  if (lower.endsWith(".wav")) return "audio/wav"
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg"
  if (lower.endsWith(".m4a")) return "audio/x-m4a"
  if (lower.endsWith(".aac")) return "audio/aac"
  if (lower.endsWith(".opus")) return "audio/opus"
  if (lower.endsWith(".flac")) return "audio/flac"
  if (lower.endsWith(".txt")) return "text/plain"
  // Markdown своим типом, а не `text/plain`: по нему превью решает, разбирать
  // разметку или показать буквами.
  if (lower.endsWith(".md") || lower.endsWith(".markdown"))
    return "text/markdown"
  if (lower.endsWith(".vtt")) return "text/vtt"
  if (lower.endsWith(".srt")) return "application/x-subrip"
  if (lower.endsWith(".csv")) return "text/csv"
  if (lower.endsWith(".json")) return "application/json"
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".zip")) return "application/zip"
  return "application/octet-stream"
}
