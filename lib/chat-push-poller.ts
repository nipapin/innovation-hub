import { syncProjectChatFromYouGile } from "@/lib/project-chat-sync"
import { listProjectsWithYougileChat } from "@/lib/repositories/projects"
import { isYouGileConfigured } from "@/lib/yougile"

const POLL_INTERVAL_MS = 30_000

let started = false

/**
 * Background loop that pulls team chat replies from YouGile independently
 * of any browser being open. Without this, `syncProjectChatFromYouGile` —
 * and therefore the Web Push notifications it triggers (see lib/push.ts) —
 * would only ever run while someone happened to have a page open that
 * calls it. Safe to run as a plain `setInterval` here: this app runs as a
 * long-lived Node process under PM2 (`next start`), not serverless, and is
 * started once from instrumentation.ts at boot.
 *
 * The interval is deliberately not too aggressive: YouGile caps its API at
 * 50 requests/minute per company, shared with the ~6s live polling done by
 * any open chat page. Revisit (stagger projects, lengthen the interval) if
 * the number of active linked projects grows a lot.
 */
export function startChatPushPoller(): void {
  if (started) return
  started = true

  const tick = async () => {
    if (!isYouGileConfigured()) return
    try {
      // Компании с выключенным зеркалом отсеивает сам запрос
      // (listProjectsWithYougileChat). Проверять их ЗДЕСЬ нельзя: тик один на
      // всю установку, и любой ранний `return` в этом цикле остановил бы опрос
      // всем остальным компаниям заодно. См. docs/COMPANY_SETUP_PANEL_PLAN.md §2.6.
      const projects = await listProjectsWithYougileChat()
      for (const project of projects) {
        await syncProjectChatFromYouGile(project)
      }
    } catch (error) {
      console.error("[chat-push-poller] tick failed", error)
    }
  }

  void tick()
  setInterval(() => void tick(), POLL_INTERVAL_MS)
}
