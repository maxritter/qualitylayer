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
import {
  type ArtifactReview,
  artifactCheckHelper,
  artifactReviewBrief as renderArtifactReviewBrief,
} from "./briefs-artifact.ts"
import { judgeHelper, judgeParts } from "./briefs-judge.ts"
import type { ReaderPackage } from "./build-package.ts"
import { implementAgentsPath, sectionText, verifyLogPath } from "./docs/build-log.ts"
import { agentFileOf, CHECKS_RECORD, RESEARCH_DIR, RESEARCH_QUESTIONS } from "./docs/names.ts"
import type { JudgeShare } from "./docs/rules/judge-shares.ts"
import { templateFrom } from "./docs/schema.ts"
import type { FlowStepId } from "./flow.ts"
import { agentEntry, appPointer } from "./install/where.ts"
import { instructionsSection } from "./instructions.ts"
import {
  researchAreaGroups,
  researchPointers,
  researchQuestionItems,
} from "./research-questions.ts"
import { writeGeneratedBrief } from "./run/bind.ts"
import type { HelperRole } from "./scaling.ts"
import { selfCommand } from "./self.ts"
import type { Task } from "./task/store.ts"

export { type ArtifactReview, artifactCheckHelper, judgeHelper }

export function artifactReviewBrief(review: ArtifactReview, invocation?: string[]): string {
  return renderArtifactReviewBrief(review, commandSection(invocation))
}

export async function artifactReviewBriefFor(ctx: Ctx, review: ArtifactReview): Promise<string> {
  return renderArtifactReviewBrief(review, commandSection(await briefInvocation(ctx)))
}

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

export const briefText = (key: string) => phaseText(key) ?? ""
const text = briefText

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
export const NO_BASE = " (no recorded base: diff the task branch against where it started)"

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
export const BUDGET_MINUTES = {
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

export const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n))

/** A Chat slice has 12 minutes a card, never under 45 and never over 150: a large slice is not cut short. */
export const sliceMinutes = (cards: number) => clamp(12 * cards, BUDGET_MINUTES.slice, 150)

/** A short random id for a helper's progress lines. */
export const salt = (ctx: Ctx) =>
  `${ctx.clock.now().toString(36).slice(-5)}${randomUUID().slice(0, 8)}`

/** The last line of a helper that reports progress, so the App stops showing it as running. */
const FINISHED = (id: string) =>
  `Your last command is \`qualitylayer progress done --agent ${id}\`.`

/** The progress section every helper with an id ends with. */
export const briefProgressSection = (id: string, what: string) =>
  `## Progress\n\nAs you start ${what}, run ` +
  `\`qualitylayer progress "<what you do now, under 60 characters>" --agent ${id}\`. ${FINISHED(id)}`
const progressSection = briefProgressSection

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
export function briefRules({
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
const rules = briefRules

function fileList(paths: string[]): string {
  return paths.map((p) => `- \`${p}\``).join("\n")
}

const FOR_AGENTS =
  "Files under `agents/` are for agents: they change nothing agreed, and where one differs from its step file the step file wins."

/** What a reader reads first, and what it may open when its job needs it. */
export function briefDocuments(pkg: ReaderPackage): string[] {
  const forAgents = [...pkg.read, ...pkg.onDemand].some((path) => /[\\/]agents[\\/]/.test(path))
  return [
    ...(pkg.read.length > 0 ? [`## Your documents\n\n${fileList(pkg.read)}`] : []),
    ...(pkg.onDemand.length > 0 ? [`## Read on demand\n\n${fileList(pkg.onDemand)}`] : []),
    ...(forAgents ? [FOR_AGENTS] : []),
  ]
}
const documents = briefDocuments

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

const CARD_BREAK = "\n\n---\n\n"

/** Captured proof keeps the path chosen by the evidence command. */
export function saveProof(task: Task): string {
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
