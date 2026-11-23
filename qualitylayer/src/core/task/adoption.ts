// A task that starts from a plan the person already has (`qualitylayer next --from-plan <file|->`).
// The plan is kept exactly as given, as original-plan.md beside the task's documents; one record says
// where it came from and its digest; the task starts at the Plan, where the planner maps the original
// onto what QualityLayer checks. The original is evidence, never instruction or approval: only the
// person's Plan approval, which binds the original's digest (gate/revision.ts), counts.

import { createHash } from "node:crypto"
import { basename, extname, isAbsolute, join, resolve } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { detectAgent } from "../agents/detect.ts"
import type { Answers } from "../config-values.ts"
import { RECORDS_DIR } from "../docs/names.ts"
import { projectRuntimeDir, type RepoRef } from "../paths.ts"
import { sessionKey } from "./binding.ts"
import { advance } from "./machine.ts"
import { startTask } from "./startup.ts"
import { loadTask, patchReadme, type Task } from "./store.ts"

/** The person's plan, kept byte for byte beside the task's documents. */
export const ORIGINAL_FILE = "original-plan.md"
/** The name a plan pasted into the App's New task travels under, among the launch's files. */
export const PASTED_PLAN_FILE = "pasted-plan.md"
/** Where the plan came from and its digest. */
export const ADOPTION_RECORD = `${RECORDS_DIR}/adoption.json`
/** A plan is a document, not a data dump: larger sources are refused rather than truncated. */
export const ORIGINAL_MAX_BYTES = 512 * 1024
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"])

export type OriginalSource =
  /** A Markdown or text file on this computer; its bytes are kept, its folder is not recorded. */
  | { kind: "file"; path: string }
  /** Text handed over directly (stdin, a pasted plan): kept exactly as submitted. */
  | { kind: "pasted"; bytes: Uint8Array }

export type AdoptionRecord = {
  version: 1
  /** The source's kind and, for a file, its name only; a local folder path is not kept or shared. */
  source: { kind: "file" | "pasted" | "chat-plan"; name?: string }
  /** The agent that supplied the plan, as detected; `unknown` when none is. */
  supplier: string
  adopted_at: number
  original: { file: typeof ORIGINAL_FILE; sha256: string; bytes: number }
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const refused = (message: string) => err({ code: "bad_args", message })

/** Byte signatures of files that are not a plan's text: PDF, PNG, JPEG, GIF, ZIP (docx, xlsx…). */
const BINARY_MAGIC: [string, number[]][] = [
  ["a PDF", [0x25, 0x50, 0x44, 0x46]],
  ["a PNG image", [0x89, 0x50, 0x4e, 0x47]],
  ["a JPEG image", [0xff, 0xd8, 0xff]],
  ["a GIF image", [0x47, 0x49, 0x46, 0x38]],
  ["a ZIP archive or Office document", [0x50, 0x4b, 0x03, 0x04]],
]

function checkOriginalBytes(bytes: Uint8Array, name?: string): string | null {
  if (name !== undefined && !TEXT_EXTENSIONS.has(extname(name).toLowerCase()))
    return `${basename(name)} is not a Markdown or text file. Give the plan as one .md, .markdown or .txt file, or pipe its text with --from-plan -.`
  if (bytes.length > ORIGINAL_MAX_BYTES)
    return `The plan is ${Math.ceil(bytes.length / 1024)} KB; an original plan can be at most ${ORIGINAL_MAX_BYTES / 1024} KB.`
  const binary = BINARY_MAGIC.find(([, magic]) => magic.every((byte, i) => bytes[i] === byte))
  if (binary)
    return `The plan is ${binary[0]}, not Markdown or text. Attach it as context and give the plan's text instead.`
  if (bytes.includes(0)) return "The plan holds binary data. Give it as Markdown or plain text."
  return null
}

/**
 * Whether bytes can be an original plan: one UTF-8 Markdown or text document, not empty, within the
 * size bound. A PDF, an image or any binary file is refused; it can travel as context, never as the
 * plan. Returns the text exactly as the bytes hold it (a BOM and CRLF line ends included).
 */
export function checkOriginal(bytes: Uint8Array, name?: string): Result<string> {
  const byteIssue = checkOriginalBytes(bytes, name)
  if (byteIssue !== null) return refused(byteIssue)
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return refused("The plan is not valid UTF-8 text. Save it as UTF-8 and try again.")
  }
  return text.replace(/^﻿/, "").trim() === "" ? refused("The plan is empty.") : ok(text)
}

/** The source's bytes, read once. A file is read as a regular file, refusing a link in its place. */
async function sourceBytes(
  ctx: Ctx,
  source: OriginalSource,
): Promise<Result<{ bytes: Uint8Array; name?: string }>> {
  if (source.kind === "pasted") return ok({ bytes: source.bytes })
  const path = isAbsolute(source.path) ? source.path : resolve(ctx.env.cwd(), source.path)
  if (!(await ctx.fs.exists(path))) return refused(`No plan file at ${source.path}.`)
  try {
    const bytes = ctx.fs.readRegularFile
      ? await ctx.fs.readRegularFile(path, ORIGINAL_MAX_BYTES + 1)
      : ctx.fs.readBytes
        ? await ctx.fs.readBytes(path)
        : new TextEncoder().encode(await ctx.fs.readFile(path))
    return ok({ bytes, name: basename(path) })
  } catch (cause) {
    return refused(
      `The plan file could not be read as a regular file: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}

export const isAdopted = (task: Pick<Task, "origin">): boolean => task.origin === "existing-plan"
export const originalPath = (task: Pick<Task, "dir">): string => join(task.dir, ORIGINAL_FILE)

export async function readAdoption(
  ctx: Ctx,
  task: Pick<Task, "dir">,
): Promise<AdoptionRecord | null> {
  const path = join(task.dir, ADOPTION_RECORD)
  if (!(await ctx.fs.exists(path))) return null
  try {
    const record = JSON.parse(await ctx.fs.readFile(path)) as AdoptionRecord
    return record?.version === 1 && typeof record.original?.sha256 === "string" ? record : null
  } catch {
    return null
  }
}

/** The digest of original-plan.md as it is on disk now, or `missing`. */
export async function originalDigest(ctx: Ctx, task: Pick<Task, "dir">): Promise<string> {
  const path = originalPath(task)
  if (!(await ctx.fs.exists(path))) return "missing"
  const bytes = ctx.fs.readBytes
    ? await ctx.fs.readBytes(path)
    : new TextEncoder().encode(await ctx.fs.readFile(path))
  return sha256(bytes)
}

/**
 * Whether the original is still the plan the person handed over: the file's digest equals the one its
 * record holds. A changed, missing or unrecorded original is not intact.
 */
export async function originalIntact(ctx: Ctx, task: Pick<Task, "dir">): Promise<boolean> {
  const record = await readAdoption(ctx, task)
  return record !== null && record.original.sha256 === (await originalDigest(ctx, task))
}

/** The refusal an adopted task's Plan gate gives while its original differs from its record. */
export const ORIGINAL_CHANGED = `${ORIGINAL_FILE} is not the plan that was handed over: its digest differs from ${ADOPTION_RECORD}. The original is never edited; restore it, or start a new task from the changed plan.`

type AdoptOptions = { type?: "feature" | "bugfix"; title?: string; answers?: Answers }

/** The first Markdown heading of the plan, as the task's name when none is given. */
function headingOf(text: string): string | undefined {
  const line = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .find((l) => /^#{1,3}\s+\S/.test(l))
  return line
    ?.replace(/^#{1,3}\s+/, "")
    .replace(/^plan:\s*/i, "")
    .trim()
}

async function resumedAdoptedTask(
  ctx: Ctx,
  repo: RepoRef,
  journal: string | null,
  digest: string,
): Promise<Task | null> {
  if (journal === null || !(await ctx.fs.exists(journal))) return null
  const previous = await ctx.fs
    .readFile(journal)
    .then((text) => JSON.parse(text) as { sha256?: string; slug?: string })
    .catch(() => null)
  if (previous?.sha256 !== digest || typeof previous.slug !== "string") return null
  const task = await loadTask(ctx, repo, previous.slug)
  return task !== null && isAdopted(task) && (await originalIntact(ctx, task)) ? task : null
}

async function ensureAdoptionRecord(
  ctx: Ctx,
  task: Task,
  params: {
    sourceKind: OriginalSource["kind"]
    name?: string
    text: string
    digest: string
    byteLength: number
  },
): Promise<Result<void>> {
  if ((await readAdoption(ctx, task)) !== null) {
    return (await originalIntact(ctx, task)) ? ok(undefined) : refused(ORIGINAL_CHANGED)
  }
  const record: AdoptionRecord = {
    version: 1,
    source: {
      kind: params.sourceKind,
      ...(params.name !== undefined ? { name: params.name } : {}),
    },
    supplier: detectAgent(ctx.env),
    adopted_at: ctx.clock.now(),
    original: { file: ORIGINAL_FILE, sha256: params.digest, bytes: params.byteLength },
  }
  await ctx.fs.atomicWrite(originalPath(task), params.text)
  if ((await originalDigest(ctx, task)) !== params.digest) {
    await ctx.fs.remove(originalPath(task))
    return refused("The plan could not be stored byte for byte; nothing was adopted.")
  }
  await ctx.fs.mkdir(join(task.dir, RECORDS_DIR))
  await ctx.fs.atomicWrite(join(task.dir, ADOPTION_RECORD), `${JSON.stringify(record, null, 2)}\n`)
  return ok(undefined)
}

async function readValidatedSource(
  ctx: Ctx,
  source: OriginalSource,
): Promise<Result<{ bytes: Uint8Array; name?: string; text: string; digest: string }>> {
  const read = await sourceBytes(ctx, source)
  if (!read.ok) return read
  const checked = checkOriginal(read.data.bytes, read.data.name)
  if (!checked.ok) return checked
  return ok({
    bytes: read.data.bytes,
    name: read.data.name,
    text: checked.data,
    digest: sha256(read.data.bytes),
  })
}

async function createAndRecordAdoptedTask(
  ctx: Ctx,
  repo: RepoRef,
  params: {
    sourceKind: OriginalSource["kind"]
    bytes: Uint8Array
    name?: string
    text: string
    digest: string
    options: AdoptOptions
  },
): Promise<Result<{ task: Task; created: boolean }>> {
  const title = params.options.title ?? headingOf(params.text) ?? params.name ?? "Existing plan"
  const started = await startTask(
    ctx,
    repo,
    `Implement the existing plan in ${ORIGINAL_FILE} (sha256 ${params.digest.slice(0, 12)}).`,
    {
      title,
      type: params.options.type ?? "feature",
      answers: params.options.answers,
      origin: "existing-plan",
    },
  )
  if (!started.ok) return started
  const task = started.data.task
  if (!isAdopted(task))
    return refused(
      "The startup reservation belongs to a task that did not start from a plan; nothing was changed.",
    )
  // A new task starts at the Plan: its original and record are written once, before anything reads them.
  const recorded = await ensureAdoptionRecord(ctx, task, {
    sourceKind: params.sourceKind,
    name: params.name,
    text: params.text,
    digest: params.digest,
    byteLength: params.bytes.length,
  })
  return recorded.ok ? ok({ task, created: started.data.created }) : recorded
}

/**
 * Start a task from the person's plan: check the source, create the task at the Plan, and keep the
 * bytes as original-plan.md with their record. A session that sends the same plan again continues
 * the task it already started.
 */
export async function adoptExistingPlan(
  ctx: Ctx,
  repo: RepoRef,
  source: OriginalSource,
  options: AdoptOptions = {},
): Promise<Result<{ task: Task; created: boolean }>> {
  const validated = await readValidatedSource(ctx, source)
  if (!validated.ok) return validated
  const { bytes, name, text, digest } = validated.data
  const key = sessionKey(ctx.env)
  const journal = key
    ? join(projectRuntimeDir(ctx, repo.id), "sessions", `${key}.adopted.json`)
    : null
  // A retry of the same plan from this session continues its task, whatever step it reached.
  const resumed = await resumedAdoptedTask(ctx, repo, journal, digest)
  if (resumed !== null) return ok({ task: resumed, created: false })
  const adopted = await createAndRecordAdoptedTask(ctx, repo, {
    sourceKind: source.kind,
    bytes,
    name,
    text,
    digest,
    options,
  })
  if (adopted.ok && journal !== null) {
    await ctx.fs.mkdir(join(projectRuntimeDir(ctx, repo.id), "sessions"))
    await ctx.fs.atomicWrite(
      journal,
      `${JSON.stringify({ sha256: digest, slug: adopted.data.task.slug })}\n`,
    )
  }
  return adopted
}

async function readChatPlan(
  ctx: Ctx,
  task: Task,
): Promise<Result<{ bytes: Uint8Array; text: string }>> {
  if (task.type !== "chat" || task.stage !== "chat")
    return refused("Only an active Chat starts the workflow from its saved plan")
  const planPath = join(task.dir, "chat-plan.md")
  if (!(await ctx.fs.exists(planPath)))
    return refused(
      "This Chat has no saved plan. Save one first, or convert the Chat to a task at the Plan.",
    )
  const bytes = ctx.fs.readBytes
    ? await ctx.fs.readBytes(planPath)
    : new TextEncoder().encode(await ctx.fs.readFile(planPath))
  const checked = checkOriginal(bytes, "chat-plan.md")
  return checked.ok ? ok({ bytes, text: checked.data }) : checked
}

/**
 * A Chat becomes a Feature or Bugfix from its saved plan: chat-plan.md is kept byte for byte as the
 * original, with its record, and the task enters the Plan (`plan_adopted`, the only kind change besides
 * `workflow_started`). Called by `promoteChat` under the Chat's lock, after its helpers are checked.
 * On any failure the Chat is left as it was.
 */
export async function adoptChatPlan(
  ctx: Ctx,
  task: Task,
  type: "feature" | "bugfix",
  options: { beforeAdvance?: () => void } = {},
): Promise<Result<Task>> {
  const plan = await readChatPlan(ctx, task)
  if (!plan.ok) return plan
  const { bytes, text } = plan.data
  const digest = sha256(bytes)
  const record: AdoptionRecord = {
    version: 1,
    source: { kind: "chat-plan", name: "chat-plan.md" },
    supplier: detectAgent(ctx.env),
    adopted_at: ctx.clock.now(),
    original: { file: ORIGINAL_FILE, sha256: digest, bytes: bytes.length },
  }
  const undo = async () => {
    await ctx.fs.remove(originalPath(task))
    await ctx.fs.remove(join(task.dir, ADOPTION_RECORD))
    await patchReadme(ctx, task, { origin: null })
  }
  await ctx.fs.atomicWrite(originalPath(task), text)
  if ((await originalDigest(ctx, task)) !== digest) {
    await undo()
    return refused("The saved plan could not be stored byte for byte; the Chat is unchanged.")
  }
  await ctx.fs.mkdir(join(task.dir, RECORDS_DIR))
  await ctx.fs.atomicWrite(join(task.dir, ADOPTION_RECORD), `${JSON.stringify(record, null, 2)}\n`)
  await patchReadme(ctx, task, { origin: "existing-plan" })
  options.beforeAdvance?.()
  const entered = await advance(ctx, { ...task, origin: "existing-plan" }, "plan_adopted", { type })
  if (!entered.ok) await undo()
  return entered
}
