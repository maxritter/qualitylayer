import { CheckIcon, InfoIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { TaskSurfaceProps } from "../../interaction/props.ts"
import { useMainShortcut } from "../../kit/StepLine.tsx"
import { GetApproval } from "../../turn/GetApproval.tsx"

/** The person's approval of the change: it ships as it stands, never pushed by this click. */
async function saveDecision(surface: TaskSurfaceProps) {
  if (surface.onReviewDecision) return surface.onReviewDecision("approved", undefined, "only")
  const { task } = surface
  await surface.api.gate(task.id, "approved", undefined, task.gate?.id, "only", {
    revision: task.gate?.revision,
  })
  surface.reload()
  return true
}
function approvalLabel(saving: boolean, saved: boolean, error: string | null) {
  if (saving) return "Saving…"
  if (saved) return "Approved"
  if (error) return "Try again"
  return "Approve"
}

function withoutClosingPunctuation(reason: string): string {
  let end = reason.length
  while (end > 0 && ".!?".includes(reason.charAt(end - 1))) end--
  return reason.slice(0, end)
}

function ApprovalStatus({
  saving,
  saved,
  error,
}: {
  saving: boolean
  saved: boolean
  error: string | null
}) {
  return (
    <>
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={error ? "review-approval-error" : "ir-muted"}
      >
        {saving
          ? "Saving approval…"
          : saved
            ? "Approved"
            : error
              ? "Approval not saved. Review kept."
              : null}
      </span>
      {error ? (
        <Popover>
          <PopoverTrigger
            render={<Button variant="ghost" size="sm" aria-label="Approval error details" />}
          >
            <InfoIcon size={14} aria-hidden="true" />
            Details
          </PopoverTrigger>
          <PopoverContent align="end" collisionPadding={8} className="review-approval-diagnostics">
            <p>{error}</p>
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  )
}

/** The final decision uses the same header slot as Plan, without turning evidence into questions. */
export function ReviewApproval({ surface }: { surface: TaskSurfaceProps }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const disabled = saving || surface.live.busy || saved
  const approve = async () => {
    if (disabled) return
    setSaving(true)
    setError(null)
    try {
      const result = await saveDecision(surface)
      if (result === false) setError("Approval could not be saved. Your review is kept. Try again.")
      else if (result === true) setSaved(true)
    } catch (cause) {
      const reason =
        cause instanceof Error && cause.message.trim()
          ? cause.message.trim()
          : "Approval could not be saved"
      setError(`${withoutClosingPunctuation(reason)}. Your review is kept. Try again.`)
    } finally {
      setSaving(false)
    }
  }
  useMainShortcut({ label: "Approve", disabled, onClick: () => void approve() })
  return (
    <fieldset
      className="ir-plan-approval review-header-actions"
      aria-label="Review actions"
      data-testid="review-approval-actions"
    >
      <GetApproval
        key={surface.task.id}
        task={surface.task.id}
        detail={surface.task}
        target="final"
        disabled={disabled}
        onSettled={surface.reload}
      />
      <ApprovalStatus saving={saving} saved={saved} error={error} />
      {/* A plain Approve that never pushes (Max, 11 Nov): the Pull request button beside it does that. */}
      <Button disabled={disabled} onClick={() => void approve()}>
        <CheckIcon size={14} aria-hidden="true" />
        {approvalLabel(saving, saved, error)}
      </Button>
    </fieldset>
  )
}
