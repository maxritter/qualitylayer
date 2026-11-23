import { join } from "node:path"
import { agentFileOf, agentRoleOf, NAMES, roleOf, STEPS } from "../../core/docs/names.ts"
import { renderTerminal, textFence } from "../../core/terminal/render.ts"
import { sketch } from "../../core/terminal/sketch.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { readArtifactPage } from "./artifact.ts"
import { factsOf, readStructure } from "./read-structure.ts"
import { parseArgs, requireTask } from "./shared.ts"

const USAGE =
  "usage: qualitylayer read <document | step | artifact <name>> [--page <page>] [--width <columns, default 100>] [--lead | --structure]"
const badArgs = (message: string): Result<never> => err({ code: "bad_args", message })
const ALLOWED_FLAGS = new Set(["width", "page", "lead", "structure"])

type ParsedRead = {
  target: string
  name: string | undefined
  width: number
  flags: Record<string, string | true>
}

function parseReadArgs(args: string[]): Result<ParsedRead> {
  const { positional, flags } = parseArgs(args, ["width", "page"])
  const [target, name, ...extra] = positional
  if (Object.keys(flags).some((key) => !ALLOWED_FLAGS.has(key))) return badArgs(USAGE)
  const width = flags.width === undefined ? 100 : Number(flags.width)
  if (flags.width === true || !Number.isSafeInteger(width) || width < 1)
    return badArgs("--width needs a positive whole number of terminal columns")
  const badNonArtifact = target !== "artifact" && (name !== undefined || flags.page !== undefined)
  const badStructure =
    flags.structure !== undefined && (flags.lead !== undefined || target === "artifact")
  if (!target || extra.length || badNonArtifact || badStructure) return badArgs(USAGE)
  return ok({ target, name, width, flags })
}

async function readArtifactSketch(
  ctx: Ctx,
  name: string | undefined,
  page: string | true | undefined,
  width: number,
): Promise<Result<unknown>> {
  if (!name) return badArgs(USAGE)
  if (page === true) return badArgs("--page needs a page name")
  const inspected = await readArtifactPage(ctx, name, page)
  if (!inspected.ok) return inspected
  const source = inspected.data
  return ok({
    file: source.file,
    path: source.path,
    printed: textFence(sketch(source.html, width)),
  })
}

function resolveDocRole(
  target: string,
  hasStructure: boolean,
): Result<{
  step: (typeof STEPS)[number] | undefined
  role: (typeof STEPS)[number]
  forAgents: boolean
}> {
  const step = STEPS.find((role) => role === target)
  const forAgents = agentRoleOf(target) !== null
  const role = step ?? agentRoleOf(target) ?? roleOf(target)
  if (role === null)
    return badArgs(
      `${USAGE}; use a task document name such as ${NAMES.plan}, or its agents' file ${agentFileOf("plan")}`,
    )
  if (step !== undefined && !hasStructure) return badArgs(`${USAGE}; a step name needs --structure`)
  return ok({ step, role, forAgents })
}

async function readTaskDoc(
  ctx: Ctx,
  target: string,
  width: number,
  flags: Record<string, string | true>,
): Promise<Result<unknown>> {
  const resolved = resolveDocRole(target, flags.structure !== undefined)
  if (!resolved.ok) return resolved
  const task = await requireTask(ctx)
  if (!task.ok) return task
  const { step, role, forAgents } = resolved.data
  if (flags.structure !== undefined) return readStructure(ctx, task.data.dir, target, step, role)
  const path = join(task.data.dir, target)
  if (!(await ctx.fs.exists(path))) return badArgs(`The task has no ${target} yet`)
  const markdown = await ctx.fs.readFile(path)
  return ok({
    file: target,
    path,
    // The step page leads with the people's file; the agents' file is read whole.
    printed: await renderTerminal(markdown, {
      width,
      lead: flags.lead === true && !forAgents,
      file: target,
      facts: await factsOf(ctx, task.data.dir),
    }),
  })
}

export async function readCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const parsed = parseReadArgs(args)
  if (!parsed.ok) return parsed
  const { target, name, width, flags } = parsed.data
  if (target === "artifact") return readArtifactSketch(ctx, name, flags.page, width)
  return readTaskDoc(ctx, target, width, flags)
}
