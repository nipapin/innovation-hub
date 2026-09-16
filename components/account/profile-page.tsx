"use client"
import { isElevated } from "@/lib/admin-roles"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { KeyRound, Loader2, Mail, User as UserIcon } from "lucide-react"
import { toast } from "sonner"
import {
  changePasswordSchema,
  deleteAccountSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type DeleteAccountInput,
  type UpdateProfileInput,
} from "@/lib/account-schemas"
import type { UserRole } from "@/lib/domain-types"
import { avatarInitials, tf, useI18n } from "@/components/account/i18n"
import { SITE_NAME } from "@/lib/site"
import { ProcessingIndicator } from "@/components/account/processing-indicator"

export type ProfileUser = {
  id: string
  fullName: string
  /** Имя для статистики обработки; пусто — используется fullName. */
  contactName: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: string
}

function formatJoined(iso: string, lang: string) {
  try {
    return new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  } catch {
    return iso
  }
}

export function ProfilePageClient({ user }: { user: ProfileUser }) {
  const { t, lang } = useI18n()
  const router = useRouter()
  const [current, setCurrent] = useState(user)
  const initials = avatarInitials(current.fullName, current.email)

  const profileForm = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      fullName: current.fullName,
      contactName: current.contactName,
      email: current.email,
    },
  })

  const passwordForm = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  })

  const deleteForm = useForm<DeleteAccountInput>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { currentPassword: "" },
  })

  useEffect(() => {
    profileForm.reset({
      fullName: current.fullName,
      contactName: current.contactName,
      email: current.email,
    })
  }, [current, profileForm])

  const onSaveProfile = async (values: UpdateProfileInput) => {
    const res = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.message ?? "Error")
      return
    }
    setCurrent((c) => ({
      ...c,
      fullName: values.fullName,
      contactName: values.contactName ?? "",
      email: values.email,
    }))
    toast.success(t.saveChanges)
    router.refresh()
  }

  const onChangePassword = async (values: ChangePasswordInput) => {
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.message ?? "Error")
      return
    }
    passwordForm.reset()
    toast.success(t.updatePassword)
  }

  const onDelete = async (values: DeleteAccountInput) => {
    const res = await fetch("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.message ?? "Error")
      return
    }
    router.push("/")
    router.refresh()
  }

  const inputClass =
    "h-[46px] w-full rounded-[10px] border border-foreground/10 bg-surface-1 px-3.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground/65 focus:border-primary"

  return (
    <main className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-foreground/[0.07] px-4 md:px-6">
        <div className="text-[13px] text-muted-foreground/90">
          <span
            className="cursor-pointer hover:text-foreground"
            onClick={() => router.push("/account/projects")}
          >
            {t.accountCrumb}
          </span>
          <span className="text-muted-foreground/50"> / </span>
          <span className="text-foreground">{t.profileTitle}</span>
        </div>
        <ProcessingIndicator />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-8 md:px-6 md:py-8">
        <div className="mx-auto max-w-[980px]">
          <div className="text-[11px] font-semibold tracking-[1.4px] text-primary">
            {t.accountSection}
          </div>
          <h1 className="mt-2 text-[32px] font-bold md:text-[40px]">
            {t.profileTitle}
          </h1>
          <p className="mt-2 text-[15px] text-muted-foreground">{tf(t.profileSub, { site: SITE_NAME })}</p>

          {/* Cover card */}
          <div className="mt-6 overflow-hidden rounded-2xl border border-foreground/10 bg-foreground/[0.02]">
            <div className="h-[100px] bg-gradient-to-br from-primary/25 via-chart-2/20 to-primary/10 md:h-[118px]" />
            <div className="-mt-11 flex flex-wrap items-end gap-5 px-5 pb-6 md:px-7">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-background bg-gradient-to-br from-primary/90 to-primary text-[28px] font-bold text-primary-foreground md:h-24 md:w-24 md:text-[30px]">
                {initials}
              </div>
              <div className="pb-1">
                <div className="text-[22px] font-bold md:text-[26px]">
                  {current.fullName || current.email}
                </div>
                <div className="mt-0.5 text-[15px] text-muted-foreground">
                  {current.email}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-foreground/5 px-3 py-1 text-[12.5px] text-secondary-foreground">
                    {isElevated(current.role) ? t.adminBadge : t.memberBadge}
                  </span>
                  <span className="rounded-full border border-success/50 px-3 py-1 text-[12.5px] text-success">
                    {t.activeBadge}
                  </span>
                  <span className="text-[13px] text-muted-foreground/80">
                    {t.joined} {formatJoined(current.createdAt, lang)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Personal info */}
          {/* Пароля здесь нет, но в адресную строку уехали бы имя и почта —
              то же самое, только тише. */}
          <form
            method="post"
            onSubmit={profileForm.handleSubmit(onSaveProfile)}
            className="mt-6 rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-5 md:p-7"
          >
            <h3 className="text-[20px] font-bold md:text-[22px]">
              {t.personalInfo}
            </h3>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
              {t.personalInfoSub}
            </p>

            <label className="mb-2 mt-5 block text-[14px] font-medium">
              {t.fullName}
            </label>
            <div className="relative">
              <UserIcon className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/65" />
              <input
                className={`${inputClass} pl-[42px]`}
                {...profileForm.register("fullName")}
              />
            </div>
            {profileForm.formState.errors.fullName && (
              <p className="mt-1 text-[13px] text-destructive">
                {profileForm.formState.errors.fullName.message}
              </p>
            )}

            <label className="mb-2 mt-4 block text-[14px] font-medium">
              {t.contactName}
            </label>
            <div className="relative">
              <UserIcon className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/65" />
              <input
                className={`${inputClass} pl-[42px]`}
                placeholder={current.fullName}
                {...profileForm.register("contactName")}
              />
            </div>
            <p className="mt-2.5 text-[13px] text-muted-foreground/80">
              {t.contactNameHint}
            </p>
            {profileForm.formState.errors.contactName && (
              <p className="mt-1 text-[13px] text-destructive">
                {profileForm.formState.errors.contactName.message}
              </p>
            )}

            <label className="mb-2 mt-4 block text-[14px] font-medium">
              {t.email}
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/65" />
              <input
                className={`${inputClass} pl-[42px]`}
                {...profileForm.register("email")}
              />
            </div>
            <p className="mt-2.5 text-[13px] text-muted-foreground/80">{t.emailHint}</p>
            {profileForm.formState.errors.email && (
              <p className="mt-1 text-[13px] text-destructive">
                {profileForm.formState.errors.email.message}
              </p>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-end gap-4 border-t border-foreground/[0.07] pt-5">
              <span className="mr-auto text-[13px] text-muted-foreground/80">
                {t.upToDate}
              </span>
              <button
                type="button"
                onClick={() =>
                  profileForm.reset({
                    fullName: current.fullName,
                    contactName: current.contactName,
                    email: current.email,
                  })
                }
                className="text-[14px] text-secondary-foreground hover:text-foreground"
              >
                {t.reset}
              </button>
              <button
                type="submit"
                disabled={profileForm.formState.isSubmitting}
                className="rounded-[10px] bg-primary/30 px-5 py-2.5 text-[14px] font-medium text-foreground hover:bg-primary/50 disabled:opacity-60"
              >
                {profileForm.formState.isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t.saveChanges
                )}
              </button>
            </div>
          </form>

          {/* Password */}
          {/* method="post" — на случай отправки до гидратации; разбор в
              components/auth/login-form.tsx. Здесь полей с паролем три, включая
              текущий. */}
          <form
            method="post"
            onSubmit={passwordForm.handleSubmit(onChangePassword)}
            className="mt-6 rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-5 md:p-7"
          >
            <h3 className="text-[20px] font-bold md:text-[22px]">
              {t.changePassword}
            </h3>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
              {t.changePasswordSub}
            </p>

            <label className="mb-2 mt-5 block text-[14px] font-medium">
              {t.currentPassword}
            </label>
            <input
              type="password"
              placeholder={t.currentPasswordPh}
              className={inputClass}
              {...passwordForm.register("currentPassword")}
            />

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-[14px] font-medium">
                  {t.newPassword}
                </label>
                <input
                  type="password"
                  placeholder={t.newPasswordPh}
                  className={inputClass}
                  {...passwordForm.register("newPassword")}
                />
              </div>
              <div>
                <label className="mb-2 block text-[14px] font-medium">
                  {t.confirmPassword}
                </label>
                <input
                  type="password"
                  placeholder={t.confirmPasswordPh}
                  className={inputClass}
                  {...passwordForm.register("confirmPassword")}
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end border-t border-foreground/[0.07] pt-5">
              <button
                type="submit"
                disabled={passwordForm.formState.isSubmitting}
                className="flex items-center gap-2 rounded-[10px] bg-primary px-5 py-2.5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {passwordForm.formState.isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-[18px] w-[18px]" />
                )}
                {t.updatePassword}
              </button>
            </div>
          </form>

          {/* Danger */}
          <form
            method="post"
            onSubmit={deleteForm.handleSubmit(onDelete)}
            className="mt-6 rounded-2xl border border-destructive/35 bg-destructive/5 p-5 md:p-7"
          >
            <h3 className="text-[20px] font-bold text-destructive">
              {t.dangerTitle}
            </h3>
            <p className="mt-1.5 text-[14px] text-muted-foreground">{t.dangerSub}</p>
            <label className="mb-2 mt-5 block text-[14px] font-medium">
              {t.currentPassword}
            </label>
            <input
              type="password"
              placeholder={t.currentPasswordPh}
              className={inputClass}
              {...deleteForm.register("currentPassword")}
            />
            <div className="mt-5 flex justify-end">
              <button
                type="submit"
                disabled={deleteForm.formState.isSubmitting}
                className="rounded-[10px] bg-destructive px-5 py-2.5 text-[14px] font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
              >
                {deleteForm.formState.isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t.deleteAccount
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  )
}
