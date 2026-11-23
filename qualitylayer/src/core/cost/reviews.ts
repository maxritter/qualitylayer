// Cross reviewers deliberately keep no session transcript. Keep only their usage, privately.
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { NativeAgent } from "../agents/ids.ts"
import { opencodeSessions } from "./native.ts"
import { finalClaudeCalls, reviewCalls } from "./review-calls.ts"
import { hasHeadlessUsage } from "./review-headless.ts"
import type { Call } from "./transcripts.ts"

export { reviewCalls }

export type ReviewCost = {
  type: "qualitylayer-review-cost"
  id: string
  /**
   * `question`: a fresh helper answered questions on lines of the change (review/answers.ts);
   * `another`: a reviewer asked from the Review workspace (review/another.ts).
   */
  point: "plan" | "build" | "verify" | "question" | "another"
  by: NativeAgent
  name: string
  model: string
  started: number
  ended: number
  parent: string | null
  calls: Call[]
  missing: boolean
  /** The native final result supplied complete usage, rather than preliminary stream tokens. */
  finalized?: boolean
  nativeSession?: string
  /**
   * A panel member's run: its agent and round ("codex-1"). Part of the row's id, so two members
   * started in the same millisecond keep a row each.
   */
  seat?: string
}

const path = (task: { runtimeDir: string }) => join(task.runtimeDir, "review-costs.ndjson")
const REVIEW_POINTS = new Set<string>(["plan", "build", "verify", "question", "another"])

export const reviewCostId = (run: Pick<ReviewCost, "point" | "started" | "seat">) =>
  `cross-${run.point}-${run.started}${run.seat === undefined ? "" : `-${run.seat}`}`

function isReviewCostRow(row: ReviewCost): boolean {
  return (
    row.type === "qualitylayer-review-cost" &&
    typeof row.id === "string" &&
    REVIEW_POINTS.has(row.point) &&
    Array.isArray(row.calls)
  )
}

function hydrateReviewRow(ctx: Ctx, row: ReviewCost): ReviewCost {
  if (row.by === "opencode" && row.nativeSession && !row.finalized) {
    const native = opencodeSessions(ctx, [row.nativeSession])?.find(
      (session) => session.id === row.nativeSession,
    )
    return native?.complete ? { ...row, calls: native.calls, finalized: true, missing: false } : row
  }
  if (row.by === "claude-code" && row.finalized !== true) return { ...row, missing: true }
  return row
}

export async function readReviewCosts(
  ctx: Ctx,
  task: { runtimeDir: string },
): Promise<ReviewCost[]> {
  const text = await ctx.fs.readFile(path(task)).catch(() => "")
  const rows: ReviewCost[] = []
  for (const line of text.split("\n")) {
    try {
      const row = JSON.parse(line) as ReviewCost
      if (isReviewCostRow(row)) rows.push(hydrateReviewRow(ctx, row))
    } catch {
      /* A torn final line is retried at the next read. */
    }
  }
  return rows
}

function opencodeSessionFromStdout(stdout: string): string | undefined {
  for (const line of stdout.split("\n")) {
    try {
      const event = JSON.parse(line)
      if (typeof event.sessionID === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(event.sessionID))
        return event.sessionID
    } catch {
      /* Native diagnostics contain no session. */
    }
  }
  return undefined
}

function isFinalizedReview(
  by: ReviewCost["by"],
  calls: readonly Call[],
  stdout: string,
  ended: number,
): boolean {
  if (by === "codex" || by === "pi" || hasHeadlessUsage(by)) return calls.length > 0
  if (by === "opencode") return false
  return finalClaudeCalls(stdout, ended) !== null
}

export async function recordReviewCost(
  ctx: Ctx,
  task: { runtimeDir: string },
  run: Omit<ReviewCost, "type" | "id" | "calls" | "missing" | "parent" | "finalized">,
  stdout: string,
): Promise<void> {
  let calls = reviewCalls(run.by, run.model, stdout, run.ended)
  let finalized = isFinalizedReview(run.by, calls, stdout, run.ended)
  let nativeSession: string | undefined
  if (run.by === "opencode") {
    nativeSession = opencodeSessionFromStdout(stdout)
    const native = nativeSession
      ? opencodeSessions(ctx, [nativeSession])?.find((session) => session.id === nativeSession)
      : undefined
    if (native?.complete) {
      calls = native.calls
      finalized = true
    }
  }
  const row: ReviewCost = {
    ...run,
    type: "qualitylayer-review-cost",
    id: reviewCostId(run),
    calls,
    missing: calls.length === 0 || !finalized,
    finalized,
    ...(nativeSession ? { nativeSession } : {}),
    parent: ctx.env.get("CLAUDE_CODE_SESSION_ID") ?? ctx.env.get("CODEX_THREAD_ID") ?? null,
  }
  await ctx.fs.withLock(`${path(task)}.lock`, async () => {
    if ((await readReviewCosts(ctx, task)).some((old) => old.id === row.id)) return
    await ctx.fs.mkdir(task.runtimeDir)
    await ctx.fs.append(path(task), `${JSON.stringify(row)}\n`)
  })
}
