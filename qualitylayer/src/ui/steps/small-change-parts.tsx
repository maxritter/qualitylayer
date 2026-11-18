// The small change's part of the step pages, drawn as the App Model draws it (step-pages.jsx:
// IntakeRow): the quiet row under the Plan's gist with its one choice. The verification rounds are
// one count in Verify's counts row.

import { LayersIcon, Minimize2Icon } from "lucide-react"
import { useState } from "react"
import type { Intake } from "../../core/task-flow.ts"
import type { Api } from "../api.ts"

/** How this task runs: the system's pick and its reason, and the one choice that overrules it. */
export function IntakeRow({
  intake,
  taskId,
  api,
  reload,
}: {
  intake: Intake
  taskId: string
  api: Api | undefined
  reload: (() => void) | undefined
}) {
  const [pick, setPick] = useState(intake.pick)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const small = pick === "small"
  const choose = async (profile: "small" | "full") => {
    if (profile === pick || api === undefined || sending) return
    setSending(true)
    setError(null)
    try {
      await api.putProfile(taskId, profile)
      setPick(profile)
      reload?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSending(false)
    }
  }
  return (
    <section className="ssc-intake-wrap" aria-label="How this task runs" data-testid="intake-row">
      <div className="ssc-intake">
        {small ? (
          <Minimize2Icon className="ssc-intake-icon" aria-hidden="true" />
        ) : (
          <LayersIcon className="ssc-intake-icon" aria-hidden="true" />
        )}
        <div className="ssc-intake-m">
          <span>
            <b>{small ? "Small change" : "Full workflow"}</b>
            <span className="ssc-chip">{intake.chosen ? "your choice" : "picked for you"}</span>
          </span>
          <span className="ssc-sub">{pick === intake.pick ? intake.reason : changed(pick)}</span>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: two pressed buttons in a row; a fieldset would bring its own border and legend */}
        <div className="ssc-seg" role="group" aria-label="The way this task runs">
          <button
            type="button"
            aria-pressed={small}
            disabled={sending || (!intake.offered && !small)}
            onClick={() => void choose("small")}
          >
            Small change
          </button>
          <button
            type="button"
            aria-pressed={!small}
            disabled={sending}
            onClick={() => void choose("full")}
          >
            Full workflow
          </button>
        </div>
      </div>
      <p className="ssc-note" role={error !== null ? "alert" : undefined}>
        {error ??
          (small
            ? "A one-page Plan, one build step, one fresh reviewer who also adds the missing tests. It becomes the full workflow when the Plan or the build needs more."
            : "You can switch until the Plan is approved.")}
      </p>
    </section>
  )
}

const changed = (pick: "small" | "full") =>
  pick === "small"
    ? "A one-page Plan, one build step, one independent review that also adds the missing tests."
    : "You chose the full workflow. The change fits a small one."
