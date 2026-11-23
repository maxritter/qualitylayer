// A reviewer's finding on its line of the change: who found it, how it was settled, and what the
// person can do with it. Fixed ones say so and can be reopened as the person's change request; one
// the build kept against its reviewer, or one still open, needs the person: make it a change request,
// or say why it is not a problem, which becomes a project lesson.

import { useState } from "react"
import type { LineFinding } from "../../core/review/findings.ts"
import { initialsOf } from "../model.ts"

function findingTag(f: LineFinding): string {
  if (f.disposition?.kind === "adopted") return "your change request"
  if (f.disposition?.kind === "dismissed") return "not a problem"
  return f.state === "fixed" ? "fixed" : "needs you"
}

function DismissReasonForm({
  id,
  why,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  id: string
  why: string
  busy: boolean
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="acts">
      <label className="sr-only" htmlFor={`why-${id}`}>
        Why it is not a problem
      </label>
      <input
        id={`why-${id}`}
        className="rw-why"
        // biome-ignore lint/a11y/noAutofocus: the box opens because the person asked for it
        autoFocus
        value={why}
        placeholder="Why it is not a problem; the next reviewers learn it"
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="q-link"
        disabled={busy || why.trim() === ""}
        onClick={onSave}
      >
        Save
      </button>
      <button type="button" className="q-link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

function FindingActionBar({
  finding: f,
  busy,
  onAct,
  onStartDismiss,
}: {
  finding: LineFinding
  busy: boolean
  onAct: (kind: "adopted" | "dismissed", reason?: string) => void
  onStartDismiss: () => void
}) {
  return (
    <div className="acts">
      <button type="button" className="q-link" disabled={busy} onClick={() => onAct("adopted")}>
        {f.state === "fixed" ? "Reopen" : "Make it a change request"}
      </button>
      {f.state === "kept" && f.reason !== undefined ? (
        <button
          type="button"
          className="q-link"
          disabled={busy}
          onClick={() => onAct("dismissed", f.reason)}
        >
          Agree with the build
        </button>
      ) : f.state === "open" ? (
        <button type="button" className="q-link" onClick={onStartDismiss}>
          Not a problem…
        </button>
      ) : null}
      <span className="rp-state">
        {f.state === "fixed" ? "fixed by the build session · checked again" : "in Look first"}
      </span>
    </div>
  )
}

export function FindingThread({
  finding: f,
  onFinding,
}: {
  finding: LineFinding
  onFinding?: (f: LineFinding, kind: "adopted" | "dismissed", reason?: string) => Promise<void>
}) {
  const [why, setWhy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const done = f.disposition
  const act = async (kind: "adopted" | "dismissed", reason?: string) => {
    if (onFinding === undefined) return
    setBusy(true)
    try {
      await onFinding(f, kind, reason)
      setWhy(null)
    } finally {
      setBusy(false)
    }
  }
  const open = done === undefined && f.state !== "fixed"
  const canAct = onFinding !== undefined && (open || (f.state === "fixed" && done === undefined))
  return (
    <div className="q-thread rp-bubble rw-finding" data-testid="finding-thread">
      <div className="who">
        <span className="q-av sm" aria-hidden="true">
          {initialsOf(f.by.replace(/ · .*$/, ""))}
        </span>
        {f.by} · line {f.line}
        <span className={open ? "rw-ftag need" : "rw-ftag"}>{findingTag(f)}</span>
      </div>
      <p>{f.what}</p>
      {f.state === "kept" && f.reason !== undefined ? (
        <p className="rw-fdim">
          Kept by the build: {f.reason} The reviewer still disagrees, so this one is yours.
        </p>
      ) : null}
      {done?.kind === "dismissed" ? (
        <p className="rw-fdim">Saved as a project lesson: {done.reason}</p>
      ) : null}
      {onFinding !== undefined && why !== null ? (
        <DismissReasonForm
          id={f.id}
          why={why}
          busy={busy}
          onChange={setWhy}
          onSave={() => void act("dismissed", why.trim())}
          onCancel={() => setWhy(null)}
        />
      ) : canAct ? (
        <FindingActionBar
          finding={f}
          busy={busy}
          onAct={(kind, reason) => void act(kind, reason)}
          onStartDismiss={() => setWhy("")}
        />
      ) : null}
    </div>
  )
}
