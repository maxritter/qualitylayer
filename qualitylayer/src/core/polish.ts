// The quality pass before the judge: the security review, when the change crosses a trust boundary.
// It records one block under `## Security` in the Verify agents' file; the cursor reads that block and
// says what comes next. A Critical or High security finding (`S<n>`) goes to a fix helper, and the
// security review then checks its fixed findings again. Nothing here writes a stage.

import { join } from "node:path"
import { type Ctx, err, type Result } from "../ctx.ts"
import { appendToSection, sectionText, verifyLogPath } from "./docs/build-log.ts"
import { removeLeftoverSlots } from "./docs/slots.ts"
import {
  listedFindings,
  type Owed,
  owedQuality,
  parseQualityPass,
  SECURITY_SECTION,
} from "./polish-parse.ts"
import type { Flow } from "./scaling.ts"
import type { Task } from "./task/store.ts"

export { listedFindings, parseQualityPass, SECURITY_SECTION }

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

/** The text of the file the quality pass is recorded in (the Verify file), empty before it exists. */
export async function readQualityLog(ctx: Ctx, task: Pick<Task, "dir">): Promise<string> {
  const path = verifyLogPath(task)
  return (await ctx.fs.exists(path)) ? await ctx.fs.readFile(path) : ""
}

/** The helpers the pass runs for this task: the security review when the flow says so. */
export const passRoles = (flow: Pick<Flow, "security">): QualityRole[] =>
  flow.security ? ["security"] : []

const owed = owedQuality

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

function qualityRowState(
  role: QualityRole,
  owing: Owed | undefined,
  running: readonly string[],
): QualityState {
  if (owing === undefined) return "done"
  if (owing.kind === "fix") return "fixing"
  if (owing.kind === "recheck" || running.some((id) => id.startsWith(`q-${role}-`)))
    return "running"
  return "waiting"
}

function buildQualityRow(
  role: QualityRole,
  roles: readonly QualityRole[],
  block: QualityBlock | undefined,
  left: readonly Owed[],
  running: readonly string[],
): QualityRow {
  if (!roles.includes(role) && block === undefined) return { step: role, state: "off" }
  const owing = left.find((one) => (one.kind === "recheck" ? "security" : one.role) === role)
  const result =
    block?.result != null
      ? owing?.kind === "coverage"
        ? `incomplete · ${block.result}`
        : block.result
      : undefined
  return {
    step: role,
    state: qualityRowState(role, owing, running),
    ...(result !== undefined ? { result } : {}),
    ...(block && block.items.length > 0
      ? { findings: block.items.map((item) => ({ severity: item.severity, text: item.text })) }
      : {}),
    ...(owing?.kind === "fix" ? { open: owing.items.length } : {}),
    ...(owing?.kind === "coverage" ? { coverage: owing.remaining } : {}),
  }
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
  return QUALITY_ROLES.map((role) => buildQualityRow(role, roles, blocks.get(role), left, running))
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
