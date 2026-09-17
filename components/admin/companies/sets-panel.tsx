"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useI18n } from "@/components/account/i18n"
import { toolText } from "@/components/account/tools/registry-ui"
import { Section } from "@/components/admin/billing/fields"
import { COMPANY_TOOLS } from "@/components/company/nav-config"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { TOOLS } from "@/lib/tools/registry"

/**
 * «Набор компании» — что ей продано (docs/COMPANY_SETUP_PANEL_PLAN.md §2).
 *
 * Два набора на одном экране, потому что решение у них одно: в какой
 * комплектации продана компания. Инструменты — её рабочее место, разделы — её
 * консоль.
 *
 * Главный элемент — переключатель «всё, что есть», и он СВОЙ у каждого набора,
 * а не общий на оба. Общий выглядел бы аккуратнее и врал бы: снимая его ради
 * разделов, человек заодно переписал бы «набор инструментов не задан» на
 * «перечислены вот эти» — то есть молча отказался бы от умолчания, о котором и
 * речи не было, и новый инструмент установки перестал бы приезжать компании
 * сам. Наборы независимы в базе, независимы они и здесь.
 *
 * Третьей строкой — зеркало чата в YouGile (§2.6). Набором оно не является и в
 * колонку не встало: там перечисляют то, что компания видит у себя, а зеркало
 * решает, видим ли её переписку МЫ.
 */
export function CompanySetsPanel({
  companyId,
  initial,
  onSaved,
}: {
  companyId: string
  initial: {
    tools: string[] | null
    sections: string[] | null
    /** Зеркало переписки в YouGile (§2.6). Умолчание — включено. */
    chatSync: boolean
    /** Работа за наш счёт (§3). Умолчание — выключено: компания платит. */
    billingFree: boolean
  }
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [chatSync, setChatSync] = useState(initial.chatSync)
  const [billingFree, setBillingFree] = useState(initial.billingFree)
  const tools = useKeySet(
    initial.tools,
    TOOLS.map((tool) => tool.key),
  )
  const sections = useKeySet(
    initial.sections,
    COMPANY_TOOLS.map((tool) => tool.key),
  )

  const save = async () => {
    /**
     * Уходит ТОЛЬКО тронутый набор.
     *
     * Слать оба всегда — значит отправлять снимок, снятый при открытии экрана:
     * правишь инструменты, а вместе с ними уезжает список разделов, каким он был
     * час назад, и чужая правка молча откатывается — да ещё и твоим именем в
     * журнале. Наборы независимы, поэтому и сохраняются порознь.
     */
    const body: Record<string, unknown> = {}
    if (tools.changed) body.companyTools = tools.value
    if (sections.changed) body.companySections = sections.value
    // Тоже только если тронули — по той же причине, что и наборы выше: иначе
    // правка инструментов молча возвращала бы зеркало к состоянию на момент
    // открытия экрана.
    if (chatSync !== initial.chatSync) body.chatYouGileSync = chatSync
    if (billingFree !== initial.billingFree) body.billingFree = billingFree
    if (Object.keys(body).length === 0) {
      toast.success(t.coSaved)
      return
    }

    setBusy(true)
    try {
      const res = await fetch(`/api/admin/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        toast.error(t.coSaveFailed)
        return
      }
      toast.success(t.coSaved)
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={t.coSetsTitle} description={t.coSetsSub}>
      {/* Друг под другом, а не в две колонки: наборы разной длины, и рядом они
          оставляли справа или слева пустой столбец в пол-экрана. Читаются они
          всё равно сверху вниз — как и остальные строки этой панели. */}
      <div className="space-y-6">
        <SetColumn
          label={t.coSetsTools}
          state={tools}
          busy={busy}
          // Подпись берётся из клиентской половины реестра, а не собирается из
          // ключа: схему `tool_<key>_name` обещает докстринг реестра, но в
          // словаре таких ключей нет, и приведение к `DictKey` молча пропустило
          // бы пустые строки в колонку.
          items={TOOLS.map((tool) => ({
            key: tool.key,
            label: t[toolText(tool.key).name],
          }))}
        />
        <SetColumn
          label={t.coSetsSections}
          state={sections}
          busy={busy}
          items={COMPANY_TOOLS.map((tool) => ({
            key: tool.key,
            label: t[tool.labelKey],
          }))}
        />
      </div>

      {/* Зеркало чата — не колонка набора, а отдельная строка: наборы отвечают
          на вопрос «что компания видит у себя», а это на вопрос «уезжает ли её
          переписка к нам». Соседство здесь по месту решения, не по смыслу. */}
      <div className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
        <Switch
          checked={chatSync}
          disabled={busy}
          onCheckedChange={setChatSync}
        />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{t.coSetsChat}</p>
          <p className="text-[11px] text-muted-foreground">{t.coSetsChatHint}</p>
        </div>
      </div>

      {/* Деньги — последней строкой и намеренно не рядом с наборами: ошибка
          здесь единственная, которой не видно глазом. Она не роняет страницу и
          не показывает пустой экран, а молча раздаёт бесплатную работу (§6). */}
      <div className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
        <Switch
          checked={billingFree}
          disabled={busy}
          onCheckedChange={setBillingFree}
        />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{t.coSetsFree}</p>
          <p className="text-[11px] text-muted-foreground">{t.coSetsFreeHint}</p>
        </div>
      </div>

      {/* Обещание «скрыли, но не удалили» и запрет гасить сервисы вместе с
          кошельком — на экране, а не только в плане: нарушают их ровно в тот
          момент, когда снимают отметку, и напоминание нужно здесь. */}
      <div className="space-y-1.5 text-[11px] text-muted-foreground">
        <p>{t.coSetsKeepNote}</p>
        <p>{t.coSetsVendorNote}</p>
      </div>

      <Button onClick={() => void save()} disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {t.saveChanges}
      </Button>
    </Section>
  )
}

type KeySetState = {
  /** Что уйдёт на сервер: `null` — «набор не задан», список — перечисление. */
  value: string[] | null
  /** Трогали ли набор на этом экране. Нетронутый не отправляется вовсе. */
  changed: boolean
  unlimited: boolean
  setUnlimited: (next: boolean) => void
  picked: string[]
  toggle: (key: string) => void
}

/**
 * Один набор: «всё, что есть» плюс отметки.
 *
 * `null` не живёт в отметках — он выражен переключателем. Иначе об одном и том
 * же пришлось бы держать два состояния и следить, чтобы они не разошлись.
 * Отметки при включённом «всё» сохраняются нетронутыми: передумал — вернулся к
 * своему списку, а не собирает его заново.
 */
function useKeySet(initial: string[] | null, all: string[]): KeySetState {
  const [unlimited, setUnlimited] = useState(initial === null)
  const [picked, setPicked] = useState<string[]>(initial ?? all)

  const value = unlimited ? null : picked
  // Сравнение по составу, а не по порядку: отметки складываются в том порядке,
  // в каком по ним щёлкали, и «тот же набор, переставленный местами» — это не
  // правка.
  const changed =
    value === null || initial === null
      ? (value === null) !== (initial === null)
      : value.length !== initial.length ||
        value.some((key) => !initial.includes(key))

  return {
    value,
    changed,
    unlimited,
    setUnlimited,
    picked,
    toggle: (key) =>
      setPicked(
        picked.includes(key)
          ? picked.filter((item) => item !== key)
          : [...picked, key],
      ),
  }
}

function SetColumn({
  label,
  state,
  busy,
  items,
}: {
  label: string
  state: KeySetState
  busy: boolean
  items: { key: string; label: string }[]
}) {
  const { t } = useI18n()

  return (
    /* Рамка одна на весь набор, а не только вокруг «всё, что есть»: заголовок,
       переключатель и отметки — это одно решение, и обведённой частью от него
       читались бы как отдельная строка, а список под ней — как ничей. */
    <div className="space-y-3 rounded-lg border border-border/60 p-3">
      <Label>{label}</Label>
      <div className="flex items-start gap-3">
        <Switch
          checked={state.unlimited}
          disabled={busy}
          onCheckedChange={state.setUnlimited}
        />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{t.coSetsAll}</p>
          <p className="text-[11px] text-muted-foreground">{t.coSetsAllHint}</p>
        </div>
      </div>

      {state.unlimited ? null : (
        // Черта, а не вторая рамка: отметки подчинены переключателю выше —
        // вложенная рамка сделала бы их равноправным соседом.
        <div className="border-t border-border/60 pt-2">
          {items.map((item) => (
            <label
              key={item.key}
              className="flex items-center gap-2.5 py-1 text-sm text-foreground"
            >
              <Switch
                checked={state.picked.includes(item.key)}
                disabled={busy}
                onCheckedChange={() => state.toggle(item.key)}
              />
              {item.label}
            </label>
          ))}
          {state.picked.length === 0 ? (
            <p className="text-[11px] text-destructive">{t.coSetsNothing}</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
