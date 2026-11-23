// The task store. A task's Plan file (docs/plans/<task>/01-plan.md) carries everything durable in
// its frontmatter; the runtime folder under ~/.qualitylayer carries what only matters while a
// session is alive. A folder without a Plan file (or an earlier task's 01-discuss.md) is not a task.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { readConfig } from "../config.ts"
import type { Answers, CommitTiming } from "../config-values.ts"
import {
  type Frontmatter,
  parseDoc,
  patchFrontmatter,
  withFrontmatter,
} from "../docs/frontmatter.ts"
import {
  AGENTS_DIR,
  agentFileOf,
  type DocRole,
  EARLIER_IDENTITY_FILE,
  folderDoc,
  IDENTITY_FILE,
  LAYOUT,
} from "../docs/names.ts"
import { agentsTemplateFor, docTypeOf, schemaForDoc, templateFrom } from "../docs/schema.ts"
import { projectRuntimeDir, type RepoRef, taskDir, taskRuntimeDir } from "../paths.ts"
import { answerModeStamp, approvalModeStamp } from "./answer-mode.ts"
import { placeFor } from "./answers.ts"
// Type-only import: store must not import machine values (machine imports store).
import type { Stage } from "./machine.ts"
import { TERMINAL_STAGES } from "./stages.ts"
import { claimTaskReservation } from "./store-reservation.ts"
import { appendEvent } from "./store-session.ts"
import { slugify, taskTitle, withoutBareSlots } from "./store-title.ts"

export {
  listTasks,
  loadTask,
  lostIdentity,
  restoreLostIdentity,
  TaskUnreadable,
} from "./store-identity.ts"
export { resolveBoundTask, resolveTask } from "./store-resolve.ts"
export {
  appendEvent,
  keepAlive,
  readEvents,
  readSession,
  type Session,
  setCheckout,
  touchSession,
} from "./store-session.ts"
export { slugify, taskTitle, withoutBareSlots } from "./store-title.ts"

export type TaskType = "feature" | "bugfix" | "chat"
/** How the task runs: a small change (one page, one build step, one review) or the full workflow. */
export type Profile = "small" | "full"

export type Task = {
  commitTiming?: CommitTiming
  answers: Answers
  /** Where the task's approvals happen; unset, they follow `answers` (`approvalsOf`). */
  approvals?: Answers
  slug: string
  title: string
  type: TaskType
  /** The task changes a user interface; the Plan must then embed a mockup. */
  ui: boolean
  /** The way the task runs, proposed from the Plan's first look; QualityLayer measures the bounds (`small-change.ts`). Absent means full. */
  profile?: Profile
  /** The user's words recorded as switches of the scaling rules, e.g. `+security`, `-checkpoint`. */
  overrides: string[]
  stage: Stage
  iterations: number
  /** The branch the user had checked out when the work started; QualityLayer never switches it. */
  branch?: string
  /**
   * The task started from a plan the person already had (`task start --from-plan`): its original is
   * kept as `original-plan.md` and the Plan maps the original (adoption.ts).
   */
  origin?: "existing-plan"
  /**
   * Made with an earlier workflow (seven or five steps: its identity file is `01-discuss.md`, or its
   * layout is not `three`): listed, opened as plain files, never continued, approved or rewritten.
   * Absent on every task made now; read it through `isCurrentLayout`.
   */
  earlier?: true
  created: number
  repoRoot: string
  repoId: string
  /** Folder holding the documents: docs/plans/<slug>. */
  dir: string
  /** Absolute path of the CLI-owned runtime folder for this task. */
  runtimeDir: string
}

/** Whether the task is of this workflow; an earlier task is read, never written. */
export const isCurrentLayout = (task: Pick<Task, "earlier">): boolean => task.earlier !== true

/** What the CLI and the App say of an earlier task. */
export const EARLIER_LAYOUT_REASON =
  "Made with the earlier seven-step workflow; it cannot be continued. Its files stay as they are: open them in Files, or start a new task."

/** The task's identity file: the Plan, whose front matter holds the layout, type, stage and settings. */
export function readmePath(task: Pick<Task, "dir"> & { earlier?: true }): string {
  return join(task.dir, task.earlier === true ? EARLIER_IDENTITY_FILE : IDENTITY_FILE)
}

/** The file a role has in this task; a details role is a section of the document that owns it. */
export function taskDocPath(task: Pick<Task, "dir">, role: DocRole): string {
  return join(task.dir, folderDoc(role))
}

/**
 * The text the build and its checks read the plan from, or null before it exists: the Plan, its
 * agents' file (patterns and project checks) and the build's cards together. A reader of the slices
 * and cards takes the cards' own reader, not this text.
 */
export async function planDetailsText(ctx: Ctx, task: Pick<Task, "dir">): Promise<string | null> {
  const paths = [
    taskDocPath(task, "plan"),
    join(task.dir, agentFileOf("plan")),
    taskDocPath(task, "implement"),
    join(task.dir, agentFileOf("implement")),
  ]
  const texts: string[] = []
  for (const path of paths) if (await ctx.fs.exists(path)) texts.push(await ctx.fs.readFile(path))
  return texts.length === 0 ? null : texts.join("\n\n")
}

export function isTerminal(stage: Stage): boolean {
  return TERMINAL_STAGES.includes(stage)
}

async function uniqueSlug(ctx: Ctx, repo: RepoRef, base: string): Promise<string> {
  let slug = base
  for (let n = 2; ; n++) {
    const taken =
      (await ctx.fs.exists(taskDir(repo.root, slug))) ||
      (await ctx.fs.exists(taskRuntimeDir(ctx, repo.id, slug)))
    if (!taken) return slug
    slug = `${base}-${n}`
  }
}

export async function registerProject(ctx: Ctx, repo: RepoRef): Promise<void> {
  const dir = projectRuntimeDir(ctx, repo.id)
  await ctx.fs.mkdir(dir)
  const path = join(dir, "project.json")
  let paths: string[] = []
  if (await ctx.fs.exists(path)) {
    try {
      const current = JSON.parse(await ctx.fs.readFile(path)) as { paths?: string[] }
      paths = current.paths ?? []
    } catch {
      paths = []
    }
  }
  if (!paths.includes(repo.root)) paths.push(repo.root)
  const name = repo.id.replace(/-[0-9a-f]{12}$/, "")
  const project = { id: repo.id, name, commonDir: repo.commonDir, paths, lastSeen: ctx.clock.now() }
  await ctx.fs.writeFile(path, `${JSON.stringify(project, null, 2)}\n`)
}

export type CreateOptions = {
  /** Both sides from a flag or an App start; unset, the chosen rows, CI or the agent decide. */
  answers?: Answers
  /** Approvals on their own side, as the place question's pick may set them. */
  approvals?: Answers
  type?: TaskType
  title?: string
  /** A startup journal reserved this filename for this session. */
  reservation?: { slug: string; owner: string }
  /**
   * The task starts from a plan the person already has: its Plan file starts as the task's record only
   * (front matter and Your request, as a Chat's); the Plan then maps the original.
   */
  origin?: "existing-plan"
}

export async function reserveTaskSlug(ctx: Ctx, repo: RepoRef, title: string): Promise<string> {
  const date = new Date(ctx.clock.now()).toISOString().slice(0, 10)
  return uniqueSlug(ctx, repo, `${date}-${slugify(title)}`)
}

function quoteRequest(request: string): string {
  // A line's leading `>` marks stay a quote inside the quote (a ticket's text arrives quoted); the
  // rest is shown as typed.
  return request
    .split("\n")
    .map((line) => {
      const marks = /^(?:> ?)*/.exec(line)?.[0] ?? ""
      const rest = line.slice(marks.length)
      return `> ${marks}${rest
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/([\\`*_[\]#])/g, "\\$1")}`
    })
    .join("\n")
}

async function writeNewTaskFiles(
  ctx: Ctx,
  task: Task,
  frontmatter: Frontmatter,
  request: string,
  plain: boolean,
): Promise<void> {
  const quoted = quoteRequest(request)
  const withRequest = (text: string): string =>
    text.replace(
      /(## Your request\n)(?:\n<!-- fill: [\s\S]*? -->)?/,
      (_match, heading: string) => `${heading}\n${quoted}\n`,
    )
  const schema = plain ? undefined : schemaForDoc(folderDoc("plan"), { type: task.type })
  const body =
    schema === undefined
      ? `# ${task.title}\n\n## Your request\n`
      : withoutBareSlots(templateFrom(schema, task.title))
  await ctx.fs.writeFile(readmePath(task), withFrontmatter(frontmatter, withRequest(body)))
  const agents = plain ? undefined : agentsTemplateFor(folderDoc("plan"), task, task.title)
  if (agents !== undefined) {
    await ctx.fs.mkdir(join(task.dir, AGENTS_DIR))
    await ctx.fs.writeFile(join(task.dir, agentFileOf("plan")), withRequest(agents))
  }
}

export async function createTask(
  ctx: Ctx,
  repo: RepoRef,
  words: string,
  options: CreateOptions = {},
): Promise<Task> {
  const request = words.trim()
  const title = taskTitle(request, options.title)
  const created = ctx.clock.now()
  const reserved = options.reservation
  if (reserved) {
    const existing = await claimTaskReservation(ctx, repo, reserved, request)
    if (existing !== null) return existing
  }
  const slug = reserved?.slug ?? (await reserveTaskSlug(ctx, repo, title))
  const runtimeDir = taskRuntimeDir(ctx, repo.id, slug)
  const dir = taskDir(repo.root, slug)
  const config = await readConfig(ctx)
  const place = placeFor(config, ctx.env, options.answers)
  const answers = place.answers
  const approvals = options.approvals ?? place.approvals
  const split = approvals !== answers
  const type = options.type ?? "feature"
  const commitTiming = type === "chat" ? "slice" : config.commitTiming
  const task: Task = {
    ...(commitTiming !== "slice" ? { commitTiming } : {}),
    answers,
    ...(split ? { approvals } : {}),
    slug,
    title,
    type,
    ui: false,
    overrides: [],
    stage: type === "chat" ? "chat" : "plan",
    iterations: 0,
    ...(options.origin ? { origin: options.origin } : {}),
    created,
    repoRoot: repo.root,
    repoId: repo.id,
    dir,
    runtimeDir,
  }
  await ctx.fs.mkdir(dir)
  await ctx.fs.mkdir(runtimeDir)
  await registerProject(ctx, repo)
  const frontmatter: Frontmatter = {
    ...(commitTiming !== "slice" ? { commit_timing: commitTiming } : {}),
    answers,
    ...answerModeStamp(ctx, null, answers, "initial"),
    ...(split ? { approvals, ...approvalModeStamp(ctx, null, approvals, "initial") } : {}),
    title,
    ...(request !== title ? { request } : {}),
    type: task.type,
    ui: false,
    overrides: [],
    stage: task.stage,
    iterations: 0,
    gate: null,
    ...(options.origin ? { origin: options.origin } : {}),
    created,
    ...(reserved ? { startup_owner: reserved.owner } : {}),
    layout: LAYOUT,
  }
  const plain = type === "chat" || options.origin === "existing-plan"
  await writeNewTaskFiles(ctx, task, frontmatter, request, plain)
  await appendEvent(ctx, task, { event: "task_created", type: task.type })
  return task
}

/** Stamp a new stage into the README frontmatter. Only advance() calls this. */
export async function saveStage(
  ctx: Ctx,
  task: Task,
  stage: Stage,
  type?: TaskType,
): Promise<Task> {
  await patchReadme(ctx, task, { stage, ...(type === undefined ? {} : { type }) })
  return { ...task, stage, type: type ?? docTypeOf((await readmeFrontmatter(ctx, task)).type) }
}

export async function patchReadme(
  ctx: Ctx,
  task: Pick<Task, "dir">,
  patch: Frontmatter,
  source = "unknown",
): Promise<void> {
  const path = readmePath(task)
  const markdown = await ctx.fs.readFile(path)
  const before = parseDoc(markdown).frontmatter
  const side = (value: unknown) => (value === "app" || value === "terminal" ? value : null)
  const previous = before?.answers === "terminal" ? "terminal" : "app"
  const value = side(patch.answers)
  // Approvals without a side of their own (none, or null) follow the questions' side.
  const own = side(before?.approvals)
  const previousApprovals = own ?? previous
  const approvals = ("approvals" in patch ? side(patch.approvals) : own) ?? value ?? previous
  await ctx.fs.writeFile(
    path,
    patchFrontmatter(markdown, {
      ...patch,
      ...(value !== null && value !== previous
        ? answerModeStamp(ctx, previous, value, source)
        : {}),
      ...(approvals !== previousApprovals
        ? approvalModeStamp(ctx, previousApprovals, approvals, source)
        : {}),
    }),
  )
}

export async function readmeFrontmatter(ctx: Ctx, task: Pick<Task, "dir">): Promise<Frontmatter> {
  const path = readmePath(task)
  if (!(await ctx.fs.exists(path))) return {}
  return parseDoc(await ctx.fs.readFile(path)).frontmatter ?? {}
}
