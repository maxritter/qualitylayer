// The task store. A task's Plan file (docs/plans/<task>/01-plan.md) carries everything durable in
// its frontmatter; the runtime folder under ~/.qualitylayer carries what only matters while a
// session is alive. A folder without a Plan file (or an earlier task's 01-discuss.md) is not a task.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { filesIn } from "../../files.ts"
import { detectAgent } from "../agents/detect.ts"
import { queueTaskEvent } from "../automations/queue.ts"
import { readConfig } from "../config.ts"
import type { Answers } from "../config-values.ts"
import { noteCostSession } from "../cost/index.ts"
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
  isTaskFrontmatter,
  LAYOUT,
} from "../docs/names.ts"
import { agentsTemplateFor, docTypeOf, schemaForDoc, templateFrom } from "../docs/schema.ts"
import {
  plansDir,
  projectRuntimeDir,
  type RepoRef,
  resolveRepo,
  taskDir,
  taskRuntimeDir,
} from "../paths.ts"
import { OVERRIDES } from "../scaling.ts"
import { followsOpenPullRequest } from "../ship/pr-open.ts"
import { trimEdgeCharacters, trimEndCharacters } from "../text-boundaries.ts"
import { answerModeStamp, approvalModeStamp } from "./answer-mode.ts"
import { placeFor } from "./answers.ts"
import { bindSession, boundSlug, claimedByOthers, keyOf, sessionKey } from "./binding.ts"
import { BindingStorageError, touchBindingIndex } from "./binding-index.ts"
import { observedTarget } from "./bound-target.ts"
// Type-only import: store must not import machine values (machine imports store).
import type { Stage } from "./machine.ts"
import { STAGE_ORDER, TERMINAL_STAGES } from "./stages.ts"

export type TaskType = "feature" | "bugfix" | "chat"
/** How the task runs: a small change (one page, one build step, one review) or the full workflow. */
export type Profile = "small" | "full"

export type Task = {
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

const KNOWN_STAGES = new Set<string>(STAGE_ORDER)

/** Whether the task is of this workflow; an earlier task is read, never written. */
export const isCurrentLayout = (task: Pick<Task, "earlier">): boolean => task.earlier !== true

/** What the CLI and the App say of an earlier task. */
export const EARLIER_LAYOUT_REASON =
  "Made with the earlier seven-step workflow; it cannot be continued. Its files stay as they are: open them in Files, or start a new task."

export function slugify(words: string, maxLength = 40): string {
  const normalized = words.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  const slug = trimEndCharacters(trimEdgeCharacters(normalized, "-").slice(0, maxLength), "-")
  return slug !== "" ? slug : "task"
}

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

const TITLE_MAX = 60

const LEADING_ATTACHMENT =
  /^(?:(?:["'`‘“])(?:\/|[A-Za-z]:[\\/]|\\\\|file:\/\/)[^\r\n]*?["'`’”](?=\s|[-–—:]|$)|(?:\/|[A-Za-z]:[\\/]|\\\\|file:\/\/)[^\r\n]*?\.(?:png|jpe?g|gif|webp|avif|svg|pdf|txt|md|log|json|csv)(?=\s|$))\s*(?:[-–—:]\s*)?/i

// A separately delimited checkout/file and GitHub repository are request context, not the action.
function resourceContext(text: string): string | undefined {
  const prefix = /^(["'`‘“])?(?:\/|[A-Za-z]:[\\/]|\\\\|file:\/\/)/i.exec(text)
  if (!prefix) return undefined
  const lineEnd = text.search(/[\r\n]/)
  const repository =
    /https?:\/\/(?:www\.)?github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/?(?:[?#][^ \t\r\n]*)?[ \t]+[-–—][ \t]+/iy
  for (const separator of text.matchAll(/(?<![ \t])[ \t]+[-–—][ \t]+(?=https?:\/\/)/gi)) {
    const at = separator.index
    if (lineEnd >= 0 && at > lineEnd) break
    if (at < prefix[0].length) continue
    if (prefix[1] && !/["'`’”]/.test(text.charAt(at - 1))) continue
    repository.lastIndex = at + separator[0].length
    if (repository.test(text)) return text.slice(repository.lastIndex).trim()
  }
  return undefined
}

function provisionalTitle(words: string): string {
  let prose = words.slice(0, 8192).trim()
  let attached = false
  for (let count = 0; count < 8; count++) {
    const withoutLabel = prose.replace(/^\[Image\s*#?\d+\]\s*[-–—:]?\s*/i, "")
    const context = resourceContext(withoutLabel)
    const next =
      context && !/^["'`‘“]?(?:\/|[A-Za-z]:[\\/]|\\\\|file:\/\/|https?:\/\/)/i.test(context)
        ? context
        : withoutLabel.replace(LEADING_ATTACHMENT, "").trim()
    if (next === prose) break
    attached = true
    prose = next
  }
  prose = prose.replace(/\s+/g, " ").trim()
  let cleaned = attached
  for (let count = 0; count < 3; count++) {
    const next = prose
      .replace(/^(?:(?:hi|hey|hello)[,!:]|(?:yeah|okay|ok)[,!]?)\s+/i, "")
      .replace(
        /^(?:(?:i|we)\s+(?:would\s+(?:love|like)|want|need)\s+to|i['’]d\s+(?:love|like)\s+to|(?:can|could|would)\s+you(?:\s+please)?|please|ich\s+(?:würde\s+gerne|möchte(?:\s+gerne)?))\s+/i,
        "",
      )
    if (next === prose) break
    cleaned = true
    prose = next
  }
  const first = prose.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? prose
  const subject = first.replace(/(?: with some ideas| for me|[,;]? please)[.!]?$/i, "").trim()
  cleaned ||= subject !== first
  const sentence = cleaned ? trimEndCharacters(subject, ".") : subject
  if (!sentence) return attached ? "Review attached files" : "New task"
  return cleaned ? sentence[0]?.toLocaleUpperCase() + sentence.slice(1) : sentence
}

/**
 * The task's name in the sidebar, the README's heading and the slug. The agent
 * refines the provisional action/topic once it understands the scope. Explicit
 * names stay as supplied; the original request is always stored separately.
 */
export function taskTitle(words: string, given?: string): string {
  const named = (given ?? "").replace(/\s+/g, " ").trim()
  if (named !== "") return named.length <= TITLE_MAX ? named : cutAtWord(named)
  const sentence = provisionalTitle(words)
  return sentence.length <= TITLE_MAX ? sentence : cutAtWord(sentence)
}

function cutAtWord(text: string): string {
  const cut = text.slice(0, TITLE_MAX - 1)
  const space = cut.lastIndexOf(" ")
  return `${trimEndCharacters(space > TITLE_MAX / 2 ? cut.slice(0, space) : cut, " ,;:.-")}…`
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

/** The stored overrides, keeping only the words the scaling rules know. */
function storedOverrides(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => (OVERRIDES as readonly unknown[]).includes(v))
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
  if (
    reserved &&
    (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(reserved.slug) ||
      !/^[a-f0-9]{16}$/.test(reserved.owner) ||
      reserved.owner !== sessionKey(ctx.env))
  )
    throw new Error("invalid task startup reservation")
  const slug = reserved?.slug ?? (await reserveTaskSlug(ctx, repo, title))
  if (reserved) {
    const existing = await loadTask(ctx, repo, slug)
    if (existing !== null) {
      const fm = await readmeFrontmatter(ctx, existing)
      if (fm.startup_owner !== reserved.owner || (fm.request ?? existing.title) !== request)
        throw new Error("task startup reservation belongs to another request")
      return existing
    }
    const marker = join(taskRuntimeDir(ctx, repo.id, slug), "startup-owner.json")
    if (
      (await ctx.fs.exists(taskDir(repo.root, slug))) ||
      (await ctx.fs.exists(taskRuntimeDir(ctx, repo.id, slug)))
    ) {
      const owner = await ctx.fs
        .readFile(marker)
        .then((text) => JSON.parse(text) as { owner?: string; request?: string })
        .catch(() => null)
      if (owner && (owner.owner !== reserved.owner || owner.request !== request))
        throw new Error("unfinished task reservation belongs to another request")
      if (!owner) {
        const journal = await ctx.fs
          .readFile(
            join(projectRuntimeDir(ctx, repo.id), "sessions", `${reserved.owner}.startup.json`),
          )
          .then(
            (text) =>
              JSON.parse(text) as {
                owner?: string
                repoId?: string
                root?: string
                slug?: string
                words?: string
              },
          )
        const contents = await ctx.fs.entries(taskRuntimeDir(ctx, repo.id, slug))
        const folder = taskDir(repo.root, slug)
        const documentFolder = (await ctx.fs.exists(folder)) ? await ctx.fs.entries(folder) : []
        if (
          journal.owner !== reserved.owner ||
          journal.repoId !== repo.id ||
          journal.root !== repo.root ||
          journal.slug !== slug ||
          journal.words !== request ||
          contents.length ||
          documentFolder.length
        )
          throw new Error("unfinished task reservation has unowned files; they were kept")
        await ctx.fs.atomicWrite(marker, JSON.stringify({ owner: reserved.owner, request }))
      }
    } else {
      await ctx.fs.mkdir(taskRuntimeDir(ctx, repo.id, slug))
      await ctx.fs.atomicWrite(marker, JSON.stringify({ owner: reserved.owner, request }))
    }
  }
  const runtimeDir = taskRuntimeDir(ctx, repo.id, slug)
  const dir = taskDir(repo.root, slug)
  const config = await readConfig(ctx)
  const place = placeFor(config, ctx.env, options.answers)
  const answers = place.answers
  // Approvals follow the questions' side until someone puts them elsewhere.
  const approvals = options.approvals ?? place.approvals
  const split = approvals !== answers
  const type = options.type ?? "feature"
  const task: Task = {
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
    answers,
    ...answerModeStamp(ctx, null, answers, "initial"),
    ...(split ? { approvals, ...approvalModeStamp(ctx, null, approvals, "initial") } : {}),
    title,
    // The user's words as given; the title is only their name for the task.
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
  // A line's leading `>` marks stay a quote inside the quote (a ticket's text arrives quoted); the
  // rest is shown as typed.
  const quoted = request
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
  // The user's words, as given, under Your request: in the agents' file of a Plan, in the one file of a
  // Chat or an adopted plan.
  const withRequest = (text: string): string =>
    text.replace(
      /(## Your request\n)(?:\n<!-- fill: [\s\S]*? -->)?/,
      (_match, heading: string) => `${heading}\n${quoted}\n`,
    )
  const plain = type === "chat" || options.origin === "existing-plan"
  const schema = plain ? undefined : schemaForDoc(folderDoc("plan"), { type })
  const body =
    schema === undefined
      ? `# ${title}\n\n## Your request\n`
      : withoutBareSlots(templateFrom(schema, title))
  await ctx.fs.writeFile(readmePath(task), withFrontmatter(frontmatter, withRequest(body)))
  const agents = plain ? undefined : agentsTemplateFor(folderDoc("plan"), task, title)
  if (agents !== undefined) {
    await ctx.fs.mkdir(join(dir, AGENTS_DIR))
    await ctx.fs.writeFile(join(dir, agentFileOf("plan")), withRequest(agents))
  }
  await appendEvent(ctx, task, { event: "task_created", type: task.type })
  return task
}

/**
 * A template without the bare optional-section lines (`only when there is content: "…"`): the brief
 * names the optional sections, and those lines were only noise. A slot that says when to write its
 * section stays.
 */
export const withoutBareSlots = (template: string): string =>
  template
    .split("\n")
    .filter((line) => !line.startsWith("<!-- optional section here, only when there is content:"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")

/**
 * A task folder whose first document is there but whose front matter cannot be used: an unclosed
 * fence, or a stage this build does not know. Thrown only to readers that ask for it (`strict`),
 * which tell the person and the log; the CLI's own lookups still see no task.
 */
export class TaskUnreadable extends Error {
  override name = "TaskUnreadable"
}

/** A task whose Plan file lost its front matter: written over, so no command sees the task. */
export type LostIdentity = { slug: string; path: string; message: string; move: string }

/**
 * The task of this checkout whose `01-plan.md` has no front matter left, though QualityLayer keeps
 * its records: the one this session or `QUALITYLAYER_TASK` names, else the only such one. Its reply
 * names the folder and the move, so an agent that wrote the file over never starts the task again.
 */
export async function lostIdentity(ctx: Ctx, repo: RepoRef): Promise<LostIdentity | null> {
  const lost: string[] = []
  for (const slug of await listDir(ctx, plansDir(repo.root))) {
    const file = join(taskDir(repo.root, slug), IDENTITY_FILE)
    if (!(await ctx.fs.exists(file))) continue
    if (!(await ctx.fs.exists(join(taskRuntimeDir(ctx, repo.id, slug), "events.ndjson")))) continue
    if (parseDoc(await ctx.fs.readFile(file)).frontmatter === null) lost.push(slug)
  }
  const key = sessionKey(ctx.env)
  const named =
    ctx.env.get("QUALITYLAYER_TASK") || (key !== null ? boundSlug(ctx, repo.id, key) : null)
  const slug = lost.find((s) => s === named) ?? (lost.length === 1 ? lost[0] : undefined)
  if (slug === undefined) return null
  const path = `${plansDir(repo.root).slice(repo.root.length + 1)}/${slug}/${IDENTITY_FILE}`
  const past = await pastPlan(ctx, taskRuntimeDir(ctx, repo.id, slug))
  return {
    slug,
    path,
    message: past
      ? `Task ${slug} is open, but ${path} lost its front matter (the task's identity) after the Plan was approved. Put the approved file back: git checkout -- ${path}, or restore its front matter by hand.`
      : `Task ${slug} is open, but ${path} lost its front matter (the task's identity). Run \`qualitylayer plan draft\`: it puts the front matter back and keeps what you wrote. Never start the task again.`,
    move: past ? `git checkout -- ${path}` : "qualitylayer plan draft",
  }
}

/** Whether a task's records show it past Plan (approved or building). */
async function pastPlan(ctx: Ctx, runtimeDir: string): Promise<boolean> {
  const events = await ctx.fs.readFile(join(runtimeDir, "events.ndjson")).catch(() => "")
  return /"event":"(?:gate_approved|implement_started)"/.test(events)
}

/**
 * `plan draft` on a task in Plan whose `01-plan.md` lost its front matter: write the front matter a
 * new task has back above what the agent wrote (title from its heading, type from the task's
 * record), so the task is seen again. Returns the restored slug, or null when nothing was lost.
 */
export async function restoreLostIdentity(ctx: Ctx, repo: RepoRef): Promise<string | null> {
  const lost = await lostIdentity(ctx, repo)
  if (lost === null) return null
  const runtimeDir = taskRuntimeDir(ctx, repo.id, lost.slug)
  if (await pastPlan(ctx, runtimeDir)) return null
  const file = join(repo.root, lost.path)
  const body = await ctx.fs.readFile(file)
  const events = (await ctx.fs.readFile(join(runtimeDir, "events.ndjson")))
    .split("\n")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as { ts?: number; event?: string; type?: string }]
      } catch {
        return []
      }
    })
  const created = events.find((e) => e.event === "task_created")
  const title = body.match(/^# (.+)$/m)?.[1]?.trim() || lost.slug
  const { answers } = placeFor(await readConfig(ctx), ctx.env)
  const frontmatter: Frontmatter = {
    answers,
    title,
    type: docTypeOf(created?.type),
    ui: false,
    overrides: [],
    stage: "plan",
    iterations: 0,
    gate: null,
    created: created?.ts ?? ctx.clock.now(),
    layout: LAYOUT,
  }
  await ctx.fs.writeFile(file, withFrontmatter(frontmatter, body))
  await appendEvent(ctx, { runtimeDir }, { event: "identity_restored" })
  return lost.slug
}

async function taskFromReadme(
  ctx: Ctx,
  repo: Pick<RepoRef, "root" | "id">,
  slug: string,
  dir: string,
  strict = false,
): Promise<Task | null> {
  const files = await filesIn(ctx.fs, dir)
  const identity = files.includes(IDENTITY_FILE)
    ? IDENTITY_FILE
    : files.includes(EARLIER_IDENTITY_FILE)
      ? EARLIER_IDENTITY_FILE
      : null
  if (identity === null) return null
  const { frontmatter } = parseDoc(await ctx.fs.readFile(join(dir, identity)))
  if (frontmatter === null) {
    if (strict) throw new TaskUnreadable("the front matter has no closing fence")
    return null
  }
  // A folder whose identity file names no layout is not a task. One made with the earlier workflow
  // (its identity file is 01-discuss.md, or its layout is another) is listed as ended and read-only.
  const earlier = identity === EARLIER_IDENTITY_FILE || !isTaskFrontmatter(frontmatter)
  if (earlier && typeof frontmatter.layout !== "string") return null
  const stored = typeof frontmatter.stage === "string" ? frontmatter.stage : null
  if (!earlier && (stored === null || !KNOWN_STAGES.has(stored))) {
    if (strict) throw new TaskUnreadable("the front matter names no known stage")
    return null
  }
  let stage = earlier ? (stored === "shipped" ? "shipped" : "abandoned") : (stored as string)
  // A crash between the final approval and its closing leaves the task on Verify, where it finishes.
  if (
    !earlier &&
    stage === "shipped" &&
    (await ctx.fs.exists(join(taskRuntimeDir(ctx, repo.id, slug), "closing-pending")))
  )
    stage = "verify"
  const iterations = typeof frontmatter.iterations === "number" ? frontmatter.iterations : 0
  return {
    slug,
    answers: frontmatter.answers === "terminal" ? "terminal" : "app",
    ...(frontmatter.approvals === "terminal" || frontmatter.approvals === "app"
      ? { approvals: frontmatter.approvals }
      : {}),
    title: typeof frontmatter.title === "string" ? frontmatter.title : slug,
    type: docTypeOf(frontmatter.type),
    ui: frontmatter.ui === true,
    ...(frontmatter.profile === "small" ? { profile: "small" as const } : {}),
    overrides: storedOverrides(frontmatter.overrides),
    stage: stage as Stage,
    iterations,
    ...(typeof frontmatter.branch === "string" && frontmatter.branch !== ""
      ? { branch: frontmatter.branch }
      : {}),
    ...(frontmatter.origin === "existing-plan" ? { origin: "existing-plan" as const } : {}),
    ...(earlier ? { earlier: true as const } : {}),
    created: typeof frontmatter.created === "number" ? frontmatter.created : 0,
    repoRoot: repo.root,
    repoId: repo.id,
    dir,
    runtimeDir: taskRuntimeDir(ctx, repo.id, slug),
  }
}

/** The task of one slug, or null. With `strict`, a folder with unusable front matter throws `TaskUnreadable`. */
export async function loadTask(
  ctx: Ctx,
  repo: RepoRef | Pick<RepoRef, "root" | "id">,
  slug: string,
  strict = false,
): Promise<Task | null> {
  return taskFromReadme(ctx, repo, slug, taskDir(repo.root, slug), strict)
}

async function listDir(ctx: Ctx, dir: string): Promise<string[]> {
  if (!(await ctx.fs.exists(dir))) return []
  try {
    // Flat Pilot plans are discovered separately; only folders can hold current tasks.
    return (await ctx.fs.entries(dir))
      .filter((entry) => entry.kind === "directory")
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Every task of this repository visible from this checkout. A task folder that cannot be read is
 * left out (and handed to `onBroken`): one broken task never hides the others.
 */
export async function listTasks(
  ctx: Ctx,
  repo: RepoRef,
  onBroken?: (folder: string, error: unknown) => void,
): Promise<Task[]> {
  const tasks: Task[] = []
  for (const entry of await listDir(ctx, plansDir(repo.root))) {
    try {
      const task = await taskFromReadme(ctx, repo, entry, taskDir(repo.root, entry), true)
      if (task !== null) tasks.push(task)
    } catch (error) {
      onBroken?.(taskDir(repo.root, entry), error)
    }
  }
  return tasks
}

/**
 * The open task this command is about: an explicit slug (--task), else the one
 * the user's words name (a handoff names its plan folder), else the one this
 * session works on, else the task whose branch is checked out, else the newest
 * open task no other session is working on.
 *
 * A shipped task whose pull request is followed and open is an open task too (the review triage
 * and its fix round run on it); it never takes the place of a task still being worked on when
 * nothing else names it, and a merged or closed pull request leaves it closed.
 */
export async function resolveTask(ctx: Ctx, repo: RepoRef, words = ""): Promise<Task | null> {
  const explicit = ctx.env.get("QUALITYLAYER_TASK")
  if (explicit !== undefined && explicit !== "") return loadTask(ctx, repo, explicit)

  // An archived task is put away: it is only picked up when named explicitly.
  const listed = await listTasks(ctx, repo)
  const open: Task[] = []
  for (const t of listed) {
    if (isTerminal(t.stage) && !(await followsOpenPullRequest(ctx, t))) continue
    if (!(await ctx.fs.exists(join(t.runtimeDir, "archived.json")))) open.push(t)
  }
  if (open.length === 0) return null

  const said = words.toLowerCase()
  const named = open
    .filter((t) => said.includes(t.slug))
    .sort((a, b) => b.slug.length - a.slug.length)[0]
  if (named !== undefined) return named

  const key = sessionKey(ctx.env)
  const bound = key !== null ? boundSlug(ctx, repo.id, key) : null
  const mine = open.find((t) => t.slug === bound)
  if (mine !== undefined) return mine
  if (open.length === 1) return open[0] ?? null

  // The branch is the user's: it names a task only when that task alone started on it.
  const branch = await ctx.git.run(repo.root, ["branch", "--show-current"])
  const current = branch.code === 0 ? branch.stdout.trim() : ""
  const onBranch = open.filter((t) => current !== "" && t.branch === current)
  if (onBranch.length === 1) return onBranch[0] ?? null

  const claimed = await claimedByOthers(ctx, repo.id, key)
  const free = open.filter((t) => !claimed.has(t.slug))
  const pool = free.length > 0 ? free : open
  const working = pool.filter((t) => t.stage !== "shipped")
  return (
    [...(working.length > 0 ? working : pool)].sort(
      (a, b) => b.created - a.created || b.slug.localeCompare(a.slug),
    )[0] ?? null
  )
}

/**
 * The open task this process is bound to, and only that: the one `QUALITYLAYER_TASK` names or the
 * one its own session works on. Unlike `resolveTask` it never guesses from the branch, the only
 * open task or the newest one, so a plain session is never counted as another task's work.
 */
export async function resolveBoundTask(ctx: Ctx, repo: RepoRef): Promise<Task | null> {
  const explicit = ctx.env.get("QUALITYLAYER_TASK")
  if (explicit !== undefined && explicit !== "") return loadTask(ctx, repo, explicit)
  const key = sessionKey(ctx.env)
  const bound = key !== null ? boundSlug(ctx, repo.id, key) : null
  if (bound === null) return null
  const task = await resolveTask(ctx, repo)
  return task?.slug === bound ? task : null
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

export async function appendEvent(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  event: Record<string, unknown>,
): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  const record = { ts: ctx.clock.now(), ...event }
  await ctx.fs.append(join(task.runtimeDir, "events.ndjson"), `${JSON.stringify(record)}\n`)
  // Automations: queued for each that wants it; never throws, never waits on the network.
  await queueTaskEvent(ctx, task, record)
}

export async function readEvents(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<Record<string, unknown>[]> {
  const path = join(task.runtimeDir, "events.ndjson")
  if (!(await ctx.fs.exists(path))) return []
  const events: Record<string, unknown>[] = []
  for (const line of (await ctx.fs.readFile(path)).split("\n")) {
    if (line.trim() === "") continue
    try {
      events.push(JSON.parse(line) as Record<string, unknown>)
    } catch {
      // a torn line from a crashed writer is skipped, never fatal
    }
  }
  return events
}

export type Session = {
  agent: string
  phase: string
  state: "busy" | "waiting"
  heartbeat: number
  since: number
  checkout: string
}

export async function readSession(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<Session | null> {
  const path = join(task.runtimeDir, "session.json")
  if (!(await ctx.fs.exists(path))) return null
  try {
    return JSON.parse(await ctx.fs.readFile(path)) as Session
  } catch {
    return null
  }
}

export async function touchSession(
  ctx: Ctx,
  task: Task,
  agent: string,
  state: "busy" | "waiting" = "busy",
  options: { bind?: boolean } = {},
): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  const previous = await readSession(ctx, task)
  const now = ctx.clock.now()
  const unchanged = previous !== null && previous.state === state && previous.phase === task.stage
  // An unknown caller (a human in a terminal) never overwrites the agent badge.
  const keptAgent = agent === "unknown" && previous !== null ? previous.agent : agent
  const session: Session = {
    agent: keptAgent,
    phase: task.stage,
    state,
    heartbeat: now,
    since: unchanged ? previous.since : now,
    // The build's checkout is sticky: it is where the task lives.
    checkout: previous?.checkout ?? task.repoRoot,
  }
  // The calling session now works on this task; its status line and its next
  // command follow it, whatever other sessions pick up. A session that only asks about or waits
  // on a task it names keeps its own binding.
  const key = ctx.visitsTask ? sessionKey(ctx.env) : null
  const visiting = key !== null && boundSlug(ctx, task.repoId, key) !== task.slug
  if (options.bind !== false && !visiting) {
    await bindSession(ctx, task)
  }
  await ctx.fs.writeFile(
    join(task.runtimeDir, "session.json"),
    `${JSON.stringify(session, null, 2)}\n`,
  )
  if (options.bind !== false && !visiting) {
    // Its raw id stays local, for the cost view to find its transcript.
    await noteCostSession(ctx, task)
  }
}

/** A tool call of the agent's session writes its heartbeat at most this often. */
const TOOL_CALL_QUIET_MS = 30_000

/**
 * The agent working on the open task of this directory just did something, so its session is
 * alive. A QualityLayer command keeps the state the session is in (a gate's wait stays a wait); a
 * tool call, reported by the agent's hook after every tool, means it works, and writes at most
 * once per 30 s. Passive failures do not interrupt tools; an explicit command must
 * report a failed session-claim admission rather than continuing as if it joined.
 */
export async function keepAlive(
  ctx: Ctx,
  source: "command" | "tool",
  sessionId?: string,
): Promise<void> {
  try {
    const key = sessionId ? keyOf(sessionId) : sessionKey(ctx.env)
    const target = source === "tool" && key !== null ? await observedTarget(ctx, key) : null
    if (target?.kind === "blocked") return
    const repo =
      target?.kind === "bound" ? { ok: true as const, data: target.repo } : await resolveRepo(ctx)
    if (!repo.ok) return
    // A command that names its task (`--task`) joins it: this session works on it from now on,
    // from whichever home it runs.
    // A visit (a question, a wait) keeps the session's own task alive instead.
    const named =
      source === "command" && !ctx.visitsTask ? ctx.env.get("QUALITYLAYER_TASK") : undefined
    const slug =
      target?.kind === "bound"
        ? target.slug
        : named !== undefined && named !== ""
          ? named
          : key !== null
            ? boundSlug(ctx, repo.data.id, key)
            : null
    const task = slug !== null ? await loadTask(ctx, repo.data, slug) : null
    if (task === null) return
    const previous = await readSession(ctx, task)
    if (source === "tool") {
      if (previous !== null && ctx.clock.now() - previous.heartbeat < TOOL_CALL_QUIET_MS) return
      if (target?.kind === "bound" && key !== null)
        await touchBindingIndex(ctx, key, {
          repoId: target.repo.id,
          slug: target.slug,
          at: target.generation,
        })
      await touchSession(ctx, task, detectAgent(ctx.env), "busy", { bind: false })
    } else {
      await touchSession(ctx, task, detectAgent(ctx.env), previous?.state ?? "busy")
    }
  } catch (cause) {
    if (source === "command" && cause instanceof BindingStorageError) throw cause
    // Passive heartbeat failure must not interrupt a native tool.
  }
}

export async function setCheckout(ctx: Ctx, task: Task, checkout: string): Promise<void> {
  const session = await readSession(ctx, task)
  if (session === null) return
  await ctx.fs.writeFile(
    join(task.runtimeDir, "session.json"),
    `${JSON.stringify({ ...session, checkout }, null, 2)}\n`,
  )
}
