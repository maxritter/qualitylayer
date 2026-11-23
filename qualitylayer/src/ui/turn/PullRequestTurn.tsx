// The Review page's top card after the approval.

import { useState } from "react"
import { toast } from "sonner"
import { launchAgent, stagePrompt } from "../../core/run/launch-spec.ts"
import { isWaiting, type PullRequestLife } from "../../core/ship/pr-words.ts"
import type { Api, TaskDetail } from "../api.ts"
import { ContinueCommand } from "./ContinueCommand.tsx"
import { buildWaitingEntries, PullRequestCalm } from "./PullRequestTurnParts.tsx"
import { TurnLabel } from "./TurnLabel.tsx"

const SAID_FITS = 4
const SAID_SHOWN = 2
const shownOf = (count: number) => (count > SAID_FITS ? SAID_SHOWN : count)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What waits, in a title: "2 threads and 1 failing check wait on you". */
export function waitingTitle(life: PullRequestLife): string {
  const w = life.waiting
  const parts = [
    w.threads > 0 ? plural(w.threads, "thread", "threads") : null,
    w.failing > 0 ? plural(w.failing, "failing check", "failing checks") : null,
    w.changes ? "a request for changes" : null,
    w.conflict === true ? "a conflict with its base" : null,
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) return "A fix is ready to push"
  const count = w.threads + w.failing + (w.changes ? 1 : 0) + (w.conflict === true ? 1 : 0)
  const said =
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "")
  const verb = parts.length === 1 && count === 1 ? "waits" : "wait"
  return `${said.charAt(0).toUpperCase()}${said.slice(1)} ${verb} on you`
}

function WaitingBody({
  task,
  life,
  command,
}: {
  task: TaskDetail
  life: PullRequestLife
  command: string
}) {
  const [all, setAll] = useState(false)
  const entries = buildWaitingEntries(life)
  const limit = shownOf(entries.length)
  return (
    <div className="pr-turn-b">
      <ul className="pr-said-list" aria-label="What waits on you">
        {(all ? entries : entries.slice(0, limit)).map((entry) => entry.node)}
        {entries.length > limit ? (
          <li className="pr-said-more">
            <button type="button" className="q-link" onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${entries.length}`}
            </button>
          </li>
        ) : null}
      </ul>
      <p className="pr-in">
        In your agent, in <code>{task.projectName}</code>
      </p>
      <ContinueCommand
        command={command}
        testId="review-command"
        copiedMessage="Copied. Paste it in your agent."
      />
    </div>
  )
}

function WaitingFooter({
  fixReady,
  asking,
  busy,
  onAct,
}: {
  fixReady: boolean
  asking: boolean
  busy: "push" | "leave" | null
  onAct: (what: "push" | "leave") => void
}) {
  return (
    <footer className="pr-turn-f">
      {fixReady ? (
        <button
          type="button"
          className="q-btn primary"
          disabled={busy !== null}
          onClick={() => onAct("push")}
          data-testid="push-fix"
        >
          {busy === "push" ? "Pushing…" : "Push the fix"}
        </button>
      ) : null}
      {asking ? (
        <button
          type="button"
          className="q-link"
          disabled={busy !== null}
          onClick={() => onAct("leave")}
          data-testid="leave-pull-request"
        >
          Leave them for now
        </button>
      ) : null}
      {asking ? (
        <span className="pr-hint">Settled answers are posted on GitHub in your name.</span>
      ) : null}
    </footer>
  )
}

async function performPullRequestAction(
  api: Api,
  taskId: string,
  what: "push" | "leave",
  reload: (() => void) | undefined,
): Promise<string | null> {
  try {
    if (what === "push") {
      await api.pushFix(taskId)
      toast.success("Pushed. GitHub runs the checks again.")
    } else {
      await api.leavePullRequest(taskId)
    }
    reload?.()
    return null
  } catch (cause) {
    return cause instanceof Error ? cause.message : "That did not go through. Try again."
  }
}

/** The Your turn card: what waits, the command for the agent, Leave them for now, Push the fix. */
function Waiting({
  task,
  life,
  api,
  reload,
}: {
  task: TaskDetail
  life: PullRequestLife
  api: Api
  reload: (() => void) | undefined
}) {
  const [busy, setBusy] = useState<"push" | "leave" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const w = life.waiting
  const asking = w.threads + w.failing > 0 || w.changes || w.conflict === true
  const command = stagePrompt(
    launchAgent(task.session?.agent ?? "claude-code"),
    task.slug,
    "verify",
  )
  const act = async (what: "push" | "leave") => {
    setBusy(what)
    setError(null)
    const err = await performPullRequestAction(api, task.id, what, reload)
    if (err !== null) setError(err)
    setBusy(null)
  }
  return (
    <section
      className="ir-step-turn pr-turn"
      id="your-turn"
      aria-label="Your turn"
      data-testid="pull-request-turn"
      tabIndex={-1}
    >
      <TurnLabel {...(life.number !== null ? { why: `pull request #${life.number}` } : {})} />
      <header>
        <h2>{waitingTitle(life)}</h2>
        {asking ? null : (
          <p>
            Your agent fixed what you agreed to and committed it. QualityLayer pushes nothing on its
            own: push the fix to update the pull request.
          </p>
        )}
      </header>
      {asking ? <WaitingBody task={task} life={life} command={command} /> : null}
      {error !== null ? (
        <p className="pr-error" role="alert">
          {error}
        </p>
      ) : null}
      <WaitingFooter
        fixReady={w.fixReady}
        asking={asking}
        busy={busy}
        onAct={(what) => void act(what)}
      />
    </section>
  )
}

/**
 * The card at the top of a shipped task's Review page. Nothing is drawn for a task with no pull
 * request, or one this page cannot act on (the share link and plain file have no `api`).
 */
export function PullRequestTurn({
  task,
  api,
  reload,
}: {
  task: TaskDetail
  api: Api | undefined
  reload: (() => void) | undefined
}) {
  const life = task.pullRequest
  if (task.stage !== "shipped" || life === undefined) return null
  const waits = life.state === "open" && isWaiting(life.waiting)
  if (waits && api !== undefined)
    return <Waiting task={task} life={life} api={api} reload={reload} />
  return <PullRequestCalm task={task} life={life} />
}
