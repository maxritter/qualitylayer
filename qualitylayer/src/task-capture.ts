// What a task leaves behind as lessons: standing human decisions and accepted or checked technical
// findings. Each source is saved once, under a key that names it (`q:q1`, `review:verify:2`,
// `amend:<time>`), so a later reply updates a lesson instead of adding a
// second one, and a crash retries only what is missing. `memory-captured.json` in the task's runtime
// folder maps each key to the hash of the text it was saved from.

import { basename, join } from "node:path"
import { replaceInlineLinksOnLines } from "./core/docs/inline-links.ts"
import { MEMORY_CAPTURED_MAX_BYTES } from "./core/home-caps.ts"
import { MEMORY_RETIRED, type MemoryService } from "./core/memory/index.ts"
import { cutChars } from "./core/memory/ranking.ts"
import { hash, relativeFile } from "./core/memory/validation.ts"
import { recordMemoryActivity } from "./core/memory-activity.ts"
import { readNeeds } from "./core/need/need.ts"
import { reviewFile } from "./core/review/cross.ts"
import { inPersonReview } from "./core/review/in-review.ts"
import { reviewFindings } from "./core/task/items.ts"
import { isNeedAvailabilityAnswer } from "./core/task/planning-answers.ts"
import { type AnsweredQuestion, answeredQuestions } from "./core/task/question.ts"
import { readEvents, type Task } from "./core/task/store.ts"
import type { Ctx } from "./ctx.ts"
import { ANSWER_TAG, type MemoryKind } from "./memory-contracts.ts"
import { memoryService } from "./memory-runtime.ts"
import { namedFiles } from "./task-memory.ts"

export type CaptureCounts = { saved: number; unchanged: number; failed: number }

const TITLE_MAX = 120

type Source = {
  key: string
  kind: MemoryKind
  title: string
  content: string
  /** A fix or discovery: published as verified only when Verify's last judgement passed. */
  needsChecks: boolean
  /** The person's own answer: tagged, kept on this computer and never matched at a session start. */
  answer?: true
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()
const headline = (text: string) => {
  const first = oneLine(text).split(/(?<=[.!?])\s/)[0] ?? ""
  if (first.length <= TITLE_MAX) return first
  const cut = cutChars(first, TITLE_MAX)
  const boundary = cut.search(/\s+\S*$/)
  return boundary < 0 ? "" : cut.slice(0, boundary).trim()
}

/** Normalize before the review parser clips its headline, so a local link cannot consume it. */
function lessonText(text: string, task: Task): string | null {
  const root = task.repoRoot.replace(/[\\/]$/, "")
  const local = text
    .replaceAll(`file://${root}/`, "")
    .replaceAll(`${root}/`, "")
    .replaceAll(`${root}\\`, "")
  // A path outside this repository has no honest repository-relative replacement.
  if (/(?:\/Users\/|\/home\/|[A-Z]:[\\/]Users[\\/]|~[\\/])/i.test(local)) return null
  const links = replaceInlineLinksOnLines(local, (label, target) =>
    /^(?:https?:|mailto:)/i.test(target) ? `${label} (${target})` : target,
  )
  return links
    .replace(/^([^\S\r\n\u2028\u2029]*(?:\d+[.)][ \t]+)?)\[P\d\][ \t]*/gim, "$1")
    .replace(
      /`([^`\n]+)`|\*\*([^\n]+?)\*\*|(?<![\w/])__([^_\n]+)__(?![\w.])/g,
      (_, code: string | undefined, strong: string | undefined, emphasis: string | undefined) =>
        code ?? strong ?? emphasis ?? "",
    )
    .trim()
}

/** Deferral and a spent judge budget leave technical records in the task, not project knowledge. */
async function captureStatus(
  ctx: Ctx,
  task: Task,
): Promise<{ verified: boolean; accepted: boolean }> {
  // Verified: Verify's last judgement passed (a kept-red review or a spent budget passed none).
  const judged = (await readEvents(ctx, task)).findLast((event) => event.event === "verify_result")
  const verified = judged?.passed === true
  // Accepted: checked or shipped.
  return { verified, accepted: verified || task.stage === "shipped" }
}

async function sourcesOf(ctx: Ctx, task: Task): Promise<Source[]> {
  const sources: Source[] = []
  // Answers recorded on a gate belong to the gate, not to the project's knowledge.
  // The history keeps every answer, including one the person undid and answered again: only the
  // latest entry of a question counts, and it counts only while it stands.
  const latest = new Map<string, AnsweredQuestion>()
  const [answers, needs] = await Promise.all([answeredQuestions(ctx, task), readNeeds(ctx, task)])
  for (const entry of answers) if (entry.id) latest.set(entry.id, entry)
  for (const [id, answered] of latest) {
    if (
      isNeedAvailabilityAnswer(answered, needs) ||
      answered.reopened ||
      answered.gate !== undefined ||
      !answered.choice?.trim()
    )
      continue
    const question = lessonText(answered.question, task)
    const choice = lessonText(answered.choice, task)
    if (question === null || choice === null) continue
    const title = headline(question)
    if (title)
      sources.push({
        key: `q:${cutChars(id, 150)}`,
        kind: "decision",
        title,
        content: `${oneLine(question)}\n\nDecided with you: ${choice}`,
        needsChecks: false,
        answer: true,
      })
  }
  const review = reviewFile(task, "verify")
  if (await ctx.fs.exists(review)) {
    const blocks = (await ctx.fs.readFile(review))
      .split(/(?=^[ \t]*\d+[.)][ \t])/m)
      .filter((block) => /^[ \t]*\d+[.)][ \t]/.test(block))
    for (const [index, block] of blocks.entries()) {
      const normalized = lessonText(block, task)
      if (normalized === null) continue
      const finding = reviewFindings(normalized)[0]
      if (finding?.stance !== "taken" || !finding.answer) continue
      const title = headline(finding.what)
      if (!title) continue
      sources.push({
        key: `review:verify:${index + 1}`,
        kind: "bugfix",
        title,
        content: `${[finding.what, finding.detail].filter(Boolean).join(" ")}\n\nFixed: ${finding.answer}`,
        needsChecks: true,
      })
    }
  }
  const seen = new Set<number>()
  for (const event of await readEvents(ctx, task)) {
    if (event.event !== "plan_amended" || event.by !== "agent") continue
    if (typeof event.note !== "string" || typeof event.ts !== "number") continue
    if (!event.note.trim()) continue
    // Keep collision keys stable even when another amendment contains a private path.
    let stamp = event.ts
    while (seen.has(stamp)) stamp += 0.5
    seen.add(stamp)
    const note = lessonText(event.note, task)
    if (note === null) continue
    const title = headline(note.split("\n")[0] ?? "")
    if (!title) continue
    sources.push({
      key: `amend:${stamp}`,
      kind: "discovery",
      title,
      content: note,
      needsChecks: true,
    })
  }
  return sources
}

type Captured = { keys: Record<string, string> }

async function readCaptured(ctx: Ctx, path: string): Promise<Captured> {
  if (!(await ctx.fs.exists(path))) return { keys: {} }
  const entry = await ctx.fs.lstat?.(path)
  if (entry && entry.kind !== "file") throw new Error("Captured lessons must be a regular file")
  if (((await ctx.fs.stat?.(path))?.size ?? 0) > MEMORY_CAPTURED_MAX_BYTES)
    throw new Error("Captured lessons exceed their limit")
  const saved: unknown = JSON.parse(await ctx.fs.readFile(path))
  const keys = (saved as { keys?: unknown } | null)?.keys
  if (!keys || typeof keys !== "object" || Array.isArray(keys))
    throw new Error("Invalid captured lessons file")
  return {
    keys: Object.fromEntries(
      Object.entries(keys).filter((pair): pair is [string, string] => typeof pair[1] === "string"),
    ),
  }
}

/**
 * Saves the lessons a task's records hold and have not saved yet. Runs on every reply while the task
 * is in Review and at the ship step. A source whose lesson the person retired stays retired: its key
 * is settled with the source's current hash and a later change to it is skipped too.
 */
export async function captureTaskLessons(
  ctx: Ctx,
  task: Task,
  open?: MemoryService,
): Promise<CaptureCounts> {
  const counts = { saved: 0, unchanged: 0, failed: 0 }
  if (task.stage !== "shipped" && !(await inPersonReview(ctx, task))) return counts
  const savedIds: string[] = []
  const service = open ?? memoryService(ctx)
  try {
    await service.registerProject({
      id: task.repoId,
      automatic: true,
      name: basename(task.repoRoot),
      root: task.repoRoot,
    })
    if (!(await service.overview(task.repoId)).enabled) return counts
    const { verified, accepted } = await captureStatus(ctx, task)
    const sources = await sourcesOf(ctx, task)
    const path = join(task.runtimeDir, "memory-captured.json")
    await ctx.fs.assertSafeDirectory?.(task.runtimeDir)
    await ctx.fs.withLock(`${path}.lock`, async () => {
      const { keys } = await readCaptured(ctx, path)
      for (const source of sources) {
        if (source.needsChecks && !accepted) continue
        const content = source.content
        const unverified = source.needsChecks && !verified
        const digest = hash(JSON.stringify([source.kind, source.title, content, unverified]))
        if (keys[source.key] === digest) {
          counts.unchanged++
          continue
        }
        try {
          // The repository paths its own text names are its files; a lesson naming none is untracked.
          const files = namedFiles(source.title, content)
            .filter((file) => relativeFile(file))
            .slice(0, 32)
          const record = await service.store({
            project: task.repoId,
            title: source.title,
            content,
            kind: source.kind,
            ...(files.length ? { files } : {}),
            ...(source.answer ? { tags: [ANSWER_TAG], local: true as const } : {}),
            task: task.slug,
            key: source.key,
            ...(unverified ? { unverified: true as const } : {}),
          })
          savedIds.push(record.id)
          counts.saved++
        } catch (cause) {
          if (!(cause instanceof Error && cause.message === MEMORY_RETIRED)) {
            counts.failed++
            continue
          }
          counts.unchanged++
        }
        // A key is written only after its lesson is saved, so a crash retries only what is missing.
        keys[source.key] = digest
        const text = `${JSON.stringify({ keys })}\n`
        if (Buffer.byteLength(text) > MEMORY_CAPTURED_MAX_BYTES)
          throw new Error("Captured lessons exceed their limit")
        await ctx.fs.atomicWrite(path, text)
      }
    })
    if (savedIds.length > 0) {
      await recordMemoryActivity(ctx, task, "saves", savedIds.length, savedIds)
      // The saves stand even when the exchange with Git cannot finish now; the next sync retries it.
      await service.exchange(task.repoId).catch(() => {})
    }
    return counts
  } finally {
    if (open === undefined) await service.close()
  }
}
