// What a task cost, read on this machine from the agents' own transcripts: per step of the flow,
// per helper, and in total. The agent's raw session ids are noted per
// task as its commands run (cost-sessions.json); the transcripts are found under the user's home.
// Nothing here goes over the network, and nothing of it is sent anywhere.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { FlowStepId } from "../flow.ts"
import type { Task } from "../task/store.ts"
import type { TaskCost } from "./labels.ts"
import { readTaskLedger, rememberTask, upsertLedger } from "./ledger.ts"
import { readsRecordCost } from "./session-calls.ts"
import { assembleTaskCost } from "./task-cost-assemble.ts"
import { bucket, type StepBucket, stepClock } from "./task-cost-buckets.ts"
import {
  type CostCollector,
  collectClaudeNote,
  collectNativeNote,
  collectRecordNote,
  createCollector,
} from "./task-cost-collect.ts"
import { collectCodexNote } from "./task-cost-collect-codex.ts"
import { sameRepository } from "./task-cost-discovery.ts"
import { foldLedgerRows } from "./task-cost-fold.ts"
import { claimedSession, noteCostSession, readNotes, type SessionNote } from "./task-cost-notes.ts"
import { collectReviewCosts } from "./task-cost-reviews.ts"

export type { TaskCost } from "./labels.ts"
export { noteCostSession }

async function collectSessionNote(
  collector: CostCollector,
  note: SessionNote,
  claimed: boolean,
): Promise<void> {
  if (note.agent === "claude-code") return collectClaudeNote(collector, note, claimed)
  if (note.agent === "pi" || note.agent === "opencode")
    return collectNativeNote(collector, note, claimed)
  if (readsRecordCost(note.agent)) return collectRecordNote(collector, note, claimed)
  if (note.agent === "codex") return collectCodexNote(collector, note, claimed)
}

export async function taskCost(ctx: Ctx, task: Task): Promise<TaskCost> {
  await rememberTask(ctx, task)
  const home = ctx.env.get("HOME") ?? ""
  const codexHome = ctx.env.get("CODEX_HOME") ?? join(home, ".codex")
  const stepAt = await stepClock(ctx, task)
  const kept = await readTaskLedger(ctx, task.runtimeDir)
  const knownSessions = new Set([
    ...kept.rows.map((row) => `${row.agent}:${row.session}`),
    ...(kept.archived?.sessions ?? []),
  ])
  const notes = await readNotes(ctx, task)
  const claims = new Set<SessionNote>()
  for (const note of notes) if (await claimedSession(ctx, note, task)) claims.add(note)
  const collector = createCollector({
    ctx,
    task,
    home,
    codexHome,
    notes,
    claims,
    knownSessions,
    ours: sameRepository(ctx, task),
    stepAt,
  })
  for (const note of notes) await collectSessionNote(collector, note, claims.has(note))
  await collectReviewCosts(collector)

  const missingRows = [...collector.helpers.entries()].filter(([, row]) => row.missing)
  await upsertLedger(ctx, collector.pending)
  // Fold durable call revisions, retaining reviewers that recorded no usage.
  collector.helpers.clear()
  for (const [id, row] of missingRows) collector.helpers.set(id, row)
  const total = bucket()
  const steps = new Map<FlowStepId, StepBucket>()
  const ledger = await readTaskLedger(ctx, task.runtimeDir)
  foldLedgerRows({ ledger, total, steps, helpers: collector.helpers, stepAt })
  return assembleTaskCost(ctx, task, {
    steps,
    helpers: collector.helpers,
    total,
    missing: collector.missing,
    incompleteSteps: collector.incompleteSteps,
    stepAt,
  })
}
