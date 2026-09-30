"use client"

import { useState } from "react"
import { avatarInitials } from "@/components/account/i18n"
import { cn } from "@/lib/utils"

/**
 * Кружок человека: фото, если есть, иначе инициалы.
 *
 * Размер, рамку и шрифт задаёт место вызова через `className` — кружков в
 * кабинете несколько, и у каждого свои. Сломанная ссылка (объект удалили, CDN
 * отстал) откатывается на инициалы, а не на пустой кружок.
 */
export function UserAvatar({
  avatarUrl,
  fullName,
  email,
  className,
}: {
  avatarUrl?: string | null
  fullName: string
  email: string
  className?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = Boolean(avatarUrl) && failedUrl !== avatarUrl
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary/90 to-primary font-bold text-primary-foreground",
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- адрес из своего
        // хранилища или прокси, оптимизатор картинок тут ничего не даёт.
        <img
          src={avatarUrl!}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailedUrl(avatarUrl ?? null)}
        />
      ) : (
        avatarInitials(fullName, email)
      )}
    </div>
  )
}
