// Briefs for fresh-context helpers. The workflow gets its quality from helpers
// that have not seen the conversation: research, fixes, security and the judge. The CLI composes
// each brief from the task's own files, and each reader gets what its job needs:
// the judge Done means, the Plan, the cards and the recorded checks. Everything else is named as
// readable on demand, never "read in full". The skill stays one generic rule:
// hand the helper its brief file; without helpers, follow `fallback`.

import { randomUUID } from "node:crypto"
import { realpath } from "node:fs/promises"
import { join } from "node:path"
import { phaseText } from "#workflow"
import type { Ctx } from "../ctx.ts"
import type { ReaderPackage } from "./build-package.ts"
import {
  type Iteration,
  implementAgentsPath,
  readBuildRecord,
  sectionText,
  verifyLogPath,
} from "./docs/build-log.ts"
import { agentFileOf, CHECKS_RECORD, RESEARCH_DIR, RESEARCH_QUESTIONS } from "./docs/names.ts"
import { allTasks, type Outline } from "./docs/outline.ts"
import { describeShare, type JudgeShare, stepsAreProved } from "./docs/rules/judge-shares.ts"
import { templateFrom } from "./docs/schema.ts"
import type { FlowStepId } from "./flow.ts"
import { agentEntry, appPointer } from "./install/where.ts"
import { instructionsSection } from "./instructions.ts"
import { recheckOf } from "./recheck.ts"
import {
  researchAreaGroups,
  researchPointers,
  researchQuestionItems,
} from "./research-questions.ts"
import { writeGeneratedBrief } from "./run/bind.ts"
import type { HelperRole } from "./scaling.ts"
import { selfCommand } from "./self.ts"
import { shellQuote } from "./shell.ts"
import type { Task } from "./task/store.ts"
import { type Assignment, codeDiff, evidenceExists, readAssignment } from "./verification.ts"

export type Helper = {
  role: HelperRole
  /** The id the helper reports progress under; it names nothing about the task. */
  id?: string
  /** The model to start it on, when the agent's table and the settings name one. */
  model?: string
  /** The reasoning effort, where the agent takes one per helper: medium to build, high to judge. */
  effort?: string
  /** A judge of a large build: the part of the build it judges, beside the other judges. */
  share?: JudgeShare
  /** The minutes its brief gives when the work sets them (a slice's cards, a fix's gaps). */
  minutes?: number
  /** The phase instructions perform prerequisite work before this point. */
  when: "start" | "after-draft" | "after-checks"
  /** Give the helper exactly this text; it must not see the conversation. */
  brief: string
  /** The brief as a file in the task runtime folder, for the agent to hand on by path. */
  brief_file?: string
  /** What the session does itself when the agent cannot start a helper. */
  fallback: string
  /** A fix helper's gaps: `withBriefFiles` reads where each comes from; the reply never carries them. */
  gaps?: Gap[]
  /** A judge's later round: the iteration it rechecks, whose failed lines `withBriefFiles` pastes. */
  rechecks?: number
}

export type FiledHelper = Omit<Helper, "brief" | "gaps" | "rechecks"> & { brief_file: string }

/** The step a helper works in, whose filed instructions its brief names. */
const ROLE_STEP: Partial<Record<HelperRole, FlowStepId>> = {
  research: "plan",
  "plan-review": "plan",
  "artifact-check": "plan",
  security: "verify",
  judge: "verify",
}

/**
 * Each helper's brief written to `briefs/<id>.md` in the task runtime folder and named by
 * `brief_file`, so the agent hands a helper a path instead of copying a long text. A helper
 * without an id still gets a file; it has no progress id.
 */
export async function withBriefFiles(
  ctx: Ctx,
  task: Task,
  helpers: Helper[],
): Promise<FiledHelper[]> {
  const dir = ctx.managedBriefsDir ?? join(task.runtimeDir, "briefs")
  const command = commandSection(await briefInvocation(ctx))
  return Promise.all(
    helpers.map(async (helper) => {
      await ctx.fs.mkdir(dir)
      const file = join(dir, `${helper.id ?? salt(ctx)}.md`)
      const step = ROLE_STEP[helper.role]
      const instructions =
        step === undefined || task.type === "chat"
          ? null
          : await instructionsSection(ctx, task, step)
      const parts =
        helper.role === "judge" && task.type !== "chat"
          ? await judgeParts(ctx, task, helper.rechecks)
          : []
      await writeGeneratedBrief(
        ctx,
        file,
        `${command}\n\n${[helper.brief, ...parts, ...(instructions === null ? [] : [instructions])].join("\n\n")}`,
      )
      const { brief: _brief, gaps: _gaps, rechecks: _rechecks, ...reply } = helper
      return {
        ...reply,
        brief_file: file,
        fallback: `${helper.fallback}\n\nRead \`${file}\` in full and follow it.`,
      }
    }),
  )
}

/** The parts of the Implement agents' file a reviewer is pasted instead of reading the whole file. */
const BUILD_PARTS = ["For Verify", "Environment"] as const

/**
 * What a reviewer's brief holds beyond the shared text: the build's *For Verify* and *Environment*
 * (a part the build did not write is left out), and on a later round the verdict lines of the
 * previous round that did not pass, each under its own heading. The files themselves stay on demand.
 */
async function judgeParts(ctx: Ctx, task: Task, rechecks: number | undefined): Promise<string[]> {
  const build = implementAgentsPath(task)
  const notes = (await ctx.fs.exists(build)) ? await ctx.fs.readFile(build) : ""
  const parts = BUILD_PARTS.flatMap((heading) => {
    const body = sectionText(notes, heading)
    return body === "" ? [] : [`## The build's ${heading}\n\n${body}`]
  })
  if (rechecks === undefined) return parts
  const record = await readBuildRecord(ctx, task)
  const steps = await recordedSteps(ctx, task, rechecks, record.verification)
  if (steps !== null) parts.push(steps)
  const previous = record.verification.find((i) => i.n === rechecks)
  const failed = (previous?.verdicts ?? []).filter(
    (v) => v.verdict === "FAIL" || v.verdict === "MISSING",
  )
  if (failed.length > 0) {
    const lines = failed.map(
      (v) => `- [${v.verdict}] ${v.kind}${v.subject === "" ? "" : ` ${v.subject}`}: ${v.text}`,
    )
    parts.push(`## Iteration ${rechecks}: the lines that did not pass\n\n${lines.join("\n")}`)
  }
  return parts
}

/**
 * A recheck of a Plan listed by Done means point: the steps the round must record, with why, and
 * the ones QualityLayer carries from earlier rounds. Null for any other round.
 */
async function recordedSteps(
  ctx: Ctx,
  task: Task,
  rechecks: number,
  rounds: Iteration[],
): Promise<string | null> {
  const assignment = await readAssignment(ctx, task)
  if (assignment === null || assignment.after?.iteration !== rechecks) return null
  const recheck = await recheckOf(
    ctx,
    task.runtimeDir,
    assignment,
    rounds,
    evidenceExists(ctx, task),
  )
  if (recheck === null) return null
  const lines = [...recheck.again].map(([id, why]) => `- \`acceptance ${id}\` — ${why}`)
  const carried = [...recheck.carried.values()].map((s) => `${s.id} (iteration ${s.iteration})`)
  return [
    "## Steps this round records",
    "",
    lines.length > 0
      ? `Record these, and \`review\` for the change:\n\n${lines.join("\n")}`
      : "Every step stands. Record `review` for the change, and any step you choose to run again.",
    ...(carried.length > 0
      ? [
          "",
          `Carried by QualityLayer with its evidence, so you record nothing for it unless you run it again: ${carried.join(", ")}.`,
        ]
      : []),
  ].join("\n")
}

const text = (key: string) => phaseText(key) ?? ""

async function briefInvocation(ctx: Ctx): Promise<string[]> {
  const self = selfCommand([])
  const launcher = agentEntry(ctx)
  if (self.length !== 1 || !(await ctx.fs.exists(launcher))) return self
  try {
    const pointer = JSON.parse(await ctx.fs.readFile(appPointer(ctx))) as { cli?: unknown }
    if (typeof pointer.cli !== "string") return self
    return (await realpath(pointer.cli)) === (await realpath(process.execPath)) ? [launcher] : self
  } catch {
    return self
  }
}

function commandSection(invocation = selfCommand([])): string {
  return (
    "## QualityLayer command\n\n" +
    "Every `qualitylayer` command below uses this exact invocation, adding the stated arguments. " +
    "Keep this executable instead of resolving another version from PATH. " +
    "The JSON array preserves argument boundaries; use your shell's executable syntax.\n\n" +
    `\`\`\`json\n${JSON.stringify(invocation)}\n\`\`\``
  )
}

/** Said of the diff a helper reviews when the task recorded no base commit. */
const NO_BASE = " (no recorded base: diff the task branch against where it started)"

/** How many leading path segments name an area of the repository. */
const AREA_DEPTH = 3

/**
 * The areas a set of changed files falls in, one line each with its file count: the directory cut
 * to its first three segments (`qualitylayer/src/ui`, `docs/site/api`), most files first.
 */
export function changedAreas(files: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const file of files) {
    const dir = file.split("/").slice(0, -1).slice(0, AREA_DEPTH).join("/")
    const area = dir === "" ? "the repository root" : `\`${dir}\``
    counts.set(area, (counts.get(area) ?? 0) + 1)
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([area, n]) => `- ${area} (${n} ${n === 1 ? "file" : "files"})`)
}

/** Minutes a helper is told it has, by role; the App never shows them. */
const BUDGET_MINUTES = {
  research: 8,
  "plan-review": 10,
  "artifact-check": 8,
  slice: 45,
  fix: 30,
  judge: 10,
  security: 10,
} as const

/** The minutes a helper of this role is told it has: a judge of a share has its share's. */
export function helperMinutes(role: HelperRole, share?: JudgeShare, minutes?: number): number {
  if (minutes !== undefined) return minutes
  return role === "judge" && share !== undefined ? share.minutes : BUDGET_MINUTES[role]
}

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n))

/** A Chat slice has 12 minutes a card, never under 45 and never over 150: a large slice is not cut short. */
export const sliceMinutes = (cards: number) => clamp(12 * cards, BUDGET_MINUTES.slice, 150)

/** A short random id for a helper's progress lines. */
export const salt = (ctx: Ctx) =>
  `${ctx.clock.now().toString(36).slice(-5)}${randomUUID().slice(0, 8)}`

/** The last line of a helper that reports progress, so the App stops showing it as running. */
const FINISHED = (id: string) =>
  `Your last command is \`qualitylayer progress done --agent ${id}\`.`

/** The progress section every helper with an id ends with. */
const progressSection = (id: string, what: string) =>
  `## Progress\n\nAs you start ${what}, run ` +
  `\`qualitylayer progress "<what you do now, under 60 characters>" --agent ${id}\`. ${FINISHED(id)}`

/** The one rule every helper carries about messages: the session reads only the final report. */
const MESSAGES = "- Messages: none while you work; your last message is your report."

/** The rules every helper carries about temporary files, processes and messages, as list items. */
export const TEMP_FILES = [
  "- Temporary files: `mktemp -d` or your scratch folder. Delete only by a literal path or a guarded " +
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax the helper copies, not a placeholder
    'variable: `rm -rf "${dir:?}"`, never `rm -rf $DIR/x`.',
  "- Processes: note the id of every process you start and stop only those, by their literal ids; " +
    "other sessions run here, so never by name or pattern (`pkill`, `killall`, `pgrep`). " +
    "No command may wait for input (`< /dev/null` or a non-interactive flag); give a long one a time limit.",
  MESSAGES,
].join("\n")

/** For the helpers that change code: an edit the person can review as a diff, never a shell patch. */
const FILE_TOOLS =
  "- Editing: only with your agent's file tools (Edit and Write in Claude Code, apply_patch in Codex), " +
  "never sed, awk, a heredoc or a one-off script; when an edit fails, read the file again and retry."

/** A helper that records does not move the build: `next` is the session's, and it reads the record. */
const NEVER_NEXT =
  "- The session moves the build on, after your report: never run `qualitylayer next`, " +
  "`qualitylayer gate` or any command that does."

const RESTARTED =
  "- If an earlier run of this brief stopped before recording anything, run every step " +
  "yourself: nothing it left counts."

/**
 * The one `## Rules` section of a brief: temporary files, processes and messages for every helper,
 * and, by role, how it edits, that `next` is not its to run, and what a restart means.
 */
function rules({
  edit = false,
  next = false,
  restart = false,
}: {
  edit?: boolean
  next?: boolean
  restart?: boolean
} = {}): string {
  return [
    "## Rules",
    "",
    TEMP_FILES,
    ...(edit ? [FILE_TOOLS] : []),
    ...(next ? [NEVER_NEXT] : []),
    ...(restart ? [RESTARTED] : []),
  ].join("\n")
}

function fileList(paths: string[]): string {
  return paths.map((p) => `- \`${p}\``).join("\n")
}

const FOR_AGENTS =
  "Files under `agents/` are for agents: they change nothing agreed, and where one differs from its step file the step file wins."

/** What a reader reads first, and what it may open when its job needs it. */
function documents(pkg: ReaderPackage): string[] {
  const forAgents = [...pkg.read, ...pkg.onDemand].some((path) => /[\\/]agents[\\/]/.test(path))
  return [
    ...(pkg.read.length > 0 ? [`## Your documents\n\n${fileList(pkg.read)}`] : []),
    ...(pkg.onDemand.length > 0 ? [`## Read on demand\n\n${fileList(pkg.onDemand)}`] : []),
    ...(forAgents ? [FOR_AGENTS] : []),
  ]
}

export { numberedItems, researchAreaGroups, researchPointers } from "./research-questions.ts"

function researchHelperTemplate(): string {
  return templateFrom(
    {
      type: "research-report",
      frontmatter: { required: [], template: null, none: true },
      title: "required",
      rules: [],
      sections: [
        {
          heading: "Findings",
          required: true,
          hint: "one H3 per finding whose header states the takeaway; under it `**Answers:** 1, 2` naming the questions it answers; a question the code could not answer gets a finding that says what the code did not show; the view beside the prose; every claim with file:line; today's shape only",
        },
        {
          heading: "How it is tested today",
          required: true,
          hint: "the suite, the command for one file and for all, the fixtures, each from the repository root; or that there are none",
        },
        {
          heading: "Code references",
          required: true,
          hint: "the load-bearing paths with line numbers, and how exhaustive this list is",
        },
      ],
    },
    "",
  )
}

/** The house style a blind helper writes in: the document rules, without how a step asks the person. */

/**
 * Blind research sees the questions and the user's pointers, never the problem or Done means.
 * Several questions are split over helpers that run side by side; each reports what it is doing
 * under an id that names nothing about the task. Handed out only when the scaling rules say so.
 * The brief is built from *Questions for helpers* of the Plan's agents' file and from nothing else,
 * the questions grouped by area.
 */
export async function researchHelpers(ctx: Ctx, task: Task): Promise<Helper[]> {
  const questionsAt = join(task.dir, agentFileOf("plan"))
  const research = (await ctx.fs.exists(questionsAt)) ? await ctx.fs.readFile(questionsAt) : ""
  const section = sectionText(research, RESEARCH_QUESTIONS)
  const items = researchQuestionItems(section)
  if (items.length === 0) return []
  const groups = researchAreaGroups(items)
  const pointers = researchPointers(section)
  // Helpers write the full findings; the session collects them into the research document.
  const template = researchHelperTemplate()
  const tag = salt(ctx)
  return groups.map((group, index) => {
    const id = `r${index + 1}-${tag}`
    const part =
      groups.length > 1
        ? "Other helpers answer the other questions at the same time; answer only yours, " +
          "with their numbers. "
        : ""
    const numbers = group.map((item) => /^\d+/.exec(item)?.[0]).filter((n) => n !== undefined)
    const progress = progressSection(id, "each question, and every few minutes on a long one")
    return {
      role: "research" as const,
      id,
      when: "start" as const,
      brief: [
        text("research-helper"),
        `## Your questions\n\n${part}${group.join("\n")}`,
        ...(pointers !== "" ? [`## Context pointers\n\n${pointers}`] : []),
        numbers.length > 0
          ? `${progress}\n\nStart each line with your question numbers, as in "${numbers.length > 1 ? "questions" : "question"} ${numbers.join(", ")} · reading the entry point".`
          : progress,
        rules(),
        // Last, so the save is the brief's last numbered step.
        `## Output\n\nThe repository is \`${task.repoRoot}\`. ` +
          `Your report is this template with every \`<!-- fill: ... -->\` comment replaced:\n\n\`\`\`\`markdown\n${template}\`\`\`\`\n\n` +
          "Save the finished document from the repository:\n\n" +
          `1. Run \`qualitylayer helper result ${id} --file <report>\` ` +
          "with the report in a file in your scratch folder, or " +
          `\`qualitylayer helper result ${id} <<'QL_REPORT'\` with the whole document on the lines after it and ` +
          "`QL_REPORT` alone on the last line. Your final message is then the single line " +
          `\`Saved ${RESEARCH_DIR}/${id}.md\`.`,
      ].join("\n\n"),
      fallback:
        "Answer the research questions yourself under the brief's rules, as if you did not know " +
        "the problem: no recommendations, nothing about what will be built.",
    }
  })
}

/** One artifact handed to a fresh check: its page, the four pictures to take of it, and what was asked for. */
export type ArtifactCheck = {
  id: string
  /** The page's name: the key of its pictures and review, the artifact's own name for a single page. */
  name: string
  /** The artifact `artifact shot` takes, when the page belongs to a folder draft; absent: `name`. */
  artifact?: string
  /** The page of that folder draft, as `artifact shot --page` takes it; absent for a single page. */
  page?: string
  /** The page on disk. */
  file: string
  /** Each picture to take, where it goes. */
  shots: { width: number; theme: "light" | "dark"; out: string }[]
  /**
   * Every page of a folder draft the check covers, when it covers more than one: one report for the
   * draft. The fields above then describe the first page and are not read.
   */
  pages?: { page: string; file: string; shots: ArtifactCheck["shots"] }[]
  /** The Plan's Done means, as written. */
  doneMeans: string
}

/**
 * A fresh agent looks at one artifact the way the person will: the pictures at wide and phone width in
 * both themes, held against the Done means. Read-only; the session writes its report to the
 * artifact's review file.
 */
export function artifactCheckHelper(task: Task, check: ArtifactCheck): Helper {
  const artifact = check.artifact ?? check.name
  const covered =
    check.pages !== undefined && check.pages.length > 1
      ? check.pages
      : [{ page: check.page, file: check.file, shots: check.shots }]
  const shots = covered.flatMap((one) =>
    one.shots.map(
      (s) =>
        `- \`qualitylayer artifact shot ${shotTarget(artifact, one.page)} --width ${s.width} --theme ${s.theme} --out ${shellQuote(s.out)} --task ${task.slug}\``,
    ),
  )
  const renders = covered.map(
    (one) =>
      `Run \`qualitylayer artifact check ${shotTarget(artifact, one.page)} --render --task ${task.slug}\`.`,
  )
  const named =
    check.page !== undefined
      ? `page \`${check.page}\` of the artifact \`${artifact}\``
      : `named \`${check.name}\``
  const yours =
    covered.length > 1
      ? `The draft is the artifact \`${artifact}\`, and one report covers its ${covered.length} pages: ${covered.map((one) => `\`${one.page}\` (${one.file})`).join(", ")}.`
      : `The page is \`${check.file}\`, ${named}.`
  return {
    role: "artifact-check",
    id: check.id,
    when: "after-draft",
    brief: [
      text("artifact-check"),
      `## Your artifact\n\n${yours} The repository is \`${task.repoRoot}\`; change no file in it.`,
      `## The Done means\n\n${check.doneMeans !== "" ? check.doneMeans : "The Plan has no Done means yet: judge the artifact against its own first part."}`,
      `## The pictures\n\nThe capture commands:\n\n${shots.join("\n")}`,
      `## The render check\n\n${renders.join("\n")}`,
      progressSection(check.id, "each picture"),
      rules(),
    ].join("\n\n"),
    fallback:
      "Look at the artifact again from the top as the person will, with no memory of how it was " +
      "drawn: take the four pictures, hold them against the Done means, and list the same findings yourself.",
  }
}

/** An artifact outside a task, handed to a fresh check: its page, the pictures to take and what was asked for. */
export type ArtifactReview = {
  /** The artifact's name, as `artifact shot` takes it. */
  artifact: string
  /** The page of a folder artifact, as `artifact shot --page` takes it; absent for a single page. */
  page?: string
  /** The page on disk. */
  file: string
  repoRoot: string
  /** The workflow task whose draft this is, for the capture commands; absent for a project artifact. */
  task?: string
  /** Each picture to take: the artifact's width, then a phone's, light and dark. */
  views: { width: number; theme: "light" | "dark" }[]
  /** What the person asked for, else the artifact's purpose: the acceptance points. Empty when neither is known. */
  asked: string
}

/**
 * The same fresh look as the Plan step's, for the calling agent to hand to a fresh subagent: the
 * pictures at the artifact's width and a phone's in both themes, held against what was asked for.
 * Read-only; the subagent's last message is its report.
 */
export function artifactReviewBrief(review: ArtifactReview): string {
  const target = shotTarget(review.artifact, review.page)
  const scope = review.task !== undefined ? ` --task ${review.task}` : ""
  const pictures = review.views.map(
    (v) =>
      `- \`qualitylayer artifact shot ${target} --width ${v.width} --theme ${v.theme}${scope}\``,
  )
  const named =
    review.page !== undefined
      ? `page \`${review.page}\` of the artifact \`${review.artifact}\``
      : `named \`${review.artifact}\``
  return [
    commandSection(),
    text("artifact-check"),
    `## Your artifact\n\nThe page is \`${review.file}\`, ${named}. The repository is \`${review.repoRoot}\`; change no file in it.`,
    `## The acceptance points\n\n${review.asked !== "" ? review.asked : "Nobody wrote down what was asked for: judge the artifact against its own first part."}`,
    `## The pictures\n\nThe capture commands print where each picture is saved:\n\n${pictures.join("\n")}`,
    `## The render check\n\nRun \`qualitylayer artifact check ${target} --render${scope}\`.`,
    rules(),
  ].join("\n\n")
}

/** What `artifact shot` is told to draw: the artifact, and its page when it is a folder's. */
const shotTarget = (artifact: string, page: string | undefined): string =>
  page !== undefined ? `${artifact} --page ${page}` : artifact

const CARD_BREAK = "\n\n---\n\n"

/** Captured proof keeps the path chosen by the evidence command. */
function saveProof(task: Task): string {
  return `capture proof for \`${task.slug}\` with \`qualitylayer evidence add\` or \`qualitylayer evidence shot\`, and use the exact returned \`file\` path unchanged (text under \`records/\`, pictures under \`evidence/\`)`
}

/** What a Chat slice helper is given: its slice, the text of its cards and its validation. */
export type ChatSlice = { slice: number; title: string; cards: string[]; validation: string }

/** A Chat slice is built by a helper that reads its own cards; Chat has no workflow approval gates. */
export function chatSliceHelper(
  task: Task,
  slice: ChatSlice,
  pkg: ReaderPackage,
  id: string,
): Helper {
  return {
    role: "slice",
    id,
    when: "start",
    minutes: sliceMinutes(slice.cards.length),
    brief: [
      `Build Chat slice ${slice.slice}: ${slice.title} in ${task.repoRoot}.`,
      "Read the repository rules before editing. Preserve other slices' files and the shared index. Use your file tools for edits. Do not commit or push. This Chat has no workflow approval gates.",
      `The plain plan is ${join(task.dir, "chat-plan.md")}; the slice list is ${join(task.dir, "chat-slices.md")}.`,
      slice.cards.join(CARD_BREAK),
      `Validation: ${slice.validation}. Run these checks in your own session permissions. Tick only your completed cards in chat-slices.md after their checks pass, preserving every other slice's boxes. Then save your report with qualitylayer helper result ${id} --file <report> and finish with qualitylayer progress done --agent ${id}. Report failures and stopped or incomplete work explicitly.`,
      ...documents(pkg),
    ].join("\n\n"),
    fallback: `Build Chat slice ${slice.slice} yourself and retain its report.`,
  }
}

/** One gap a fix helper closes: a failed check, judge line, or a security item. */
export type Gap = {
  source: string
  subject: string
  text: string
  /** A running program showed this gap (a judge run): the evidence files that run saved. */
  observed?: { evidence: string[] }
}

const NOT_HELPED = "`**Reviewer:** build session, no helpers available`"

/**
 * The security review of the quality pass (`recheck` names the severe findings a fix helper fixed
 * since, which it checks again). `inline` is the Plan's Trust boundary line, pasted in.
 */
export function qualityHelper(
  task: Task,
  { base, diff, pkg, id }: { base: string | null; diff: string; pkg: ReaderPackage; id: string },
  {
    inline = "",
    recheck = [],
    areas = [],
    recordSlot,
  }: {
    inline?: string
    recheck?: string[]
    /** The build's changed areas, from `changedAreas`: a first review covers each. */
    areas?: string[]
    recordSlot?: string
  } = {},
): Helper {
  const rechecking = recheck.length > 0
  const record = verifyLogPath(task)
  return {
    role: "security",
    id,
    when: "start",
    brief: [
      text(rechecking ? "quality-security-recheck" : "quality-security"),
      ...(rechecking ? [`## Your findings\n\n${recheck.map((i) => `- ${i}`).join("\n")}`] : []),
      ...(inline !== "" ? [`## The Plan's trust boundary\n\n${inline}`] : []),
      ...documents(pkg),
      ...(recordSlot
        ? [
            `## Your record slot\n\nWrite your block only between \`<!-- quality-record:${recordSlot} -->\` and \`<!-- /quality-record:${recordSlot} -->\` in \`${record}\`. Preserve these markers. This is your placement instead of the generic end-of-section instruction. Read the current slot before an exact-text edit; a stale edit is retried from the current text, never with a whole-file replacement.`,
          ]
        : []),
      `## Your change\n\nThe repository is \`${task.repoRoot}\`. The change under review is \`${diff}\`${base === null ? NO_BASE : ""}. The record you write in is \`${record}\`.${
        implementAgentsPath(task) === record
          ? ""
          : ` The build's notes are in \`${implementAgentsPath(task)}\`. Check and scan results are in \`${CHECKS_RECORD}\` when present.`
      }${
        areas.length > 0 && !rechecking
          ? `\n\nThe build's commits changed these areas. Cover each, the backend routes as much as the screens:\n\n${areas.join("\n")}`
          : ""
      }`,
      progressSection(id, "each part"),
      rules({ edit: true, next: true, restart: true }),
    ].join("\n\n"),
    fallback: rechecking
      ? `Check ${recheck.join(", ")} again yourself under the brief's rules, and write ${NOT_HELPED} in the block.`
      : `Review the change for severe security problems yourself under the brief's rules: one pass, read only. Write ${NOT_HELPED} in the block so a reviewer can tell.`,
  }
}

/**
 * What a judge of a large build is told about its share. It replaces the single judge's "one
 * block" record: each judge appends its own part, beside the others, to the same iteration.
 */
function shareSection(share: JudgeShare, iteration: number, byStep: boolean): string {
  const part = `### Iteration ${iteration} · share ${share.n}`
  const evidence = `it${iteration}-s${share.n}-…`
  const intro =
    `## Your share: ${describeShare(share)}\n\nThis build is too large for one judge: ${share.of} ` +
    "judges work at the same time, each on its own share. Do not wait for them. " +
    "Where the rules above say to judge everything, they mean your share."
  const record =
    "The other judges append their parts to the same `## Verification` section at the same time: " +
    "read its end just before you insert, add only your block with an exact-text edit, never " +
    "rewrite the file. " +
    `Name your evidence files \`${evidence}\`. Your block starts with \`${part}\` and holds the ` +
    "Assignment and Judge lines (no Revision line: QualityLayer stamps it), your verdict lines and " +
    "your own `**Result:**`, `pass` only when every line of your part is `[PASS]` or `[NOTE]`. " +
    "If a part for your share exists, replace it and leave the others."
  // A points Plan's build splits its steps: a share runs its steps, the diff-wide share the diff.
  if (byStep && share.kind === "diff") {
    return [
      intro,
      "Review the integrated change on its assigned source and check the recorded evidence yourself. The acceptance helpers run their assigned steps and record their own verdicts.",
      "- **Review of the whole diff:** the `review` line and its findings, including files changed outside every Files block (Verify's own lanes and the fix helpers are in scope), and each card's done lines against the code.",
      "Record no `acceptance`, `done`, `dod`, `scenario` or `check` line.",
      record,
    ].join("\n\n")
  }
  if (byStep) {
    return [
      intro,
      `Run these steps of the Plan's Acceptance test:\n\n- **Steps:** ${share.steps.join(", ")}. Run each as written, then probe one or two inputs past it (empty, invalid, boundary). A step that needs the person's own account, device or an app you cannot run is \`[USER]\`, opened with the question they are asked.`,
      "Record one `acceptance A<n>` line per step of your share. Record no `check`, `done` line and no clean " +
        "`review` line: the diff-wide judge records the `review`; a defect you meet is a `[FAIL] review:` " +
        "line. Run whatever you need to prove your lines, once.",
      record,
    ].join("\n\n")
  }
  if (share.kind === "diff") {
    return [
      intro,
      "Review the integrated change on its assigned source and check the recorded evidence yourself. The acceptance helpers check each task's definition of done and the scenarios.",
      `- **The checks:** cite the CLI's \`${CHECKS_RECORD}\`, or \`## Checks\` in \`${agentFileOf("implement")}\` for earlier runs. Record one \`check\` line per command.\n` +
        "- **The acceptance test:** one `acceptance A<n>` line per step of the Plan's Acceptance test, run as it says.\n" +
        "- **Done means:** one `done <n>` line per item of *Done means*.\n" +
        "- **Review of the whole diff:** the `review` line and its findings, including files changed outside every Files block (Verify's own lanes and the fix helpers are in scope).",
      "Record no `dod` or `scenario` line.",
      record,
    ].join("\n\n")
  }
  return [
    intro,
    `Judge these:\n\n- **Definition of done:** every bullet of ${share.tasks.join(", ")}.\n` +
      `- **Scenarios:** ${share.scenarios.length > 0 ? `${share.scenarios.join(", ")}, step by step and probed past the script, as above` : "none"}.\n` +
      "- **Review:** the diff of the files in those tasks' Files blocks and the deviations that name them.",
    "Record one `dod T<n>` line per task and one `scenario <n>` line per scenario of your share. " +
      "Record no `check`, `acceptance`, `done` line and no clean `review` line: the diff-wide judge " +
      "records those. Run whatever you need to prove your lines, once.",
    record,
  ].join("\n\n")
}

/** What the judge is told about the items of its assignment: how to record each, and what not to judge. */
/** What a reviewer of a Plan with numbered steps (a bug's Plan too) records besides the Acceptance test and the diff. */
function itemSections(assignment: Assignment, share: JudgeShare | undefined): string[] {
  const out: string[] = []
  out.push(
    "## Record each check as you finish it\n\n" +
      "After each item run " +
      `\`qualitylayer verdict ${assignment.id} "<item>" pass|fail|missing|user|note "<one line of evidence>" [--evidence <returned file>]\`, ` +
      "the item named as its record line names it (`check`, `dod T4`, `acceptance A1`). " +
      "This command saves a receipt. Also write the corresponding verdict line in your assigned Verify iteration or share. " +
      "Use `check` for each recorded command, not `check all`. A `pass` of an " +
      "acceptance step needs `--evidence` with the exact `file` returned by the capture command; do not change its folder or name.",
  )
  if (assignment.ignored !== undefined && assignment.ignored.length > 0) {
    out.push(
      "## Ignored by git\n\nThe Plan names these paths, but git ignores them (generated or local-only " +
        `files): ${assignment.ignored.map((p) => `\`${p}\``).join(", ")}. Record no \`[MISSING]\` for ` +
        "them and never judge a card bullet against them; judge what generates them instead.",
    )
  }
  // The diff-wide judge (or the only judge) records these; a judge of slices does not repeat them.
  if (share?.kind !== "slices") {
    const exempt = (assignment.outline === undefined ? [] : allTasks(assignment.outline))
      .filter((c) => c.testFirst?.kind === "trivial" || c.testFirst?.kind === "qualification")
      .map((c) => c.id)
    if (exempt.length > 0) {
      out.push(
        "## Cards that need no failing test\n\n" +
          `${exempt.join(", ")}: marked \`**Trivial:**\` or \`**Qualification:**\`, the Plan's approved ` +
          "exemption from a failing test. Their missing red run is no finding: write no `[NOTE]` and no " +
          "other line about it, and judge their verify command as their proof.",
      )
    }
  }
  return out
}

/**
 * A judge's minutes grow with what it must judge: each task's bullets take time. Ten minutes for 27
 * tasks left it no time for the definition-of-done lines.
 */
export function judgeMinutes(outline: Outline | undefined): number {
  if (outline === undefined) return BUDGET_MINUTES.judge
  const tasks = allTasks(outline).length
  return clamp(Math.ceil(tasks * 0.75), BUDGET_MINUTES.judge, 60)
}

/** What a lone judge's record needs to be accepted, and the step that proves it before the report. */
function recordMustValidate(): string {
  return (
    "## Your record must validate\n\nEvery runtime pass (a scenario or an acceptance step) cites its proof file by " +
    "path in backticks, as in the example lines. " +
    `Before you report, run \`qualitylayer validate ${agentFileOf("verify")}\` and fix every ` +
    "error."
  )
}

/** The judge sees what its job needs and the diff, never the build's conversation. */
export function judgeHelper(
  task: Task,
  iteration: number,
  base: string | null,
  diff: string,
  pkg: ReaderPackage,
  assignment?: Assignment,
  options: {
    progress?: string
    share?: JudgeShare
    committedDiff?: boolean
  } = {},
): Helper {
  const label = "build session, no helpers available"
  const bugfix = task.type === "bugfix" ? `\n\n${text("judge-bugfix")}` : ""
  const { share } = options
  const record = verifyLogPath(task)
  const minutes = share?.minutes ?? judgeMinutes(assignment?.outline)
  const treeNote = options.committedDiff
    ? assignment?.note?.replace(
        "The diff against the effective base includes tracked working edits with the normal exclusions; inspect untracked files directly.",
        "The diff above shows committed changes. Inspect local inputs recorded for your assignment separately.",
      )
    : assignment?.note
  return {
    role: "judge",
    when: "start",
    ...(options.progress !== undefined ? { id: options.progress } : {}),
    ...(share !== undefined ? { share } : { minutes }),
    ...(assignment?.after !== undefined ? { rechecks: assignment.after.iteration } : {}),
    brief: [
      `${text("judge")}${bugfix}`,
      ...documents(pkg),
      `## Your assignment\n\nThe repository is \`${task.repoRoot}\`. The change is ` +
        `\`${diff}\`${base === null ? NO_BASE : ""}. ` +
        (share === undefined
          ? `Record your verdicts as \`### Iteration ${iteration}\` at the end of the ` +
            `\`## Verification\` section of \`${record}\`, and ${saveProof(task)}.`
          : `Record your part at the end of the \`## Verification\` section of \`${record}\`, ` +
            `and ${saveProof(task)}.`),
      ...(share !== undefined
        ? [
            shareSection(
              share,
              iteration,
              share.steps.length > 0 ||
                (assignment?.outline !== undefined && stepsAreProved(assignment.outline)),
            ),
          ]
        : [recordMustValidate()]),
      ...(treeNote !== undefined ? [`## The tree you judge\n\n${treeNote}`] : []),
      ...(assignment
        ? [
            ...(assignment.head !== undefined
              ? [`Judged commit: \`${assignment.head}\`. Report the actual tree you execute.`]
              : []),
            `Record this field verbatim in ${share === undefined ? "this iteration" : "your part"}:\n\n**Assignment:** ${assignment.id}\n\nWrite no revision or commit hash: QualityLayer records it.`,
          ]
        : []),
      ...(assignment !== undefined ? itemSections(assignment, share) : []),
      ...(assignment?.after !== undefined
        ? [
            text("judge-rerun")
              .replaceAll("{previous}", String(assignment.after.iteration))
              .replaceAll(
                "{fix}",
                codeDiff(
                  shellQuote(
                    assignment.head === undefined
                      ? assignment.after.head
                      : `${assignment.after.head}..${assignment.head}`,
                  ),
                ),
              ),
          ]
        : []),
      ...(options.progress !== undefined
        ? [
            progressSection(
              options.progress,
              "each check, scenario, acceptance step and review area",
            ),
          ]
        : []),
      rules({ next: true }),
    ].join("\n\n"),
    fallback:
      share === undefined
        ? `Judge the build yourself under the brief's rules, and write \`**Judge:** ${label}\` in the ` +
          "iteration so a reviewer can tell."
        : "Judge every share of the build yourself, one after another, under the briefs' rules, and " +
          `write each part as its brief says with \`**Judge:** ${label}\` so a reviewer can tell.`,
  }
}
