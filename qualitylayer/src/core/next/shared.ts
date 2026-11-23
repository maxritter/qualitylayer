import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { artifactTools, detectAgent } from "../agents/detect.ts"
import { agentFileOf, type DocRole, folderDoc } from "../docs/names.ts"
import { agentsTemplateFor, type DocFacts } from "../docs/schema.ts"
import { type Task, taskDocPath } from "../task/store.ts"
import type { TaskFlow } from "../task-flow.ts"

export type NextPayload = Record<string, unknown>

/** The stages a build lives in: one checkout holds it. */
export const BUILD_STAGES = ["implement", "verify"]

export function base(task: Task, extra: Record<string, unknown>): NextPayload {
  return { task: task.slug, type: task.type, answers: task.answers, ...extra }
}

export const at = (task: Task, role: DocRole) => taskDocPath(task, role)

/**
 * A step's agents' file in the reply: its path, and its skeleton while it is not written. Nothing
 * for a step whose schema names no agents' sections. `facts` carries what else the skeleton depends
 * on: the Plan's proof list, for the cards' file.
 */
export async function agentsFields(
  ctx: Ctx,
  task: Task,
  role: DocRole,
  title: string,
  facts: Partial<DocFacts> = {},
): Promise<NextPayload> {
  const template = agentsTemplateFor(folderDoc(role), { ...task, ...facts }, title)
  if (template === undefined) return {}
  const document = join(task.dir, agentFileOf(role))
  return {
    agents_document: document,
    ...((await ctx.fs.exists(document)) ? {} : { agents_template: template }),
  }
}

/** The artifact tools this agent has installed, named when the Plan or a visible change can use them. */
export async function artifactToolsField(ctx: Ctx, task: Task): Promise<NextPayload> {
  const tools = await artifactTools(ctx, detectAgent(ctx.env), task.repoRoot)
  return tools.length > 0 ? { artifact_tools: tools } : {}
}

/** The scaling rules' result for a reply: what applies, in one line for the user. */
export const flowFields = (flow: TaskFlow): NextPayload => ({
  flow: flow.flow,
  flow_line: flow.line,
})

/** True the first time a helper is offered for this task; a marker in the runtime folder keeps it once. */
export async function firstOffer(ctx: Ctx, task: Task, marker: string): Promise<boolean> {
  const path = join(task.runtimeDir, marker)
  if (await ctx.fs.exists(path)) return false
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.writeFile(path, `${ctx.clock.now()}\n`)
  return true
}
