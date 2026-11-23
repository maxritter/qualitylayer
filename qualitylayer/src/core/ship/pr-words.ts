// What the pull request's state says to the person, with nothing that touches the machine: the
// App reads this module too, so Home, the sidebar and the Review page use the same words.

import type { PrReviewer, PrReviewerState, PrStats, PullRequestRecord } from "./pr-record.ts"

/** What of the pull request waits on the person, in counts. */
export type PrWaiting = {
  /** Review threads nobody on this side has answered. */
  threads: number
  /** Which of the pull request's threads those are, by GitHub's id. */
  threadIds: string[]
  failing: number
  /** The branch conflicts with its base: it cannot merge as it is. Absent when it does not. */
  conflict?: boolean
  /** Changes were requested and nothing has answered them: no thread to open, no check to read. */
  changes: boolean
  /** Commits made after the pull request's head are not on GitHub yet: the fix waits for the push. */
  fixReady: boolean
  /** The person chose to leave what is there for now; it asks again when something new comes. */
  left: boolean
  /** When what waits first showed on a read; null when nothing waits or it was never read here. */
  since: number | null
}

/** Where the agent's watch of its own pull request stands (`pr-watch.ts` writes it). */
export type PrWatchState =
  | "watching"
  | "fixing"
  | "resolving"
  | "green"
  | "gave-up"
  | "no-checks"
  | "timed-out"

/** The agent's watch of the pull request, as the App shows it. */
export type PrWatch = {
  /** The pull request it belongs to. */
  url: string
  state: PrWatchState
  /** Fix attempts begun, of `max`. */
  attempt: number
  max: number
  /** The failing checks of the last read (the ones being fixed, or the ones that still fail). */
  failing: string[]
  /** The branch it merges into, and the files git names in a conflict. */
  base: string
  files: string[]
  /** When the watch last wrote. */
  at: number
}

/**
 * What QualityLayer last did about something new on the pull request (`pr-wake.ts`): it woke the
 * build session, or it did not and says why. `what` names the event: "failing checks (lint)".
 */
export type PrWake = {
  state: "woken" | "skipped"
  at: number
  what: string
  /** Why the agent was not woken, in words for the person. */
  reason?: string
}

export type PullRequestLife = PullRequestRecord & {
  /** `gh` is there to read it: false says the pull request is not followed here. */
  followed: boolean
  waiting: PrWaiting
  /** How many of the pull request's threads were settled with the person's agent; absent for a record read before it was kept. */
  settled?: number
  /** The agent's watch while it is current; null or absent when nobody watches. */
  watch?: PrWatch | null
  /** The last wake-up decision about what the pull request holds now; null or absent when there was none. */
  wake?: PrWake | null
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The failing checks as the watch's words name them: one by name, several as the first and a count. */
function namesOf(names: string[]): string {
  const [first, ...rest] = names
  if (first === undefined) return ""
  return rest.length === 0 ? first : `${first} and ${rest.length} more`
}

const WATCH_WORDS: Record<PrWatchState, (watch: PrWatch) => string | null> = {
  watching: () => "Agent is watching checks",
  fixing: (watch) =>
    watch.failing.length > 0
      ? `Fixing ${namesOf(watch.failing)} · attempt ${watch.attempt} of ${watch.max}`
      : `Fixing checks · attempt ${watch.attempt} of ${watch.max}`,
  resolving: () => "Resolving conflicts",
  green: () => "Checks pass",
  "gave-up": (watch) => {
    const what =
      watch.failing.length > 0
        ? `${namesOf(watch.failing)} still ${watch.failing.length === 1 ? "fails" : "fail"}`
        : "conflicts still remain"
    return `Stopped after ${watch.max} attempts: ${what}`
  },
  "timed-out": () => "Stopped waiting: checks still running",
  "no-checks": () => null,
}

/**
 * What the agent's watch says, in the words of the card and (after "Pull request · ") of the sidebar:
 * "Agent is watching checks", "Fixing test · attempt 2 of 3", "Resolving conflicts", "Checks pass",
 * "Stopped after 3 attempts: test still fails". Null when there is no watch or it has nothing to say.
 */
export function watchWords(watch: PrWatch | null | undefined): string | null {
  if (watch === null || watch === undefined) return null
  return WATCH_WORDS[watch.state]?.(watch) ?? null
}

/** The watch's words after "Pull request · ", their first letter lowered as the sidebar's other lines are. */
const lowered = (words: string): string => words.charAt(0).toLowerCase() + words.slice(1)

/** The agent has the failing check or the conflict in hand, or gave it up: the watch speaks in place of the count. */
const speaks = (watch: PrWatch | null | undefined): watch is PrWatch =>
  watch !== null &&
  watch !== undefined &&
  (watch.state === "fixing" || watch.state === "resolving" || watch.state === "gave-up")

/** "Pull request · 2 threads, 1 check failing": what the lines of Home and the sidebar say; null when nothing waits. */
export function waitingWords(
  life:
    | { state: string; waiting: PrWaiting; watch?: PrWatch | null; wake?: PrWake | null }
    | null
    | undefined,
): string | null {
  if (life === null || life === undefined || life.state !== "open") return null
  const w = life.waiting
  const watch = speaks(life.watch) ? watchWords(life.watch) : null
  const parts = [
    w.threads > 0 ? plural(w.threads, "thread", "threads") : null,
    watch !== null
      ? lowered(watch)
      : w.failing > 0
        ? `${plural(w.failing, "check", "checks")} failing`
        : null,
    w.changes ? "changes requested" : null,
    w.conflict === true ? "conflict" : null,
    w.fixReady ? "fix ready to push" : null,
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) return null
  // Why the agent was not told, where the person looks for what needs them.
  const skipped =
    life.wake?.state === "skipped" ? ` · Agent not woken · ${life.wake.reason ?? ""}` : ""
  return `Pull request · ${parts.join(", ")}${skipped}`
}

/** Something waits on the person: a thread, a failing check, a request, or a fix to push. */
export function isWaiting(w: PrWaiting): boolean {
  if (w.threads > 0 || w.failing > 0) return true
  return w.changes || w.conflict === true || w.fixReady
}

/** One line of the card's Reviews: who, and what they did or were asked. */
export type ReviewerLine = { kind: PrReviewerState; text: string }

/** "Anna", "Anna and Ben", "Anna, Ben and Cy". */
const named = (names: string[]): string =>
  names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

const DID: Record<Exclude<PrReviewerState, "asked">, (name: string) => string> = {
  changes: (name) => `${name} asked for changes`,
  approved: (name) => `${name} approved`,
  commented: (name) => `${name} commented`,
  dismissed: (name) => `${name}'s review was dismissed`,
}

/**
 * Who was asked to review and what the reviews say, in the person's words: one line per review,
 * changes first, then one line for the people still asked. "Anna and Ben were asked · no review yet".
 */
export function reviewerLines(reviewers: PrReviewer[]): ReviewerLine[] {
  const asked = reviewers.filter((r) => r.state === "asked").map((r) => r.name)
  const done = reviewers.filter(
    (r): r is PrReviewer & { state: Exclude<PrReviewerState, "asked"> } => r.state !== "asked",
  )
  const first = (state: PrReviewerState) => (state === "changes" ? 0 : 1)
  const lines: ReviewerLine[] = [...done]
    .sort((a, b) => first(a.state) - first(b.state))
    .map((r) => ({ kind: r.state, text: DID[r.state](r.name) }))
  if (asked.length > 0)
    lines.push({
      kind: "asked",
      text: `${named(asked)} ${asked.length === 1 ? "was" : "were"} asked${done.length === 0 ? " · no review yet" : ""}`,
    })
  return lines
}

/**
 * What the reviewers said in the end, for the merged card: who approved and how many threads were
 * settled with the person's agent. "Anna and Ben approved · 3 threads settled by your agent"; null
 * when nobody approved and no thread was settled.
 */
export function outcomeWords(
  life: Pick<PullRequestRecord, "reviewers"> & { settled?: number },
): string | null {
  const approved = life.reviewers.filter((r) => r.state === "approved").map((r) => r.name)
  const settled = life.settled ?? 0
  const parts = [
    approved.length > 0 ? `${named(approved)} approved` : null,
    settled > 0 ? `${plural(settled, "thread", "threads")} settled by your agent` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(" · ") : null
}

/** "20 commits · 58 files · +1,204 −388": the header's numbers; null when GitHub gave none. */
export function statsWords(stats: PrStats | null | undefined): string | null {
  if (stats === null || stats === undefined) return null
  const n = (count: number) => count.toLocaleString("en-US")
  return [
    `${n(stats.commits)} ${stats.commits === 1 ? "commit" : "commits"}`,
    `${n(stats.files)} ${stats.files === 1 ? "file" : "files"}`,
    `+${n(stats.additions)} −${n(stats.deletions)}`,
  ].join(" · ")
}

const CLOSED_LIFE_WORDS: Partial<Record<PullRequestRecord["state"], string>> = {
  merged: "Shipped · merged",
  closed: "Shipped · pull request closed",
}

function openChecksLine(checks: PullRequestRecord["checks"]): string {
  if (checks.some((c) => c.result === "running")) return "Pull request · open · checks running"
  if (checks.length > 0 && checks.every((c) => c.result === "passed"))
    return "Pull request · open · checks passed"
  return "Pull request · open"
}

/** The line of a pull request nothing waits on: its state and its checks, in the words the sidebar uses. */
export function lifeWords(
  life:
    | (Pick<PullRequestRecord, "state" | "checks"> & { watch?: PrWatch | null })
    | null
    | undefined,
): string | null {
  if (life === null || life === undefined) return null
  const closed = CLOSED_LIFE_WORDS[life.state]
  if (closed !== undefined) return closed
  const watching = watchWords(life.watch)
  if (watching !== null) return `Pull request · ${lowered(watching)}`
  return openChecksLine(life.checks)
}
