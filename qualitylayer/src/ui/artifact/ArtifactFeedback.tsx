// Deliberate feedback on an artifact (App Model artifact-feedback.html, approved 16 November 2026):
// the Feedback button that arms one mark, the hint while it is armed, and the chip beside selected
// words. Plain clicks, drags and selections always use the artifact itself.

import { MessageSquarePlusIcon, MousePointer2Icon } from "lucide-react"
import type { Ref } from "react"
import type { ArtifactMark } from "./ArtifactPageFrame.tsx"
import "./feedback.css"

export function FeedbackButton({
  armed,
  labelled,
  onToggle,
  ref,
}: {
  armed: boolean
  labelled: boolean
  onToggle: () => void
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      type="button"
      className="dg-t dg-fb"
      aria-pressed={armed}
      aria-label="Feedback"
      title="Mark a spot or area for feedback"
      data-testid="artifact-feedback"
      onClick={onToggle}
    >
      <MessageSquarePlusIcon aria-hidden="true" />
      {labelled ? <span className="dg-fb-label">Feedback</span> : null}
    </button>
  )
}

/** Shown over the canvas while Feedback is armed. */
export function FeedbackHint({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="dg-mark-hint" role="status" data-testid="artifact-feedback-hint">
      <MousePointer2Icon aria-hidden="true" />
      <span>Click a spot or drag an area</span>
      <button type="button" className="dg-mark-esc" aria-label="Cancel feedback" onClick={onCancel}>
        Esc
      </button>
    </div>
  )
}

/** Beside words selected on the page: choosing it marks them. Copying the selection still works. */
export function SelectionChip({
  selection,
  onMark,
}: {
  selection: ArtifactMark
  onMark: (selection: ArtifactMark) => void
}) {
  const last = selection.boxes.at(-1)
  if (last === undefined) return null
  const width = typeof window === "undefined" ? 1280 : window.innerWidth
  return (
    <button
      type="button"
      className="dg-mark-chip"
      data-testid="artifact-feedback-chip"
      style={{
        left: Math.max(4, Math.min(last.x + last.width + 6, width - 112)),
        top: Math.max(4, last.y - 34),
      }}
      // Pressing the chip must not move focus or clear the page's selection before it is read.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => onMark(selection)}
    >
      <MessageSquarePlusIcon aria-hidden="true" />
      Feedback
    </button>
  )
}
