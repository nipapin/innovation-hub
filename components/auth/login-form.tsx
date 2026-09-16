"use client"
import type { UserRole } from "@/lib/domain-types"

import Link from "next/link"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import { loginSchema, type LoginInput } from "@/lib/auth-schemas"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button"

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  google_unconfigured: "Google sign-in is not configured on this server.",
  google_denied: "Google sign-in was cancelled.",
  google_invalid_response: "Google returned an unexpected response. Please try again.",
  google_state_mismatch: "Sign-in session expired. Please try again.",
  google_token_failed: "Could not verify your Google account. Please try again.",
  google_email_unverified: "Your Google email is not verified. Please verify it and retry.",
  google_link_failed: "Could not link your Google account. Please try again.",
  google_create_failed: "Could not create your account. Please try again.",
  account_inactive: "This account is inactive.",
}

type LoginFormProps = {
  redirectTo?: string
  googleEnabled?: boolean
  oauthError?: string | null
}

export function LoginForm({
  redirectTo = "/account",
  googleEnabled = false,
  oauthError = null,
}: LoginFormProps) {
  const [serverMessage, setServerMessage] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(
    oauthError ? OAUTH_ERROR_MESSAGES[oauthError] ?? "Sign-in failed. Please try again." : null,
  )

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

  const onSubmit = async (values: LoginInput) => {
    setServerMessage(null)
    setServerError(null)

    try {
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      })

      const raw = await response.text()
      let data: {
        message?: string
        role?: UserRole
        mustChangePassword?: boolean
      } = {}
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {}
      } catch {
        setServerError(
          response.ok
            ? "Unexpected server response. Please try again."
            : `Sign in failed (HTTP ${response.status}). Please try again.`,
        )
        return
      }

      if (!response.ok) {
        setServerError(data.message ?? "Sign in failed. Please try again.")
        return
      }

      setServerMessage(data.message ?? "Signed in successfully.")
      form.reset({ email: values.email, password: "" })
      const target =
        data.mustChangePassword
          ? "/account/security?mustChange=1"
          : redirectTo.startsWith("/") && !redirectTo.startsWith("//")
            ? redirectTo
            : "/account"
      window.location.assign(target)
    } catch {
      setServerError("Unable to reach the server. Please try again.")
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="font-display text-2xl">Sign In</CardTitle>
        <CardDescription>Access your account to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        {googleEnabled ? (
          <div className="mb-4 space-y-3">
            <GoogleSignInButton next={redirectTo} />
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  or sign in with email
                </span>
              </div>
            </div>
          </div>
        ) : null}
        <Form {...form}>
          {/* method="post" — не для сервера, а на случай отправки ДО гидратации.
              Несколько сотен миллисекунд страница живёт без JavaScript (а при
              ошибке в скрипте — всегда), и Enter в этот промежуток отправит
              форму сам. По умолчанию это GET, то есть пароль уедет в адресную
              строку, а оттуда в историю браузера, логи сервера и заголовок
              Referer. POST кладёт поля в тело запроса. Обработчика по этому
              адресу нет и отправка ничем не кончится — но пароль нигде не
              осядет. */}
          <form
            method="post"
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
          >
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
                    <Input type="password" placeholder="Enter your password" autoComplete="current-password" {...field} />
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
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        </Form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Do not have an account?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Register
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
