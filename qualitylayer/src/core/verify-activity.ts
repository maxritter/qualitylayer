import { join } from "node:path"
import type { Ctx } from "../ctx.ts"
import { type CheckRecord, latestRuns, readCheckRecords } from "./checks.ts"
import { currentBranch, headSha } from "./git/repo.ts"
import { type ErrorRow, liveDir } from "./live/record.ts"
import { isUuid, parseTime } from "./peers/base.ts"
import { timelyReply } from "./peers/commands/mailbox.ts"
import type { Task } from "./task/store.ts"

export type VerifyRevision = { head: string; branch?: string }
export type VerifyCheck = {
  command: string
  outcome: "passed" | "failed" | "not-run" | "timed-out" | "interrupted"
  exit: number | null
}
export type VerifyActivity = {
  projectChecks?: {
    at: number
    commands: VerifyCheck[]
    checked?: VerifyRevision
    checkout?: VerifyRevision
    candidate?: VerifyRevision
  }
  judgeRefusal?: { at: number; reason: string }
  peer?: { at: number; name: string; expires: number }
}

const readJson = <T>(ctx: Ctx, path: string): Promise<T | null> =>
  ctx.fs
    .readFile(path)
    .then((line) => JSON.parse(line) as T)
    .catch(() => null)

const cleanRevision = (head: unknown): head is string =>
  typeof head === "string" && /^[a-f0-9]{7,64}$/.test(head)

function checkOutcome(row: CheckRecord): VerifyCheck["outcome"] {
  if (row.timedOut) return "timed-out"
  if (!row.ran || row.notRun !== undefined) return "not-run"
  if (row.exit === null) return "interrupted"
  return row.exit === 0 ? "passed" : "failed"
}

async function projectCheckActivity(ctx: Ctx, task: Task, candidate: string | undefined) {
  const records = (await readCheckRecords(ctx, task)).filter((row) => row.scope === "all")
  const last = records.at(-1)
  if (!last) return undefined
  const commands = latestRuns(
    records.filter((row) => row.check === last.check && row.revision === last.revision),
  ).map((row) => ({ command: row.command, exit: row.exit, outcome: checkOutcome(row) }))
  // Legacy receipts only have the checked short revision. A content digest is not a commit.
  const checked = last.head ?? (/^[a-f0-9]{7,12}$/.test(last.revision) ? last.revision : null)
  const [head, branch] = await Promise.all([
    headSha(ctx, task.repoRoot).catch(() => null),
    currentBranch(ctx, task.repoRoot).catch(() => null),
  ])
  return {
    at: last.at,
    commands,
    ...(cleanRevision(checked)
      ? { checked: { head: checked, ...(last.branch ? { branch: last.branch } : {}) } }
      : {}),
    ...(cleanRevision(head) ? { checkout: { head, ...(branch ? { branch } : {}) } } : {}),
    ...(cleanRevision(candidate) ? { candidate: { head: candidate } } : {}),
  }
}

async function judgeRefusal(ctx: Ctx, task: Task, enteredAt: number) {
  const row = await readJson<ErrorRow>(ctx, join(liveDir(task.runtimeDir), "errors.json"))
  if (
    row === null ||
    row.at < enteredAt ||
    !/^verify judge(?: [^:]+)?:(?:wrong_checkout|state_mismatch)$/.test(row.kind)
  )
    return undefined
  return { at: row.at, reason: row.words }
}

const REQUEST_SUFFIX = ".request.json"
type PeerWait = NonNullable<VerifyActivity["peer"]>
type WaitScope = {
  repo: string
  slug: string
  requester: string
  enteredAt: number
}

async function readPeerWait(
  ctx: Ctx,
  scope: WaitScope,
  dir: string,
  id: string,
): Promise<PeerWait | null> {
  const meta = await readJson<Record<string, unknown>>(ctx, join(dir, `${id}${REQUEST_SUFFIX}`))
  if (
    meta?.requester_session_id !== scope.requester ||
    meta.workflow_repo !== scope.repo ||
    meta.workflow_task !== scope.slug
  )
    return null
  const now = ctx.clock.now()
  const at = (parseTime(meta.created_at) ?? -1) * 1000
  const expires = (parseTime(meta.expires_at) ?? 0) * 1000
  if (at < scope.enteredAt || at > now || expires <= now) return null
  const response = await readJson<unknown>(ctx, join(dir, `${id}.reply.json`))
  if (timelyReply(response, id, meta)) return null
  const peer = meta.target_session_name
  const name = typeof peer === "string" ? peer.replace(/\s+/g, " ").trim().slice(0, 100) : ""
  return { at, expires, name: name || "Peer agent" }
}

async function peerWait(ctx: Ctx, task: Task, nativeSession: string, enteredAt: number) {
  const dir = join(ctx.home, "peers", "requests")
  const names = await ctx.fs.readdir(dir).catch(() => [])
  const scope = { repo: task.repoId, slug: task.slug, requester: nativeSession, enteredAt }
  let latest: PeerWait | undefined
  for (const name of names) {
    if (!name.endsWith(REQUEST_SUFFIX)) continue
    const id = name.slice(0, -REQUEST_SUFFIX.length)
    if (!isUuid(id)) continue
    const wait = await readPeerWait(ctx, scope, dir, id)
    if (wait !== null && (!latest || wait.at > latest.at)) latest = wait
  }
  return latest
}

export async function readVerifyActivity(
  ctx: Ctx,
  task: Task,
  nativeSession: string | null,
  events: readonly Record<string, unknown>[],
  candidate: string | undefined,
): Promise<VerifyActivity> {
  const start = events.findLast((event) => event.to === "verify" && typeof event.ts === "number")
  const enteredAt = typeof start?.ts === "number" ? start.ts : 0
  const [projectChecks, refusal, peer] = await Promise.all([
    projectCheckActivity(ctx, task, candidate),
    task.stage === "verify" ? judgeRefusal(ctx, task, enteredAt) : undefined,
    task.stage === "verify" && nativeSession !== null
      ? peerWait(ctx, task, nativeSession, enteredAt)
      : undefined,
  ])
  return {
    ...(projectChecks ? { projectChecks } : {}),
    ...(refusal ? { judgeRefusal: refusal } : {}),
    ...(peer ? { peer } : {}),
  }
}
