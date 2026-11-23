import type { Ctx } from "../../ctx.ts"
import { sessionVariables } from "../agents/detect.ts"
import { readArtifactAgentContext } from "../artifact/agent-context.ts"
import { canonicalPath } from "../platform.ts"
import type { Task } from "../task/store.ts"
import {
  AttentionSignals,
  acceptedStopEvent,
  acceptedStopSequence,
  acceptedTurnBoundary,
  inputBoundaryEvent,
  invalidateRunBoundary,
  permissionChangeBoundary,
  reserveGuardedStop,
  reserveRunRestart,
  retainEvents,
  runAttention,
  untouchedRun,
} from "./bind-boundary.ts"
import {
  checkGeneratedBrief,
  runBriefsDirectory,
  taskBriefsDirectory,
  writeGeneratedBrief,
} from "./bind-briefs.ts"
import { continueRunIntent, recordRunHook, settleRunStop } from "./bind-hook.ts"
import { managedPlanningContext, withManagedRunNext } from "./bind-next.ts"
import type { RunEvent, RunRecord } from "./contracts.ts"
import { leadCaller } from "./lead-process.ts"
import { readRun } from "./registry.ts"

export {
  AttentionSignals,
  acceptedStopEvent,
  acceptedStopSequence,
  acceptedTurnBoundary,
  checkGeneratedBrief,
  continueRunIntent,
  inputBoundaryEvent,
  invalidateRunBoundary,
  managedPlanningContext,
  permissionChangeBoundary,
  recordRunHook,
  reserveGuardedStop,
  reserveRunRestart,
  retainEvents,
  runAttention,
  runBriefsDirectory,
  settleRunStop,
  taskBriefsDirectory,
  untouchedRun,
  withManagedRunNext,
  writeGeneratedBrief,
}

export function managed(ctx: Ctx): RunRecord | null {
  const id = ctx.env.get("QUALITYLAYER_RUN")
  return id ? readRun(ctx.home, id) : null
}

/** A native start witness is checked at both ends of the bounded parent walk. */
export function fromLead(ctx: Ctx, run: RunRecord, pid: number): boolean {
  return leadCaller(ctx.home, run, pid) !== null
}

/** The session this command runs in, as the run's own agent names it to the commands it runs. */
export function ownSession(ctx: Ctx, run: RunRecord): string {
  if (run.agent === "other") return ""
  for (const name of sessionVariables(run.agent)) {
    const value = ctx.env.get(name)?.trim()
    if (value) return value
  }
  return ""
}

/** Presentation only: a copied run marker does not identify the terminal of this task. */
export function inManagedTaskTerminal(
  ctx: Ctx,
  task: Pick<Task, "repoId" | "slug" | "repoRoot">,
): boolean {
  const run = managed(ctx)
  if (!run) return false
  const expected = run.task ?? (run.purpose.kind === "task" ? run.purpose.task : undefined)
  const sameTask =
    expected === `${task.repoId}~${task.slug}` ||
    (expected === task.slug && canonicalPath(run.cwd) === canonicalPath(task.repoRoot))
  return Boolean(
    sameTask &&
      run.nativeSession &&
      ownSession(ctx, run) === run.nativeSession &&
      fromLead(ctx, run, process.pid),
  )
}

function isAcceptedArtifactPromptEvent(
  ctx: Ctx,
  run: RunRecord | null,
  event: RunEvent | null,
): run is RunRecord & {
  purpose: Extract<RunRecord["purpose"], { kind: "artifact" }>
  artifactBinding: NonNullable<RunRecord["artifactBinding"]>
} {
  if (!event?.lead || !run || run.purpose.kind !== "artifact" || !run.artifactBinding) return false
  const validEvent = event.event === "UserPromptSubmit" && event.accepted !== false
  const matchesRun =
    run.generation === event.generation &&
    run.nativeSession === event.nativeSession &&
    run.eventSequence === event.sequence
  return validEvent && matchesRun && fromLead(ctx, run, process.pid)
}

/** Deliver fresh feedback only at an accepted prompt from this run's native lead. */
export async function managedArtifactPrompt(
  ctx: Ctx,
  event: RunEvent | null,
): Promise<string | null> {
  const run = managed(ctx)
  if (!isAcceptedArtifactPromptEvent(ctx, run, event)) return null
  const context = await readArtifactAgentContext(ctx, run.artifactBinding, run.purpose.request)
  return context.ok
    ? context.data.prompt
    : `Artifact context unavailable: ${context.error.message}. Refresh this artifact in the App before editing.`
}
