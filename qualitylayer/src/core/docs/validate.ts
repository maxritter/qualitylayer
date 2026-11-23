// Schema walk: frontmatter -> required sections (present, not empty) -> remaining guidance
// comments. Named engine rules (schema.rules) guard the records and limits of each document.

import { join, relative, resolve, sep } from "node:path"
import { type Ctx, err, ok, type Result, type ValidationError } from "../../ctx.ts"
import { committedSlices } from "../git/build-start.ts"
import { withPagesLock } from "../pages/record.ts"
import { parseDoc } from "./frontmatter.ts"
import { agentFileOf, agentRoleOf, folderDoc, IDENTITY_FILE, roleOf } from "./names.ts"
import { type Outline, parseOutline } from "./outline.ts"
import { repoFiles } from "./repo-files.ts"
import { type RuleInput, rules } from "./rules/index.ts"
import { type DocSchema, docTypeOf, schemaForDoc } from "./schema.ts"
import { validateContent, validationError } from "./validate-content.ts"
import { extractFences, type Fence } from "./visuals.ts"

export { validateContent }

export type ValidationReport = { valid: boolean; doc: string; errors: ValidationError[] }

/**
 * Validate a document on disk, resolving its schema from the file name. `runtimeDir` is the task's
 * runtime folder: with it, a marker's text an agent changed since QualityLayer wrote it is refused.
 */
export async function validateDoc(
  ctx: Ctx,
  taskDir: string,
  docName: string,
  options: { runtimeDir?: string } = {},
): Promise<Result<ValidationReport>> {
  const validate = () => validateSnapshot(ctx, taskDir, docName, options)
  // Imported tasks can have documents without a local runtime/ownership record yet.
  if (options.runtimeDir === undefined || !(await ctx.fs.exists(options.runtimeDir)))
    return validate()
  return withPagesLock(ctx, options.runtimeDir, validate)
}

function resolveDocName(ctx: Ctx, taskDir: string, docName: string): string {
  // The directory distinguishes the person's step from the agents' record with the same basename.
  return (
    [taskDir, ctx.env.cwd(), repoRootOf(taskDir) ?? taskDir]
      .map((base) => relative(taskDir, resolve(base, docName)).split(sep).join("/"))
      .find((candidate) => roleOf(candidate) !== null || agentRoleOf(candidate) !== null) ?? docName
  )
}

function buildRuleInput(params: {
  ctx: Ctx
  taskDir: string
  name: string
  markdown: string
  schema: DocSchema
  task: RuleInput["task"]
  runtimeDir: string | null
  released: Set<number> | undefined
}): RuleInput {
  let outline: Outline | null = null
  let fences: Fence[] | null = null
  let listing: Promise<string[] | null> | null = null
  const root = repoRootOf(params.taskDir)
  return {
    ctx: params.ctx,
    taskDir: params.taskDir,
    repoRoot: root,
    docName: params.name,
    markdown: params.markdown,
    schema: params.schema,
    task: params.task,
    runtimeDir: params.runtimeDir,
    ...(params.released === undefined ? {} : { committedSlices: params.released }),
    outline: () => {
      outline ??= parseOutline(params.markdown)
      return outline
    },
    fences: () => {
      fences ??= extractFences(params.markdown)
      return fences
    },
    repoFiles: () => {
      listing ??= root === null ? Promise.resolve(null) : repoFiles(params.ctx, root)
      return listing
    },
  }
}

async function releasedSlicesFor(
  ctx: Ctx,
  name: string,
  task: RuleInput["task"],
  runtimeDir: string | undefined,
): Promise<Set<number> | undefined> {
  const cards = name === agentFileOf("implement")
  if (!cards || runtimeDir === undefined || !["implement", "verify"].includes(task.stage ?? ""))
    return undefined
  return new Set(await committedSlices(ctx, { runtimeDir }))
}

async function runValidationRules(
  schema: DocSchema,
  input: RuleInput,
  errors: ValidationError[],
): Promise<void> {
  for (const ruleName of schema.rules) {
    const rule = rules[ruleName]
    if (rule !== undefined) errors.push(...(await rule(input)))
  }
}

async function validateExistingDoc(params: {
  ctx: Ctx
  taskDir: string
  name: string
  schema: DocSchema
  task: RuleInput["task"]
  runtimeDir: string | undefined
}): Promise<Result<ValidationReport>> {
  const { ctx, taskDir, name, schema, task, runtimeDir } = params
  const forAgents = agentRoleOf(name) !== null
  const markdown = await ctx.fs.readFile(join(taskDir, name))
  const role = agentRoleOf(name) ?? roleOf(name)
  // The step's other file, for a heading that is in the wrong one.
  const otherName = role === null ? undefined : forAgents ? folderDoc(role) : agentFileOf(role)
  const otherSchema = otherName === undefined ? undefined : schemaForDoc(otherName, task)
  const other =
    otherName === undefined || otherSchema === undefined
      ? undefined
      : { file: otherName, sections: otherSchema.sections }
  const errors = validateContent(markdown, schema, other)
  // A step file is validated with its agents' file, each against its own sections.
  if (!forAgents && otherName !== undefined && otherSchema !== undefined) {
    errors.push(
      ...(await validateAgentsFile({
        ctx,
        taskDir,
        agentsName: otherName,
        agentsSchema: otherSchema,
        stepSchema: schema,
        stepName: name,
      })),
    )
  }
  const released = await releasedSlicesFor(ctx, name, task, runtimeDir)
  const input = buildRuleInput({
    ctx,
    taskDir,
    name,
    markdown,
    schema,
    task,
    runtimeDir: runtimeDir ?? null,
    released,
  })
  await runValidationRules(schema, input, errors)
  errors.sort((a, b) => a.line - b.line)
  return ok({ valid: errors.every((e) => e.severity !== "error"), doc: name, errors })
}

async function validateSnapshot(
  ctx: Ctx,
  taskDir: string,
  docName: string,
  options: { runtimeDir?: string },
): Promise<Result<ValidationReport>> {
  const name = resolveDocName(ctx, taskDir, docName)
  const task = await taskFacts(ctx, taskDir)
  if (task.type === "chat")
    return err({ code: "bad_args", message: "this is a Chat; Convert to task first" })
  const schema = schemaForDoc(name, task)
  if (schema === undefined)
    return err({ code: "bad_args", message: `no schema for document "${name}"` })
  if (!(await ctx.fs.exists(join(taskDir, name)))) {
    return ok({
      valid: false,
      doc: name,
      errors: [
        validationError(
          1,
          "document-missing",
          `${name} does not exist yet`,
          `write ${name} from the template first`,
        ),
      ],
    })
  }
  return validateExistingDoc({
    ctx,
    taskDir,
    name,
    schema,
    task,
    runtimeDir: options.runtimeDir,
  })
}

type AgentsFileCheck = {
  ctx: Ctx
  taskDir: string
  agentsName: string
  agentsSchema: DocSchema
  stepSchema: DocSchema
  stepName: string
}

/** The agents' file of a step, against the sections that name it; its errors say which file they are in. */
async function validateAgentsFile(check: AgentsFileCheck): Promise<ValidationError[]> {
  const { ctx, taskDir, agentsName, agentsSchema, stepSchema, stepName } = check
  if (agentsSchema.sections.length === 0) return []
  const path = join(taskDir, agentsName)
  if (!(await ctx.fs.exists(path))) {
    const required = agentsSchema.sections.filter((s) => s.required)
    if (required.length === 0) return []
    return [
      validationError(
        1,
        "agents-file-missing",
        `${agentsName} does not exist yet`,
        `write ${agentsName} beside ${stepName}: ${required.map((s) => `"## ${s.heading}"`).join(", ")}`,
      ),
    ]
  }
  return validateContent(await ctx.fs.readFile(path), agentsSchema, {
    file: stepName,
    sections: stepSchema.sections,
  }).map((e) => ({ ...e, message: `${agentsName}: ${e.message}` }))
}

/** docs/plans/<task> sits three levels below the working tree root. */
function repoRootOf(taskDir: string): string | null {
  const parts = taskDir.split(sep)
  const n = parts.length
  if (n >= 3 && parts[n - 2] === "plans" && parts[n - 3] === "docs") {
    return resolve(taskDir, "..", "..", "..")
  }
  return null
}

async function taskFacts(ctx: Ctx, taskDir: string): Promise<RuleInput["task"]> {
  const path = join(taskDir, IDENTITY_FILE)
  if (!(await ctx.fs.exists(path))) return { type: "feature", ui: false }
  const { frontmatter } = parseDoc(await ctx.fs.readFile(path))
  return {
    type: docTypeOf(frontmatter?.type),
    ui: frontmatter?.ui === true,
    ...(frontmatter?.profile === "small" ? { profile: "small" as const } : {}),
    ...(typeof frontmatter?.stage === "string" ? { stage: frontmatter.stage } : {}),
    ...(frontmatter?.origin === "existing-plan" ? { origin: "existing-plan" as const } : {}),
  }
}
