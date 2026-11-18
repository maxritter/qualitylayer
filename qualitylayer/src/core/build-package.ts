// What each reader of a task gets: one table names, for every agent that works from the task
// folder, the step files and agents' files its job needs, in reading order, and the rest as
// readable on demand. Every way an agent is started prints its list from here, so no agent works
// from memory or from the conversation (agent-files.html, *Who reads what*).

import { join } from "node:path"
import type { Ctx } from "../ctx.ts"
import { materializeChecksRecord } from "./check-receipts.ts"
import { agentFileOf, CHECKS_RECORD, type DocRole } from "./docs/names.ts"
import { artifactPath, extractFences } from "./docs/visuals.ts"
import { type Task, taskDocPath } from "./task/store.ts"

export type ReaderRole =
  /** The session that writes the Plan, and its helpers. */
  | "plan"
  /** The Implement session: it cuts the Plan into task cards and coordinates the build. */
  | "coordinator"
  | "fix"
  | "security"
  | "judge"
  /** Another agent's second opinion on the Plan. */
  | "secondPlan"
  /** Another agent's second opinion on the change while it is built. */
  | "secondBuild"
  /** Another agent's second opinion on the change once Verify has recorded its checks. */
  | "secondVerify"
  /** The final approval's context: the person's review in Verify. */
  | "review"

export type ReaderPackage = {
  /** Read these in full before working. */
  read: string[]
  /** Open these only when the job needs them. */
  onDemand: string[]
}

/** A step's file, or the agents' file of the same step. */
type Doc = DocRole | `agents:${DocRole}`
const pair = (role: DocRole): Doc[] => [role, `agents:${role}`]

/**
 * The table. The Plan is the one file the jobs after it read; the task cards are in Implement's
 * agents' file, beside the build's notes. Nobody reads Verify's people's file, which QualityLayer
 * writes for people. An agents' file stands right after its step file; where the two differ the
 * step file wins.
 */
const READING: Record<ReaderRole, { read: Doc[]; onDemand: Doc[] }> = {
  plan: { read: pair("plan"), onDemand: [] },
  coordinator: { read: [...pair("plan"), ...pair("implement")], onDemand: [] },
  fix: {
    read: ["agents:implement"],
    onDemand: [...pair("plan"), "implement", "agents:verify"],
  },
  security: { read: [], onDemand: [...pair("plan"), "agents:implement"] },
  // The reviewer's brief pastes the build's *For Verify* and *Environment*, and on a later round
  // the lines that failed, so the rest of the Implement and Verify files stay on demand.
  judge: {
    read: ["plan", "agents:implement"],
    onDemand: ["agents:plan", "implement", "agents:verify"],
  },
  secondPlan: { read: pair("plan"), onDemand: [] },
  secondBuild: { read: [...pair("plan"), ...pair("implement")], onDemand: [] },
  secondVerify: {
    read: [...pair("plan"), "agents:implement"],
    onDemand: ["implement", "agents:verify"],
  },
  review: {
    read: ["plan", "agents:implement"],
    onDemand: ["implement", "agents:verify"],
  },
}

/** The mockups go to whoever compares the screens: the judge of a UI task. */
const SEES_MOCKUPS: ReadonlySet<ReaderRole> = new Set(["judge"])

/** The artifacts (mockups, diagrams) the given documents embed, as paths in the task folder. */
async function artifactsOf(ctx: Ctx, task: Task, documents: string[]): Promise<string[]> {
  const found: string[] = []
  for (const document of documents) {
    if (!(await ctx.fs.exists(document))) continue
    for (const fence of extractFences(await ctx.fs.readFile(document))) {
      if (fence.kind !== "artifact") continue
      const artifact = artifactPath(fence)
      if (!("path" in artifact)) continue
      const path = join(task.dir, artifact.path)
      if (!found.includes(path)) found.push(path)
    }
  }
  return found
}

const pathOf = (task: Task, doc: Doc): string =>
  doc.startsWith("agents:")
    ? join(task.dir, agentFileOf(doc.slice("agents:".length) as DocRole))
    : taskDocPath(task, doc as DocRole)

/**
 * The documents one reader gets, those not written yet left out. `first` names files read before
 * the table's own (the original of an adopted plan). The build session reads every artifact the
 * Plan embeds; the judge of a UI task gets them too.
 */
export async function readerPackage(
  ctx: Ctx,
  role: ReaderRole,
  task: Task,
  first: string[] = [],
): Promise<ReaderPackage> {
  if (task.type === "chat") return { read: [taskDocPath(task, "plan")], onDemand: [] }
  const existing = async (paths: string[]) => {
    const out: string[] = []
    for (const path of new Set(paths)) if (await ctx.fs.exists(path)) out.push(path)
    return out
  }
  const table = READING[role]
  const read = [...first, ...table.read.map((doc) => pathOf(task, doc))]
  const mockups =
    role === "coordinator" || (SEES_MOCKUPS.has(role) && task.ui)
      ? await artifactsOf(ctx, task, [pathOf(task, "plan")])
      : []
  const chosen = [...read, ...mockups]
  const optional = table.onDemand.map((doc) => pathOf(task, doc))
  const readsBuild = table.read.includes("agents:implement")
  if (readsBuild || table.onDemand.includes("agents:implement")) {
    const checks = await materializeChecksRecord(ctx, task).catch(() => null)
    if (checks !== null) (readsBuild ? chosen : optional).push(join(task.dir, CHECKS_RECORD))
  }
  return {
    read: await existing(chosen),
    onDemand: await existing(optional.filter((path) => !chosen.includes(path))),
  }
}

/** The documents in reading order, for a reply's `context`: what the reader takes in first. */
export async function contextOf(
  ctx: Ctx,
  role: ReaderRole,
  task: Task,
  first: string[] = [],
): Promise<string[]> {
  return (await readerPackage(ctx, role, task, first)).read
}
