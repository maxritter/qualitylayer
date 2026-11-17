// The quality pass before the judge: the security review, when the change crosses a trust boundary.
// It records one block under `## Security` in the Verify agents' file; the cursor reads that block and
// says what comes next. A Critical or High security finding (`S<n>`) goes to a fix helper, and the
// security review then checks its fixed findings again. Nothing here writes a stage.

import { join } from "node:path"
import { type Ctx, err, type Result } from "../ctx.ts"
import { appendToSection, sectionText, verifyLogPath } from "./docs/build-log.ts"
import { removeLeftoverSlots } from "./docs/slots.ts"
import { qualityFinding, qualityHeading, qualityResult } from "./review/quality-lines.ts"
import type { Flow } from "./scaling.ts"
import type { Task } from "./task/store.ts"

export type Severity = "critical" | "high" | "medium" | "low"

/** The helpers of the quality pass. */
export type QualityRole = "security"
export const QUALITY_ROLES: readonly QualityRole[] = ["security"]

/** A security finding of the pass: `S<n>`. */
export type QualityItem = {
  /** S1, S2 … */
  id: string
  severity: Severity
  /** A fix helper fixed it and ticked its box. */
  ticked: boolean
  /** The rest of the line: where, what, reach, fix. */
  text: string
}

export type QualityBlock = {
  /** The `S<n>` lines of the block, and of its re-check; the last line of an id stands. */
  items: QualityItem[]
  /** The ids a `### Security re-check` block names. */
  rechecked: Set<string>
  /** What the block's `**Result:**` line says, after the label; null before the helper wrote one. */
  result: string | null
  /** A `### Security re-check` block has its result line: the helper ran, whatever it found. */
  recheckResult: string | null
  /** Scope the reviewer explicitly did not reach. */
  notChecked: string[]
}

export type QualityCoverageGap = {
  role: QualityRole
  scope: string
}

export type QualityNext =
  /** The helper to start; `recheck` sends the security review back to its fixed findings. */
  | { kind: "run"; roles: QualityRole[]; recheck?: string[] }
  /** Open severe findings, for one fix helper. */
  | { kind: "fix"; items: QualityItem[] }
  | { kind: "judge" }

/** The `### ` heading the helper records its block under. */
const HEADINGS: Record<QualityRole, string> = { security: "Security" }
export const blockHeading = (role: QualityRole): string => HEADINGS[role]

export const LABELS: Record<QualityRole, string> = { security: "Security review" }

/** The section of the Verify agents' file the security review records its blocks under. */
export const SECURITY_SECTION = "Security"

const RECHECK_HEADING = "Security re-check"

/** Fixed before the judge: a critical or high security finding. */
const severe = (item: QualityItem) => item.severity === "critical" || item.severity === "high"

const RECHECK_FIXED = /^[-*]\s+(S\d+)\s+fixed\b/

function readCoverageLine(block: QualityBlock, line: string, collecting: boolean): boolean {
  const uncovered = line.match(/^\s*\*\*Not checked:\*\*(.*)/i)
  if (uncovered) {
    const text = uncovered[1]?.trim() ?? ""
    collecting = text === ""
    if (collecting) block.notChecked.push("Remaining review scope was not listed")
    if (text !== "" && !/^(?:none|nothing|n\/a|not applicable)[.!]?$/i.test(text))
      block.notChecked.push(text)
  } else if (collecting) {
    const item = line.match(/^\s*[-*]\s+(\S.*)/)?.[1]?.trimEnd()
    if (item) {
      block.notChecked = block.notChecked.filter(
        (scope) => scope !== "Remaining review scope was not listed",
      )
      block.notChecked.push(item)
    } else if (line.trim() !== "") collecting = false
  }
  return collecting
}

/** The security block of the log's `## Security` section, by the role that recorded it. */
export function parseQualityPass(log: string): Map<QualityRole, QualityBlock> {
  const blocks = new Map<QualityRole, QualityBlock>()
  let block: QualityBlock | null = null
  let recheck = false
  let notCheckedList = false
  for (const line of sectionText(log, SECURITY_SECTION).split(/\r?\n/)) {
    const heading = qualityHeading(line)
    if (heading !== undefined) {
      notCheckedList = false
      recheck = heading === RECHECK_HEADING.toLowerCase()
      block = null
      if (heading === "security" || recheck) {
        block = blocks.get("security") ?? {
          items: [],
          rechecked: new Set<string>(),
          result: null,
          recheckResult: null,
          notChecked: [],
        }
        blocks.set("security", block)
      }
      continue
    }
    if (block === null) continue
    notCheckedList = readCoverageLine(block, line, notCheckedList)
    const resultLine = qualityResult(line)
    if (!recheck && block.result === null) block.result = resultLine
    if (recheck && block.recheckResult === null) block.recheckResult = resultLine
    // A re-check clears a finding only with its own `- S<n> fixed` line; the latest line of an id stands.
    const fixed = recheck ? line.trim().match(RECHECK_FIXED)?.[1] : undefined
    if (fixed !== undefined) block.rechecked.add(fixed)
    const found = qualityFinding(line.trim())
    if (found === null) continue
    // A finding written again as a box, by the re-check or after it, is unchecked until checked again.
    block.rechecked.delete(found.id)
    const at = block.items.findIndex((i) => i.id === found.id)
    if (at === -1) block.items.push(found)
    else block.items[at] = found
  }
  return blocks
}

function remainingCoverage(role: QualityRole, block: QualityBlock): QualityCoverageGap[] {
  const remaining: QualityCoverageGap[] = [...new Set(block.notChecked)].map((scope) => ({
    role,
    scope,
  }))
  for (const result of [block.result, block.recheckResult]) {
    if (
      result &&
      /^(?:partial|partly|incomplete|blocked|not checked|not done|not reviewed|not run|unfinished|stopped|skipped|inconclusive|unverified|unable)\b/i.test(
        result,
      )
    )
      remaining.push({ role, scope: `Incomplete report: ${result}` })
  }
  return remaining
}

/** The Medium and Low findings of the security review: they block nothing and go into the pull request description. */
export function listedFindings(log: string): QualityItem[] {
  return (parseQualityPass(log).get("security")?.items ?? []).filter((item) => !severe(item))
}

/** The text of the file the quality pass is recorded in (the Verify file), empty before it exists. */
export async function readQualityLog(ctx: Ctx, task: Pick<Task, "dir">): Promise<string> {
  const path = verifyLogPath(task)
  return (await ctx.fs.exists(path)) ? await ctx.fs.readFile(path) : ""
}

/** The helpers the pass runs for this task: the security review when the flow says so. */
export const passRoles = (flow: Pick<Flow, "security">): QualityRole[] =>
  flow.security ? ["security"] : []

/** What the pass still owes, in the order it is handed out. */
type Owed =
  | { kind: "run"; role: QualityRole }
  | { kind: "fix"; role: QualityRole; items: QualityItem[] }
  | { kind: "recheck"; ids: string[] }
  | { kind: "coverage"; role: QualityRole; remaining: QualityCoverageGap[] }

function owed(roles: readonly QualityRole[], blocks: Map<QualityRole, QualityBlock>): Owed[] {
  const found: Owed[] = []
  for (const role of roles) {
    const block = blocks.get(role)
    // A heading alone is a helper that has not finished: the step is done once its result line is written.
    if (block === undefined || block.result === null) {
      found.push({ kind: "run", role })
      continue
    }
    const open = block.items.filter((item) => severe(item) && !item.ticked)
    if (open.length > 0) {
      found.push({ kind: "fix", role, items: open })
      continue
    }
    // A security finding that was fixed is checked again.
    const unchecked = block.items.filter((item) => severe(item) && !block.rechecked.has(item.id))
    if (unchecked.length > 0) found.push({ kind: "recheck", ids: unchecked.map((item) => item.id) })
    const remaining = remainingCoverage(role, block)
    if (remaining.length > 0) found.push({ kind: "coverage", role, remaining })
  }
  return found
}

/**
 * What Verify hands out next: the helper still owed, then the fix of every open severe finding
 * (one helper), then the security re-check, then the judge.
 */
export function nextQualityOf(roles: readonly QualityRole[], log: string): QualityNext {
  const left = owed(roles, parseQualityPass(log))
  const runs = left.flatMap((one) => (one.kind === "run" ? [one.role] : []))
  if (runs.length > 0) return { kind: "run", roles: runs }
  const fixes = left.flatMap((one) => (one.kind === "fix" ? one.items : []))
  if (fixes.length > 0) return { kind: "fix", items: fixes }
  const recheck = left.find((one) => one.kind === "recheck")
  if (recheck?.kind === "recheck") return { kind: "run", roles: ["security"], recheck: recheck.ids }
  return { kind: "judge" }
}

export async function nextQuality(
  ctx: Ctx,
  task: Task,
  roles: readonly QualityRole[],
): Promise<QualityNext> {
  return nextQualityOf(roles, await readQualityLog(ctx, task))
}

function qualityOwedText(one: Owed): string[] {
  if (one.kind === "coverage")
    return one.remaining.map((gap) => `${LABELS[one.role]}: not checked · ${gap.scope}`)
  if (one.kind === "run") return [`${LABELS[one.role]}: not done`]
  if (one.kind === "fix")
    return one.items.map((item) => `${item.id} ${item.severity}: ${item.text}`)
  return one.ids.length > 0 ? [`${one.ids.join(", ")}: fixed, not checked again`] : []
}

/** Everything the quality pass has not done, in words; empty once it is done. */
export async function qualityLeft(
  ctx: Ctx,
  task: Task,
  roles: readonly QualityRole[],
): Promise<string[]> {
  const left = owed(roles, parseQualityPass(await readQualityLog(ctx, task)))
  return left.flatMap(qualityOwedText)
}

/** Required quality work; unavailable advisory scanner coverage remains in the report. */
export async function blockingQualityLeft(
  ctx: Ctx,
  task: Task,
  roles: readonly QualityRole[],
): Promise<string[]> {
  return owed(roles, parseQualityPass(await readQualityLog(ctx, task)))
    .filter((one) => one.kind !== "coverage")
    .flatMap(qualityOwedText)
}

export type QualityState = "waiting" | "running" | "done" | "fixing" | "off"

/** The security review as the App shows it: its state, and what its block recorded. */
export type QualityRow = {
  step: QualityRole
  state: QualityState
  /** The block's `**Result:**` line, after its label. */
  result?: string
  /** The block's findings by their severity. */
  findings?: { severity: Severity; text: string }[]
  /** Severe findings still to fix. */
  open?: number
  /** Explicitly unverified scope. */
  coverage?: QualityCoverageGap[]
}

/**
 * The pass as the App lists it: security is off when the change crosses no trust boundary. The
 * helper runs while its id (`q-<role>-…`, from `running`) is out.
 */
export function qualityRows(
  roles: readonly QualityRole[],
  log: string,
  running: readonly string[],
): QualityRow[] {
  const blocks = parseQualityPass(log)
  const left = owed(roles, blocks)
  return QUALITY_ROLES.map((role): QualityRow => {
    const block = blocks.get(role)
    if (!roles.includes(role) && block === undefined) return { step: role, state: "off" }
    const owing = left.find((one) => (one.kind === "recheck" ? "security" : one.role) === role)
    const state: QualityState =
      owing === undefined
        ? "done"
        : owing.kind === "fix"
          ? "fixing"
          : owing.kind === "recheck" || running.some((id) => id.startsWith(`q-${role}-`))
            ? "running"
            : "waiting"
    return {
      step: role,
      state,
      ...(block?.result != null
        ? { result: owing?.kind === "coverage" ? `incomplete · ${block.result}` : block.result }
        : {}),
      ...(block !== undefined && block.items.length > 0
        ? { findings: block.items.map((item) => ({ severity: item.severity, text: item.text })) }
        : {}),
      ...(owing?.kind === "fix" ? { open: owing.items.length } : {}),
      ...(owing?.kind === "coverage" ? { coverage: owing.remaining } : {}),
    }
  })
}

/** `qualityRows` for a task: the log as it stands, so every surface reads the pass the way `next` does. */
export async function qualityRowsFor(
  ctx: Ctx,
  task: Task,
  roles: readonly QualityRole[],
  running: readonly string[],
): Promise<QualityRow[]> {
  return qualityRows(roles, await readQualityLog(ctx, task), running)
}

/** The refusal of what must wait for the quality pass (the judge, the final gate); null once it is done. */
export async function refuseWhileOpen(
  ctx: Ctx,
  task: Task,
  roles: readonly QualityRole[],
  waiting: string,
): Promise<Result<never> | null> {
  const left = await blockingQualityLeft(ctx, task, roles)
  if (left.length === 0) return null
  const message = `${waiting} waits for the quality pass. Left open: ${left.join("; ")}.`
  return err({
    code: "validation_failed",
    message,
    errors: [
      {
        line: 1,
        rule: "quality_pass_open",
        message,
        fix_hint: "run qualitylayer next: it hands out the helpers or the fix",
        severity: "error",
      },
    ],
  })
}

/**
 * The Verify agents' file has its `## Security` section before `## Second opinion` and
 * `## Verification` (the schema's order), where the helper records its block: the judge appends to
 * the end of the log, so the section must not follow it.
 */
export async function ensureQualitySection(ctx: Ctx, task: Task): Promise<void> {
  const path = verifyLogPath(task)
  if (!(await ctx.fs.exists(path))) return
  await ctx.fs.withLock(join(task.runtimeDir, "quality-record-slots.lock"), async () => {
    const log = await ctx.fs.readFile(path)
    const at = log.search(/^## (?:Second opinion|Verification)\s*$/m)
    let written = new RegExp(`^## ${SECURITY_SECTION}\\s*$`, "m").test(log)
      ? log
      : at === -1
        ? `${log.trimEnd()}\n\n## ${SECURITY_SECTION}\n`
        : `${log.slice(0, at)}## ${SECURITY_SECTION}\n\n${log.slice(at)}`
    written = removeLeftoverSlots(written).markdown
    const body = sectionText(written, SECURITY_SECTION)
    // Existing reports keep their exact history and placement; fresh passes get disjoint edit anchors.
    if (!/^### Security(?: re-check)?\s*$/m.test(body) && !body.includes("<!-- quality-record:")) {
      written = appendToSection(
        written,
        SECURITY_SECTION,
        ["security", "security-recheck"]
          .map((role) => `<!-- quality-record:${role} -->\n\n<!-- /quality-record:${role} -->`)
          .join("\n\n"),
      )
    }
    if (written !== log) await ctx.fs.atomicWrite(path, written)
  })
}

export function qualityRecordSlot(log: string, recheck: boolean): string | undefined {
  const name = recheck ? "security-recheck" : "security"
  return log.split(`<!-- quality-record:${name} -->`).length === 2 &&
    log.split(`<!-- /quality-record:${name} -->`).length === 2
    ? name
    : undefined
}
