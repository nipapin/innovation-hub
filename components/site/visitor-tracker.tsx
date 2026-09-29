"use client"

import { useEffect, useRef } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { KOTLIAR_HOSTS } from "@/lib/kotliar/host"

/**
 * Reports every client-side navigation to /api/visitors/track. We dedupe by
 * path+query within the same mount to avoid double-counting React Strict
 * Mode double-renders and to keep the dashboard signal-to-noise high. We
 * also skip the admin surface — admins refreshing the Visitors dashboard
 * shouldn't appear as visits themselves.
 */
export function VisitorTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const lastSent = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname) return
    if (pathname.startsWith("/admin")) return
    if (pathname.startsWith("/api")) return
    if (pathname.startsWith("/kotliar-site")) return
    if (KOTLIAR_HOSTS.has(window.location.hostname)) return

    const query = searchParams?.toString() ?? ""
    const key = `${pathname}?${query}`
    if (lastSent.current === key) return
    lastSent.current = key

    const body = JSON.stringify({
      path: pathname,
      query,
      referer: typeof document !== "undefined" ? document.referrer : "",
    })

    try {
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function"
      ) {
        const blob = new Blob([body], { type: "application/json" })
        const ok = navigator.sendBeacon("/api/visitors/track", blob)
        if (ok) return
      }
    } catch {
      // sendBeacon failures fall through to fetch below.
    }

    void fetch("/api/visitors/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {
      // Best-effort tracking; never bubble errors to the page.
    })
  }, [pathname, searchParams])

  return null
}
