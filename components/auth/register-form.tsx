"use client"

import Link from "next/link"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import { registerSchema, type RegisterInput } from "@/lib/auth-schemas"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button"

type RegisterFormProps = {
  googleEnabled?: boolean
}

export function RegisterForm({ googleEnabled = false }: RegisterFormProps = {}) {
  const [serverMessage, setServerMessage] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  })

  const onSubmit = async (values: RegisterInput) => {
    setServerMessage(null)
    setServerError(null)

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName: values.fullName,
          email: values.email,
          password: values.password,
        }),
      })

      const data = (await response.json()) as {
        message?: string
        redirectTo?: string
      }

      if (!response.ok) {
        setServerError(data.message ?? "Registration failed. Please try again.")
        return
      }

      setServerMessage(data.message ?? "Account created successfully.")
      const target =
        data.redirectTo &&
        data.redirectTo.startsWith("/") &&
        !data.redirectTo.startsWith("//")
          ? data.redirectTo
          : "/account/dashboard"
      /**
       * Намерение «пришёл за тестовым периодом» переносим на дашборд: там
       * откроются условия. Сам период не активируется — ни здесь, ни там без
       * нажатия, иначе копии шаблонов заводились бы каждому, кто ушёл сразу
       * после регистрации.
       *
       * Адрес указан явно, а не собран из `target`: по умолчанию регистрация
       * отправляет на `/account/dashboard`, то есть в СТАРЫЙ кабинет
       * (docs/CLEANUP_PLAN.md §C.2 — известная ошибка), а карточка периода
       * живёт на новом, `/account`. Общий редирект здесь не трогаем: это
       * отдельная задача с собственным чеклистом.
       */
      const wantsTrial =
        new URLSearchParams(window.location.search).get("trial") === "1"
      window.location.assign(wantsTrial ? "/account?trial=1" : target)
    } catch {
      setServerError("Unable to reach the server. Please try again.")
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="font-display text-2xl">Register</CardTitle>
        <CardDescription>Create your account and start exploring content.</CardDescription>
      </CardHeader>
      <CardContent>
        {googleEnabled ? (
          <div className="mb-4 space-y-3">
            <GoogleSignInButton label="Continue with Google" />
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  or use email
                </span>
              </div>
            </div>
          </div>
        ) : null}
        <Form {...form}>
          {/* См. разбор в login-form.tsx: до гидратации Enter отправил бы форму
              методом GET, то есть пароль попал бы в адресную строку. */}
          <form
            method="post"
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input type="text" placeholder="Alex Johnson" autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="you@example.com" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Create a password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Repeat your password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {serverError ? <p className="text-sm font-medium text-destructive">{serverError}</p> : null}
            {serverMessage ? <p className="text-sm font-medium text-primary">{serverMessage}</p> : null}

            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                "Create Account"
              )}
            </Button>
          </form>
        </Form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign In
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
