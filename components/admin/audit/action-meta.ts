"use client"

import {
  ArrowLeftRight,
  Building2,
  Palette,
  FolderTree,
  Gift,
  TriangleAlert,
  KeyRound,
  Monitor,
  Plug,
  ScrollText,
  Settings2,
  ShieldCheck,
  ToggleRight,
  Trash2,
  UserCog,
  Workflow,
} from "lucide-react"

import type { AdminDict } from "@/components/admin/admin-dict"
import type { AuditAction } from "@/lib/audit-actions"

/**
 * Подпись действия и его вес. Иконка и цвет несут смысл, а не украшают: по ленте
 * должно быть видно, где раздали доступ, а где поправили профиль, не вчитываясь.
 */
export const ACTION_META: Record<
  AuditAction,
  {
    labelKey: keyof AdminDict
    icon: typeof UserCog
    tone: "access" | "danger" | "neutral"
  }
> = {
  "user.created": { labelKey: "auditUserCreated", icon: UserCog, tone: "neutral" },
  "user.updated": { labelKey: "auditUserUpdated", icon: UserCog, tone: "neutral" },
  "user.role_changed": {
    labelKey: "auditUserRoleChanged",
    icon: ShieldCheck,
    tone: "access",
  },
  "user.password_reset": {
    labelKey: "auditUserPasswordReset",
    icon: KeyRound,
    tone: "access",
  },
  "user.suspended": {
    labelKey: "auditUserSuspended",
    icon: UserCog,
    tone: "danger",
  },
  "user.reactivated": {
    labelKey: "auditUserReactivated",
    icon: UserCog,
    tone: "neutral",
  },
  "user.deleted": { labelKey: "auditUserDeleted", icon: Trash2, tone: "danger" },
  "capability.granted": {
    labelKey: "auditCapabilityGranted",
    icon: ShieldCheck,
    tone: "access",
  },
  "capability.revoked": {
    labelKey: "auditCapabilityRevoked",
    icon: ShieldCheck,
    tone: "access",
  },
  "computer.created": {
    labelKey: "auditComputerCreated",
    icon: Monitor,
    tone: "access",
  },
  "computer.token_rotated": {
    labelKey: "auditComputerTokenRotated",
    icon: KeyRound,
    tone: "access",
  },
  "computer.revoked": {
    labelKey: "auditComputerRevoked",
    icon: Monitor,
    tone: "neutral",
  },
  "machine_token.revoked": {
    labelKey: "auditMachineTokenRevoked",
    icon: KeyRound,
    tone: "access",
  },
  "settings.updated": {
    labelKey: "auditSettingsUpdated",
    icon: Settings2,
    tone: "neutral",
  },
  // `access`, а не `neutral`: выключатель меняет не содержимое раздела, а то,
  // доберётся ли до него хоть кто-нибудь — и сразу для всех пользователей.
  "feature.toggled": {
    labelKey: "auditFeatureToggled",
    icon: ToggleRight,
    tone: "access",
  },
  "user.automation_enabled": {
    labelKey: "auditAutomationEnabled",
    icon: Workflow,
    tone: "neutral",
  },
  "user.automation_disabled": {
    labelKey: "auditAutomationDisabled",
    icon: Workflow,
    tone: "neutral",
  },
  "project.created": {
    labelKey: "auditProjectCreated",
    icon: FolderTree,
    tone: "neutral",
  },
  "project.deleted": {
    labelKey: "auditProjectDeleted",
    icon: Trash2,
    tone: "danger",
  },
  // Тяжелее удаления: у того есть корзина и срок, у этого — ничего. Файлы
  // стёрты и в базе, и в хранилище, вернуть их неоткуда.
  "project.purged": {
    labelKey: "auditProjectPurged",
    icon: Trash2,
    tone: "danger",
  },
  // Тяжёлая строка: сменился владелец, а вместе с ним — кошелёк, с которого
  // идут списания за обработку.
  "project.transferred": {
    labelKey: "auditProjectTransferred",
    icon: ArrowLeftRight,
    tone: "danger",
  },
  "project.shared": {
    labelKey: "auditProjectShared",
    icon: FolderTree,
    tone: "access",
  },
  "project.unshared": {
    labelKey: "auditProjectUnshared",
    icon: FolderTree,
    tone: "access",
  },
  "service.created": {
    labelKey: "auditServiceCreated",
    icon: Plug,
    tone: "access",
  },
  "service.updated": {
    labelKey: "auditServiceUpdated",
    icon: Plug,
    tone: "neutral",
  },
  "service.secret_rotated": {
    labelKey: "auditServiceSecretRotated",
    icon: KeyRound,
    tone: "access",
  },
  "service.secrets_revoked": {
    labelKey: "auditServiceSecretsRevoked",
    icon: KeyRound,
    tone: "access",
  },
  // Выдача живого ключа на машину — самая тяжёлая строка в этой ленте: после
  // неё секрет существует вне сервера, и знать об этом надо без вчитывания.
  "service.keys_issued": {
    labelKey: "auditServiceKeysIssued",
    icon: KeyRound,
    tone: "danger",
  },
  // Заведение учётки — «danger»: в базу лёг чужой ключ, и это событие того же
  // веса, что выдача доступа.
  "service.account_created": {
    labelKey: "auditServiceAccountCreated",
    icon: KeyRound,
    tone: "danger",
  },
  "service.account_updated": {
    labelKey: "auditServiceAccountUpdated",
    icon: Plug,
    tone: "neutral",
  },
  // Не «danger»: инцидент — это сообщение о поломке, а не опасное действие
  // человека. Красным он бы соревновался за внимание с выдачей ключей.
  "service.incident": {
    labelKey: "auditServiceIncident",
    icon: TriangleAlert,
    tone: "neutral",
  },
  // Оба — «danger»: отзыв забирает у человека деньги, сброс их раздаёт. Тихим
  // ни то ни другое быть не должно.
  "trial.revoked": { labelKey: "auditTrialRevoked", icon: Gift, tone: "danger" },
  "trial.reset": { labelKey: "auditTrialReset", icon: Gift, tone: "danger" },
  // Дожим — «neutral»: он не двигает чужие деньги, а доводит до конца то, что
  // человек уже запросил сам.
  "trial.resumed": { labelKey: "auditTrialResumed", icon: Gift, tone: "neutral" },
  // «access»: смена плательщика даёт одному человеку право тратить чужой
  // кошелёк — по весу это выдача доступа, а не правка профиля.
  "billing.payer_changed": {
    labelKey: "auditPayerChanged",
    icon: ArrowLeftRight,
    tone: "access",
  },
  "company.created": {
    labelKey: "auditCompanyCreated",
    icon: Building2,
    tone: "access",
  },
  // «danger»: перевод меняет и принадлежность человека, и кошелёк, с которого
  // идут списания за его работу, — по весу это ближе к смене владельца проекта.
  "company.member_transferred": {
    labelKey: "auditCompanyMemberTransferred",
    icon: ArrowLeftRight,
    tone: "danger",
  },
  "company.enabled": {
    labelKey: "auditCompanyEnabled",
    icon: Building2,
    tone: "neutral",
  },
  "company.disabled": {
    labelKey: "auditCompanyDisabled",
    icon: Building2,
    tone: "access",
  },
  "company.deleted": {
    labelKey: "auditCompanyDeleted",
    icon: Trash2,
    tone: "danger",
  },
  // Вторая ось прав (план §4). «access» — как у сайтовых собратьев: это раздача
  // полномочий, а не правка профиля.
  "company.role_changed": {
    labelKey: "auditCompanyRoleChanged",
    icon: ShieldCheck,
    tone: "access",
  },
  "company.capability_granted": {
    labelKey: "auditCompanyCapabilityGranted",
    icon: ShieldCheck,
    tone: "access",
  },
  "company.capability_revoked": {
    labelKey: "auditCompanyCapabilityRevoked",
    icon: ShieldCheck,
    tone: "access",
  },
  "company.renamed": {
    labelKey: "auditCompanyRenamed",
    icon: Building2,
    tone: "neutral",
  },
  // «access»: набор проданного решает, что компании ВИДНО, — это про доступ, а
  // не про оформление, хотя правится по соседству с ним.
  "company.sets_changed": {
    labelKey: "auditCompanySetsChanged",
    icon: Building2,
    tone: "access",
  },
  // «neutral»: оформление не раздаёт доступ. Домен — исключение по весу, но
  // отдельным действием он не пишется: экран у них один.
  "company.branding_changed": {
    labelKey: "auditCompanyBrandingChanged",
    icon: Palette,
    tone: "neutral",
  },
  "company.machine_created": {
    labelKey: "auditCompanyMachineCreated",
    icon: Monitor,
    tone: "access",
  },
  "company.machine_revoked": {
    labelKey: "auditCompanyMachineRevoked",
    icon: Monitor,
    tone: "neutral",
  },
  "company.machine_token_rotated": {
    labelKey: "auditCompanyMachineRotated",
    icon: KeyRound,
    tone: "access",
  },
  "company.machines_policy_changed": {
    labelKey: "auditCompanyMachinesPolicy",
    icon: Monitor,
    tone: "neutral",
  },
  "company.automation_enabled": {
    labelKey: "auditCompanyAutomationEnabled",
    icon: Workflow,
    tone: "neutral",
  },
  "company.automation_disabled": {
    labelKey: "auditCompanyAutomationDisabled",
    icon: Workflow,
    tone: "neutral",
  },
  // `Plug`, а не `Building2`: это про связь с внешним сервисом, а не про саму
  // компанию. «neutral» — доступа зеркало никому не раздаёт.
  "company.chat_sync_enabled": {
    labelKey: "auditCompanyChatSyncEnabled",
    icon: Plug,
    tone: "neutral",
  },
  "company.chat_sync_disabled": {
    labelKey: "auditCompanyChatSyncDisabled",
    icon: Plug,
    tone: "neutral",
  },
  // `Gift` — работа за наш счёт это подарок и есть. Тон не «neutral»: доступа
  // флаг не раздаёт, но деньги двигает, и в ленте журнала он должен выделяться.
  "company.billing_free_enabled": {
    labelKey: "auditCompanyBillingFreeEnabled",
    icon: Gift,
    tone: "access",
  },
  "company.billing_free_disabled": {
    labelKey: "auditCompanyBillingFreeDisabled",
    icon: Gift,
    tone: "access",
  },
}

export const TONE_CLASS = {
  access: "bg-amber-500/15 text-amber-300",
  danger: "bg-destructive/15 text-destructive",
  neutral: "bg-primary/10 text-primary",
} as const
