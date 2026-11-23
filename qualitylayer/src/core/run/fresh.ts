import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { Incoming } from "../interaction-docs/attachments.ts"
import { acceptedStopSequence } from "./bind.ts"
import type { RunRecord, StartRequest } from "./contracts.ts"
import {
  acceptedFreshPermission,
  assertValidPreparedRequest,
  freshPermission,
  isGuardedStopped,
  linked,
} from "./fresh-checks.ts"
import {
  type FreshJournal,
  freshDestination,
  freshKey,
  freshPath,
  readFreshJournal,
} from "./fresh-state.ts"
import { listRuns, readRun, runDir, updateRun } from "./registry.ts"

export { acceptedFreshPermission, freshPermission }

export type FreshPreparation = {
  request: StartRequest
  context: string
  artifactBinding?: RunRecord["artifactBinding"]
  files?: Incoming[]
}
export type FreshDependencies = {
  /** Rechecked after every await boundary; tied to this exact controlling WebSocket. */
  authorized(): boolean | Promise<boolean>
  childrenIdle(source: RunRecord): Promise<boolean>
  prepare(source: RunRecord, key: string): Promise<FreshPreparation>
  unchanged(prepared: FreshPreparation): Promise<boolean>
  /** Exact host-accepted Stop and proven complete cleanup, without relaunching. */
  stop(source: RunRecord): Promise<RunRecord>
  allocate(prepared: FreshPreparation, source: RunRecord): Promise<RunRecord>
  start(destination: RunRecord, prepared: FreshPreparation): Promise<RunRecord>
  ready(destination: RunRecord, source: RunRecord): Promise<boolean>
  failed?(destination: RunRecord): Promise<void>
}

type FreshContext = {
  ctx: Ctx
  id: string
  generation: number
  sequence: number
  deps: FreshDependencies
  authorize: () => Promise<void>
  persist: (value: FreshJournal) => Promise<void>
}

function assertSourceBoundary(
  source: RunRecord,
  journal: FreshJournal | null,
  sequence: number,
  stopped: boolean,
): void {
  if (stopped) {
    const validStopped =
      journal?.sequence === sequence &&
      source.guardedRestart?.sequence === sequence &&
      source.guardedRestart.valid === true &&
      source.cleanup?.complete === true
    if (!validStopped)
      throw new Error(
        "The previous session’s guarded cleanup is not verified. Resume it explicitly.",
      )
  } else if (acceptedStopSequence(source) !== sequence) {
    throw new Error("The agent is no longer at that idle boundary. Wait for its turn to finish.")
  }
}

async function reuseReadyDestination(
  fc: FreshContext,
  source: RunRecord,
  existing: RunRecord,
  journal: FreshJournal | null,
): Promise<RunRecord> {
  const stopped = source.status === "stopped" || source.status === "failed"
  if (!stopped || source.cleanup?.complete !== true || journal?.sequence !== fc.sequence)
    throw new Error("The previous conversation’s cleanup is not verified.")
  if (!journal) throw new Error("The newer conversation has no matching fresh request.")
  await fc.authorize()
  await fc.persist({ ...journal, state: "started", destination: existing.id })
  return existing
}

async function prepareFreshRequest(
  fc: FreshContext,
  source: RunRecord,
  key: string,
): Promise<FreshPreparation> {
  const prepared = await fc.deps.prepare(source, key)
  assertValidPreparedRequest(fc.ctx, source, readRun(fc.ctx.home, fc.id), prepared.request, key)
  const collision = listRuns(fc.ctx.home).find((candidate) => candidate.idempotencyKey === key)
  if (collision && !linked(source, collision, key))
    throw new Error(
      "The fresh conversation key belongs to an unverified destination. The previous session is kept.",
    )
  await fc.authorize()
  if (!(await fc.deps.unchanged(prepared)))
    throw new Error("The task changed during preparation. The previous conversation is kept.")
  return prepared
}

async function stopActiveSource(
  fc: FreshContext,
  source: RunRecord,
  prepared: FreshPreparation,
  key: string,
): Promise<RunRecord> {
  if (!(await fc.deps.childrenIdle(source)))
    throw new Error("Active or unknown subagents must finish before starting fresh.")
  await fc.authorize()
  await fc.persist({
    version: 1,
    generation: fc.generation,
    sequence: fc.sequence,
    key,
    state: "prepared",
    context: prepared.context,
    sourceSession: source.nativeSession as string,
  })
  const stopped = await fc.deps.stop(source)
  if (!isGuardedStopped(stopped, fc.generation, fc.sequence))
    throw new Error(
      "The old session has not finished guarded cleanup. No new conversation was started.",
    )
  return stopped
}

async function launchFreshDestination(
  fc: FreshContext,
  source: RunRecord,
  prepared: FreshPreparation,
  journal: FreshJournal,
  existing: RunRecord | undefined,
): Promise<RunRecord> {
  await fc.persist({ ...journal, state: "source-stopped" })
  let destination = existing
  try {
    await fc.authorize()
    if (!(await fc.deps.unchanged(prepared)))
      throw new Error(
        "The task changed. Resume the previous conversation or explicitly try fresh again.",
      )
    if (!destination) {
      destination = await fc.deps.allocate(prepared, source)
      if (!linked(source, destination, journal.key))
        throw new Error("The new conversation identity could not be verified.")
      await fc.persist({ ...journal, state: "source-stopped", destination: destination.id })
    }
    await fc.authorize()
    destination = await fc.deps.start(destination, prepared)
    if (!(await fc.deps.ready(destination, source)))
      throw new Error(
        "The new native conversation has not confirmed its binding. Its history is kept; retry explicitly.",
      )
    await fc.persist({ ...journal, state: "started", destination: destination.id })
    return destination
  } catch (cause) {
    if (destination) {
      try {
        await fc.deps.failed?.(destination)
      } catch {
        // The kept destination stays explicit; an uncertain process never grants Resume old.
      }
    }
    await fc.persist({
      ...journal,
      state: "failed",
      ...(destination ? { destination: destination.id } : {}),
    })
    throw cause
  }
}

async function loadFreshSourceAndJournal(
  ctx: Ctx,
  id: string,
  generation: number,
): Promise<{ source: RunRecord; journal: FreshJournal | null }> {
  const source = readRun(ctx.home, id)
  if (
    !source ||
    source.generation !== generation ||
    source.agent === "other" ||
    !source.nativeSession
  )
    throw new Error("This conversation changed. Open its current window again.")
  let journal = await readFreshJournal(ctx, source)
  if (journal && journal.generation !== generation) journal = null
  if (journal && journal.sourceSession !== source.nativeSession)
    throw new Error(
      "The fresh request belongs to another native session. The previous session is kept.",
    )
  return { source, journal }
}

function createFreshContext(input: {
  ctx: Ctx
  id: string
  generation: number
  sequence: number
  deps: FreshDependencies
  onJournal: (value: FreshJournal) => void
}): FreshContext {
  const { ctx, id, generation, sequence, deps, onJournal } = input
  return {
    ctx,
    id,
    generation,
    sequence,
    deps,
    authorize: async () => {
      if (!(await deps.authorized()))
        throw new Error(
          "This window no longer controls the conversation. The previous session is kept.",
        )
    },
    persist: async (value: FreshJournal) => {
      await ctx.fs.atomicWrite(freshPath(ctx, { id }), JSON.stringify(value))
      const {
        version: _version,
        context: _context,
        sourceSession: _sourceSession,
        ...state
      } = value
      updateRun(ctx.home, id, generation, { fresh: state })
      onJournal(value)
    },
  }
}

async function runFreshLocked(
  ctx: Ctx,
  id: string,
  generation: number,
  sequence: number,
  deps: FreshDependencies,
): Promise<RunRecord> {
  let journal: FreshJournal | null = null
  const fc = createFreshContext({
    ctx,
    id,
    generation,
    sequence,
    deps,
    onJournal: (value) => {
      journal = value
    },
  })
  await fc.authorize()
  const loaded = await loadFreshSourceAndJournal(ctx, id, generation)
  let source = loaded.source
  journal = loaded.journal
  const existing = freshDestination(ctx, source)
  if (existing && (await deps.ready(existing, source)))
    return reuseReadyDestination(fc, source, existing, journal)
  const stopped = source.status === "stopped" || source.status === "failed"
  assertSourceBoundary(source, journal, sequence, stopped)
  if (!stopped && !(await deps.childrenIdle(source)))
    throw new Error("Active or unknown subagents must finish before starting fresh.")
  const key = freshKey(id, generation)
  const prepared = await prepareFreshRequest(fc, source, key)
  if (!stopped) source = await stopActiveSource(fc, source, prepared, key)
  if (!journal)
    throw new Error("The fresh request could not be saved. The previous conversation is kept.")
  return launchFreshDestination(fc, source, prepared, journal, existing)
}

/** Only an explicit, currently controlling request invokes this transaction; startup never does. */
export async function freshConversation(
  ctx: Ctx,
  id: string,
  generation: number,
  sequence: number,
  deps: FreshDependencies,
): Promise<RunRecord> {
  return ctx.fs.withLock(join(runDir(ctx.home, id), ".bind.lock"), () =>
    ctx.fs.withLock(join(runDir(ctx.home, id), "control.lock"), () =>
      runFreshLocked(ctx, id, generation, sequence, deps),
    ),
  )
}
