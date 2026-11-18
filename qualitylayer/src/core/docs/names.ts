// The task folder's document names. Free of runtime imports, so the App's
// browser bundle reads them as they are.

/** The three steps, and what each task document is for: one file for people, one for agents, per step. */
export type Step = "plan" | "implement" | "verify"
export type DocRole = Step

/**
 * The frontmatter value of `layout` in a task's Plan file (`01-plan.md`), its identity file. A folder
 * whose identity file is `01-discuss.md`, or whose layout is anything else, is an earlier task: listed,
 * opened as plain files, never continued.
 */
export const LAYOUT = "three"

/** Pictures and recordings. */
export const EVIDENCE_DIR = "evidence"
/** The artifacts an agent draws for a task. */
export const ARTIFACT_DIR = "artifacts"
/** Raw command output (a probe's output, the final checks note). */
export const RECORDS_DIR = "records"

/** The Markdown record of the commands and scans run by QualityLayer. */
export const CHECKS_RECORD = `${RECORDS_DIR}/checks.md`
/** The other agents' reviews, verbatim. */
export const REVIEWS_DIR = "reviews"
/** The research helpers' reports, as written (`research/r1.md`). */
export const RESEARCH_DIR = "research"

/** The file each step has. */
export const NAMES: Record<Step, string> = {
  plan: "01-plan.md",
  implement: "02-implement.md",
  verify: "03-verify.md",
}

/** The three steps in flow order. */
export const STEPS: readonly Step[] = ["plan", "implement", "verify"]

/** The identity file of a task: its frontmatter holds the layout, type, stage and the person's settings. */
export const IDENTITY_FILE = NAMES.plan
/** The identity file of a task made with seven or five steps. */
export const EARLIER_IDENTITY_FILE = "01-discuss.md"

/** The file a role's text is in. */
export const folderDoc = (role: DocRole): string => NAMES[role]

/** The second opinions, one file each: the Plan review and the second opinion on the change. */
export const REVIEW_FILES = {
  plan: `${REVIEWS_DIR}/plan.md`,
  verify: `${REVIEWS_DIR}/verify.md`,
}

/** Supporting files written for agents, never for the person's approval. */
export const AGENTS_DIR = "agents"
/** The agents' file of a step: `agents/NN-step.md`, beside the step file of the same number and name. */
export const agentFileOf = (role: DocRole): string => `${AGENTS_DIR}/${NAMES[role]}`

/**
 * The records the build and its checks write: the Implement people's file, and Verify's agents' file,
 * where the judges record their iterations and the security review its blocks.
 */
export const LOGS = { implement: NAMES.implement, verify: agentFileOf("verify") }

/** The note the App shows at the final approval, from the task folder. */
export const FINAL_CHECKS = `${RECORDS_DIR}/final-checks.md`

/**
 * Whether a path from the task folder names proof a check may cite: a picture or a recording under
 * `evidence/`, or raw output under `records/`.
 */
export function isProofPath(path: string): boolean {
  return (
    !path.includes("..") &&
    [EVIDENCE_DIR, RECORDS_DIR].some((root) =>
      new RegExp(`^${root}(?:/[A-Za-z0-9][A-Za-z0-9._-]*)+$`).test(path),
    )
  )
}

/** The heading the Plan's questions for research helpers are written under, in `agents/01-plan.md`. */
export const RESEARCH_QUESTIONS = "Questions for helpers"

/** Whether a Plan file's frontmatter marks its folder as a task of this workflow. */
export const isTaskFrontmatter = (frontmatter?: { layout?: unknown } | null): boolean =>
  frontmatter?.layout === LAYOUT

/** The step a file belongs to, or null. */
export function roleOf(file: string): DocRole | null {
  return STEPS.find((role) => NAMES[role] === file) ?? null
}

/** The files a comment can be on: every step file holds working sections, so each takes comments. */
export const COMMENTABLE_FILES: readonly string[] = STEPS.map((role) => NAMES[role])

/** A file that is not one of the person's documents: the other agents' reviews. */
export const isAgentFile = (file: string): boolean => file.startsWith(`${REVIEWS_DIR}/`)

/** The step whose agents' file this is (`agents/01-plan.md`), or null. */
export function agentRoleOf(file: string): DocRole | null {
  return STEPS.find((role) => agentFileOf(role) === file) ?? null
}

/** Fill the placeholders of a served text: each step's file for people, and the task's folders. */
export function fillNames(text: string): string {
  return text
    .replaceAll("{plan_doc}", NAMES.plan)
    .replaceAll("{implement_doc}", NAMES.implement)
    .replaceAll("{verify_doc}", NAMES.verify)
    .replaceAll("{research_dir}", RESEARCH_DIR)
    .replaceAll("{records_dir}", RECORDS_DIR)
    .replaceAll("{reviews_dir}", REVIEWS_DIR)
}

/** One task document as the App lists it. */
export type TaskFile = {
  role: DocRole
  name: string
  step: Step
  /** `<project>/docs/plans/<slug>/<name>`. */
  path: string
  exists: boolean
}

/** The steps a task of this type has: a feature and a bug have the same three; a Chat has none. */
export function taskRoles(type: "feature" | "bugfix" | "chat"): DocRole[] {
  return type === "chat" ? [] : [...STEPS]
}

/** The files the App shows for a task: every step with its name, display path and whether it exists. */
export function taskFiles(
  project: string,
  slug: string,
  type: "feature" | "bugfix" | "chat",
  exists: (role: DocRole) => boolean,
): TaskFile[] {
  return taskRoles(type).map((role) => {
    const name = folderDoc(role)
    return {
      role,
      name,
      step: role,
      path: `${project}/docs/plans/${slug}/${name}`,
      exists: exists(role),
    }
  })
}
