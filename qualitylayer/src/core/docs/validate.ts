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
import { proseLines } from "./rules/types.ts"
import {
  type DocSchema,
  docTypeOf,
  GUIDANCE_PREFIX,
  type SectionSpec,
  schemaForDoc,
  sectionMatches,
} from "./schema.ts"
import { OPTIONAL_SLOT_LINE } from "./slots.ts"
import { extractFences, type Fence } from "./visuals.ts"

const error = (line: number, rule: string, message: string, fix_hint: string): ValidationError => ({
  line,
  rule,
  message,
  fix_hint,
  severity: "error",
})

type Heading = { text: string; line: number }

function collectHeadings(body: string, bodyStart: number): Heading[] {
  const headings: Heading[] = []
  proseLines(body).forEach(({ text: raw, line: number }) => {
    const line = raw.trimEnd()
    const match = line.match(/^## (.+)$/)
    if (match?.[1] !== undefined)
      headings.push({ text: match[1].trim(), line: bodyStart + number - 1 })
  })
  return headings
}

/** A section of the step's other file: its heading in this file is in the wrong place. */
export type OtherFile = { file: string; sections: SectionSpec[] }

/** Validate one file's text against the sections its schema names; `other` is the step's other file. */
export function validateContent(
  markdown: string,
  schema: DocSchema,
  other?: OtherFile,
): ValidationError[] {
  const errors: ValidationError[] = []
  const { frontmatter, body, bodyStart } = parseDoc(markdown)

  if (schema.frontmatter.none === true) {
    if (frontmatter !== null)
      errors.push(
        error(
          1,
          "frontmatter-none",
          "this document has no frontmatter, and starts with a --- block",
          "remove the --- block at the top: the file is read as it is",
        ),
      )
  } else if (frontmatter === null) {
    errors.push(
      error(
        1,
        "frontmatter-missing",
        "the document has no frontmatter block",
        `start the file with ---, the fields ${schema.frontmatter.required.join(", ")}, and ---`,
      ),
    )
  } else {
    const missing = schema.frontmatter.required.filter(
      (key) => frontmatter[key] === undefined || frontmatter[key] === null,
    )
    if (missing.length > 0) {
      errors.push(
        error(
          1,
          "frontmatter-complete",
          `frontmatter is missing ${missing.join(", ")}`,
          `add the missing field(s) to the frontmatter block: ${missing.join(", ")}`,
        ),
      )
    }
  }

  const bodyLines = body.split(/\r?\n/)

  const headings = collectHeadings(body, bodyStart)
  const specIndex = (text: string) => schema.sections.findIndex((s) => sectionMatches(s, text))
  const present = headings.filter((h) => specIndex(h.text) !== -1)
  const lastLine = bodyStart + bodyLines.length - 1

  for (const section of schema.sections) {
    if (!section.required) continue
    if (!present.some((h) => sectionMatches(section, h.text))) {
      errors.push(
        error(
          lastLine,
          "section-missing",
          `required section "## ${section.heading}" is missing`,
          `add "## ${section.heading}": ${section.hint ?? "see the template"}`,
        ),
      )
    }
  }

  // A heading that belongs to the step's other file is in the wrong place.
  if (other !== undefined) {
    for (const heading of headings) {
      if (specIndex(heading.text) !== -1) continue
      if (!other.sections.some((section) => sectionMatches(section, heading.text))) continue
      errors.push(
        error(
          heading.line,
          "section-wrong-file",
          `section "## ${heading.text}" belongs in ${other.file}`,
          `move "## ${heading.text}" to ${other.file}`,
        ),
      )
    }
  }

  // A required section that is present must have content before the next heading.
  for (const heading of present) {
    const section = schema.sections[specIndex(heading.text)]
    if (section === undefined || !section.required || section.allowEmpty === true) continue
    const startIndex = heading.line - bodyStart + 1
    let hasContent = false
    for (let i = startIndex; i < bodyLines.length; i++) {
      const line = (bodyLines[i] ?? "").trim()
      if (/^#{1,2} /.test(line)) break
      // The template's guidance and its slots for optional sections are not content.
      if (line !== "" && !line.startsWith(GUIDANCE_PREFIX) && !OPTIONAL_SLOT_LINE.test(line)) {
        hasContent = true
        break
      }
    }
    if (!hasContent) {
      errors.push(
        error(
          heading.line,
          "section-empty",
          `section "## ${section.heading}" has no content`,
          `write the section: ${section.hint ?? section.heading}`,
        ),
      )
    }
  }

  return errors
}

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

async function validateSnapshot(
  ctx: Ctx,
  taskDir: string,
  docName: string,
  options: { runtimeDir?: string },
): Promise<Result<ValidationReport>> {
  // The directory distinguishes the person's step from the agents' record with the same basename.
  const name =
    [taskDir, ctx.env.cwd(), repoRootOf(taskDir) ?? taskDir]
      .map((base) => relative(taskDir, resolve(base, docName)).split(sep).join("/"))
      .find((candidate) => roleOf(candidate) !== null || agentRoleOf(candidate) !== null) ?? docName
  const forAgents = agentRoleOf(name) !== null
  const task = await taskFacts(ctx, taskDir)
  if (task.type === "chat")
    return err({ code: "bad_args", message: "this is a Chat; Convert to task first" })
  const schema = schemaForDoc(name, task)
  if (schema === undefined) {
    return err({ code: "bad_args", message: `no schema for document "${name}"` })
  }
  const path = join(taskDir, name)
  if (!(await ctx.fs.exists(path))) {
    return ok({
      valid: false,
      doc: name,
      errors: [
        error(
          1,
          "document-missing",
          `${name} does not exist yet`,
          `write ${name} from the template first`,
        ),
      ],
    })
  }
  const markdown = await ctx.fs.readFile(path)
  const role = agentRoleOf(name) ?? roleOf(name)
  // The step's other file, for a heading that is in the wrong one.
  const otherName = role === null ? undefined : forAgents ? folderDoc(role) : agentFileOf(role)
  const otherSchema = otherName === undefined ? undefined : schemaForDoc(otherName, task)
  const errors = validateContent(
    markdown,
    schema,
    otherName === undefined || otherSchema === undefined
      ? undefined
      : { file: otherName, sections: otherSchema.sections },
  )
  // A step file is validated with its agents' file, each against its own sections.
  if (!forAgents && otherName !== undefined && otherSchema !== undefined)
    errors.push(...(await validateAgentsFile(ctx, taskDir, otherName, otherSchema, schema, name)))

  let outline: Outline | null = null
  let fences: Fence[] | null = null
  let listing: Promise<string[] | null> | null = null
  const cards = name === agentFileOf("implement")
  const released =
    cards && options.runtimeDir !== undefined && ["implement", "verify"].includes(task.stage ?? "")
      ? new Set(await committedSlices(ctx, { runtimeDir: options.runtimeDir }))
      : undefined
  const input: RuleInput = {
    ctx,
    taskDir,
    repoRoot: repoRootOf(taskDir),
    docName: name,
    markdown,
    schema,
    task,
    runtimeDir: options.runtimeDir ?? null,
    ...(released === undefined ? {} : { committedSlices: released }),
    outline: () => {
      outline ??= parseOutline(markdown)
      return outline
    },
    fences: () => {
      fences ??= extractFences(markdown)
      return fences
    },
    repoFiles: () => {
      const root = input.repoRoot
      listing ??= root === null ? Promise.resolve(null) : repoFiles(ctx, root)
      return listing
    },
  }
  for (const ruleName of schema.rules) {
    const rule = rules[ruleName]
    if (rule === undefined) continue
    errors.push(...(await rule(input)))
  }
  errors.sort((a, b) => a.line - b.line)
  return ok({ valid: errors.every((e) => e.severity !== "error"), doc: name, errors })
}

/** The agents' file of a step, against the sections that name it; its errors say which file they are in. */
async function validateAgentsFile(
  ctx: Ctx,
  taskDir: string,
  agentsName: string,
  agentsSchema: DocSchema,
  stepSchema: DocSchema,
  stepName: string,
): Promise<ValidationError[]> {
  if (agentsSchema.sections.length === 0) return []
  const path = join(taskDir, agentsName)
  if (!(await ctx.fs.exists(path))) {
    const required = agentsSchema.sections.filter((s) => s.required)
    if (required.length === 0) return []
    return [
      error(
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
