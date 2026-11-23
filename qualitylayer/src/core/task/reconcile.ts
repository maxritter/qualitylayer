// The stored stage is checked against the documents on every `next`. On
// disagreement the CLI refuses with state_mismatch and points to `doctor`,
// which explains the difference and repairs it on confirmation.

import { dirname, join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { renderModFiles } from "../../workflow/mod-files.ts"
import { implementLogPath, lastIteration, readBuildRecord } from "../docs/build-log.ts"
import { agentFileOf, type DocRole, folderDoc } from "../docs/names.ts"
import { agentsTemplateFor, schemaForDoc, templateFrom, verifyTemplate } from "../docs/schema.ts"
import { movedSinceApproval } from "../gate/plan-moved.ts"
import { approvalCurrent, driftedDocuments } from "../gate/revision.ts"
import { modFolder } from "../install/agent-settings.ts"
import { realDir } from "../install/manifest.ts"
import { agentEntry } from "../install/where.ts"
import { environmentOnly } from "../judge-environment.ts"
import type { Stage } from "./machine.ts"
import { appendEvent, isCurrentLayout, patchReadme, readEvents, type Task } from "./store.ts"

export { doctor } from "./doctor.ts"

/** The stages that need the approved Plan: everything after its gate. */
const BUILD_STAGES: Stage[] = ["implement", "verify"]

/** Null when no mod is installed or its hook matches this binary's shipped version. */
export async function inspectInstalledMod(ctx: Ctx): Promise<string | null> {
  const folder = modFolder(ctx)
  if (!(await ctx.fs.exists(folder))) return null
  const hook = renderModFiles(agentEntry({ ...ctx, home: realDir(ctx.home) })).find(
    (file) => file.path === "hooks/register.tsx",
  )
  if (hook === undefined) throw new Error("shipped mod hook missing")
  const path = join(folder, hook.path)
  if ((await ctx.fs.exists(path)) && (await ctx.fs.readFile(path)) === hook.text) return null
  return `The installed QualityLayer mod's ${path} differs from the shipped hook. Run qualitylayer install --refresh to replace it.`
}

export type Finding = {
  stored: Stage
  found: string
  implied: Stage
  /** The approved plan changed during the build: amended in place, never sent back through planning. */
  amend?: true
  /** The approved documents whose approval stamp no longer matches them. */
  drifted?: string[]
  /** The Plan's approval is recorded in another QualityLayer home, not in this one. */
  elsewhere?: true
}

export const AMEND_HINT =
  "If the change is yours to make (no user decision changes), run " +
  '`qualitylayer plan amend --by agent --note "<what changed and why>"`; if it touches Done means, ' +
  "the scope or a decision the user made, ask the user, then run it with --by user and their words."

/** Null when the stored stage agrees with the documents. */
export async function inspect(ctx: Ctx, task: Task): Promise<Finding | null> {
  if (!BUILD_STAGES.includes(task.stage) || !isCurrentLayout(task)) return null
  const target = folderDoc("plan")
  if (!(await approvalCurrent(ctx, task, target))) {
    if (await ctx.fs.exists(join(task.dir, target))) {
      // Name what moved: the Plan, its agents' file, an artifact or a picture it shows.
      const drifted = await driftedDocuments(ctx, task, target)
      return {
        stored: task.stage,
        found: `${drifted.length > 0 ? drifted.join(", ") : target} changed since its approval`,
        drifted: drifted.length > 0 ? drifted : undefined,
        implied: task.stage,
        amend: true,
      }
    }
    return {
      stored: task.stage,
      found: `${target} is missing or has no versioned approval`,
      implied: "plan",
    }
  }
  // The build is admitted by the Plan's approval as this QualityLayer home recorded it: a home that
  // holds no such record (another HOME joining the same checkout) cannot borrow the other's.
  const events = await readEvents(ctx, task)
  if (!events.some((e) => e.event === "gate_approved" && e.from === "plan"))
    return {
      stored: task.stage,
      found: "this QualityLayer home holds no record of the Plan's approval",
      implied: task.stage,
      elsewhere: true,
    }
  // The approved Plan holds. The cards are the agents' own file: editing them is no amendment.
  return null
}

/** The refusal for a build this home never admitted, with the move that settles it. */
export const ELSEWHERE_HINT =
  "Run QualityLayer from the home that planned and approved this task (the same HOME and QUALITYLAYER_HOME), or start a new task here."

/**
 * A failed Verify round that was not counted when it ended (a plan amend, `doctor --repair` in
 * between) is counted here as the verbs count it: the iteration and its result in the events, which
 * the fix rounds and Verify's mode are read from. The task stays in Verify; without such a round it
 * comes back as it was.
 */
export async function countLeftRound(ctx: Ctx, task: Task): Promise<Task> {
  const iteration = lastIteration(await readBuildRecord(ctx, task))
  if (iteration === null || iteration.result !== "fail" || iteration.n <= task.iterations)
    return task
  await appendEvent(ctx, task, {
    event: "verify_result",
    passed: false,
    budgeted: !environmentOnly(iteration),
    iteration: iteration.n,
    judge: iteration.judge,
  })
  await patchReadme(ctx, task, { iterations: iteration.n })
  return { ...task, iterations: iteration.n }
}

/**
 * A step's agents' file, from the sections that name it, beside the step file. Written once, and
 * only for a step that has such sections.
 */
async function writeAgentsFile(ctx: Ctx, task: Task, role: DocRole, title: string): Promise<void> {
  const path = join(task.dir, agentFileOf(role))
  if (await ctx.fs.exists(path)) return
  const text = agentsTemplateFor(folderDoc(role), task, title)
  if (text === undefined) return
  await ctx.fs.mkdir(dirname(path))
  await ctx.fs.writeFile(path, text)
}

/** Write the build log the first time the build is started; true when it was written now. */
export async function ensureBuildLog(ctx: Ctx, task: Task): Promise<boolean> {
  const path = implementLogPath(task)
  if (await ctx.fs.exists(path)) return false
  // The build record is the Implement document, with the sections of that document.
  const schema = schemaForDoc(folderDoc("implement"), task)
  if (schema === undefined) throw new Error("build schema missing from the build")
  await ctx.fs.mkdir(dirname(path))
  await ctx.fs.writeFile(path, templateFrom(schema, `${task.title} · the build`))
  await writeAgentsFile(ctx, task, "implement", `${task.title} · the build`)
  await appendEvent(ctx, task, { event: "build_log_created" })
  return true
}

/** Write the Verify files the first time Verify starts: the people's file and the agents' file, each once. */
export async function ensureVerifyLog(ctx: Ctx, task: Task): Promise<void> {
  const path = join(task.dir, folderDoc("verify"))
  if (!(await ctx.fs.exists(path))) {
    await ctx.fs.mkdir(dirname(path))
    await ctx.fs.writeFile(path, verifyTemplate(task, `${task.title} · what was checked`))
  }
  await writeAgentsFile(ctx, task, "verify", `${task.title} · what was checked`)
}

export async function reconcile(ctx: Ctx, task: Task): Promise<Result<Task>> {
  const finding = await inspect(ctx, task)
  if (finding === null) return ok(task)
  if (finding.elsewhere === true)
    return err({
      code: "state_mismatch",
      message: `${task.slug}: ${finding.found}, so this session cannot take its build. ${ELSEWHERE_HINT}`,
      stored: finding.stored,
      found: finding.found,
      fix: "qualitylayer task start",
    })
  if (finding.amend === true) {
    const moved = await movedSinceApproval(ctx, task)
    // No changed text against the copy kept at approval: what moved is not in the words.
    const silent =
      moved === "" && finding.drifted !== undefined
        ? `\nThe text of ${finding.drifted.join(", ")} is as approved: a front matter field or an attached artifact differs, or an answer was recorded again since the approval.`
        : ""
    return err({
      code: "state_mismatch",
      message: `the admitted build changed: ${finding.found}. ${AMEND_HINT}${moved === "" ? silent : `\n${moved}`}`,
      stored: finding.stored,
      found: finding.found,
      fix: "qualitylayer plan amend",
    })
  }
  return err({
    code: "state_mismatch",
    message:
      `the task is stored at stage "${finding.stored}", but ${finding.found}. ` +
      `Run \`qualitylayer doctor\` to see the difference and repair it.`,
    stored: finding.stored,
    found: finding.found,
    fix: "qualitylayer doctor",
  })
}
