// `qualitylayer verdict`: a judge records each check as it goes, so the App's list fills in live.
// One line per call, appended to the current assignment's file in the task's runtime folder; the
// latest line of an item stands. `03-verify.md` is still written at the end, for the record.

import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { proofOf } from "./acceptance.ts"
import { isProofPath } from "./docs/names.ts"
import { evidenceIn } from "./docs/outline.ts"
import { type EvidenceMode, isEvidenceMode, isRunId } from "./review/screen-evidence.ts"
import type { Task } from "./task/store.ts"
import { readAssignment } from "./verification.ts"

/** What a judge says of one item. `user` is a point only the person can confirm. */
export const VERDICT_WORDS = ["pass", "fail", "missing", "user", "note"] as const
export type VerdictWord = (typeof VERDICT_WORDS)[number]

export type VerdictEntry = {
  at: number
  /**
   * `acceptance:A1` and `review` make a round complete on a points Plan; `scenario:2`, `done:8`,
   * `dod:T3` and `check` are accepted, and required on a flat Plan.
   */
  item: string
  verdict: VerdictWord
  text: string
  /** A file under evidence/, from the task folder. */
  evidence?: string
  /** The run of the acceptance test this verdict judged, and how that run happened. */
  run?: string
  mode?: EvidenceMode
}

/** What the call answers: the entry as kept, and a warning that is not stored. */
export type RecordedVerdict = VerdictEntry & { warning?: string }

const KINDS: Record<string, RegExp> = {
  scenario: /^\d+$/,
  done: /^\d+$/,
  dod: /^[Tt]\d+$/,
  acceptance: /^[Aa]\d+$/,
}

/**
 * The one name of an item, whatever its spelling: `scenario 2`, `scenario:2` and `Scenario-2` are
 * `scenario:2`; `dod t3` is `dod:T3`. Null when it is no item of a judge's record.
 */
export function itemId(raw: string): string | null {
  const text = raw.trim()
  if (/^(?:review|check)$/i.test(text)) return text.toLowerCase()
  const parts = /^([A-Za-z]+)[\s:_-]+([A-Za-z\d]+)$/.exec(text)
  const kind = parts?.[1]?.toLowerCase()
  const subject = parts?.[2]
  if (kind === undefined || subject === undefined) return null
  const rule = KINDS[kind]
  if (rule === undefined || !rule.test(subject)) return null
  return `${kind}:${kind === "dod" || kind === "acceptance" ? subject.toUpperCase() : subject.toLowerCase()}`
}

/**
 * The card a `review` line names when it opens with it: `[MISSING] review: T3 the help text omits
 * the flag` is T3's. Null for a line that names none.
 */
export function reviewCard(text: string): string | null {
  const found = /^\s*([Tt]\d+)\b/.exec(text)
  return found?.[1] === undefined ? null : found[1].toUpperCase()
}

const verdictsDir = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "verdicts")
const verdictsPath = (task: Pick<Task, "runtimeDir">, assignment: string) =>
  join(verdictsDir(task), `${assignment.replace(/[^A-Za-z0-9-]/g, "")}.jsonl`)

/** The folder a runtime check cites proof from, as a sentence names it. */
const PROOF_FOLDER = "evidence/ or records/"

export type VerdictInput = {
  assignment: string
  item: string
  verdict: string
  text: string
  evidence?: string
  run?: string
  mode?: string
}

/** Append one verdict to the current assignment's file; refuses what the build log would refuse. */
export async function recordVerdict(
  ctx: Ctx,
  task: Task,
  input: VerdictInput,
): Promise<Result<RecordedVerdict>> {
  const current = await readAssignment(ctx, task)
  if (current === null || current.id !== input.assignment) {
    return err({
      code: "bad_args",
      message:
        "that assignment was replaced by a later one (or the id is mistyped), so nothing is recorded under it. Stop: you were replaced, and the current assignment belongs to another reviewer.",
    })
  }
  // The round is recorded in the build log: that record stands, a later call cannot contradict it.
  if (current.result !== undefined) {
    return err({
      code: "bad_args",
      message:
        "this round is already recorded in the build log; run `qualitylayer next` for the next one",
    })
  }
  const item = itemId(input.item)
  if (item === null) {
    return err({
      code: "bad_args",
      message: `"${input.item}" is not an item; use scenario <n>, done <n>, dod T<n>, acceptance A<n>, review or check`,
    })
  }
  const verdict = input.verdict.toLowerCase()
  if (!(VERDICT_WORDS as readonly string[]).includes(verdict)) {
    return err({
      code: "bad_args",
      message: `"${input.verdict}" is not a verdict; use ${VERDICT_WORDS.join(", ")}`,
    })
  }
  if (verdict === "user" && !item.startsWith("done:")) {
    // A Done means step is what a person can be asked to check.
    const list = await proofOf(ctx, task)
    const step = item.startsWith("acceptance:") ? item.slice("acceptance:".length) : null
    if (step === null || !list.steps.some((s) => s.id === step)) {
      return err({
        code: "bad_args",
        message: `only a Done means step (acceptance A<n>) can be the person's; judge ${item.replace(":", " ")} yourself`,
      })
    }
  }
  const text = input.text.replace(/\s+/g, " ").trim()
  if (text === "") {
    return err({ code: "bad_args", message: "a verdict needs the evidence behind it, in words" })
  }
  // A verdict names the run it judged and how the run happened, or neither.
  if ((input.run === undefined) !== (input.mode === undefined)) {
    return err({ code: "bad_args", message: "--run and --mode go together: name both or neither" })
  }
  if (input.run !== undefined && !isRunId(input.run)) {
    return err({
      code: "bad_args",
      message: `"${input.run}" is not a run name; use letters, digits, . _ - (at most 64)`,
    })
  }
  if (input.mode !== undefined && !isEvidenceMode(input.mode)) {
    return err({
      code: "bad_args",
      message: `"${input.mode}" is not a mode; use scripted or real-session`,
    })
  }
  let evidence: string | undefined
  if (input.evidence !== undefined && input.evidence !== "") {
    const path = input.evidence.replace(/^\.\//, "")
    if (!isProofPath(path) || !(await ctx.fs.exists(join(task.dir, path)))) {
      return err({
        code: "bad_args",
        message: `\`${input.evidence}\` is not a file under ${PROOF_FOLDER} in the task folder; save it there first`,
      })
    }
    evidence = path
  }
  // A runtime pass cites captured proof, as the build log's verdict lines do.
  if (verdict === "pass" && /^(?:scenario|acceptance):/.test(item) && evidence === undefined) {
    return err({
      code: "bad_args",
      message: `a pass of ${item.replace(":", " ")} needs --evidence <file under ${PROOF_FOLDER}>`,
    })
  }
  const entry: VerdictEntry = {
    at: ctx.clock.now(),
    item,
    verdict: verdict as VerdictWord,
    text,
    ...(evidence !== undefined ? { evidence } : {}),
    ...(input.run !== undefined && isEvidenceMode(input.mode)
      ? { run: input.run, mode: input.mode }
      : {}),
  }
  await ctx.fs.mkdir(verdictsDir(task))
  await ctx.fs.append(verdictsPath(task, input.assignment), `${JSON.stringify(entry)}\n`)
  // The build log's record is refused for a runtime pass whose own line names no proof file.
  const unnamed =
    verdict === "pass" && /^(?:scenario|acceptance):/.test(item) && evidenceIn(text).length === 0
  return ok(
    unnamed
      ? {
          ...entry,
          warning: `Remember to cite \`${evidence ?? "<returned file>"}\` in backticks when writing the ${item.replace(":", " ")} line in the verify document. Use the capture command's returned path unchanged. A runtime pass whose line names no file under ${PROOF_FOLDER} is refused when the record is validated`,
        }
      : entry,
  )
}

/** Every item of an assignment with its latest verdict. */
export async function readVerdicts(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  assignment: string,
): Promise<Map<string, VerdictEntry>> {
  const path = verdictsPath(task, assignment)
  const found = new Map<string, VerdictEntry>()
  if (!(await ctx.fs.exists(path))) return found
  for (const line of (await ctx.fs.readFile(path)).split("\n")) {
    if (line.trim() === "") continue
    try {
      const entry = JSON.parse(line) as VerdictEntry
      if (typeof entry.item === "string" && typeof entry.verdict === "string")
        found.set(entry.item, entry)
    } catch {
      // A torn line from a crashed judge hides itself, nothing else.
    }
  }
  return found
}

/**
 * The latest `acceptance:A<n>` verdict of each step across every assignment: what a judge recorded
 * for the acceptance test when it kept no evidence run of its own.
 */
export async function acceptanceVerdicts(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<Map<string, VerdictEntry>> {
  const found = new Map<string, VerdictEntry>()
  for (const name of await ctx.fs.readdir(verdictsDir(task)).catch(() => [] as string[])) {
    if (!name.endsWith(".jsonl")) continue
    for (const line of (await ctx.fs.readFile(join(verdictsDir(task), name))).split("\n")) {
      try {
        const entry = JSON.parse(line) as VerdictEntry
        if (typeof entry.item !== "string" || !entry.item.startsWith("acceptance:")) continue
        const step = entry.item.slice("acceptance:".length)
        if ((found.get(step)?.at ?? 0) <= entry.at) found.set(step, entry)
      } catch {
        // A torn line from a crashed judge hides itself, nothing else.
      }
    }
  }
  return found
}

/**
 * The latest run the verdicts judged where every judged item passed: the run whose evidence a task
 * keeps besides its last runs. Null when no run passed.
 */
export async function passedRun(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<string | null> {
  const runs = new Map<string, { latest: number; words: Map<string, VerdictWord> }>()
  for (const name of await ctx.fs.readdir(verdictsDir(task)).catch(() => [] as string[])) {
    if (!name.endsWith(".jsonl")) continue
    for (const line of (await ctx.fs.readFile(join(verdictsDir(task), name))).split("\n")) {
      try {
        const entry = JSON.parse(line) as VerdictEntry
        if (!isRunId(entry.run) || typeof entry.item !== "string") continue
        const seen = runs.get(entry.run) ?? { latest: 0, words: new Map<string, VerdictWord>() }
        seen.latest = Math.max(seen.latest, entry.at)
        seen.words.set(`${name}\n${entry.item}`, entry.verdict)
        runs.set(entry.run, seen)
      } catch {
        // A torn line from a crashed judge hides itself, nothing else.
      }
    }
  }
  let found: { run: string; latest: number } | null = null
  for (const [run, { latest, words }] of runs) {
    const all = [...words.values()]
    if (!all.includes("pass") || all.some((word) => word === "fail" || word === "missing")) continue
    if (found === null || latest >= found.latest) found = { run, latest }
  }
  return found?.run ?? null
}
