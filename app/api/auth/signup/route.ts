import { z } from "zod"
import { NextResponse } from "next/server"
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieConfig,
  createSessionToken,
  hashPassword,
} from "@/lib/auth"
import { createUser, findLoginByEmail } from "@/lib/repositories/users"
import { syncUserMeta } from "@/lib/project-storage"

const signupRequestSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email().max(254),
  password: z.string().min(8).max(72),
})

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null)
    const parsed = signupRequestSchema.safeParse(payload)

    if (!parsed.success) {
      return NextResponse.json(
        {
          message: "Invalid registration data.",
          errors: parsed.error.flatten(),
        },
        { status: 400 },
      )
    }

    const email = parsed.data.email.toLowerCase()
    const existing = await findLoginByEmail(email)
    if (existing) {
      return NextResponse.json(
        { message: "User with this email already exists." },
        { status: 409 },
      )
    }

    let user
    try {
      const passwordHash = await hashPassword(parsed.data.password)
      user = await createUser({
        fullName: parsed.data.fullName,
        email,
        passwordHash,
      })
      void syncUserMeta({
        userId: user.id,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
      })
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        return NextResponse.json(
          { message: "User with this email already exists." },
          { status: 409 },
        )
      }

      console.error("[auth/signup] create failed", error)
      return NextResponse.json(
        { message: "Unable to create account right now." },
        { status: 500 },
      )
    }

    const token = await createSessionToken({
      sub: user.id,
      lid: user.id,
      role: user.role,
      email: user.email,
    })

    const response = NextResponse.json(
      {
        message: `Welcome, ${user.fullName}.`,
        role: user.role,
        redirectTo: "/account",
      },
      { status: 201 },
    )
    response.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieConfig())
    return response
  } catch (error) {
    console.error("[auth/signup] failed", error)
    return NextResponse.json(
      { message: "Unable to create account right now." },
      { status: 500 },
    )
  }
}
