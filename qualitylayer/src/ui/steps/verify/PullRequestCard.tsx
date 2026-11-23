// The pull request after the approval, on the Review page: its checks with their names and results,
// the threads and requests reviewers left, and one line that says what QualityLayer does with it
// (follows it, never merges it, closes the task when it is merged). Read from the task's own
// `pull-request.json`, which the server keeps current while a window is open; without `gh` the card
// says the pull request is not followed here.

import { GitPullRequestIcon } from "lucide-react"
import { useState } from "react"
import type { PrCheck, PrThreadRow } from "../../../core/ship/pr-record.ts"
import {
  isWaiting,
  outcomeWords,
  type PrWake,
  type PrWatch,
  type PrWatchState,
  type PullRequestLife,
  type ReviewerLine,
  reviewerLines,
  statsWords,
  watchWords,
} from "../../../core/ship/pr-words.ts"
import { WhoMark } from "../../kit/WhoMark.tsx"

/** The checks that need a look first: failed, then running, then the ones that passed. */
const ORDER: Record<PrCheck["result"], number> = { failed: 0, running: 1, passed: 2 }

/** How many checks show before the rest fold. */
const SHOWN = 8

const MARK = { failed: "stop", running: "agent", passed: "check" } as const
const REVIEW_MARK = {
  asked: "todo",
  approved: "check",
  changes: "stop",
  commented: "quiet",
  dismissed: "quiet",
} as const satisfies Record<ReviewerLine["kind"], string>
const WORD = { failed: "failed", running: "running", passed: "passed" } as const

const isUrl = (text: string) => /^https?:\/\//.test(text)

/** The last two parts of a path, as the line of a thread names its file. */
const tail = (path: string) => path.split("/").slice(-2).join("/")

/** A check is its mark and its name: the mark says passed, failing or running; a failing one adds its log, unless Your turn above already carries it. */
function CheckRow({ check, why }: { check: PrCheck; why: boolean }) {
  return (
    <li className="pr-row" data-result={check.result}>
      <WhoMark who={MARK[check.result]} running={check.result === "running"} />
      <span className="pr-what">
        {check.name}
        <span className="sr-only"> · {WORD[check.result]}</span>
        {check.result === "failed" && why && check.summary ? (
          <span className="pr-words"> · {check.summary}</span>
        ) : null}
      </span>
      {check.result === "failed" && why && isUrl(check.detail) ? (
        <a className="pr-side" href={check.detail} target="_blank" rel="noreferrer">
          Read the log
        </a>
      ) : (
        <span className="pr-side" />
      )}
    </li>
  )
}

/** The agent's watch: a turning ring while it watches, fixes or resolves; the end it came to otherwise. */
const WATCH_MARK = {
  watching: "agent",
  fixing: "agent",
  resolving: "agent",
  green: "check",
  "gave-up": "stop",
  "no-checks": "quiet",
  "timed-out": "quiet",
} as const satisfies Record<PrWatchState, string>

function WatchRow({ watch }: { watch: PrWatch }) {
  const words = watchWords(watch)
  if (words === null) return null
  const at = WATCH_MARK[watch.state]
  return (
    <li className="pr-row" data-testid="pr-watch" data-state={watch.state}>
      <WhoMark who={at} running={at === "agent"} />
      <span className="pr-what">{words}</span>
      <span className="pr-side" />
    </li>
  )
}

/** What QualityLayer did when something new came on the pull request: woke the agent, or did not and why. */
function WakeRow({ wake }: { wake: PrWake }) {
  const woken = wake.state === "woken"
  return (
    <li className="pr-row" data-testid="pr-wake" data-state={wake.state}>
      <WhoMark who={woken ? "agent" : "quiet"} />
      <span className="pr-what">
        {woken ? `Agent woken about ${wake.what}` : `Agent not woken about ${wake.what}`}
        {wake.reason !== undefined ? <span className="pr-words"> · {wake.reason}</span> : null}
      </span>
      <span className="pr-side" />
    </li>
  )
}

/** What the agent is doing about the open pull request: its watch, and whether QualityLayer woke it. */
function AgentBlock({ life }: { life: PullRequestLife }) {
  const watching =
    life.watch !== undefined && life.watch !== null && watchWords(life.watch) !== null
  if (!watching && !life.wake) return null
  return (
    <>
      <h3 className="pr-k">Agent</h3>
      <ul className="pr-list">
        {watching && life.watch ? <WatchRow watch={life.watch} /> : null}
        {life.wake ? <WakeRow wake={life.wake} /> : null}
      </ul>
    </>
  )
}

function ThreadRow({ thread, settled }: { thread: PrThreadRow; settled: boolean }) {
  return (
    <li className="pr-row" data-kind="thread" data-settled={settled}>
      <WhoMark who={settled ? "done" : "you"} />
      <span className="pr-what">
        <b>{thread.by}</b> on{" "}
        <code>
          {tail(thread.path)}
          {thread.line !== null ? `:${thread.line}` : ""}
        </code>
        <span className="pr-words"> · {thread.text}</span>
      </span>
      <span className="pr-side">{settled ? "settled with your agent" : thread.via}</span>
    </li>
  )
}

/** What the card's last line says, by the pull request's state; a merged pull request needs none. */
function footer(life: PullRequestLife): string | null {
  if (!life.followed) return "The pull request is not followed here: gh is not installed."
  if (life.state === "merged") return null
  if (life.state === "closed")
    return "The pull request was closed without a merge. Nothing more is followed."
  return "QualityLayer follows the pull request and never merges it. Merge in your own process; the task closes by itself when the pull request is merged."
}

function MergedChecks({ life }: { life: PullRequestLife }) {
  const passed = life.checks.length > 0 && life.checks.every((c) => c.result === "passed")
  const outcome = outcomeWords(life)
  return (
    <ul className="pr-list">
      <li className="pr-row" data-kind="merged">
        <WhoMark who="check" />
        <span className="pr-what">
          Merged into <code>{life.base}</code>
        </span>
        <span className="pr-side" />
      </li>
      {passed ? (
        <li className="pr-row">
          <WhoMark who="check" />
          <span className="pr-what">All checks passed</span>
          <span className="pr-side">
            {life.checks.length} {life.checks.length === 1 ? "check" : "checks"}
          </span>
        </li>
      ) : null}
      {outcome !== null ? (
        <li className="pr-row" data-kind="outcome">
          <WhoMark who="check" />
          <span className="pr-what">{outcome}</span>
          <span className="pr-side" />
        </li>
      ) : null}
    </ul>
  )
}

function ChecksList({ checks, yourTurn }: { checks: readonly PrCheck[]; yourTurn: boolean }) {
  const [all, setAll] = useState(false)
  if (checks.length === 0) return <p className="pr-none">GitHub has reported no checks yet.</p>
  const sorted = [...checks].sort((a, b) => ORDER[a.result] - ORDER[b.result])
  const shown = all ? sorted : sorted.slice(0, SHOWN)
  return (
    <>
      <ul className="pr-list">
        {shown.map((check) => (
          <CheckRow key={check.name} check={check} why={!yourTurn} />
        ))}
      </ul>
      {sorted.length > SHOWN ? (
        <button type="button" className="q-link pr-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer checks" : `Show all ${sorted.length} checks`}
        </button>
      ) : null}
    </>
  )
}

function ReviewsSection({ life, yourTurn }: { life: PullRequestLife; yourTurn: boolean }) {
  if (life.state !== "open") return null
  const reviews = life.threads.filter(
    (thread) => !(yourTurn && life.waiting.threadIds.includes(thread.id)),
  )
  const people = reviewerLines(life.reviewers)
  // A reviewer who asked for changes has a line of their own: the general one would say it twice.
  const unnamedChanges = life.changesRequested && !people.some((p) => p.kind === "changes")
  if (reviews.length === 0 && people.length === 0 && !unnamedChanges) return null
  return (
    <>
      <h3 className="pr-k">Reviews</h3>
      <ul className="pr-list">
        {people.map((line) => (
          <li className="pr-row" data-kind="reviewer" data-state={line.kind} key={line.text}>
            <WhoMark who={REVIEW_MARK[line.kind]} />
            <span className="pr-what">{line.text}</span>
            <span className="pr-side" />
          </li>
        ))}
        {reviews.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            settled={!life.waiting.left && !life.waiting.threadIds.includes(thread.id)}
          />
        ))}
        {unnamedChanges ? (
          <li className="pr-row" data-kind="changes">
            <WhoMark who="stop" />
            <span className="pr-what">A reviewer asked for changes</span>
            <span className="pr-side" />
          </li>
        ) : null}
      </ul>
    </>
  )
}

export function PullRequestCard({ life }: { life: PullRequestLife }) {
  const open = life.state === "open"
  // What waits on the person stands in the Your turn card above: its threads are not listed twice.
  const yourTurn = open && isWaiting(life.waiting)
  const stats = statsWords(life.stats)
  const foot = footer(life)
  const branchText =
    life.branch !== "" && life.base !== "" ? `${life.branch} → ${life.base}` : life.state
  return (
    <section
      className="pr-card"
      aria-label="Pull request"
      data-testid="pull-request-card"
      data-state={life.state}
    >
      <header className="pr-h">
        <GitPullRequestIcon aria-hidden="true" className="pr-icon" data-state={life.state} />
        <h2>Pull request{life.number !== null ? ` #${life.number}` : ""}</h2>
        <span className="pr-n">
          {branchText}
          {stats !== null ? ` · ${stats}` : ""}
        </span>
        <a className="pr-link" href={life.url} target="_blank" rel="noreferrer">
          Open on GitHub
        </a>
      </header>
      <div className="pr-b">
        {open ? <AgentBlock life={life} /> : null}
        <h3 className="pr-k">{life.state === "merged" ? "Merged" : "Checks"}</h3>
        <div>
          {life.state === "merged" ? (
            <MergedChecks life={life} />
          ) : (
            <ChecksList checks={life.checks} yourTurn={yourTurn} />
          )}
        </div>
        <ReviewsSection life={life} yourTurn={yourTurn} />
      </div>
      {foot !== null ? <p className="pr-foot">{foot}</p> : null}
    </section>
  )
}
