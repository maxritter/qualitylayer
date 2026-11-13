// Settings › Licence: the plan and its billing account (where subscription, invoices and seats are
// managed), the command that puts the licence on another computer, and what leaves this computer.
// The version lives in About.

import {
  AwardIcon,
  EyeOffIcon,
  FlagIcon,
  KeyRoundIcon,
  LaptopIcon,
  RefreshCwIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { ButtonLink } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Licence } from "../api.ts"
import { PRIVACY_URL } from "./About.tsx"
import { SettingRow, SettingsGroup, SettingsMore } from "./Rows.tsx"

/** The one place to manage a subscription: Polar's own portal is never linked, so cancelling asks why. */
export const BILLING = "https://qualitylayer.dev/billing"
export const ACTIVATE = "qualitylayer licence activate <key>"

/** The commercial plan name, the trial's days, or why there is no licence. */
export function planLine(licence: Licence | null): string {
  if (licence === null) return "Reading the licence…"
  if (licence.state !== "active") {
    return `Not licensed (${(licence.state ?? "unknown").replaceAll("_", " ")})`
  }
  if (licence.tier === "trial") {
    const days = licence.daysLeft ?? 0
    return `Trial · ${days} ${days === 1 ? "day" : "days"} left`
  }
  return licence.tier === "team" ? "Business licence" : "Individual licence"
}

/** What leaves this computer, one line each, with how often. */
const ICON = "size-[15px]"

const LEAVES: { label: string; hint?: string; when: string; icon: ReactNode }[] = [
  {
    label: "Licence check",
    hint: "To qualitylayer.dev: your licence key and the App's version.",
    when: "Daily",
    icon: <KeyRoundIcon className={ICON} />,
  },
  {
    label: "Update checks",
    hint: "To qualitylayer.dev: the App's version and update channel.",
    when: "Once a day",
    icon: <RefreshCwIcon className={ICON} />,
  },
  {
    label: "Reports you send",
    hint: "What you write and attach, plus App, system and agent versions. Nothing from your code.",
    when: "When you send one",
    icon: <FlagIcon className={ICON} />,
  },
  { label: "Usage events", when: "None", icon: <EyeOffIcon className={ICON} /> },
]

/** The labels of the rows that say what leaves this computer, for the search. */
export const LEAVES_LABELS: readonly string[] = LEAVES.map((row) => row.label)

/** What the licence row may be called, by what the licence is: the search finds it under any of them. */
export const PLAN_LABELS = [
  "Business licence",
  "Individual licence",
  "Trial",
  "Not licensed",
] as const

/**
 * "renews monthly on Nov 11", "renews yearly on Mar 3, 2027", or "renews monthly" when the date is not
 * known; the year is said only when it is not this one. Empty for a licence that carries no renewal.
 */
export function renewsWords(renews: Licence["renews"], now: number = Date.now()): string | null {
  if (renews === undefined || renews === null) return null
  const every = renews.every === "year" ? "yearly" : "monthly"
  if (renews.at === null) return `renews ${every}`
  const at = new Date(renews.at)
  const date = at.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(at.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  })
  return `renews ${every} on ${date}`
}

/** The first row: the plan by name, who it is for, and where seats, invoices and the payment method are managed. */
function BillingRow({ licence }: { licence: Licence | null }) {
  const email = licence?.email
  const renews = licence?.tier === "trial" ? null : renewsWords(licence?.renews)
  const says =
    licence?.tier === "trial"
      ? "Choose a plan on qualitylayer.dev to keep going."
      : "Manage it in your billing account."
  return (
    <SettingRow
      label={<span data-testid="licence-plan">{planLine(licence)}</span>}
      icon={<AwardIcon className={ICON} />}
      hint={
        <>
          {email ? (
            <>
              <span data-testid="licence-email">{email}</span> ·{" "}
            </>
          ) : null}
          {renews !== null ? (
            <>
              <span data-testid="licence-renews">{renews}</span>.{" "}
            </>
          ) : null}
          <span data-testid="licence-status">{says}</span>
        </>
      }
    >
      <ButtonLink variant="outline" href={BILLING} target="_blank" rel="noopener noreferrer">
        Open billing account
      </ButtonLink>
    </SettingRow>
  )
}

/** The new key's field with Activate and Cancel; Enter activates, Escape cancels. */
function KeyField({
  working,
  onActivate,
  onClose,
}: {
  working: boolean
  onActivate: (key: string) => void
  onClose: () => void
}) {
  const [key, setKey] = useState("")
  const ready = key.trim() !== ""
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Input
        aria-label="New licence key"
        placeholder="Licence key"
        className="w-[240px] max-w-full"
        value={key}
        disabled={working}
        onChange={(event) => setKey(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && ready && !event.nativeEvent.isComposing) onActivate(key)
          if (event.key === "Escape") onClose()
        }}
      />
      <button
        type="button"
        className="q-btn primary"
        disabled={working || !ready}
        onClick={() => onActivate(key)}
      >
        Activate
      </button>
      <button type="button" className="q-btn quiet" disabled={working} onClick={onClose}>
        Cancel
      </button>
    </span>
  )
}

/** The masked key, or where a bought key is found when none is held; then a refusal's own words. */
function KeyHint({ masked, error }: { masked: string | null; error: string | null }) {
  return (
    <>
      {masked !== null ? (
        <span className="font-mono text-[12.5px]">{masked}</span>
      ) : (
        "Bought a licence? Enter its key from qualitylayer.dev/billing."
      )}
      {error !== null ? (
        <span role="alert" className="mt-1 block text-destructive">
          {error}
        </span>
      ) : null}
    </>
  )
}

/**
 * The key this computer holds, masked, with Change… (Enter key… when it holds none, as on a trial):
 * a field takes the key the way setup does (`qualitylayer licence activate`) and says the
 * refusal's own words when it is not accepted.
 */
function KeyRow({
  masked,
  onKey,
}: {
  /** Null when this computer holds no key yet (a trial, or no licence). */
  masked: string | null
  /** Takes the key like `qualitylayer licence activate`; rejects with the refusal's own words. */
  onKey: ((key: string) => Promise<void>) | undefined
}) {
  const [changing, setChanging] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    setChanging(false)
    setError(null)
  }
  const activate = async (key: string) => {
    if (onKey === undefined) return
    setWorking(true)
    setError(null)
    try {
      await onKey(key)
      close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
    setWorking(false)
  }
  const none = masked === null
  let control: ReactNode
  if (onKey === undefined) control = undefined
  else if (changing)
    control = (
      <KeyField working={working} onActivate={(key) => void activate(key)} onClose={close} />
    )
  else
    control = (
      <button
        type="button"
        className={none ? "q-btn primary" : "q-btn"}
        onClick={() => setChanging(true)}
      >
        {none ? "Enter key…" : "Change…"}
      </button>
    )
  return (
    <SettingRow
      label="Licence key"
      icon={<KeyRoundIcon className={ICON} />}
      testId="licence-key"
      hint={<KeyHint masked={masked} error={error} />}
    >
      {control}
    </SettingRow>
  )
}

export function LicenceTab({
  licence,
  onCopy,
  onKey,
}: {
  licence: Licence | null
  /** The App's copy: it says it copied, or that it could not. */
  onCopy: (text: string, note: string) => unknown
  /** Takes a new key like setup does; without it the key is shown and not changed here. */
  onKey?: (key: string) => Promise<void>
}) {
  return (
    <div className="q-sgs">
      <SettingsGroup testId="licence-card" title="Your licence">
        <BillingRow licence={licence} />
        {/* Every licence state takes a key here: a trial, a missing licence, or one not read. */}
        {onKey !== undefined || licence?.key ? (
          <KeyRow masked={licence?.key ?? null} onKey={onKey} />
        ) : null}
        <SettingRow
          label="On another computer"
          icon={<LaptopIcon className={ICON} />}
          hint={
            <>
              Install QualityLayer there, then run{" "}
              <code className="rounded bg-sunken px-1.5 py-px font-mono text-[12.5px]">
                {ACTIVATE}
              </code>{" "}
              with your licence key. One licence covers your computers.
            </>
          }
        >
          <button
            type="button"
            className="q-btn"
            onClick={() => void onCopy(ACTIVATE, "Copied the activation command")}
          >
            Copy activation command
          </button>
        </SettingRow>
        <SettingsMore summary="What the billing account holds">
          <p className="q-sg-foot">
            Subscription, invoices, payment method and seats. Sign in with your checkout email.
          </p>
        </SettingsMore>
      </SettingsGroup>

      <SettingsGroup
        testId="privacy-disclosure"
        title="What leaves this computer"
        end={
          <a className="q-link" href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
            Privacy
          </a>
        }
      >
        {/* One line a row: the icon, the label and when it happens. Where each goes is in the fold, and the row's tooltip. */}
        {LEAVES.map(({ label, hint, when, icon }) => (
          <SettingRow key={label} label={label} icon={icon} title={hint}>
            <span className="q-sr-value">{when}</span>
          </SettingRow>
        ))}
        <SettingsMore summary="More about what is sent">
          <ul className="q-sg-sent" aria-label="Where each goes">
            {LEAVES.flatMap(({ label, hint }) => (hint === undefined ? [] : [{ label, hint }])).map(
              ({ label, hint }) => (
                <li key={label}>
                  <b>{label}</b> {hint}
                </li>
              ),
            )}
          </ul>
          <p className="q-sg-foot">
            Task, Chat, artifact and memory content stays on your computers. Your agent receives the
            context you send through its normal input. Personal remote access uses your configured
            machines. A private support report also carries an error count.
          </p>
        </SettingsMore>
      </SettingsGroup>
    </div>
  )
}
