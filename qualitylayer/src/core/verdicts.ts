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
import { finishVerdicts } from "./verdicts-finish.ts"
import {
  acceptanceVerdicts,
  passedRun,
  readVerdicts,
  verdictsDir,
  verdictsPath,
} from "./verdicts-read.ts"
import { readAssignment } from "./verification.ts"

export { acceptanceVerdicts, finishVerdicts, passedRun, readVerdicts }

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
  /** The parallel judge share that recorded this verdict, when a round is split into shares. */
  share?: number
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
  share?: number
}

const badVerdict = (message: string) => err({ code: "bad_args", message })

function validateRunMetadata(input: VerdictInput): Result<void> {
  // A verdict names the run it judged and how the run happened, or neither.
  if ((input.run === undefined) !== (input.mode === undefined))
    return badVerdict("--run and --mode go together: name both or neither")
  if (input.run !== undefined && !isRunId(input.run))
    return badVerdict(`"${input.run}" is not a run name; use letters, digits, . _ - (at most 64)`)
  if (input.mode !== undefined && !isEvidenceMode(input.mode))
    return badVerdict(`"${input.mode}" is not a mode; use scripted or real-session`)
  if (input.share !== undefined && (!Number.isSafeInteger(input.share) || input.share < 1))
    return badVerdict("--share must be a positive integer")
  return ok(undefined)
}

async function validateVerdictEvidence(
  ctx: Ctx,
  task: Task,
  item: string,
  verdict: VerdictWord,
  rawEvidence: string | undefined,
): Promise<Result<string | undefined>> {
  let evidence: string | undefined
  if (rawEvidence !== undefined && rawEvidence !== "") {
    const path = rawEvidence.replace(/^\.\//, "")
    if (!isProofPath(path) || !(await ctx.fs.exists(join(task.dir, path)))) {
      return badVerdict(
        `\`${rawEvidence}\` is not a file under ${PROOF_FOLDER} in the task folder; save it there first`,
      )
    }
    evidence = path
  }
  // A runtime pass cites captured proof, as the build log's verdict lines do.
  if (verdict === "pass" && /^(?:scenario|acceptance):/.test(item) && evidence === undefined) {
    return badVerdict(
      `a pass of ${item.replace(":", " ")} needs --evidence <file under ${PROOF_FOLDER}>`,
    )
  }
  return ok(evidence)
}

async function validateVerdictTarget(
  ctx: Ctx,
  task: Task,
  input: VerdictInput,
): Promise<Result<{ item: string; verdict: VerdictWord; text: string }>> {
  const item = itemId(input.item)
  if (item === null) {
    return badVerdict(
      `"${input.item}" is not an item; use scenario <n>, done <n>, dod T<n>, acceptance A<n>, review or check`,
    )
  }
  const verdict = input.verdict.toLowerCase()
  if (!(VERDICT_WORDS as readonly string[]).includes(verdict))
    return badVerdict(`"${input.verdict}" is not a verdict; use ${VERDICT_WORDS.join(", ")}`)
  if (verdict === "user" && !item.startsWith("done:")) {
    // A Done means step is what a person can be asked to check.
    const list = await proofOf(ctx, task)
    const step = item.startsWith("acceptance:") ? item.slice("acceptance:".length) : null
    if (step === null || !list.steps.some((s) => s.id === step)) {
      return badVerdict(
        `only a Done means step (acceptance A<n>) can be the person's; judge ${item.replace(":", " ")} yourself`,
      )
    }
  }
  const text = input.text.replace(/\s+/g, " ").trim()
  if (text === "") return badVerdict("a verdict needs the evidence behind it, in words")
  return ok({ item, verdict: verdict as VerdictWord, text })
}

async function checkOpenAssignment(
  ctx: Ctx,
  task: Task,
  assignmentId: string,
): Promise<Result<void>> {
  const current = await readAssignment(ctx, task)
  if (current === null || current.id !== assignmentId) {
    return badVerdict(
      "that assignment was replaced by a later one (or the id is mistyped), so nothing is recorded under it. Stop: you were replaced, and the current assignment belongs to another reviewer.",
    )
  }
  // The round is recorded in the build log: that record stands, a later call cannot contradict it.
  if (current.result !== undefined) {
    return badVerdict(
      "this round is already recorded in the build log; run `qualitylayer next` for the next one",
    )
  }
  return ok(undefined)
}

/** Append one verdict to the current assignment's file; refuses what the build log would refuse. */
export async function recordVerdict(
  ctx: Ctx,
  task: Task,
  input: VerdictInput,
): Promise<Result<RecordedVerdict>> {
  const open = await checkOpenAssignment(ctx, task, input.assignment)
  if (!open.ok) return open
  const target = await validateVerdictTarget(ctx, task, input)
  if (!target.ok) return target
  const meta = validateRunMetadata(input)
  if (!meta.ok) return meta
  const { item, verdict, text } = target.data
  const checkedEvidence = await validateVerdictEvidence(ctx, task, item, verdict, input.evidence)
  if (!checkedEvidence.ok) return checkedEvidence
  const evidence = checkedEvidence.data
  const entry: VerdictEntry = {
    at: ctx.clock.now(),
    item,
    verdict,
    text,
    ...(evidence !== undefined ? { evidence } : {}),
    ...(input.run !== undefined && isEvidenceMode(input.mode)
      ? { run: input.run, mode: input.mode }
      : {}),
    ...(input.share !== undefined ? { share: input.share } : {}),
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
          warning: `\`verdict finish\` cites \`${evidence ?? "<returned file>"}\` automatically; cite it in backticks if writing ${item.replace(":", " ")} by hand.`,
        }
      : entry,
  )
}
