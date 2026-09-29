"use client"

import { useState } from "react"
import { loginSchema } from "@/lib/auth-schemas"

export function KotliarLoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const parsed = loginSchema.safeParse({ email, password })
    if (!parsed.success) {
      setError("Введите почту и пароль.")
      return
    }
    setPending(true)
    try {
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })
      const data = (await response.json().catch(() => ({}))) as { message?: string }
      if (!response.ok) {
        setError(data.message ?? "Не удалось войти.")
        return
      }
      window.location.assign("/edit")
    } catch {
      setError("Сервер недоступен.")
    } finally {
      setPending(false)
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-[13px] text-[#4a4843]">Почта</span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-[42px] w-full rounded-[10px] border border-black/10 bg-white px-3.5 text-[15px] outline-none focus:border-[#3b5bdb]"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-[13px] text-[#4a4843]">Пароль</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-[42px] w-full rounded-[10px] border border-black/10 bg-white px-3.5 text-[15px] outline-none focus:border-[#3b5bdb]"
        />
      </label>
      {error ? <p className="text-[13px] text-[#b42318]">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="h-[42px] w-full rounded-[10px] bg-[#3b5bdb] text-[15px] font-medium text-white disabled:opacity-50"
      >
        {pending ? "Вход…" : "Войти"}
      </button>
    </form>
  )
}
