import { NextResponse, type NextRequest } from "next/server"
import { requireProductionApi } from "@/lib/production/access"
import { subscribe } from "@/lib/production/live"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Живое обновление чатов производства — SSE (§7.3, §10.2). Во вкладку уходит
 * только «в чате этапа X что-то изменилось»; данные она берёт обычным
 * запросом с проверкой прав. Пинг раз в 25 секунд держит соединение через nginx.
 */
export async function GET(request: NextRequest) {
  const auth = await requireProductionApi(request)
  if (auth instanceof NextResponse) return auth

  const encoder = new TextEncoder()
  let cleanup = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          cleanup()
        }
      }
      send(": connected\n\n")
      const unsubscribe = subscribe(auth.userId, (event) => send(`data: ${JSON.stringify(event)}\n\n`))
      const ping = setInterval(() => send(": ping\n\n"), 25_000)
      cleanup = () => {
        clearInterval(ping)
        unsubscribe()
      }
      request.signal.addEventListener("abort", () => {
        cleanup()
        try {
          controller.close()
        } catch {}
      })
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx иначе копит поток в буфере, и события приходят пачками.
      "X-Accel-Buffering": "no",
    },
  })
}
