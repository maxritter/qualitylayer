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
import { opencodeDatabase } from "../agents/storage.ts"
import { USAGE_INDEX_FILES_KEPT, USAGE_INDEX_MAX_BYTES } from "../home-caps.ts"
import { roots } from "../install/agent-settings.ts"
import type { Call } from "./transcripts.ts"
import { type BillingHints, billingOf } from "./usage-billing.ts"
import {
  type Indexed,
  pack,
  STRIDE,
  tokensOf,
  type Usage,
  usageOf,
  type Wanted,
} from "./usage-count.ts"
import { cursorCoverage } from "./usage-cursor.ts"
import { type UsagePeriod, usageWindows } from "./usage-days.ts"
import { type Candidate, chunksOf, DAY_MS } from "./usage-files.ts"
import { SOURCES, type Source } from "./usage-sources.ts"
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

/** What each agent's transcripts have shown; one per server, so the next request reads only what changed. */
export class UsageIndex {
  private files = new Map<string, Indexed>()
  private calls = 0
  private wrote = true
  private discovered = new Map<Source["agent"], { base: string; wanted: Wanted[] }>()
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

  /** Read what is unread, within the budget; how many files were left for the next request, how many were too large, and how many were read but could not be held. */
  private async load(
    ctx: Ctx,
    wanted: readonly Wanted[],
  ): Promise<{ pending: number; skipped: number; capped: number; failed: Set<string> }> {
    const clock = this.options.clock ?? (() => performance.now())
    const started = clock()
    const budget = this.options.budgetMs ?? USAGE_BUDGET_MS
    let pending = 0
    let skipped = 0
    let capped = 0
    let read = 0
    const failed = new Set<string>()
    const retryOrder = new Map([...this.failedFiles].map((path, order) => [path, order + 1]))
    const ordered = [...wanted].sort(
      (a, b) => (retryOrder.get(a.file.path) ?? 0) - (retryOrder.get(b.file.path) ?? 0),
    )
    for (const { source, file } of ordered) {
      if (failed.has(source.agent) && file.size > 0) {
        const held = this.files.get(file.path)
        if (
          !this.failedFiles.has(file.path) &&
          (held?.mtimeMs !== file.mtimeMs || held?.size !== file.size)
        )
          pending++
        continue
      }
      // Every request attempts at least one file, so a long list is always worked through.
      const outOfTime = file.size > 0 && read > 0 && clock() - started >= budget
      if (outOfTime && this.failedFiles.has(file.path)) {
        failed.add(source.agent)
        continue
      }
      let outcome: Awaited<ReturnType<UsageIndex["take"]>>
      try {
        outcome = await this.take(ctx, source, file, outOfTime)
      } catch {
        read++
        this.failedFiles.delete(file.path)
        this.failedFiles.add(file.path)
        failed.add(source.agent)
        continue
      }
      if (outcome === "read" || outcome === "full") {
        read++
        this.failedFiles.delete(file.path)
      }
      if (outcome === "skipped") skipped++
      if (outcome === "full" || outcome === "capped") capped++
      if (outcome === "pending") pending++
    }
    return { pending, skipped, capped, failed }
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
    if (outOfTime) {
      return "pending"
    }
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
    const wanted: Wanted[] = []
    const discovery = new Map<string, string>()
    const dirs = roots(ctx)
    if (dirs !== null)
      for (const source of SOURCES) {
        const folder = source.folder(dirs)
        const base = source.agent === "opencode" ? (opencodeDatabase(ctx) ?? "") : folder
        if (this.discovered.get(source.agent)?.base !== base) this.discovered.delete(source.agent)
        try {
          const files = await source.files(ctx, folder, from)
          if (files.partial) discovery.set(source.agent, files.partial)
          const entries = files.map((file) => ({ source, file }))
          this.discovered.set(source.agent, { base, wanted: entries })
          wanted.push(...entries)
        } catch {
          discovery.set(source.agent, "Usage history could not be read")
          const old = this.discovered.get(source.agent)
          if (old?.base === base)
            for (const { file } of old.wanted) {
              const held = this.files.get(file.path)
              if (held)
                wanted.push({
                  source,
                  file: { path: file.path, mtimeMs: held.mtimeMs, size: held.size },
                })
            }
        }
      }
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
    for (const row of usage.agents)
      if (discovery.has(row.agent)) {
        row.partial = discovery.get(row.agent)
        if (
          !wanted.some(
            ({ source, file }) => source.agent === row.agent && this.files.has(file.path),
          )
        ) {
          row.state = "unavailable"
          row.reason = row.partial ?? null
        }
      }
    for (const row of usage.agents)
      if (row.state === "counted") {
        const used = row.models.map((m) => ({ model: m.model, tokens: tokensOf(m.tokens) }))
        row.billing = await billingOf(ctx, row.agent, used, hints)
        if (
          row.accounting &&
          row.accounting.spendCalls === row.calls &&
          row.calls > 0 &&
          row.accounting.unknownCalls === 0
        )
          row.billing = "key"
        if (
          row.accounting &&
          row.accounting.planCalls === row.calls &&
          row.calls > 0 &&
          row.accounting.unknownCalls === 0
        )
          row.billing = "plan"
      }
    const cursor = usage.agents.find((agent) => agent.agent === "cursor")
    if (cursor && !discovery.has("cursor"))
      try {
        const coverage = await cursorCoverage(ctx)
        if (coverage === "Provider usage export required") {
          cursor.state = "unavailable"
          cursor.reason = coverage
        } else if (coverage) cursor.partial = coverage
      } catch {
        cursor.partial = "Usage history could not be read"
      }
    return usage
  }
}
