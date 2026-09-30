export type WorkerState = "off" | "searching" | "processing" | "error"

export type TokenMachineDto = {
  id: string
  /** Ключ машины. null у компьютеров, заведённых руками до появления UUID. */
  machineUuid: string | null
  /** Hostname — подпись для человека. */
  name: string
  /** Стучится на сайт: любое обращение по API за последние 90 секунд. */
  seen: boolean
  worker: WorkerState
  lastSeenAt: string | null
  lastClaimAt: string | null
  currentTaskId: string | null
  currentProjectName: string | null
}

/**
 * Токен доступа как его видит человек: завёл, назвал, один раз скопировал в
 * машину. Под токеном — машины, которые им обращаются.
 */
export type AccessTokenDto = {
  kind: "computer" | "machine"
  id: string
  name: string
  /** Описание из выпуска токена. null у `mch_` и у пустого. */
  description: string | null
  ownerEmail: string
  projectId: string | null
  createdAt: string
  machines: TokenMachineDto[]
  /** Обновить токен умеет только компьютер: у `mch_` замены нам взять негде. */
  canRotate: boolean
}
