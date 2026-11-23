// What the agents' own transcripts say was used over the last 7, 30 or 90 days: tokens and an
// estimated cost by agent and by model. Transcripts run to gigabytes, so the read is bounded three
// ways: only files changed within the range are opened, a file past the size cap is counted as
// skipped, and one request works for a time budget and then answers with what it has (`complete`
// is false, `pendingFiles` says how many are left). A file that was read but is too much to hold
// is `cappedFiles`: asking again cannot add it, so it does not keep `complete` false. What a
// file held is kept by its change time and size, so the next request only reads what is new. A
// model's usage counts once per message id, even when a resumed session repeats the message in
// another file. OpenCode keeps its calls in a database, so each of its sessions stands for a file.

import type { Ctx } from "../../ctx.ts"
import { USAGE_INDEX_FILES_KEPT, USAGE_INDEX_MAX_BYTES } from "../home-caps.ts"
import type { Call } from "./transcripts.ts"
import type { BillingHints } from "./usage-billing.ts"
import { type Indexed, pack, STRIDE, type Usage, usageOf, type Wanted } from "./usage-count.ts"
import { type UsagePeriod, usageWindows } from "./usage-days.ts"
import { type Candidate, chunksOf, DAY_MS } from "./usage-files.ts"
import { type DiscoveredMap, discoverUsageSources, finalizeUsage } from "./usage-finalize.ts"
import type { Source } from "./usage-sources.ts"
import { loadStored, pruneStored, saveStored } from "./usage-store.ts"

export type { BillingHints, UsageBilling } from "./usage-billing.ts"
export type {
  AgentUsage,
  DayModel,
  DayUsage,
  ModelUsage,
  Spend,
  Usage,
} from "./usage-count.ts"
export { USAGE_PERIODS, type UsagePeriod } from "./usage-days.ts"

/** A file past this size is not read: a transcript this large is counted as skipped. */
export const USAGE_FILE_MAX_BYTES = 128 * 1024 * 1024
/** One request reads for this long, then answers with what it has. */
export const USAGE_BUDGET_MS = 1500
/** Calls kept in the index; past it a file is left unread rather than held. */
export const USAGE_CALLS_MAX = 300_000
/** A file untouched this long is let go of: no period reaches back further. */
const LONGEST_DAYS = 90

type LoadState = {
  pending: number
  skipped: number
  capped: number
  read: number
  failed: Set<string>
  started: number
  budget: number
  clock: () => number
}

/** What each agent's transcripts have shown; one per server, so the next request reads only what changed. */
export class UsageIndex {
  private files = new Map<string, Indexed>()
  private calls = 0
  private wrote = true
  private discovered: DiscoveredMap = new Map()
  private failedFiles = new Set<string>()

  constructor(
    private options: {
      budgetMs?: number
      fileMaxBytes?: number
      callsMax?: number
      /** The time the budget is measured on; a test gives its own. */
      clock?: () => number
      /** The caps of the index kept in the home (`USAGE_INDEX_*` in home-caps.ts); a test gives its own. */
      stored?: { files?: number; bytes?: number; fileBytes?: number }
    } = {},
  ) {}

  /** Indexed calls held, for the memory cap and its test. */
  get size(): number {
    return this.calls
  }

  /** Forget everything held, as the resource guard may when memory is short. */
  drop(): void {
    this.files.clear()
    this.calls = 0
    this.discovered.clear()
    this.failedFiles.clear()
  }

  private forget(path: string): void {
    const held = this.files.get(path)
    if (held === undefined) return
    this.calls -= held.calls.length / STRIDE
    this.files.delete(path)
  }

  /** Let go of files older than any period, and of files gone from the stretch that was just listed. */
  private evict(now: number, listedFrom: number, present: ReadonlySet<string>): void {
    for (const path of this.failedFiles) if (!present.has(path)) this.failedFiles.delete(path)
    for (const [path, held] of [...this.files])
      if (
        held.mtimeMs < now - LONGEST_DAYS * DAY_MS ||
        (held.mtimeMs >= listedFrom && !present.has(path))
      )
        this.forget(path)
  }

  private isUnreadChange(file: Candidate): boolean {
    const held = this.files.get(file.path)
    return (
      !this.failedFiles.has(file.path) &&
      (held?.mtimeMs !== file.mtimeMs || held?.size !== file.size)
    )
  }

  private async loadOne(ctx: Ctx, { source, file }: Wanted, state: LoadState): Promise<void> {
    if (state.failed.has(source.agent) && file.size > 0) {
      if (this.isUnreadChange(file)) state.pending++
      return
    }
    // Every request attempts at least one file, so a long list is always worked through.
    const outOfTime =
      file.size > 0 && state.read > 0 && state.clock() - state.started >= state.budget
    if (outOfTime && this.failedFiles.has(file.path)) {
      state.failed.add(source.agent)
      return
    }
    let outcome: Awaited<ReturnType<UsageIndex["take"]>>
    try {
      outcome = await this.take(ctx, source, file, outOfTime)
    } catch {
      state.read++
      this.failedFiles.delete(file.path)
      this.failedFiles.add(file.path)
      state.failed.add(source.agent)
      return
    }
    if (outcome === "read" || outcome === "full") {
      state.read++
      this.failedFiles.delete(file.path)
    }
    if (outcome === "skipped") state.skipped++
    if (outcome === "full" || outcome === "capped") state.capped++
    if (outcome === "pending") state.pending++
  }

  /** Read what is unread, within the budget; how many files were left for the next request, how many were too large, and how many were read but could not be held. */
  private async load(
    ctx: Ctx,
    wanted: readonly Wanted[],
  ): Promise<{ pending: number; skipped: number; capped: number; failed: Set<string> }> {
    const clock = this.options.clock ?? (() => performance.now())
    const state: LoadState = {
      pending: 0,
      skipped: 0,
      capped: 0,
      read: 0,
      failed: new Set(),
      started: clock(),
      budget: this.options.budgetMs ?? USAGE_BUDGET_MS,
      clock,
    }
    const retryOrder = new Map([...this.failedFiles].map((path, order) => [path, order + 1]))
    const ordered = [...wanted].sort(
      (a, b) => (retryOrder.get(a.file.path) ?? 0) - (retryOrder.get(b.file.path) ?? 0),
    )
    for (const entry of ordered) await this.loadOne(ctx, entry, state)
    return {
      pending: state.pending,
      skipped: state.skipped,
      capped: state.capped,
      failed: state.failed,
    }
  }

  /**
   * What became of one file: kept from before, too large, left for later, read, read but not held for
   * lack of room (`full`), or known from an earlier read and not held for the same reason (`capped`,
   * which costs no reading).
   */
  private async take(
    ctx: Ctx,
    source: Source,
    file: Candidate,
    outOfTime: boolean,
  ): Promise<"held" | "skipped" | "pending" | "read" | "full" | "capped"> {
    const held = this.files.get(file.path)
    if (held?.mtimeMs === file.mtimeMs && held.size === file.size) return "held"
    // What an earlier server made of this transcript stands while the transcript has not changed.
    const stored = await loadStored(ctx, file, source.agent)
    if (stored !== null) {
      this.forget(file.path)
      return this.admit(file, stored) ? "held" : "capped"
    }
    if (file.size > (this.options.fileMaxBytes ?? USAGE_FILE_MAX_BYTES)) {
      this.forget(file.path)
      return "skipped"
    }
    if (outOfTime) return "pending"
    const indexed = pack(source, file, await this.callsOf(ctx, source, file))
    this.forget(file.path)
    this.wrote =
      (await saveStored(ctx, file, indexed, this.options.stored?.fileBytes, source.agent)) ||
      this.wrote
    return this.admit(file, indexed) ? "read" : "full"
  }

  /** A candidate's calls: read out of its database, or parsed from its transcript chunk by chunk. */
  private async callsOf(ctx: Ctx, source: Source, file: Candidate): Promise<Call[]> {
    if (source.read !== undefined) return source.read(ctx, file)
    const parser = source.parse()
    for await (const text of chunksOf(ctx, file.path, file.size)) parser.chunk(text)
    return parser.finish()
  }

  /** Hold a transcript's calls in memory unless that would pass the cap. */
  private admit(file: Candidate, indexed: Indexed): boolean {
    if (this.calls + indexed.calls.length / STRIDE > (this.options.callsMax ?? USAGE_CALLS_MAX))
      return false
    this.files.set(file.path, indexed)
    this.calls += indexed.calls.length / STRIDE
    return true
  }

  /** Requests run one at a time: two at once would both count a file into the index. */
  private queue: Promise<unknown> = Promise.resolve()

  /** What was used in a period, with the period before it; `hints` tell how an agent is billed beyond what its own folder says. */
  read(ctx: Ctx, period: UsagePeriod, hints: BillingHints = {}): Promise<Usage> {
    const run = this.queue.then(() => this.readNow(ctx, period, hints))
    this.queue = run.catch(() => {})
    return run
  }

  private async readNow(ctx: Ctx, period: UsagePeriod, hints: BillingHints): Promise<Usage> {
    const to = ctx.clock.now()
    const { current, previous } = usageWindows(period, to)
    // Files changed since the earlier of the two stretches hold what either of them counts.
    const from = Math.min(current.from, previous.from)
    const { wanted, discovery } = await discoverUsageSources(ctx, from, this.discovered, this.files)
    this.evict(to, from, new Set(wanted.map((entry) => entry.file.path)))
    const left = await this.load(ctx, wanted)
    for (const agent of left.failed) discovery.set(agent, "Usage history could not be read")
    if (this.wrote) {
      this.wrote = false
      await pruneStored(ctx, to - LONGEST_DAYS * DAY_MS, {
        files: this.options.stored?.files ?? USAGE_INDEX_FILES_KEPT,
        bytes: this.options.stored?.bytes ?? USAGE_INDEX_MAX_BYTES,
      })
    }
    const usage = usageOf(this.files, wanted, { period, now: to }, left)
    return finalizeUsage(ctx, usage, { discovery, wanted, files: this.files, hints })
  }
}
