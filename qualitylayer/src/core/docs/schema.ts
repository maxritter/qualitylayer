// One schema per document type feeds the validator and the template.
// The template is never authored twice: it is generated from the schema.

import { schemaText } from "#workflow"
import { agentFileOf, agentRoleOf, type DocRole, IDENTITY_FILE, NAMES, roleOf } from "./names.ts"
import type { ProofList } from "./proof-list.ts"
import { GUIDANCE_PREFIX, templateFrom } from "./schema-template.ts"

export type SectionSpec = {
  heading: string
  /** Regex source matched against the heading text; makes the section repeatable (slices). */
  pattern?: string
  required: boolean
  /** A required heading that may stay empty until a later phase fills it. */
  allowEmpty?: boolean
  /**
   * The file the section lives in: the step file for people (`NN-step.md`) or the agents' file
   * (`agents/NN-step.md`). Unset: people; every shipped schema names it on every section.
   */
  file?: SectionFile
  /** The section must carry at least one diagram, artifact or code-shape block. */
  visual?: boolean
  hint?: string
  /**
   * An optional section's one short phrase on when to write it. The template's slot then reads
   * `write it <when>` instead of `only when there is content`, which agents filling the skeleton
   * took as a reason to skip it.
   */
  when?: string
  /** Literal template lines emitted under the heading instead of the guidance comment. */
  skeleton?: string[]
  /**
   * Where the App shows the section: `lead` on the step page, `detail` in the Reader only (named in
   * the step page's strip), `lead-folded` on the step page as a fold of its headers. Unset: lead.
   */
  show?: SectionShow
  /**
   * `points`: the section answers the Plan's Done means step by step (Implement's Proof order). It
   * stays optional in the schema, since a rule carries the requirement; a template given the Plan's
   * list (`DocFacts.proof`) asks for it with one line per step.
   */
  plan?: "points"
  /**
   * `qualitylayer read <document> --lead` prints the section although the step page does not lead
   * with it: a terminal reading has no page, so what the App keeps in the Reader is read in the
   * document.
   */
  terminal_lead?: true
  /**
   * Who writes it: the planning or build session (`agent`), QualityLayer between `ql:` markers
   * (`ql`), or fresh helpers appending blocks under the heading (`helpers`). Unset: the agent.
   */
  writer?: SectionWriter
}

export type SectionShow = "lead" | "detail" | "lead-folded"
export type SectionFile = "people" | "agents"
export type SectionWriter = "agent" | "ql" | "helpers"

/** Where the App shows a section; a section that names none leads. */
export const sectionShow = (section: SectionSpec): SectionShow => section.show ?? "lead"
/** The file a section lives in; a section that names none is the people's. */
export const sectionFile = (section: Pick<SectionSpec, "file">): SectionFile =>
  section.file ?? "people"
/** Who writes a section; a section that names none is the agent's. */
export const sectionWriter = (section: SectionSpec): SectionWriter => section.writer ?? "agent"

export type DocSchema = {
  type: string
  frontmatter: {
    required: string[]
    /** Initial frontmatter for documents the agent creates; null when the CLI scaffolds it. */
    template: Record<string, string> | null
    /** The document has no frontmatter at all: a page QualityLayer writes, a pull request's text. */
    none?: boolean
  }
  title: "required" | "optional"
  /** Literal template lines between the title and the first section (a pull request's links line). */
  preamble?: string[]
  sections: SectionSpec[]
  /** The `ql:` markers the document must hold, by name; QualityLayer writes their text. */
  markers?: string[]
  rules: string[]
  /** The `ql:` markers the step's agents' file must hold; unset: none. */
  agentMarkers?: string[]
  /** The rules the step's agents' file is held to (a record's grammar); unset: none. */
  agentRules?: string[]
}

export type DocType = "feature" | "bugfix" | "chat"
/** What picks a document's schema: the task's kind and, for a task started from an existing plan, its origin. */
export type DocFacts = {
  type: DocType
  origin?: "existing-plan"
  /**
   * The Plan's proof list, for a template that answers it step by step (Implement's agents' file):
   * its Proof order is asked for, one line per step. Unset: the stored schema.
   */
  proof?: ProofList
}

/** Known task kinds remain distinct; unknown metadata keeps the Feature default. */
export const docTypeOf = (value: unknown): DocType =>
  value === "chat" ? "chat" : value === "bugfix" ? "bugfix" : "feature"

/** The research helpers' report (the base of their reply template), then the three steps' schemas. */
const SCHEMA_NAMES = ["research", "plan", "plan-bugfix", "plan-adopted", "implement", "verify"]

/** Each schema is read (and, in a release build, decrypted) the first time something asks for it. */
export const schemas: Record<string, DocSchema> = {}
for (const name of SCHEMA_NAMES) {
  let loaded: DocSchema | undefined
  Object.defineProperty(schemas, name, {
    enumerable: true,
    get: () => {
      loaded ??= JSON.parse(schemaText(name) ?? "null") as DocSchema
      return loaded
    },
  })
}

/** The documents the Plan gate validates and approves: the Plan, alone. */
export const PLAN_GATE_DOCS: readonly string[] = [IDENTITY_FILE]

/**
 * The schema a step is validated against: one per step. A bug's Plan holds its diagnosis; a task
 * started from an existing plan has its own Plan, the execution agreement that maps the person's
 * original (plan-adopted).
 */
function schemaName(role: DocRole, facts: DocFacts): string | undefined {
  if (facts.type === "chat") return undefined
  if (role !== "plan") return role
  if (facts.origin === "existing-plan") return "plan-adopted"
  return facts.type === "bugfix" ? "plan-bugfix" : "plan"
}

/**
 * A section that answers the Plan step by step, as a template asks for it: required, with one line
 * for each step of the Plan (`- A1 · after slice …`) in place of the generic example.
 */
function askedFor(section: SectionSpec, proof: ProofList): SectionSpec {
  const lines = proof.steps.map(
    (step) =>
      `- ${step.id} · after slice <!-- fill: N, the slice after which ${step.id} can first run -->`,
  )
  return { ...section, required: true, ...(lines.length > 0 ? { skeleton: lines } : {}) }
}

/**
 * Resolve the schema for a document file name, e.g. "01-plan.md" or "agents/02-implement.md",
 * through the step the file plays. A step has one schema; each file gets the sections that name it.
 */
export function schemaForDoc(name: string, facts: DocFacts): DocSchema | undefined {
  const forAgents = agentRoleOf(name)
  const role = forAgents ?? roleOf(name)
  const key = role === null ? undefined : schemaName(role, facts)
  const whole = key === undefined ? undefined : schemas[key]
  if (whole === undefined) return undefined
  const file: SectionFile = forAgents === null ? "people" : "agents"
  const sections = whole.sections
    .filter((s) => sectionFile(s) === file)
    .map((s) => (facts.proof !== undefined && s.plan === "points" ? askedFor(s, facts.proof) : s))
  if (file === "people") return { ...whole, sections }
  // An agents' file is plain Markdown under its own headings: no frontmatter. The step names the
  // markers QualityLayer writes there and the rules that read its records, if any.
  return {
    type: whole.type,
    frontmatter: { required: [], template: null, none: true },
    title: "required",
    sections,
    ...(whole.agentMarkers !== undefined ? { markers: whole.agentMarkers } : {}),
    rules: whole.agentRules ?? [],
  }
}

/**
 * The skeleton of a step's agents' file, from the sections that name it; undefined while the step
 * has none. `name` is the step file's name (`01-plan.md`).
 */
export function agentsTemplateFor(
  name: string,
  facts: DocFacts,
  title: string,
): string | undefined {
  const role = roleOf(name)
  if (role === null) return undefined
  const schema = schemaForDoc(agentFileOf(role), facts)
  return schema === undefined || schema.sections.length === 0
    ? undefined
    : templateFrom(schema, title)
}

export function sectionMatches(spec: SectionSpec, heading: string): boolean {
  if (spec.pattern !== undefined) return new RegExp(spec.pattern).test(heading)
  return spec.heading === heading
}

export { GUIDANCE_PREFIX, templateFrom }

/**
 * Verify's people's file as QualityLayer creates it: *Changed from the Plan* is in every new one
 * (QualityLayer fills its marker), and *Interface* in every one whose change shows a screen.
 */
export function verifyTemplate(task: DocFacts & { ui?: boolean }, title: string): string {
  const schema = schemaForDoc(NAMES.verify, task)
  if (schema === undefined) throw new Error("verify schema missing from the build")
  return templateFrom(
    {
      ...schema,
      sections: schema.sections.map((section) =>
        section.heading === "Changed from the Plan" ||
        (task.ui === true && section.heading === "Interface")
          ? { ...section, required: true }
          : section,
      ),
    },
    title,
  )
}
