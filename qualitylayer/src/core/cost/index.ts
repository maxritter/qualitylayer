// What a task cost, read on this machine from the agents' own transcripts: per step of the flow,
// per helper, and in total. The agent's raw session ids are noted per
// task as its commands run (cost-sessions.json); the transcripts are found under the user's home.
// Nothing here goes over the network, and nothing of it is sent anywhere.

import { realpath } from "node:fs/promises"
import { basename, join, resolve, sep } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { filesIn } from "../../files.ts"
import {
  isCompressedRollout,
  isRollout,
  oncePerSession,
  readCompressedHead,
} from "../agents/codex-rollout.ts"
import { sessionIdentity } from "../agents/detect.ts"
import { AGENT_NAMES, isNativeAgent, type NativeAgent } from "../agents/ids.ts"
import { readCheckRecords } from "../checks.ts"
import { type FlowStepId, flowStepOf } from "../flow.ts"
import {
  COST_SESSION_LINES_KEPT,
  COST_SESSIONS_KEPT,
  capFolder,
  newestLines,
} from "../home-caps.ts"
import { projectRuntimeDir, repoIdFrom } from "../paths.ts"
import { keyOf } from "../task/binding.ts"
import { readBindingJson, workflowBindingOf, workflowBindingPath } from "../task/binding-index.ts"
import { readEvents, type Task } from "../task/store.ts"
import {
  type CostHelper,
  type CostLine,
  type CostStep,
  kindOfId,
  kindOfText,
  labelHelpers,
  modelLabel,
  projectChecks,
  type TaskCost,
} from "./labels.ts"
import {
  indexedTranscript,
  type LedgerCall,
  readTaskLedger,
  rememberTask,
  type TaskCostTotal,
  upsertLedger,
} from "./ledger.ts"
import { opencodeSessions, piSessions } from "./native.ts"
import {
  addTokens,
  allTokens,
  PRICE_NOTE,
  pricedCost,
  priceOf,
  type Tokens,
  zeroTokens,
} from "./prices.ts"
import { readReviewCosts, reviewCostId } from "./reviews.ts"
import { readsRecordCost, recordCalls, sessionRecordPath } from "./session-calls.ts"
import { type Brief, type Call, codexCalls, mergeNativeCredits } from "./transcripts.ts"

type Agent = NativeAgent
type SessionNote = { agent: Agent; id: string; at: number; source?: "workflow" }

const SESSIONS_FILE = "cost-sessions.json"

/** The raw session id of the agent running this command, if it names one. */
function rawSession(ctx: Ctx): SessionNote | null {
  const native = sessionIdentity(ctx.env)
  return native ? { ...native, at: ctx.clock.now() } : null
}

async function readNotes(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<SessionNote[]> {
  const path = join(task.runtimeDir, SESSIONS_FILE)
  if (!(await ctx.fs.exists(path))) return []
  try {
    const raw = JSON.parse(await ctx.fs.readFile(path)) as unknown
    return Array.isArray(raw)
      ? raw.filter(
          (n): n is SessionNote =>
            typeof n === "object" &&
            n !== null &&
            isNativeAgent(n.agent) &&
            typeof n.id === "string",
        )
      : []
  } catch {
    return []
  }
}

type CostTask = Pick<Task, "runtimeDir" | "repoId" | "slug">

/** An incidental legacy note does not establish authority over another checkout. */
async function claimedSession(ctx: Ctx, note: SessionNote, task: CostTask): Promise<boolean> {
  if (note.source === "workflow") return true
  if (!task.repoId) return false
  const binding = workflowBindingOf(
    await readBindingJson(ctx, workflowBindingPath(ctx, task, keyOf(note.id))),
  )
  return binding?.slug === task.slug
}

/**
 * Note the calling session as one of this task's (once per session), and when it moves on to this
 * task from another, the moment it did: one session may work on several tasks in turn.
 */
export async function noteCostSession(ctx: Ctx, task: CostTask): Promise<void> {
  const note = rawSession(ctx)
  if (note === null) return
  await rememberTask(ctx, task)
  await noteSwitch(ctx, note, task)
  const notes = await readNotes(ctx, task)
  if (notes.some((n) => n.agent === note.agent && n.id === note.id)) return
  const recorded = (await claimedSession(ctx, note, task))
    ? { ...note, source: "workflow" as const }
    : note
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.writeFile(
    join(task.runtimeDir, SESSIONS_FILE),
    `${JSON.stringify([...notes, recorded], null, 2)}\n`,
  )
}

// ---------------------------------------------------------------------------- which task, when

/** From `at` on, the session worked on this task (until its next switch). */
type Switch = { repoId: string; slug: string; at: number }

const timelinePath = (ctx: Ctx, note: Pick<SessionNote, "agent" | "id">) =>
  join(ctx.home, "cost-sessions", `${note.agent}-${keyOf(note.id)}.ndjson`)

async function readTimeline(ctx: Ctx, note: Pick<SessionNote, "agent" | "id">): Promise<Switch[]> {
  const path = timelinePath(ctx, note)
  if (!(await ctx.fs.exists(path))) return []
  const out: Switch[] = []
  for (const line of (await ctx.fs.readFile(path)).split("\n")) {
    try {
      const s = JSON.parse(line) as Partial<Switch>
      if (typeof s.repoId === "string" && typeof s.slug === "string" && typeof s.at === "number")
        out.push({ repoId: s.repoId, slug: s.slug, at: s.at })
    } catch {
      // a torn line
    }
  }
  return out
}

async function noteSwitch(ctx: Ctx, note: SessionNote, task: CostTask): Promise<void> {
  if (!task.repoId || !task.slug) return
  const timeline = await readTimeline(ctx, note)
  const last = timeline.at(-1)
  if (last?.repoId === task.repoId && last.slug === task.slug) return
  const folder = join(ctx.home, "cost-sessions")
  await ctx.fs.mkdir(folder)
  const path = timelinePath(ctx, note)
  await ctx.fs.append(
    path,
    `${JSON.stringify({ repoId: task.repoId, slug: task.slug, at: note.at })}\n`,
  )
  // The folder grows by a file per agent session for as long as the machine lives: a session keeps
  // its newest switches, and the folder its newest sessions (a dropped timeline is rebuilt on read).
  if (timeline.length >= COST_SESSION_LINES_KEPT)
    await ctx.fs.atomicWrite(
      path,
      newestLines(await ctx.fs.readFile(path), COST_SESSION_LINES_KEPT),
    )
  await capFolder(ctx, folder, COST_SESSIONS_KEPT, (name) => name.endsWith(".ndjson"))
}

/**
 * When a session worked on which task. A session noted before switches were kept has none: its
 * timeline is rebuilt from the moment each of the repository's tasks first noted it.
 */
async function timelineOf(ctx: Ctx, note: SessionNote, task: CostTask): Promise<Switch[]> {
  const kept = await readTimeline(ctx, note)
  if (kept.length > 0) return kept
  if (!task.repoId) return []
  const tasks = join(projectRuntimeDir(ctx, task.repoId), "tasks")
  const rebuilt: Switch[] = []
  for (const slug of await list(ctx, tasks)) {
    const own = (await readNotes(ctx, { runtimeDir: join(tasks, slug) })).find(
      (n) => n.agent === note.agent && n.id === note.id,
    )
    if (own !== undefined && typeof own.at === "number")
      rebuilt.push({ repoId: task.repoId, slug, at: own.at })
  }
  return rebuilt.sort((a, b) => a.at - b.at)
}

/**
 * Whether a moment of the session belongs to this task: the task it last switched to by then.
 * A proven claim excludes earlier history; unproven legacy imports keep their existing window.
 * A moment the transcript does not date goes
 * with where the session is now. No timeline: legacy records retain their existing attribution.
 */
function ownedBy(
  timeline: Switch[],
  task: CostTask,
  claimed: boolean,
): (at: number | null) => boolean {
  if (timeline.length === 0) return () => true
  const mine = (s: Switch | undefined) => s?.repoId === task.repoId && s?.slug === task.slug
  return (at) => {
    if (at === null) return mine(timeline.at(-1))
    if (claimed && at < (timeline[0]?.at ?? -Infinity)) return false
    let owner = timeline[0]
    for (const s of timeline) {
      if (s.at > at) break
      owner = s
    }
    return mine(owner)
  }
}

/** The earliest dated call, or null when none is dated. */
function firstAt(calls: Call[]): number | null {
  let first: number | null = null
  for (const c of calls) if (c.at !== null && (first === null || c.at < first)) first = c.at
  return first
}

// ---------------------------------------------------------------------------- finding transcripts

async function list(ctx: Ctx, dir: string): Promise<string[]> {
  try {
    return await ctx.fs.readdir(dir)
  } catch {
    return []
  }
}

/** A Claude Code session's transcript and its subagents' transcripts. */
async function claudeFiles(
  ctx: Ctx,
  home: string,
  id: string,
): Promise<{ main: string; subagents: string[] } | null> {
  const projects = join(ctx.env.get("CLAUDE_CONFIG_DIR") || join(home, ".claude"), "projects")
  for (const project of await list(ctx, projects)) {
    const main = join(projects, project, `${id}.jsonl`)
    if (!(await filesIn(ctx.fs, join(projects, project))).includes(`${id}.jsonl`)) continue
    const folder = join(projects, project, id, "subagents")
    const subagents = (await filesIn(ctx.fs, folder, true))
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .map((name) => join(folder, name))
    return { main, subagents }
  }
  return null
}

/** Every Codex rollout file (sessions/YYYY/MM/DD/rollout-*.jsonl, or compressed), once per session. */
async function codexRollouts(ctx: Ctx, root: string): Promise<string[]> {
  return oncePerSession(
    (await filesIn(ctx.fs, root, true)).filter(isRollout).map((name) => join(root, name)),
    (path) => path,
  )
}

const headers = new WeakMap<
  Ctx,
  Map<string, { size: number; mtimeMs: number; meta: ReturnType<typeof codexCalls> }>
>()
async function codexHeader(ctx: Ctx, file: string): Promise<ReturnType<typeof codexCalls>> {
  const cached = headers.get(ctx) ?? new Map()
  headers.set(ctx, cached)
  const stat = await ctx.fs.stat?.(file)
  const prior = cached.get(file)
  if (prior && stat && prior.size === stat.size && prior.mtimeMs === stat.mtimeMs) return prior.meta
  const text = isCompressedRollout(file)
    ? ((await readCompressedHead(file, 4096))?.text ?? "")
    : ctx.fs.readRange
      ? await ctx.fs.readRange(file, 0, 4096)
      : (await ctx.fs.readFile(file)).slice(0, 4096)
  // Current native headers include long base instructions. Read JSON string atoms from
  // their bounded prefix rather than requiring that entire first line to fit.
  const atom = (pattern: RegExp): string | null => {
    const value = text.match(pattern)?.[1]
    try {
      return value === undefined ? null : (JSON.parse(value) as string)
    } catch {
      return null
    }
  }
  const meta = codexCalls("")
  if (/"type"\s*:\s*"session_meta"/.test(text)) {
    meta.id = atom(/"id"\s*:\s*("(?:[^"\\]|\\.)*")/)
    meta.parent = atom(/"parent_thread_id"\s*:\s*("(?:[^"\\]|\\.)*")/)
    meta.cwd = atom(/"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/)
  }
  if (stat) cached.set(file, { ...stat, meta })
  return meta
}

// ---------------------------------------------------------------------------- the cost

export type { TaskCost } from "./labels.ts"

type Bucket = {
  byModel: Record<string, Tokens>
  usd: number
  unpriced: Record<string, number>
  nativeCredits?: Call["nativeCredits"]
  reportedCreditValueUsd?: number
  estimateUsd?: number
}

const bucket = (): Bucket => ({ byModel: {}, usd: 0, unpriced: {} })

function put(into: Bucket, call: Call): void {
  const tokens = into.byModel[call.model] ?? zeroTokens()
  addTokens(tokens, call.tokens)
  into.byModel[call.model] = tokens
  into.nativeCredits = mergeNativeCredits(into.nativeCredits, call.nativeCredits)
  if (call.reportedCreditValueUsd !== undefined) {
    into.usd += call.reportedCreditValueUsd
    into.reportedCreditValueUsd = (into.reportedCreditValueUsd ?? 0) + call.reportedCreditValueUsd
    return
  }
  const priced = pricedCost({ [call.model]: call.tokens }, call.pricing ?? {})
  if (
    priced.unpriced.length === 0 &&
    allTokens(call.tokens) > 0 &&
    call.pricing?.grokAggregate?.source !== "native"
  )
    into.estimateUsd = (into.estimateUsd ?? 0) + priced.usd
  into.usd += priced.usd
  for (const row of priced.unpriced)
    into.unpriced[row.model] = (into.unpriced[row.model] ?? 0) + row.tokens
}

/** What months archived long ago cost this task, as the start of its total: figures keep their order and sums. */
function seedArchived(total: Bucket, archived: TaskCostTotal): void {
  total.usd = archived.usd
  total.nativeCredits = archived.nativeCredits
  total.reportedCreditValueUsd = archived.reportedCreditValueUsd
  total.estimateUsd = archived.estimateUsd
  total.byModel.archived = {
    input: archived.tokens.input,
    output: archived.tokens.output,
    cacheRead: archived.tokens.cacheRead,
    cacheWrite5m: archived.tokens.cacheWrite - archived.tokens.cacheWrite1h,
    cacheWrite1h: archived.tokens.cacheWrite1h,
  }
  for (const row of archived.unpriced) total.unpriced[row.model] = row.tokens
}

function lineOf(b: Bucket): CostLine {
  const tokens = zeroTokens()
  for (const t of Object.values(b.byModel)) addTokens(tokens, t)
  return {
    tokens,
    all: allTokens(tokens),
    usd: b.nativeCredits?.status === "unavailable" && b.estimateUsd === undefined ? null : b.usd,
    ...(b.nativeCredits ? { nativeCredits: b.nativeCredits } : {}),
    ...(b.reportedCreditValueUsd !== undefined
      ? { reportedCreditValueUsd: b.reportedCreditValueUsd }
      : {}),
    ...(b.estimateUsd !== undefined ? { estimateUsd: b.estimateUsd } : {}),
    unpriced: Object.entries(b.unpriced).map(([model, tokens]) => ({ model, tokens })),
  }
}

/** The model that carried most of a bucket's tokens. */
function mainModel(b: Bucket): string {
  let best = "unknown"
  let most = -1
  for (const [model, tokens] of Object.entries(b.byModel)) {
    const n = allTokens(tokens)
    if (n > most) {
      best = model
      most = n
    }
  }
  return best
}

/** Which step a moment belongs to, from the task's own stage changes. */
async function stepClock(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "stage">,
): Promise<(at: number | null) => FlowStepId> {
  const changes = (await readEvents(ctx, task))
    .filter((e) => typeof e.ts === "number" && typeof e.to === "string")
    .map((e) => ({ at: e.ts as number, step: flowStepOf(e.to as string) }))
    .sort((a, b) => a.at - b.at)
  const now = flowStepOf(task.stage) ?? "verify"
  return (at) => {
    if (at === null) return now
    let step: FlowStepId = "plan"
    for (const change of changes) {
      if (change.at > at) break
      if (change.step !== null) step = change.step
    }
    return step
  }
}

/** A wait longer than this between two calls is the person's time, not the agents'. */
const IDLE_MS = 5 * 60_000

/** Time the agents worked: the gaps between calls, side-by-side helpers counted once, idle waits left out. */
function activeMs(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b)
  let total = 0
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i] ?? 0) - (sorted[i - 1] ?? 0)
    if (gap <= IDLE_MS) total += gap
  }
  return total
}

type HelperRow = Bucket & {
  missing?: true
  kind?: CostHelper["kind"]
  agent?: Agent
  /** Every call it made: all of its cost is counted in the step it began in. */
  calls: Call[]
  first: number | null
  last: number | null
  brief: Brief
  prompt: string | null
  description: string | null
  fallback: string
}

export async function taskCost(ctx: Ctx, task: Task): Promise<TaskCost> {
  await rememberTask(ctx, task)
  const pending: LedgerCall[] = []
  const home = ctx.env.get("HOME") ?? ""
  const codexHome = ctx.env.get("CODEX_HOME") ?? join(home, ".codex")
  const stepAt = await stepClock(ctx, task)
  const steps = new Map<FlowStepId, { all: Bucket; session: Bucket; times: number[] }>()
  const helpers = new Map<string, HelperRow>()
  const total = bucket()
  let missing = 0
  const seen = new Set<string>()
  const countedCodex = new Set<string>()
  const kept = await readTaskLedger(ctx, task.runtimeDir)
  const knownSessions = new Set([
    ...kept.rows.map((row) => `${row.agent}:${row.session}`),
    ...(kept.archived?.sessions ?? []),
  ])

  const stepOf = (step: FlowStepId) => {
    const own = steps.get(step) ?? { all: bucket(), session: bucket(), times: [] }
    steps.set(step, own)
    return own
  }

  let session = ""
  let agent: Agent = "claude-code"
  let folding = false
  const record = (call: Call, helper: HelperRow | null) => {
    if (!folding) {
      if (helper && call.at !== null) {
        helper.first = helper.first === null ? call.at : Math.min(helper.first, call.at)
        helper.last = helper.last === null ? call.at : Math.max(helper.last, call.at)
      }
      pending.push({
        call: call.accountingId
          ? `${agent}:accounting:${call.accountingId}`
          : `${agent}:${session}:${call.id ?? pending.length}`,
        ...(call.legacyIds
          ? { legacyCalls: call.legacyIds.map((id) => `${agent}:${session}:${id}`) }
          : {}),
        at: call.at,
        task: task.runtimeDir,
        taskId: `${task.repoId ?? ""}~${task.slug}`,
        title: task.title ?? task.slug,
        session,
        agent,
        role:
          helper === null
            ? "session"
            : kindOfText(helper.prompt, helper.description) === "cross-review"
              ? "review"
              : (kindOfId(helper.fallback) ?? kindOfText(helper.prompt, helper.description)),
        label: helper?.description ?? null,
        model: call.model,
        ...call.tokens,
        cacheWrite: call.tokens.cacheWrite5m + call.tokens.cacheWrite1h,
        usd: call.reportedCreditValueUsd ?? priceOf(call.model, call.tokens, call.pricing),
        ...(call.nativeCredits ? { nativeCredits: call.nativeCredits } : {}),
        ...(call.reportedCreditValueUsd !== undefined
          ? { reportedCreditValueUsd: call.reportedCreditValueUsd }
          : {}),
        ...(call.pricing !== undefined ? { pricing: call.pricing } : {}),
        helper:
          helper === null
            ? null
            : {
                brief: helper.brief,
                description: helper.description,
                fallback: helper.fallback,
                first: helper.first,
                last: helper.last,
                missing: helper.missing,
              },
      })
      return
    }
    put(total, call)
    if (helper === null) {
      const own = stepOf(stepAt(call.at))
      put(own.all, call)
      put(own.session, call)
      if (call.at !== null) own.times.push(call.at)
      return
    }
    put(helper, call)
    helper.calls.push(call)
    if (call.at !== null) {
      helper.first = helper.first === null ? call.at : Math.min(helper.first, call.at)
      helper.last = helper.last === null ? call.at : Math.max(helper.last, call.at)
    }
  }

  /** The row of the helper a transcript is; the same id in two transcripts (a restart) is one row. */
  const rowOf = (
    sub: { prompt: string | null; brief: Brief },
    fallback: string,
    description: string | null,
  ) => {
    const id = sub.brief.helper ?? fallback
    const row: HelperRow = helpers.get(id) ?? {
      ...bucket(),
      calls: [],
      first: null,
      last: null,
      brief: sub.brief,
      prompt: sub.prompt,
      description,
      fallback: id,
    }
    helpers.set(id, row)
    return row
  }

  const ours = sameRepository(ctx, task)
  let rollouts:
    | {
        id: string | null
        parent: string | null
        cwd: string | null
        prompt: string | null
        calls: Call[]
        brief: Brief
      }[]
    | null = null
  const notes = await readNotes(ctx, task)
  const claims = new Set<SessionNote>()
  for (const note of notes) if (await claimedSession(ctx, note, task)) claims.add(note)
  const native = new Map<Agent, Awaited<ReturnType<typeof piSessions>>>()
  const countedNative = new Set<string>()
  for (const note of notes) {
    const claimed = claims.has(note)
    session = note.id
    agent = note.agent
    if (note.agent === "claude-code") {
      const files = await claudeFiles(ctx, home, note.id)
      if (files === null) {
        if (!knownSessions.has(`${note.agent}:${note.id}`)) missing++
        continue
      }
      const counted = new Set(seen)
      const parsedMain = await indexedTranscript(ctx, files.main, "claude-code")
      const main = {
        ...parsedMain,
        calls: parsedMain.calls.filter((c) => !counted.has(c.id ?? "")),
      }
      for (const call of main.calls) counted.add(call.id ?? "")
      if (!claimed && !(await ours(main.cwd))) continue
      for (const id of counted) seen.add(id)
      // One session may plan one task and build another: each call goes to the task it was on.
      const owns = ownedBy(await timelineOf(ctx, note, task), task, claimed)
      for (const call of main.calls) if (owns(call.at)) record(call, null)
      for (const file of files.subagents) {
        const parsedSub = await indexedTranscript(ctx, file, "claude-code")
        const sub = { ...parsedSub, calls: parsedSub.calls.filter((c) => !seen.has(c.id ?? "")) }
        for (const call of sub.calls) seen.add(call.id ?? "")
        session = basename(file, ".jsonl")
        // A helper belongs, whole, to the task its session was on when it started.
        if (!owns(firstAt(sub.calls))) continue
        const stem = file.slice(file.lastIndexOf("/") + 1).replace(/\.jsonl$/, "")
        const row = rowOf(sub, stem, await describedAs(ctx, file))
        for (const call of sub.calls) record(call, row)
      }
    } else if (note.agent === "pi" || note.agent === "opencode") {
      let parsed = native.get(note.agent)
      if (!parsed) {
        const wanted = notes.filter((row) => row.agent === note.agent).map((row) => row.id)
        parsed =
          note.agent === "pi"
            ? await piSessions(
                ctx,
                task.repoRoot,
                wanted,
                notes
                  .filter((note) => note.agent === "pi" && claims.has(note))
                  .map((note) => note.id),
              )
            : (opencodeSessions(ctx, wanted) ?? [])
        native.set(note.agent, parsed)
      }
      const own = parsed.find((row) => row.id === note.id)
      if (!own) {
        if (!knownSessions.has(`${note.agent}:${note.id}`)) missing++
        continue
      }
      const owns = ownedBy(await timelineOf(ctx, note, task), task, claimed)
      const related = new Set([note.id])
      let grew = true
      while (grew) {
        grew = false
        for (const row of parsed)
          if (row.id && row.parent && related.has(row.parent) && !related.has(row.id)) {
            related.add(row.id)
            grew = true
          }
      }
      for (const row of parsed) {
        if (!row.id || !related.has(row.id)) continue
        if (
          !row.id ||
          countedNative.has(`${note.agent}:${row.id}`) ||
          (!claimed && !(await ours(row.cwd)))
        )
          continue
        if (row.id !== note.id && !owns(firstAt(row.calls))) continue
        countedNative.add(`${note.agent}:${row.id}`)
        session = row.id
        const helper =
          row.parent !== null || row.ownHelper !== null
            ? rowOf(row, `session-${row.id}`, null)
            : null
        for (const call of row.calls) if (helper || owns(call.at)) record(call, helper)
      }
    } else if (readsRecordCost(note.agent)) {
      // Grok, Antigravity and Copilot: the session's own record, read with the usage count's parser.
      const path = sessionRecordPath(ctx, note.agent, note.id, {
        cwd: task.repoRoot,
        runtimeDir: task.runtimeDir,
      })
      if (path === null) {
        if (!knownSessions.has(`${note.agent}:${note.id}`)) missing++
        continue
      }
      if (countedNative.has(`${note.agent}:${note.id}`)) continue
      countedNative.add(`${note.agent}:${note.id}`)
      const owns = ownedBy(await timelineOf(ctx, note, task), task, claimed)
      for (const call of await recordCalls(ctx, note.agent, path))
        if (owns(call.at)) record(call, null)
    } else if (note.agent === "codex") {
      if (rollouts === null) {
        rollouts = []
        const metadata = []
        for (const file of await codexRollouts(ctx, join(codexHome, "sessions")))
          metadata.push({ file, meta: await codexHeader(ctx, file) })
        const wanted = new Set(
          notes.filter((note) => note.agent === "codex").map((note) => note.id),
        )
        let changed = true
        while (changed) {
          changed = false
          for (const { meta } of metadata)
            if (meta.id && meta.parent && wanted.has(meta.parent) && !wanted.has(meta.id)) {
              wanted.add(meta.id)
              changed = true
            }
        }
        for (const { file, meta } of metadata)
          if (meta.id && wanted.has(meta.id))
            rollouts.push(await indexedTranscript(ctx, file, "codex"))
      }
      const own = rollouts.find((r) => r.id === note.id)
      if (own === undefined) {
        if (!knownSessions.has(`${note.agent}:${note.id}`)) missing++
        continue
      }
      if (!claimed && !(await ours(own.cwd))) continue
      if (countedCodex.has(note.id)) continue
      countedCodex.add(note.id)
      const owns = ownedBy(await timelineOf(ctx, note, task), task, claimed)
      // Helpers note their own sessions when they call the CLI. A noted child is still a helper,
      // and its parent's scan must not count it a second time (in either note order).
      const ownRow = own.parent !== null ? rowOf(own, `thread-${note.id}`, null) : null
      for (const call of own.calls) if (owns(call.at)) record(call, ownRow)
      const visited = new Set<string>()
      const descendants = (parent: string): NonNullable<typeof rollouts> => {
        visited.add(parent)
        const children = (rollouts ?? []).filter(
          (r) => r.parent === parent && (r.id === null || !visited.has(r.id)),
        )
        return children.flatMap((child) => [
          child,
          ...(child.id === null ? [] : descendants(child.id)),
        ])
      }
      for (const sub of descendants(note.id)) {
        if (sub.id !== null && countedCodex.has(sub.id)) continue
        if (!owns(firstAt(sub.calls))) continue
        if (sub.id !== null) countedCodex.add(sub.id)
        const row = rowOf(sub, `thread-${sub.id ?? helpers.size + 1}`, null)
        session = sub.id ?? row.fallback
        for (const call of sub.calls) record(call, row)
      }
    }
  }

  const reviewCosts = await readReviewCosts(ctx, task)
  const incompleteSteps = new Set<FlowStepId>()
  for (const review of reviewCosts) {
    const row = rowOf(
      { prompt: "You are reviewing: the change", brief: { helper: null } },
      review.id,
      review.point === "question"
        ? `${review.name} answering questions on the change`
        : review.point === "another"
          ? `${review.name} reviewing the change, asked from the Review workspace`
          : `${review.name} ${review.point} review`,
    )
    row.first = review.started
    row.last = review.ended
    session = review.id
    agent = review.by
    for (const [index, call] of review.calls.entries()) record({ ...call, id: String(index) }, row)
    if (review.missing) {
      row.missing = true
      missing++
      incompleteSteps.add(stepAt(review.started))
    }
  }
  // Older ephemeral reviews left no usage. Their cost is unknown, never zero.
  for (const point of ["plan", "verify"] as const) {
    const run = await readJsonReview(ctx, task, point)
    if (
      !run ||
      typeof run.pid !== "number" ||
      run.state === "running" ||
      reviewCosts.some((r) => r.id === reviewCostId({ point, started: run.started }))
    )
      continue
    const row = rowOf(
      { prompt: "You are reviewing: the change", brief: { helper: null } },
      reviewCostId({ point, started: run.started }),
      `${run.name} ${point} review`,
    )
    row.first = run.started
    row.last = run.ended ?? run.started
    row.missing = true
    row.byModel[run.model] = zeroTokens()
    missing++
    incompleteSteps.add(stepAt(run.started))
  }

  const missingRows = [...helpers.entries()].filter(([, row]) => row.missing)
  await upsertLedger(ctx, pending)
  // Fold durable call revisions, retaining reviewers that recorded no usage.
  helpers.clear()
  for (const [id, row] of missingRows) helpers.set(id, row)
  folding = true
  const ledger = await readTaskLedger(ctx, task.runtimeDir)
  if (ledger.archived !== null) seedArchived(total, ledger.archived)
  for (const entry of ledger.rows) {
    const helper = entry.helper
    const row =
      helper === null
        ? null
        : rowOf({ ...helper, prompt: null }, helper.fallback, helper.description)
    if (row && helper) {
      row.first = helper.first
      row.last = helper.last
      row.missing ||= helper.missing
      row.kind =
        entry.role === "review"
          ? "cross-review"
          : entry.role === "session"
            ? "own-helper"
            : entry.role
      row.agent = entry.agent
    }
    record(
      {
        at: entry.at,
        model: entry.model,
        ...(entry.nativeCredits ? { nativeCredits: entry.nativeCredits } : {}),
        ...(entry.reportedCreditValueUsd !== undefined
          ? { reportedCreditValueUsd: entry.reportedCreditValueUsd }
          : {}),
        ...(entry.pricing !== undefined ? { pricing: entry.pricing } : {}),
        tokens: {
          input: entry.input,
          output: entry.output,
          cacheRead: entry.cacheRead,
          cacheWrite5m: entry.cacheWrite5m,
          cacheWrite1h: entry.cacheWrite1h,
        },
      },
      row,
    )
  }

  // A helper's whole cost goes to the step it began in, so a step is its session plus the helpers
  // listed under it, in cost and in time.
  for (const row of helpers.values()) {
    const own = stepOf(stepAt(row.first))
    if (row.first !== null) own.times.push(row.first)
    if (row.last !== null) own.times.push(row.last)
    for (const call of row.calls) {
      put(own.all, call)
      if (call.at !== null) own.times.push(call.at)
    }
  }

  const order: FlowStepId[] = ["plan", "implement", "verify"]
  const stepList: CostStep[] = order.flatMap((step) => {
    const s = steps.get(step)
    if (s === undefined) return []
    const session = lineOf(s.session)
    const model = mainModel(s.session)
    return [
      {
        step,
        ms: activeMs(s.times),
        session: session.all > 0 ? { ...session, model, modelLabel: modelLabel(model) } : null,
        ...lineOf(s.all),
        ...(incompleteSteps.has(step) ? { usd: null } : {}),
      },
    ]
  })
  const named = labelHelpers(
    [...helpers.entries()].map(([id, row]) => ({
      id,
      row,
      kind: row.kind ?? kindOfId(id) ?? kindOfText(row.prompt, row.description),
      description: row.description,
      first: row.first,
    })),
  )
  const runs = projectChecks(await readCheckRecords(ctx, task))
  return {
    steps: stepList,
    // In the order they started.
    helpers: [...named]
      .sort((a, b) => (a.first ?? Number.MAX_SAFE_INTEGER) - (b.first ?? Number.MAX_SAFE_INTEGER))
      .map(({ id, row, kind, label }) => ({
        id,
        kind,
        label:
          kind === "own-helper"
            ? label.replace(
                /^(?:Claude Code's own helper|Agent's own helper)/,
                `${AGENT_NAMES[row.agent ?? "claude-code"]}'s own helper`,
              )
            : label,
        model: mainModel(row),
        modelLabel: modelLabel(mainModel(row)),
        ms: row.first !== null && row.last !== null ? row.last - row.first : 0,
        step: stepAt(row.first),
        calls: row.calls.length,
        ...lineOf(row),
        ...(row.missing ? { usd: null } : {}),
      })),
    checks: runs === null ? null : { step: stepAt(runs.firstAt), runs: runs.runs, ms: runs.ms },
    total: {
      ms: stepList.reduce((n, s) => n + s.ms, 0),
      ...lineOf(total),
      ...(missing ? { usd: null } : {}),
    },
    note:
      total.nativeCredits?.amount !== undefined
        ? "Copilot AI-credit usage value at $0.01 per credit; not additional money billed. Other calls use verified list estimates. Partial credit amounts are reported subtotals."
        : PRICE_NOTE,
    missing,
  }
}

async function readJsonReview(
  ctx: Ctx,
  task: { runtimeDir: string },
  point: string,
): Promise<{
  state: string
  name: string
  model: string
  started: number
  ended?: number
  pid?: number
} | null> {
  try {
    const run = JSON.parse(await ctx.fs.readFile(join(task.runtimeDir, `review-${point}.json`)))
    return typeof run?.state === "string" &&
      typeof run?.name === "string" &&
      typeof run?.model === "string" &&
      typeof run?.started === "number"
      ? run
      : null
  } catch {
    return null
  }
}

/**
 * Whether a session that started in `cwd` worked in this task's repository: inside its checkout,
 * or in another worktree of it. A transcript that names no folder is counted.
 */
function sameRepository(
  ctx: Ctx,
  task: Pick<Task, "repoRoot" | "repoId">,
): (cwd: string | null) => Promise<boolean> {
  const known = new Map<string, boolean>()
  let canonicalTask: Promise<string | null> | null = null
  return async (cwd) => {
    if (cwd === null || !task.repoRoot) return true
    const dir = resolve(cwd)
    const root = resolve(task.repoRoot)
    if (dir === root || dir.startsWith(`${root}${sep}`)) return true
    let same = known.get(dir)
    if (same === undefined) {
      // Git resolves checkout aliases (for example /var and /private/var on macOS).
      const checkout = await ctx.git.topLevel(dir)
      const commonDir = await ctx.git.commonDir(checkout ?? dir)
      same = commonDir !== null && repoIdFrom(commonDir) === task.repoId
      // A transcript can name the checkout through a symlink (on macOS, /var and /private/var).
      // Compare the actual Git directories before silently treating it as another repository.
      if (!same && commonDir !== null) {
        const canonical = await realpath(commonDir).catch(() => null)
        if (canonical !== null) {
          canonicalTask ??= ctx.git
            .commonDir(root)
            .then((path) => (path === null ? null : realpath(path).catch(() => null)))
          same = canonical === (await canonicalTask)
        }
      }
      known.set(dir, same)
    }
    return same
  }
}

/** What the session that started a helper called it (Claude Code writes it beside the transcript). */
async function describedAs(ctx: Ctx, transcript: string): Promise<string | null> {
  try {
    const meta = JSON.parse(
      await ctx.fs.readFile(transcript.replace(/\.jsonl$/, ".meta.json")),
    ) as {
      description?: unknown
    }
    return typeof meta.description === "string" && meta.description.trim() !== ""
      ? meta.description.trim()
      : null
  } catch {
    return null
  }
}
