// Pull request (App Model: get-approval, get-approval-final; Max, 11 Nov 2026): one button in the header
// on the Plan and on Verify, GitHub only. A click pushes the branch (the Plan on ql/plan/<task>, or the
// task's branch) and opens GitHub's compare page, prefilled; the person creates the pull request there, in
// GitHub's UI. The App then finds it by its branch and the button names it: #7 · waiting on the Plan, #7 ·
// open on Verify, #7 · update once the Plan or the code moved (a click pushes again; the request follows).
// Its menu opens the request. A push that cannot go says why in a toast with the fix. The App looks every
// 30 seconds while the page is open: an approving review settles the gate and the page reloads.

import { ChevronDownIcon, ExternalLinkIcon, UploadIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { OutsideState } from "../../core/integrations/approval-app.ts"
import type { TaskDetail } from "../api.ts"
import { PortableReviewDraft } from "./PortableReviewDraft.tsx"
import { ReviewProviderIcon } from "./ReviewProviderIcon.tsx"
import "./get-approval.css"

const LOOK_MS = 30_000

/** A refusal's words and its first fix, as the toast says them. */
class Refusal extends Error {
  constructor(
    message: string,
    readonly fix: string | undefined,
  ) {
    super(message)
  }
}

async function answer(response: Response): Promise<OutsideState> {
  if (response.status === 403)
    throw new Refusal("This browser may only watch the App.", "open it with qualitylayer app")
  const payload = (await response.json().catch(() => ({}))) as OutsideState & {
    ok?: boolean
    error?: { message?: string; missing?: { what?: string; move?: string }[] }
  }
  if (!response.ok || payload.ok !== true)
    throw new Refusal(
      payload.error?.message ?? "The App could not reach its server.",
      payload.error?.missing?.find((m) => m.move !== undefined)?.move,
    )
  return payload
}

type Target = "plan" | "final"

export const outsideApi = {
  read: (task: string, target: Target = "plan") =>
    fetch(
      `/api/tasks/${encodeURIComponent(task)}/outside-approval${target === "final" ? "?target=final" : ""}`,
    ).then(answer),
  send: (task: string, target: Target = "plan") =>
    fetch(`/api/tasks/${encodeURIComponent(task)}/outside-approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    }).then(answer),
}

/**
 * A tab opened while the click still counts as the person's (a tab opened after the push would be
 * blocked as a popup), pointed at GitHub once the push answers, closed when it fails.
 */
function pendingTab(): { go: (url: string) => void; drop: () => void } {
  const tab = window.open("", "_blank")
  if (tab !== null) tab.opener = null
  return {
    go: (url) => {
      if (tab === null || tab.closed) window.open(url, "_blank", "noopener")
      else tab.location.href = url
    },
    drop: () => tab?.close(),
  }
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
  detail?: Pick<TaskDetail, "title" | "request" | "prDescription">
  readPlan?: () => Promise<string>
  /** Not ready to approve (answers left, a review running): nothing is pushed either. */
  disabled: boolean
  /** An approval came back from GitHub: the task page reloads. */
  onSettled?: () => void
  /** The Plan (default) or the change in its final review. */
  target?: Target
  api?: typeof outsideApi
}) {
  const [state, setState] = useState<OutsideState | null>(null)
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null)
  const [sending, setSending] = useState(false)
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
  // Approved on GitHub: the page reloads and the Plan's meta line names the reviewer.
  if (state === null || state.state === "approved") return null
  const isPlan = target === "plan"
  async function prepare() {
    if (!detail) return
    setSending(true)
    try {
      const planText = isPlan ? await readPlan?.() : undefined
      const summary = planText
        ?.match(/^## Summary[^\S\n]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/im)?.[1]
        ?.trim()
      const body = isPlan
        ? summary || detail.request || detail.title
        : detail.prDescription || detail.request || detail.title
      setDraft({ title: detail.title, body })
    } catch {
      setDraft({ title: detail.title, body: detail.request || detail.title })
    } finally {
      setSending(false)
    }
  }
  // Before the request exists the push opens GitHub's page in a tab; an update of an open one does not.
  const push = async (withTab: boolean) => {
    const tab = withTab ? pendingTab() : { go: () => undefined, drop: () => undefined }
    setSending(true)
    try {
      const next = await api.send(task, target)
      setState(next)
      if (next.open) tab.go(next.open)
      else tab.drop()
      toast.success(
        next.sent?.number !== undefined
          ? `Pushed · #${next.sent.number} follows on GitHub`
          : "Pushed · create the pull request on GitHub",
        next.open
          ? {
              action: {
                label: "Open",
                onClick: () => window.open(next.open, "_blank", "noopener"),
              },
            }
          : {},
      )
    } catch (cause) {
      tab.drop()
      // A refusal said only in a tooltip reads as a click that did nothing.
      const fix = (cause as { fix?: unknown } | null)?.fix
      const said = typeof fix === "string" && fix !== "" ? ` Fix: ${fix}` : ""
      toast.error("Not pushed", {
        description: `${cause instanceof Error ? cause.message : String(cause)}${said}`,
        ...(detail && state.destination && state.sent?.number === undefined
          ? { action: { label: "Copy a draft", onClick: () => void prepare() } }
          : {}),
      })
    } finally {
      setSending(false)
    }
  }
  const sent = state.sent
  const number = sent?.number
  const destination = state.destination
  if (
    destination &&
    (destination.host !== "github.com" || draft) &&
    detail &&
    number === undefined
  ) {
    return (
      <span className="q-ga" data-testid="get-approval">
        <Button
          variant="outline"
          disabled={disabled || sending}
          onClick={() => void prepare()}
          data-testid="pull-request"
        >
          <ReviewProviderIcon provider={destination.provider} />
          {destination.provider === "gitlab" ? "Merge request" : "Pull request"}
        </Button>
        {draft && (
          <PortableReviewDraft
            key={task + target}
            plan={isPlan}
            destination={destination}
            initialTitle={draft.title}
            initialBody={draft.body}
            onClose={() => setDraft(null)}
          />
        )}
      </span>
    )
  }
  if (number === undefined || sent === null)
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
  const stale = state.state === "stale"
  const label = sending
    ? "Pushing…"
    : `#${number} · ${stale ? "update" : target === "final" ? "open" : "waiting"}`
  return (
    <span className="q-ga" data-testid="get-approval" data-state={state.state}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              disabled={sending}
              aria-label={`Pull request #${number} on GitHub, ${stale ? "changed since the push" : target === "final" ? "open" : "waiting"}`}
              title={sent.url}
              data-testid="pull-request"
            />
          }
        >
          <ReviewProviderIcon provider="github" size={14} />
          {label}
          <ChevronDownIcon size={14} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" collisionPadding={8} className="review-approval-menu">
          <DropdownMenuItem
            data-testid="get-approval-open"
            onClick={() => window.open(sent.url, "_blank", "noopener")}
          >
            <ExternalLinkIcon size={14} aria-hidden="true" />
            {`#${number} on GitHub`}
          </DropdownMenuItem>
          {stale ? (
            <DropdownMenuItem
              disabled={disabled}
              data-testid="pull-request-update"
              onClick={() => void push(false)}
            >
              <UploadIcon size={14} aria-hidden="true" />
              Push the update
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}
