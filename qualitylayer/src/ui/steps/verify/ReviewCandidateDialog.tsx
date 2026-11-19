import {
  Check,
  ChevronRight,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  History,
  TriangleAlert,
} from "lucide-react"
import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { ReviewCandidateChoice, ReviewCandidateState } from "../../../core/review-candidate.ts"

type Props = {
  state: ReviewCandidateState
  close: () => void
  focusAfterClose: () => HTMLElement | null
  submit: (choice: ReviewCandidateChoice, acknowledged: boolean) => Promise<void>
}

export function ReviewCandidateDialog({ state, close, focusAfterClose, submit }: Props) {
  const [choice, setChoice] = useState(
    () => (state.choices.find((row) => !row.shared) ?? state.choices[0])?.checkout,
  )
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const current = state.choices.find((row) => row.checkout === choice)
  const canStart = current !== undefined && (!current.shared || acknowledged)
  async function start() {
    if (!current || !canStart || busy) return
    setBusy(true)
    try {
      await submit(current, acknowledged)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!busy && !next) close()
      }}
    >
      <DialogContent
        className="rc-dialog"
        finalFocus={focusAfterClose}
        initialFocus={() =>
          document.querySelector<HTMLInputElement>(".rc-dialog .rc-row input:checked")
        }
      >
        <header className="rc-head">
          <span className="rc-icon">
            <GitPullRequestArrow size={20} />
          </span>
          <div>
            <DialogTitle>Choose review commit</DialogTitle>
            <div className="rc-repo">
              <FolderGit2 size={14} />
              {state.repository}
            </div>
          </div>
        </header>
        <DialogDescription className="sr-only">
          Choose a checkout for a fresh review against the approved Plan.
        </DialogDescription>
        <fieldset disabled={busy} className="rc-list">
          <legend>Checkout</legend>
          {state.choices.map((item) => (
            <label className="rc-row" key={item.checkout}>
              <input
                type="radio"
                name="review-checkout"
                checked={choice === item.checkout}
                onChange={() => {
                  setChoice(item.checkout)
                  setAcknowledged(false)
                }}
              />
              <GitBranch size={16} />
              <span className="rc-row-copy">
                <strong>{item.branch ?? "Detached HEAD"}</strong>
                <span>{item.subject}</span>
              </span>
              <code>{item.head.slice(0, 7)}</code>
              <span className="rc-selected" aria-hidden="true">
                {choice === item.checkout && <Check size={12} />}
              </span>
            </label>
          ))}
        </fieldset>
        {current && (
          <details className="rc-details">
            <summary>
              <History size={14} />
              Review details
              <ChevronRight size={14} />
            </summary>
            <dl>
              <dt>Worktree</dt>
              <dd>{current.checkout}</dd>
              <dt>Candidate</dt>
              <dd>
                <code>{current.head}</code>
              </dd>
              {state.prior && (
                <>
                  <dt>Previous</dt>
                  <dd>
                    <code>
                      {state.prior.branch} {state.prior.head}
                    </code>
                  </dd>
                </>
              )}
            </dl>
            <p>
              Earlier evidence stays with its commit. The reviewer checks this whole candidate
              against the Plan.
            </p>
          </details>
        )}
        {current?.shared && (
          <label className="rc-warning">
            <TriangleAlert size={16} />
            <span>Include changes from other tasks on {current.branch ?? "this checkout"}</span>
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
          </label>
        )}
        <footer>
          <button className="q-btn" type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            className="q-btn primary rc-confirm"
            type="button"
            disabled={busy || !canStart}
            onClick={() => void start()}
          >
            <GitCommitHorizontal size={15} />
            Start fresh review
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
