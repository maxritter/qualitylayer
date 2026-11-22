import { commitReviewUpdate } from "./task/precommit.ts"
// One bounded file watcher for every agent. Cursors are per session and committed under a lock.

import { randomUUID } from "node:crypto"
import { join } from "node:path"
import type { Ctx, Result } from "../ctx.ts"
import { detectAgent } from "./agents/detect.ts"
import { readCheckProgress } from "./check-progress.ts"
import { folderDoc } from "./docs/names.ts"
import { isAutonomousBuildStage } from "./flow.ts"
import {
  COMMENT_PLACEMENT_THEN,
  commentPlaces,
  readComments,
  take,
  takeImmediate,
} from "./gate/comments.ts"
import { finalApprovalUnheard, readGate } from "./gate/gate.ts"
import { attachmentLine } from "./interaction-docs/attachments.ts"
import { readNeeds, takeSetNeeds } from "./need/need.ts"
import { resolveRepo } from "./paths.ts"
import { procStartChecked } from "./peers/claude.ts"
import type { PlanningWaitDetails } from "./planning-wait.ts"
import { MIGRATION_FILE } from "./records/contract.ts"
import { PLAN_REVIEW_HANDOFF, planReviewWork } from "./review/cross.ts"
import { managedPlanningContext } from "./run/bind.ts"
import { pidAlive } from "./self.ts"
import { followsOpenPullRequest } from "./ship/pr-open.ts"
import { isArchived, withTaskWaitLock } from "./task/archive.ts"
import { sessionKey } from "./task/binding.ts"
import { pickerPending, reconcilePickerCompletions } from "./task/picker-completion.ts"
import { answeredQuestions, openQuestion, replyOf } from "./task/question.ts"
import {
  batchProgress,
  clarificationInstructions,
  pollBatch,
  readBatch,
} from "./task/question-batch.ts"
import {
  isTerminal,
  loadTask,
  readmePath,
  resolveTask,
  type Task,
  touchSession,
} from "./task/store.ts"
import { readVerifyMode } from "./task/verify-mode.ts"
import { agentActionable } from "./team/comments.ts"
import { helperRunning, leftBehind } from "./wait-rules.ts"

export type WaitHost = Pick<Task, "runtimeDir" | "stage"> & Partial<Task>
export type WaitKind = "answer" | "comment" | "gate" | "check" | "need"
export type WaitEvent =
  | {
      event: "answer"
      items: unknown[]
      answered_meanwhile?: unknown[]
      /** A Tell me more is waiting: what to do about it. */
      then?: string
      /** A coalescing wait: where the batch stands (every answer of it that arrived is in `items`). */
      batch?: { id: string; answered: number; total: number; open: number; complete: boolean }
      changed_answers?: unknown[]
      more_requests?: unknown[]
      item_answers?: unknown[]
      links?: unknown[]
      receipts?: unknown[]
      /** One line per item, Tell me more first: what the plain output opens with. */
      summary?: string[]
    }
  | { event: "comment"; ids: string[]; comments: unknown[]; summary?: string[] }
  | { event: "gate"; target: string; decision: string; outcome: unknown }
  /** Every finished check not heard of yet, failed first; `check` and `exit` are the worst of them. */
  | {
      event: "check"
      check: string
      exit: number | null
      checks: { check: string; scope: string; exit: number | null }[]
    }
  | { event: "need"; task: string; met: boolean; need: unknown }
  | ({
      event: "pending"
      again: true
      status: string
      then?: string
    } & Partial<PlanningWaitDetails>)
  /** The task moved while this session waited: continue from its current stage. */
  | { event: "stage"; stage: string; then: string }
  | { event: "removed" | "archived"; task: string; stop: true; then: string }
/** `beat: false`: the wait is not the task's sign of life. */
type Options = {
  seconds: number
  kinds?: WaitKind[]
  beat?: boolean
  /**
   * While a batch is open, answers to its members are held back until the batch is complete or no
   * new one arrived for `quietMs`, then delivered together. Other events wake the wait at once.
   */
  coalesce?: { quietMs: number; batch?: string }
}
/** How long a coalescing wait lets a batch rest before it hands over the answers so far. */
export const BATCH_QUIET_MS = 45_000

async function withDelivery<T>(ctx: Ctx, task: WaitHost, action: () => Promise<T>): Promise<T> {
  const dir = join(task.runtimeDir, "wait")
  await ctx.fs.mkdir(dir)
  return ctx.fs.withLock(join(dir, `${sessionKey(ctx.env) ?? "unbound"}.delivery.lock`), action)
}

/** Poll and wait share one session cursor, including when both commands run concurrently. */
export async function pollWaitAnswers(ctx: Ctx, task: WaitHost, batch?: string) {
  const completion = await reconcilePickerCompletions(ctx, task)
  return withDelivery(ctx, task, async () => {
    const result = await pollBatch(ctx, task, batch)
    await acknowledgeReply(ctx, task, sessionKey(ctx.env) ?? "unbound", result)
    return { ...result, ...pickerPending(completion) }
  })
}

async function stoppedTask(ctx: Ctx, task: WaitHost): Promise<WaitEvent | null> {
  if (!task.slug || !task.dir || !task.repoRoot || !(await ctx.fs.exists(task.repoRoot)))
    return null
  if (!(await ctx.fs.exists(readmePath({ dir: task.dir }))))
    return {
      event: "removed",
      task: task.slug,
      stop: true,
      then: `Task ${task.slug} was removed from this checkout. Stop this session; restore the task in the App or start a new task.`,
    }
  if (await isArchived(ctx, task))
    return {
      event: "archived",
      task: task.slug,
      stop: true,
      then: `Task ${task.slug} is archived. Stop this session; restore it in the App before resuming.`,
    }
  return null
}

async function whileTaskWaits<T>(
  ctx: Ctx,
  task: WaitHost,
  action: () => Promise<T>,
): Promise<T | WaitEvent> {
  if (!task.slug || !task.dir || !task.repoRoot) return action()
  return withTaskWaitLock(ctx, task, async () => (await stoppedTask(ctx, task)) ?? action())
}
/** How often an event wait checks whether its stage or open gate was handled meanwhile. */
const GATE_LOOK_MS = 5_000
type Cursor = Partial<Record<WaitKind, string[]>>

export type WaitReply = { call: number; stop: boolean; done: boolean }
export const waitReplyPath = (task: Pick<Task, "runtimeDir">, key: string) =>
  join(task.runtimeDir, "wait", `${key}.reply.json`)

type Tick = () => Promise<void>
/** How often a running wait refreshes its lease, and how old a refresh may be and still count. */
const LEASE_BEAT_MS = 3_000
const LEASE_FRESH_MS = 12_000

/**
 * Whether this session has a `qualitylayer wait` running on the task (typically in the agent's
 * background shell), so its Stop need not ask for another. The process identity decides; where
 * `ps` cannot be read (a sandbox hides it, from the waiter or from the hook) the lease's own
 * refresh, a few seconds old at most, stands in.
 */
export async function hasActiveWait(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  key: string,
): Promise<boolean> {
  const dir = join(task.runtimeDir, "wait")
  const names = await ctx.fs.readdir(dir).catch(() => [])
  for (const name of names) {
    if (!name.startsWith(`${key}.active.`) || !name.endsWith(".json")) continue
    const lease = await ctx.fs
      .readFile(join(dir, name))
      .then((text) => JSON.parse(text) as { pid?: unknown; start?: unknown; at?: unknown })
      .catch(() => null)
    if (!lease || typeof lease.pid !== "number" || !Number.isInteger(lease.pid)) continue
    if (typeof lease.start === "string" && lease.start) {
      const [now, error] = procStartChecked(lease.pid)
      if (error === null && now !== null) {
        if (pidAlive(lease.pid) && now === lease.start) return true
        continue
      }
      // `ps` cannot be read here: a process that is gone is gone, one that is alive stays unverified.
      if (!pidAlive(lease.pid)) continue
    }
    if (typeof lease.at === "number" && ctx.clock.now() - lease.at < LEASE_FRESH_MS) return true
  }
  return false
}

/** A turn guard reads only this session's last reply, including intentional workflow stops. */
export async function rememberWaitReply(ctx: Ctx, result: Result<unknown>): Promise<void> {
  const key = sessionKey(ctx.env) ?? "unbound"
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return
  const task = await resolveTask(ctx, repo.data)
  if (!task) return
  await withTaskWaitLock(ctx, task, async () => {
    if (await ctx.fs.exists(task.runtimeDir)) await rememberTaskReply(ctx, task, key, result)
  })
}

async function rememberTaskReply(
  ctx: Ctx,
  task: Task,
  key: string,
  result: Result<unknown>,
): Promise<void> {
  const path = waitReplyPath(task, key)
  await ctx.fs.mkdir(join(task.runtimeDir, "wait"))
  await ctx.fs.withLock(`${path}.lock`, async () => {
    let previous: WaitReply | null = null
    try {
      previous = JSON.parse(await ctx.fs.readFile(path)) as WaitReply
    } catch {
      /* first reply */
    }
    const data =
      result.ok && result.data && typeof result.data === "object"
        ? (result.data as Record<string, unknown>)
        : {}
    await ctx.fs.atomicWrite(
      path,
      JSON.stringify({
        call: (previous?.call ?? 0) + 1,
        // A gate or hold wait that timed out says the person resumes with `qualitylayer`: the turn
        // may end there, and the Stop hook does not send the session into another wait.
        stop:
          typeof data.stop === "string" ||
          data.stop === true ||
          (data.decision === "timeout" && typeof data.resume === "string"),
        done: data.done === true,
      } satisfies WaitReply),
    )
  })
  if (result.ok && result.data && typeof result.data === "object")
    await acknowledgeReply(ctx, task, key, result.data as Record<string, unknown>)
}

/** Legacy commands deliver the same sources: their replies advance this session's cursor too. */
async function acknowledgeReply(
  ctx: Ctx,
  task: WaitHost,
  key: string,
  data: Record<string, unknown>,
) {
  if (["answer", "comment", "gate", "check", "need", "pending"].includes(String(data.event))) return
  const rows = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? value.filter((row) => row && typeof row === "object") : []
  const heard = [
    ...rows(data.answered_meanwhile),
    ...rows(data.changed_answers),
    ...(["answered", "unsure"].includes(String(data.status)) ? [data] : []),
  ]
  const comments = [...rows(data.item_answers), ...rows(data.comments), ...rows(data.notes)]
  const more = [...rows(data.more_requests), ...(data.status === "more" ? [data] : [])]
  const gateReply = data.decision === "approved" || data.decision === "changes"
  const needIds = [
    ...rows(data.needs_set).map((n) => n.for),
    ...(data.state === "set" || data.state === "resolved" ? [data.need] : []),
  ]
  if (!heard.length && !comments.length && !more.length && !gateReply && !needIds.length) return
  const ids: Partial<Record<WaitKind, string[]>> = {}
  const add = (kind: WaitKind, id: string) => {
    ids[kind] = [...(ids[kind] ?? []), id]
  }
  for (const a of await answeredQuestions(ctx, task))
    if (
      (a.changed ? a.changed.delivered !== false : a.delivered !== false) &&
      heard.some(
        (h) =>
          ((h.id !== undefined && h.id === a.id) ||
            (h.number !== undefined && h.number === a.number)) &&
          (h.choice ?? h.recommended ?? h.now) === a.choice,
      )
    )
      add("answer", `${a.id ?? a.number}:${a.at}:${a.changed?.at ?? 0}:${a.choice}`)
  for (const c of await readComments(ctx, task))
    if (comments.some((h) => h.id === c.id))
      add(
        c.immediate ? "answer" : "comment",
        c.immediate ? `item:${c.id}:${c.created}` : `${c.id}:${c.created}`,
      )
  if (more.length) {
    const batch = await readBatch(ctx, task)
    const single = await openQuestion(ctx, task)
    for (const q of [...(batch?.questions ?? []), ...(single ? [single] : [])])
      if (
        q.more?.taken !== undefined &&
        more.some((h) => h.id === q.id && h.request === q.more?.request)
      )
        add("answer", `more:${q.id}:${q.more.at}`)
  }
  if (gateReply) {
    const gate = await readGate(ctx, task)
    if (gate && gate.decision !== "pending")
      add("gate", `gate:${gate.id ?? gate.opened}:${gate.decided}`)
  }
  for (const n of await readNeeds(ctx, task))
    if (needIds.includes(n.for)) add("need", `${n.for}:${n.set?.at}:${n.resolved}`)
  const path = join(task.runtimeDir, "wait", `${key}.json`)
  await ctx.fs.withLock(`${path}.lock`, async () => {
    let cursor: Cursor = {}
    try {
      cursor = JSON.parse(await ctx.fs.readFile(path)) as Cursor
    } catch {
      /* first delivery */
    }
    for (const kind of Object.keys(ids) as WaitKind[])
      cursor[kind] = [...new Set([...(cursor[kind] ?? []), ...(ids[kind] ?? [])])]
    await ctx.fs.atomicWrite(path, `${JSON.stringify(cursor)}\n`)
  })
}

/** A value shown inside a summary line: one line, at most 120 characters. */
const quoted = (text: unknown): string => {
  const one = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
  return `"${one.length > 120 ? `${one.slice(0, 117)}...` : one}"`
}

/** The summary line of each answer-event item, in the order of `items`. */
function summaryLines(items: Record<string, unknown>[]): string[] {
  return items.map((item) => {
    const at = typeof item.answer_at === "number" ? ` (answer-at ${item.answer_at})` : ""
    if (item.status === "more") return `more: ${item.id} ${quoted(item.request)}`
    if (item.status === "answered") return `answered: ${item.id} ${quoted(item.choice)}${at}`
    if (item.status === "unsure") return `unsure: ${item.id} ${quoted(item.recommended)}${at}`
    if (item.now !== undefined) return `changed: ${item.id} ${quoted(item.now)}${at}`
    return `item-answer: ${item.item ?? item.id} ${quoted(item.remark)}`
  })
}

/** Both the turn hook and strict release harness inspect the same open App work. */
export async function hasPending(
  ctx: Ctx,
  task: WaitHost,
  /** The key of the session whose turn ends: checks that one of its helpers runs are the helper's. */
  session?: string,
): Promise<boolean> {
  if (isTerminal(task.stage) && !(await followsOpenPullRequest(ctx, task))) return false
  if (await isArchived(ctx, task)) return false
  const [question, batch, gate, answers, checks, needs] = await Promise.all([
    openQuestion(ctx, task),
    readBatch(ctx, task),
    readGate(ctx, task),
    answeredQuestions(ctx, task),
    readCheckProgress(ctx, task),
    readNeeds(ctx, task),
  ])
  const undelivered = answers.filter(
    (a) => (!a.reopened && a.delivered === false) || a.changed?.delivered === false,
  )
  const decided = gate && gate.decision !== "pending" ? (gate.decided ?? gate.opened) : null
  // What happened in a step the task has left never comes back through `wait`: it holds nothing open.
  const gone = await leftBehind(ctx, task, task.stage, [
    ...undelivered.map((a) => a.changed?.at ?? a.at),
    ...(decided !== null ? [decided] : []),
  ])
  // The orchestrator's Stop does not wait for a check its helper runs: the helper reports it.
  const helperChecks = session !== undefined && (await helperRunning(ctx, task, session))
  const autonomous = isAutonomousBuildStage(
    task.stage,
    (await readVerifyMode(ctx, task as Task)) ?? undefined,
  )
  return (
    (!autonomous && (!!question || !!batch?.questions.length)) ||
    !!(gate && !gate.settled && !(decided !== null && gone.has(decided))) ||
    (await finalApprovalUnheard(ctx, task, gate)) ||
    undelivered.some((a) => !gone.has(a.changed?.at ?? a.at)) ||
    (!helperChecks && checks.some((check) => check.running)) ||
    needs.some(
      (need) =>
        (!autonomous && need.state === "open" && typeof need.waiting === "number") ||
        (need.state === "set" && !need.told),
    )
  )
}

/** The compatibility waits keep their own replies, while using this same watch loop. */
export function waitFor<T>(
  ctx: Ctx,
  task: WaitHost,
  opts: Options & { poll: () => Promise<T | null>; pending: () => T },
): Promise<T>
export function waitFor(ctx: Ctx, task: WaitHost, opts: Options): Promise<WaitEvent>
export async function waitFor<T>(
  ctx: Ctx,
  task: WaitHost,
  opts: Options & { poll?: () => Promise<T | null>; pending?: () => T },
): Promise<T | WaitEvent> {
  const stopped = await stoppedTask(ctx, task)
  if (stopped) return stopped
  if (task.slug && task.dir && task.repoRoot) ctx = await managedPlanningContext(ctx, task as Task)
  const run = (tick: Tick) => waitBody(ctx, task, opts, tick)
  const key = sessionKey(ctx.env)
  const lease = key
    ? join(task.runtimeDir, "wait", `${key}.active.${process.pid}.${randomUUID()}.json`)
    : null
  const start = lease ? procStartChecked(process.pid)[0] : null
  const writeLease = () =>
    lease
      ? ctx.fs.atomicWrite(lease, JSON.stringify({ pid: process.pid, start, at: ctx.clock.now() }))
      : Promise.resolve()
  const setup = await whileTaskWaits(ctx, task, async () => {
    if (!lease) return
    await ctx.fs.mkdir(join(task.runtimeDir, "wait"))
    await writeLease()
  })
  if (setup) return setup
  // The lease says "this wait is alive" for the Stop hook, also where the process cannot be
  // checked from outside: the loop refreshes it a few seconds apart.
  let leased = ctx.clock.now()
  const tick = async () => {
    if (!lease || ctx.clock.now() - leased < LEASE_BEAT_MS) return
    leased = ctx.clock.now()
    await whileTaskWaits(ctx, task, () => writeLease().catch(() => {}))
  }
  try {
    const result = await run(tick)
    if (result && typeof result === "object" && "event" in result && result.event === "pending") {
      return await whileTaskWaits(ctx, task, async () => {
        const completion = pickerPending(await reconcilePickerCompletions(ctx, task))
        if ("native_picker_pending" in completion)
          return { ...result, ...completion, status: completion.native_picker_pending.status }
        if ("native_picker_unanswered" in completion)
          return { ...result, ...completion, status: completion.native_picker_unanswered.status }
        return result
      })
    }
    return result
  } finally {
    if (lease) await ctx.fs.remove(lease).catch(() => {})
  }
}

async function waitBody<T>(
  ctx: Ctx,
  task: WaitHost,
  opts: Options & { poll?: () => Promise<T | null>; pending?: () => T },
  tick: Tick = async () => {},
): Promise<T | WaitEvent> {
  const start = ctx.clock.now()
  const initialStage = task.stage
  // A wait started while a gate was open ends once that gate is decided, also when another command
  // (the session's own `next`) delivered the decision first: a bench run's planner otherwise held its
  // session for the full half hour after the Plan's approval, then woke to "nothing new".
  const openGate =
    opts.poll === undefined && task.slug !== undefined && (opts.kinds?.includes("gate") ?? true)
      ? await readGate(ctx, task as Task)
      : null
  const watched = openGate !== null && openGate.decision === "pending" ? openGate : null
  let looked = start
  // A wait names its task (bound or not), so it is that task's sign of life from its first idle
  // moment, then every 15 s: the App shows the agent waiting, never quiet.
  let beat: number | null = null
  for (;;) {
    const stopped = await stoppedTask(ctx, task)
    if (stopped) return stopped
    const event = opts.poll
      ? await opts.poll()
      : await whileTaskWaits(ctx, task, () => takeEvent(ctx, task, opts.kinds, opts.coalesce))
    if (event !== null) return event
    if (
      opts.poll === undefined &&
      task.slug !== undefined &&
      ctx.clock.now() - looked >= GATE_LOOK_MS
    ) {
      looked = ctx.clock.now()
      const stage = await currentStage(ctx, task)
      if (stage !== initialStage) return { event: "stage", stage, then: "qualitylayer next" }
      const gate = watched !== null ? await readGate(ctx, task as Task) : null
      if (
        watched !== null &&
        gate !== null &&
        (gate.id ?? gate.opened) === (watched.id ?? watched.opened) &&
        gate.decision !== "pending"
      )
        return {
          event: "stage",
          stage: await currentStage(ctx, task),
          then: `The ${gate.target} decision (${gate.decision}) was already handled in this session: run qualitylayer next${task.slug ? ` --task ${task.slug}` : ""}.`,
        }
    }
    const now = ctx.clock.now()
    await tick()
    if (now - start >= opts.seconds * 1000)
      return opts.pending
        ? opts.pending()
        : {
            event: "pending",
            again: true,
            status: "Still waiting for an App event. Run the returned wait command again.",
            then: `qualitylayer wait${opts.coalesce?.batch ? ` --batch ${opts.coalesce.batch}` : ""} --json`,
          }
    if (opts.beat !== false && task.slug && (beat === null || now - beat >= 15_000)) {
      beat = now
      const halted = await whileTaskWaits(ctx, task, () =>
        touchSession(ctx, task as Task, detectAgent(ctx.env), "waiting"),
      )
      if (halted) return halted
    }
    await ctx.clock.sleep(Math.min(1000, Math.max(1, opts.seconds * 1000 - (now - start))))
  }
}

/** The stage the task is in now: a long wait started before it moved reads it again from disk. */
async function currentStage(ctx: Ctx, task: WaitHost): Promise<string> {
  const repo = task.slug !== undefined ? await resolveRepo(ctx) : null
  const now = repo?.ok && task.slug !== undefined ? await loadTask(ctx, repo.data, task.slug) : null
  return now?.stage ?? task.stage
}

export async function takeEvent(
  ctx: Ctx,
  task: WaitHost,
  kinds?: WaitKind[],
  coalesce?: Options["coalesce"],
): Promise<WaitEvent | null> {
  await reconcilePickerCompletions(ctx, task)
  const dir = join(task.runtimeDir, "wait")
  const path = join(dir, `${sessionKey(ctx.env) ?? "unbound"}.json`)
  return withDelivery(ctx, task, () =>
    ctx.fs.withLock(`${path}.lock`, async () => {
      let cursor: Cursor = {}
      try {
        cursor = JSON.parse(await ctx.fs.readFile(path)) as Cursor
      } catch {
        /* first wait */
      }
      const unread = (kind: WaitKind, id: string) => !cursor[kind]?.includes(id)
      const checks = await readCheckProgress(ctx, task)
      // The batch's open members are read BEFORE the answers. An answer that lands between the two
      // reads is then in the history while the batch still counts it open, so it is held with the
      // rest. Read the other way round, the batch could look complete while its last answer was
      // missing from the history: the earlier answers went out alone and the last one stayed unheard.
      const progress = coalesce ? await batchProgress(ctx, task, coalesce.batch) : null
      const [history, batchNow, singleNow, commentsNow, gateNow, needsNow] = await Promise.all([
        answeredQuestions(ctx, task),
        readBatch(ctx, task, coalesce?.batch),
        openQuestion(ctx, task),
        readComments(ctx, task),
        readGate(ctx, task),
        readNeeds(ctx, task),
      ])
      const currentRecords = await ctx.fs.exists(join(task.runtimeDir, MIGRATION_FILE))
      const retainedPickup =
        currentRecords && (!kinds || kinds.includes("answer")) ? await takeImmediate(ctx, task) : []
      const retainedIds = new Set(retainedPickup.map((answer) => answer.id))
      const handledAnswer = (a: (typeof history)[number]) =>
        !a.changed &&
        a.originReceipt !== undefined &&
        commentsNow.some(
          (c) =>
            c.originQuestion?.receipt === a.originReceipt &&
            c.originQuestion?.id === a.id &&
            c.originQuestion?.number === a.number &&
            c.originQuestion?.pick === a.choice &&
            (c.answer !== undefined || c.resolved !== undefined) &&
            (a.gate === undefined || c.doc === a.gate),
        )
      const answerId = (a: (typeof history)[number]) =>
        `${a.id ?? a.number}:${a.at}:${a.changed?.at ?? 0}:${a.choice}`
      const answerTime = (a: (typeof history)[number]) => a.changed?.at ?? a.at
      const members = new Set(progress?.members)
      // What this session may still be told: not marked in its cursor, and (the marks the records
      // carry, so a session with no cursor of its own is not replayed history) not delivered before.
      const unheard = history.filter(
        (a) =>
          (coalesce?.batch === undefined || (a.id !== undefined && members.has(a.id))) &&
          (!a.reopened || a.changed !== undefined) &&
          !handledAnswer(a) &&
          unread("answer", answerId(a)),
      )
      const gateId = (g: NonNullable<typeof gateNow>) => `gate:${g.id ?? g.opened}:${g.decided}`
      const gateUnheard =
        gateNow && gateNow.decision !== "pending" && unread("gate", gateId(gateNow))
          ? gateNow
          : null
      // Nor what happened in a step the task has left: an answer or the Plan's approval, while the
      // task is at Implement, was handled by the session that was there.
      const gone =
        task.slug && (unheard.length > 0 || gateUnheard !== null)
          ? await leftBehind(ctx, task, await currentStage(ctx, task), [
              ...unheard.map(answerTime),
              ...(gateUnheard ? [gateUnheard.decided ?? gateUnheard.opened] : []),
            ])
          : new Set<number>()
      const answerDue = (a: (typeof history)[number]) =>
        unheard.includes(a) && !gone.has(answerTime(a))
      // The final approval the App applied as it opened the pull request moved the task to shipped
      // itself: that move does not put the approval behind the agent, who has its ship step to run.
      const gateDue =
        gateUnheard &&
        (!gone.has(gateUnheard.decided ?? gateUnheard.opened) ||
          (await finalApprovalUnheard(ctx, task, gateUnheard)))
          ? gateUnheard
          : null
      const arrivals: { kind: WaitKind; at: number }[] = []
      const reviewWork =
        task.slug && gateNow?.decision === "pending" && gateNow.waitsFor === "plan"
          ? await planReviewWork(ctx, task as Task)
          : null
      const reviewId = reviewWork
        ? `review:plan:${reviewWork.run.started}:${reviewWork.run.ended ?? 0}`
        : null
      if (reviewWork && reviewId && unread("gate", reviewId))
        arrivals.push({ kind: "gate", at: reviewWork.run.ended ?? reviewWork.run.started })
      // On a shipped task the triage waits for the person: a check the fix round runs is not news to it.
      const triage = await followsOpenPullRequest(ctx, task)
      for (const check of triage ? [] : checks)
        if (!check.running && unread("check", check.check))
          arrivals.push({ kind: "check", at: check.ended ?? check.started })
      // A coalescing wait holds answers to the members of an incomplete batch back (see `Options`).
      const held: { kind: WaitKind; at: number }[] = []
      for (const a of history)
        if (answerDue(a)) {
          const arrival = { kind: "answer" as const, at: a.changed?.at ?? a.at }
          if (progress && !a.changed && !a.reopened && a.id !== undefined && members.has(a.id))
            held.push(arrival)
          else arrivals.push(arrival)
        }
      for (const q of [
        ...(batchNow?.questions ?? []),
        ...(singleNow && coalesce?.batch === undefined ? [singleNow] : []),
      ])
        if (
          q.more &&
          q.more.cancelled === undefined &&
          unread("answer", `more:${q.id}:${q.more.at}`)
        )
          arrivals.push({ kind: "answer", at: q.more.at })
      for (const c of commentsNow) {
        const kind = c.immediate ? "answer" : "comment"
        const id = c.immediate ? `item:${c.id}:${c.created}` : `${c.id}:${c.created}`
        if (
          agentActionable(c, "resolve") &&
          c.resolved === undefined &&
          c.answer === undefined &&
          (currentRecords && c.immediate ? retainedIds.has(c.id) : unread(kind, id))
        )
          arrivals.push({ kind, at: c.created })
      }
      const commitEdit =
        !kinds || kinds.includes("gate") ? await commitReviewUpdate(ctx, task) : null
      const commitEditId = commitEdit ? `commit-edits:${commitEdit.id}` : null
      const commitEditDue = commitEdit && commitEditId && unread("gate", commitEditId)
      if (task.slug) {
        if (commitEditDue) arrivals.push({ kind: "gate", at: commitEdit.at })
        if (gateDue) arrivals.push({ kind: "gate", at: gateDue.decided ?? gateDue.opened })
      }
      for (const n of needsNow)
        if (n.state !== "open" && unread("need", `${n.for}:${n.set?.at}:${n.resolved}`))
          arrivals.push({ kind: "need", at: n.resolved ?? n.set?.at ?? n.opened })
      if (held.length && progress && coalesce) {
        const resting =
          progress.open.length > 0 &&
          !arrivals.some((a) => a.kind === "answer") &&
          ctx.clock.now() - Math.max(...held.map((a) => a.at)) < coalesce.quietMs
        if (!resting) arrivals.push(...held)
      }
      const first = arrivals
        .filter((a) => !kinds || kinds.includes(a.kind))
        .sort((a, b) => a.at - b.at)[0]
      const enabled = (kind: WaitKind) => first?.kind === kind
      const deliver = async (kind: WaitKind, ids: string[], event: WaitEvent) => {
        cursor[kind] = [...new Set([...(cursor[kind] ?? []), ...ids])]
        await ctx.fs.atomicWrite(path, `${JSON.stringify(cursor)}\n`)
        return event
      }
      if (enabled("check")) {
        // Every finished check this session has not heard of comes together, failed ones first: a
        // session that waits after a build hears of its checks once, not one per call.
        const heard = checks
          .filter((row) => !row.running && unread("check", row.check))
          .map((row) => ({ check: row.check, scope: row.scope, exit: row.exit ?? null }))
        const failed = heard.filter((row) => row.exit !== 0)
        const [worst] = failed.length ? failed : heard
        if (worst)
          return deliver(
            "check",
            heard.map((row) => row.check),
            {
              event: "check",
              check: worst.check,
              exit: worst.exit,
              checks: [...failed, ...heard.filter((row) => row.exit === 0)],
            },
          )
      }
      if (enabled("answer")) {
        const answers = history.filter(answerDue)
        const itemAnswers = currentRecords
          ? retainedPickup
          : commentsNow.filter(
              (c) =>
                c.immediate &&
                agentActionable(c, "resolve") &&
                c.resolved === undefined &&
                c.answer === undefined &&
                unread("answer", `item:${c.id}:${c.created}`),
            )
        const batch = batchNow
        const single = singleNow
        const questions = new Map(
          [
            ...(batch?.questions ?? []),
            ...(single && coalesce?.batch === undefined ? [single] : []),
          ].map((q) => [q.id, q]),
        )
        const more = [...questions.values()].filter(
          (q) =>
            q.more &&
            q.more.cancelled === undefined &&
            unread("answer", `more:${q.id}:${q.more.at}`),
        )
        const changed = answers
          .filter((a) => a.changed)
          .map((a) => ({
            id: a.id,
            number: a.number,
            question: a.question,
            was: a.changed?.was,
            now: a.choice,
            answer_at: a.at,
          }))
        // `answer_at` is the saved time a reply to this answer names with `--answer-at`.
        const fresh = answers
          .filter((a) => !a.changed && !a.reopened)
          .map((a) => ({ ...replyOf(a), answer_at: a.at }))
        // A person waits for a Tell me more: it comes first.
        const items = [
          ...more.map((q) => ({ status: "more", id: q.id, request: q.more?.request })),
          ...fresh,
          ...changed,
          ...itemAnswers,
        ]
        if (items.length) {
          const deliveries = await pollBatch(ctx, task, coalesce?.batch)
          return deliver(
            "answer",
            [
              ...answers.map(answerId),
              ...itemAnswers.map((c) => `item:${c.id}:${c.created}`),
              ...more.map((q) => `more:${q.id}:${q.more?.at}`),
            ],
            {
              event: "answer",
              ...(more.length
                ? {
                    then: clarificationInstructions(
                      more.map((q) => ({ id: q.id, request_at: q.more?.at })),
                    ),
                    more_requests: more.map((q) => ({
                      ...(batch?.questions.some((member) => member.id === q.id)
                        ? { batch: batch.id }
                        : {}),
                      id: q.id,
                      request: q.more?.request,
                      request_at: q.more?.at,
                      points: batch?.links.find((link) => link.questionId === q.id)?.points ?? [],
                    })),
                  }
                : {}),
              summary: [
                ...summaryLines(items as Record<string, unknown>[]),
                ...(progress
                  ? [
                      `batch ${progress.id}: ${progress.members.length - progress.open.length} of ${progress.members.length} answered${progress.open.length === 0 ? ", complete" : `, ${progress.open.length} open`}`,
                    ]
                  : []),
              ],
              items,
              links: deliveries.links,
              receipts: deliveries.receipts,
              ...(progress
                ? {
                    batch: {
                      id: progress.id,
                      answered: progress.members.length - progress.open.length,
                      total: progress.members.length,
                      open: progress.open.length,
                      complete: progress.open.length === 0,
                    },
                  }
                : {}),
              ...(fresh.length ? { answered_meanwhile: fresh } : {}),
              ...(changed.length ? { changed_answers: changed } : {}),
              ...(itemAnswers.length ? { item_answers: itemAnswers } : {}),
            },
          )
        }
      }
      if (enabled("gate") && task.slug) {
        if (commitEditDue)
          return deliver("gate", [commitEditId], {
            event: "gate",
            target: "commit",
            decision: "changes",
            outcome: { requestChanges: commitEdit.feedback, next: "qualitylayer next" },
          })
        if (reviewWork && reviewId && unread("gate", reviewId))
          return deliver("gate", [reviewId], {
            event: "gate",
            target: gateNow?.target ?? folderDoc("plan"),
            decision: "review-ready",
            outcome: {
              file: reviewWork.file,
              state: reviewWork.run.state,
              instructions: PLAN_REVIEW_HANDOFF,
              then: "qualitylayer next",
            },
          })
        const gate = gateDue
        if (gate) {
          return deliver("gate", [gateId(gate)], {
            event: "gate",
            target: gate.target,
            decision: gate.decision,
            outcome: {
              decision: gate.decision,
              ...(gate.by !== undefined ? { by: gate.by } : {}),
              ...(gate.requestChanges ? { requestChanges: gate.requestChanges } : {}),
              applied: gate.settled === true,
              next: "qualitylayer next",
            },
          })
        }
      }
      if (enabled("comment")) {
        const comments = commentsNow.filter(
          (c) =>
            !c.immediate &&
            agentActionable(c, "resolve") &&
            c.resolved === undefined &&
            unread("comment", `${c.id}:${c.created}`),
        )
        if (comments.length) {
          await take(ctx, task)
          return deliver(
            "comment",
            comments.map((c) => `${c.id}:${c.created}`),
            {
              event: "comment",
              summary: [
                COMMENT_PLACEMENT_THEN,
                ...comments.map(
                  (c) => `comment: ${c.id} ${quoted(c.remark)}${attachmentLine(c.files)}`,
                ),
              ],
              ids: comments.map((c) => c.id),
              comments: await commentPlaces(ctx, task, comments),
            },
          )
        }
      }
      if (enabled("need")) {
        const need = needsNow.find(
          (n) => n.state !== "open" && unread("need", `${n.for}:${n.set?.at}:${n.resolved}`),
        )
        if (need) {
          await takeSetNeeds(ctx, task)
          return deliver("need", [`${need.for}:${need.set?.at}:${need.resolved}`], {
            event: "need",
            task: need.for,
            met: true,
            need,
          })
        }
      }
      return null
    }),
  )
}
