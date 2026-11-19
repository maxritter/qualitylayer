import { useEffect, useRef, useState } from "react"
import type { ReviewCandidateChoice, ReviewCandidateState } from "../../../core/review-candidate.ts"
import type { Api } from "../../api.ts"
import { ReviewCandidateDialog } from "./ReviewCandidateDialog.tsx"
import "./review-candidate.css"

type CandidateApi = Required<Pick<Api, "reviewCandidates" | "selectReviewCandidate">>
type Props = CandidateApi & { id: string; reload?: () => void }

export function ReviewCandidate(props: Props) {
  const { id, reviewCandidates } = props
  const [state, setState] = useState<ReviewCandidateState | null>(null)
  useEffect(() => {
    let active = true
    void reviewCandidates(id)
      .then((next) => {
        if (active) setState(next)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [reviewCandidates, id])
  if (!state) return null
  const selected = state.selected
  if (selected && selected.state !== "stale") return <SelectedCandidate candidate={selected} />
  if (!state.eligible && !state.prior?.stale && !selected) return null
  return <CandidateChooser {...props} state={state} setState={setState} />
}

function SelectedCandidate({
  candidate,
}: {
  candidate: NonNullable<ReviewCandidateState["selected"]>
}) {
  return (
    <section className="candidate-blocker">
      <strong>
        {candidate.state === "assigned" ? "Fresh review started" : "Fresh review requested"}
      </strong>
      <p tabIndex={-1} role="status">
        {candidate.branch ?? "Detached HEAD"} · <code>{candidate.head.slice(0, 12)}</code>
      </p>
    </section>
  )
}

function CandidateChooser({
  id,
  reviewCandidates,
  selectReviewCandidate,
  reload,
  state,
  setState,
}: Props & { state: ReviewCandidateState; setState: (next: ReviewCandidateState) => void }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")
  const button = useRef<HTMLButtonElement>(null)
  async function show() {
    setError("")
    try {
      const next = await reviewCandidates(id)
      setState(next)
      setOpen(next.eligible)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  async function start(current: ReviewCandidateChoice, acknowledged: boolean) {
    setError("")
    try {
      const next = await selectReviewCandidate(id, {
        version: state.version,
        checkout: current.checkout,
        head: current.head,
        branch: current.branch,
        acknowledgeShared: acknowledged,
      })
      setState(next)
      reload?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setOpen(false)
    }
  }
  return (
    <section className="candidate-blocker" data-testid="review-candidate">
      <strong>
        {state.selected?.state === "stale"
          ? "The selected candidate changed"
          : "A rebase changed the commits for review"}
      </strong>
      <p>
        {state.prior?.stale
          ? `${state.prior.stale} of ${state.prior.commits} earlier receipts refer to commits outside this history. `
          : ""}
        {state.eligible
          ? "Choose a checkout for a fresh independent review."
          : "Finish or put aside local edits in a linked worktree, then reopen Verify."}
      </p>
      <button
        type="button"
        ref={button}
        disabled={!state.eligible}
        className="q-btn"
        onClick={() => void show()}
      >
        Choose review commit…
      </button>
      {error && <p role="alert">{error}</p>}
      {open && (
        <ReviewCandidateDialog
          state={state}
          close={() => setOpen(false)}
          focusAfterClose={() => button.current}
          submit={start}
        />
      )}
    </section>
  )
}
