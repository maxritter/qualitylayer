// Pull request (App Model: get-approval, get-approval-final; Max, 11 Nov 2026): one button in the header
// on the Plan and on Verify, GitHub only. A click pushes the branch (the Plan on ql/plan/<task>, or the
// task's branch) and opens GitHub's compare page, prefilled; the person creates the pull request there, in
// GitHub's UI. The App then finds it by its branch and the button names it: #7 · waiting on the Plan, #7 ·
// open on Verify, #7 · update once the Plan or the code moved (a click pushes again; the request follows).
// Its menu opens the request. A push that cannot go says why in a toast with the fix. The App looks every
// 30 seconds while the page is open: an approving review settles the gate and the page reloads.

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { OutsideState } from "../../core/integrations/approval-app.ts"
import {
  buildPortableDraft,
  GitHubPullRequestMenu,
  type OutsideDetail,
  type OutsideTarget,
  outsideApi,
  PortableDraftControl,
  pushOutsideApproval,
} from "./GetApprovalParts.tsx"
import { ReviewProviderIcon } from "./ReviewProviderIcon.tsx"
import "./get-approval.css"

export { outsideApi }

const LOOK_MS = 30_000

function isPortableDraftMode(
  destination: OutsideState["destination"],
  draft: { title: string; body: string } | null,
  detail: OutsideDetail | undefined,
  number: number | undefined,
): destination is NonNullable<OutsideState["destination"]> {
  if (!destination || !detail || number !== undefined) return false
  return destination.host !== "github.com" || draft !== null
}

function useOutsideApprovalState(
  api: typeof outsideApi,
  task: string,
  target: OutsideTarget,
  onSettled?: () => void,
) {
  const [state, setState] = useState<OutsideState | null>(null)
  const look = useCallback(
    () =>
      api.read(task, target).then(
        (read) => {
          setState(read)
          if (read.state === "approved") onSettled?.()
        },
        () => undefined,
      ),
    [api, task, target, onSettled],
  )
  useEffect(() => {
    void look()
    const timer = setInterval(() => void look(), LOOK_MS)
    return () => clearInterval(timer)
  }, [look])
  return [state, setState] as const
}

export function GetApproval({
  task,
  disabled,
  onSettled,
  target = "plan",
  api = outsideApi,
  detail,
  readPlan,
}: {
  task: string
  detail?: OutsideDetail
  readPlan?: () => Promise<string>
  /** Not ready to approve (answers left, a review running): nothing is pushed either. */
  disabled: boolean
  /** An approval came back from GitHub: the task page reloads. */
  onSettled?: () => void
  /** The Plan (default) or the change in its final review. */
  target?: OutsideTarget
  api?: typeof outsideApi
}) {
  const [state, setState] = useOutsideApprovalState(api, task, target, onSettled)
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null)
  const [sending, setSending] = useState(false)

  if (state === null || state.state === "approved") return null
  const isPlan = target === "plan"
  const prepare = async () => {
    if (!detail) return
    setSending(true)
    try {
      setDraft(await buildPortableDraft(detail, isPlan, readPlan))
    } finally {
      setSending(false)
    }
  }
  const push = async (withTab: boolean) => {
    setSending(true)
    try {
      await pushOutsideApproval({
        api,
        task,
        target,
        withTab,
        state,
        detail,
        onState: setState,
        onPrepareDraft: () => void prepare(),
      })
    } finally {
      setSending(false)
    }
  }

  const sent = state.sent
  const number = sent?.number
  if (isPortableDraftMode(state.destination, draft, detail, number)) {
    return (
      <PortableDraftControl
        task={task}
        target={target}
        isPlan={isPlan}
        destination={state.destination}
        disabled={disabled}
        sending={sending}
        draft={draft}
        onPrepare={() => void prepare()}
        onCloseDraft={() => setDraft(null)}
      />
    )
  }
  if (number === undefined || sent === null) {
    return (
      <span className="q-ga" data-testid="get-approval" data-state={state.state}>
        <Button
          variant="outline"
          disabled={disabled || sending}
          title={sent?.compare}
          onClick={() => void push(true)}
          data-testid="pull-request"
        >
          <ReviewProviderIcon provider="github" size={14} />
          {sending ? "Pushing…" : "Pull request"}
        </Button>
      </span>
    )
  }
  return (
    <GitHubPullRequestMenu
      state={state}
      target={target}
      number={number}
      url={sent.url}
      disabled={disabled}
      sending={sending}
      onUpdate={() => void push(false)}
    />
  )
}
