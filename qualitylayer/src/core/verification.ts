// One assignment/receipt contract for the judge. A judgement counts once it is recorded: later edits to
// the code, the Plan or the evidence do not void it. Phase dispatch stays in next.ts; this module never
// writes a task's stage.
import { createHash, randomUUID } from "node:crypto"
import { join } from "node:path"
import { type Ctx, err, ok, type Result, type ValidationError } from "../ctx.ts"
import {
  type Iteration,
  implementAgentsPath,
  lastIteration,
  parseNotes,
  readBuildRecord,
  stampRevision,
  verifyLogPath,
} from "./docs/build-log.ts"
import { folderDoc } from "./docs/names.ts"
import { emptyOutline, evidenceIn, type Outline } from "./docs/outline.ts"
import { verr } from "./docs/rules/types.ts"
import {
  acceptanceBasis,
  citedFiles,
  evidenceResolves,
  isEvidencePath,
  verdictsComplete,
} from "./docs/rules/verify-rules.ts"
import {
  buildOwnPaths,
  buildRevision,
  evidenceFolder,
  evidenceRevision,
  fileRevision,
  gateRevision,
} from "./gate/revision.ts"
import { sliceCommits } from "./git/build-start.ts"
import { type JudgeInputs, judgeInputs, RecordedHistoryRewritten } from "./git/judge-inputs.ts"
import { OwnedTreeMoved } from "./git/owned-tree.ts"
import { revisionPaths } from "./git/revision-paths.ts"
import {
  clearOwnChanges,
  foreignLooseEdits,
  keepOwnChanges,
  keepRestored,
  keptOwnChanges,
  type OwnChange,
  type OwnChanges,
  ownEdits,
  ownEditTimes,
  ownRecordSpan,
  recordedBytes,
  toolHooksSeen,
} from "./git/session-edits.ts"
import { releaseWaiting } from "./judge-environment.ts"
import { assignedPlan } from "./judge-records.ts"
import { movedSince, recordMoved, saveSnapshot } from "./moved.ts"
import { passRoles, refuseWhileOpen } from "./polish.ts"
import { recheckOf, roundAssignment } from "./recheck.ts"
import { shellQuote } from "./shell.ts"
import { readEvents, type Task } from "./task/store.ts"
import { taskFlow } from "./task-flow.ts"

/** The helpers of the task's quality pass. */
const rolesOf = async (ctx: Ctx, task: Task) => passRoles((await taskFlow(ctx, task)).flow)

export type Assignment = {
  id: string
  revision: string
  context: string
  iteration: number
  /** The commit the judge was assigned at, so a later round can name the fix. */
  head?: string
  source?: JudgeInputs | null
  /** Why the judge reads current HEAD in full, when the recorded history was rewritten. */
  note?: string
  /** The task list and scenarios as they stood when this assignment was handed out. */
  outline?: Outline
  /** The IDs of the Plan's Acceptance test steps when this assignment was handed out (`A1`…). */
  acceptance?: string[]
  /**
   * Each step's text then (`A1` → `action → expected`): a recheck carries a
   * step's earlier pass only while the step reads as it did when it was judged.
   */
  stepTexts?: Record<string, string>
  /** A re-judgement after a judged run on unchanged requirements: the fix is the diff since `head`. */
  after?: { iteration: number; head: string }
  /** The approved requirements alone (the Plan), without the deviations. */
  requirements?: string
  /**
   * What `context` was made of, kept apart so a stale assignment can say which input changed: the
   * Plan's revision, and the notes of `## Notes` that change the build, one string each.
   */
  inputs?: { plan: string; deviations: string[] }
  /** Paths the Plan names that git ignores or that are generated: not judged, not counted. */
  ignored?: string[]
  /**
   * The independent reviewer also added the missing tests: it adds tests and docs beside its
   * verdicts, so commits that touch only tests and docs after it do not undo its pass.
   */
  combined?: true
  /**
   * The task's own production files that were uncommitted when this assignment was handed out,
   * digested with their bytes (`looseOwn`): the judge reads the working tree, so these are part of
   * what it ruled on. Absent when there were none.
   */
  loose?: string
  /**
   * Each of those files with the digest of its bytes then. A file committed since with the same
   * bytes is still the code the judge read: uncommitted or committed is no change of the source.
   */
  looseFiles?: Record<string, string>
  /**
   * A session of the task ran both of QualityLayer's tool hooks before this was handed out
   * (`toolHooksSeen`: hook presence, not a surviving edit record), and what the task's sessions
   * change from here on is kept with the task (`noteOwnChange`, no expiry). So for this pass "no
   * record of an own change" reads as "no own change", however long ago it was and whatever
   * others did to the history, unless that record says the hooks could not tell (`ownMoves`).
   * Absent on an older receipt and for an agent without hooks: there the sessions' records must
   * still vouch for themselves.
   */
  observed?: true
  result?: "pass" | "fail"
  /** The agent asked for a fresh review (`verify recheck`): this pass no longer stands. */
  withdrawn?: true
  /** When QualityLayer read and counted the round: what changed after it is not judged. */
  counted?: number
  proof?: Record<string, string>
}

/**
 * What the session may commit of the reviewer's added tests after the judge ruled: tests and
 * Markdown docs. Production code committed since still needs a judge.
 */
const REVIEWER_TEST_GLOBS: readonly string[] = [
  // Any case: `Tests/` and `Test_x.py` are tests on Windows and in .NET repositories too.
  ...[
    "**/tests/**",
    "**/test/**",
    "**/__tests__/**",
    "**/spec/**",
    "**/*.test.*",
    "**/*.spec.*",
    "**/*_test.*",
    "**/*_spec.*",
    "**/test_*.*",
    "**/*.md",
    "docs/**/*.mdx",
  ].map((glob) => `glob,icase)${glob}`),
  // .NET and JVM projects name tests `FooTests.cs` in `Foo.Tests/`; case kept, so `contests/` is not one.
  ...["**/*Tests/**", "**/*Tests.*"].map((glob) => `glob)${glob}`),
]

export const REVIEWER_TEST_PATHS: readonly string[] = REVIEWER_TEST_GLOBS.map(
  (magic) => `:(exclude,${magic}`,
)

/** The same paths as pathspecs that select them: the tests and docs a reviewer may add. */
export const REVIEWER_TEST_SPECS: readonly string[] = REVIEWER_TEST_GLOBS.map(
  (magic) => `:(${magic}`,
)

const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

/**
 * The commit a combined review's production code is compared with: its recorded source, or, for a
 * run that read the whole tree (`source: null`, as in a shared checkout), the HEAD it was pinned to.
 * Null when there is none to compare with.
 */
function judgedCommit(assignment: Assignment): string | null {
  const source = assignment.source
  if (source === null)
    return assignment.head !== undefined && OBJECT_ID.test(assignment.head) ? assignment.head : null
  if (!source || !OBJECT_ID.test(source.commit) || !OBJECT_ID.test(source.tree)) return null
  return source.commit
}

/** Preserve the combined review only when the build's production code still matches the judged commit. */
export async function combinedCodeCurrent(
  ctx: Ctx,
  task: Task,
  assignment: Assignment,
): Promise<boolean> {
  const commit = judgedCommit(assignment)
  if (assignment.combined !== true || assignment.ignored?.length || commit === null) return false
  try {
    const owned = await buildOwnPaths(ctx, task)
    if (owned === null) return false
    const edits = await ownEdits(ctx, { id: task.repoId, root: task.repoRoot }, task.slug)
    const paths = [...new Set([...owned, ...edits])]
    if (
      paths.length === 0 ||
      paths.length > 4096 ||
      Buffer.byteLength(JSON.stringify(paths)) > 256 * 1024
    )
      return false
    const scope = revisionPaths(task.repoRoot, paths)
    if (scope.external.length > 0 || scope.local.length === 0) return false
    const specs = [
      ...scope.local.map((path) => `:(literal)${path}`),
      ":(exclude)docs/plans/**",
      ...REVIEWER_TEST_PATHS,
    ]
    const maxOutputBytes = 1024 * 1024
    const options = { maxOutputBytes, fresh: true } as const
    const complete = (result: { code: number; stdout: string; stderr: string }) =>
      result.code === 0 &&
      Buffer.byteLength(result.stdout) < maxOutputBytes &&
      Buffer.byteLength(result.stderr) < maxOutputBytes
    const diff = await ctx.git.run(
      task.repoRoot,
      ["diff", "--quiet", "--no-ext-diff", "--no-textconv", commit, "--", ...specs],
      options,
    )
    if (!complete(diff)) return false
    const fresh = await ctx.git.run(
      task.repoRoot,
      ["ls-files", "--others", "--exclude-standard", "-z", "--", ...specs],
      options,
    )
    return complete(fresh) && fresh.stdout === ""
  } catch {
    return false
  }
}

/**
 * `git diff --quiet` between two commits over code only: not the plan folder, and for a combined
 * review not the tests and docs its reviewer added. Exit 1 means code differs.
 */
export async function codeDiffCode(
  ctx: Ctx,
  task: Task,
  from: string,
  to: string,
  { combined, only = null }: { combined: boolean; only?: string[] | null },
): Promise<number> {
  const changed = await ctx.git.run(task.repoRoot, [
    "diff",
    "--quiet",
    from,
    to,
    "--",
    ...(only === null ? ["."] : only.map((path) => `:(literal)${path}`)),
    ":(exclude)docs/plans/**",
    ...(combined ? REVIEWER_TEST_PATHS : []),
  ])
  return changed.code
}
const receiptPath = (task: Task) => join(task.runtimeDir, "verification.json")

const withoutJudgePath = (task: Task) =>
  join(task.runtimeDir, "checked-without-independent-judge.json")

/**
 * A recorded quality pass with the user's independent-review setting off; no verdict is invented. The
 * Checks section says so on the Independent review's line: it was off in Settings.
 */
export async function recordWithoutIndependentJudge(ctx: Ctx, task: Task): Promise<void> {
  const revision = await buildRevision(ctx, task)
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.writeFile(
    withoutJudgePath(task),
    `${JSON.stringify({ revision, context: await verificationContextRevision(ctx, task), at: ctx.clock.now() })}\n`,
  )
}

export async function checkedWithoutIndependentJudge(ctx: Ctx, task: Task): Promise<boolean> {
  try {
    const record = JSON.parse(await ctx.fs.readFile(withoutJudgePath(task))) as {
      revision: string
      context: string
    }
    return (
      record.revision === (await buildRevision(ctx, task)) &&
      record.context === (await verificationContextRevision(ctx, task))
    )
  } catch {
    return false
  }
}

/**
 * The change under review, code only: the plan's own documents and evidence
 * reach the reader as `context`, and would otherwise dominate the diff.
 */
export function codeDiff(range: string, leaveOut: readonly string[] = []): string {
  // Another build's files on the same branch (`otherTasksOnly`) are not this change.
  const others = leaveOut.map((path) => ` ${shellQuote(`:(exclude)${path}`)}`).join("")
  return `git diff ${range} -- . ':(exclude)docs/plans/**'${others}`
}

/**
 * The deviations that change the code or the requirements, one string each: `T2 (tactical): …`.
 * A note of the judge's own (`judged`) and every line that is no note (an attestation, a remark)
 * say nothing new about the build, so a record of them never makes a judgement stale.
 */
async function deviationInputs(ctx: Ctx, task: Task): Promise<string[]> {
  const path = implementAgentsPath(task)
  if (!(await ctx.fs.exists(path))) return []
  return parseNotes(await ctx.fs.readFile(path))
    .filter((note) => note.kind !== "judged")
    .map((note) => {
      const who = note.task ?? "Plan"
      return note.kind === "baseline"
        ? `Baseline: ${note.text}`
        : `${who} (${note.kind}): ${note.text}`
    })
}

async function contextInputs(
  ctx: Ctx,
  task: Task,
): Promise<{ plan: string; deviations: string[] }> {
  return {
    plan: await gateRevision(ctx, task, folderDoc("plan")),
    deviations: await deviationInputs(ctx, task),
  }
}

export async function verificationContextRevision(ctx: Ctx, task: Task): Promise<string> {
  const { plan, deviations } = await contextInputs(ctx, task)
  return `${plan}:${deviations.join("\n")}`
}

/**
 * What changed since an assignment was handed out, in words: the Plan, a deviation that was added
 * or taken out, or the code. Empty while the assignment still stands. An attestation or a remark in
 * the build log is not among them.
 */
export async function staleInputs(ctx: Ctx, task: Task, assignment: Assignment): Promise<string[]> {
  const out = await staleContext(ctx, task, assignment)
  try {
    if (assignment.revision !== (await buildRevision(ctx, task))) out.push("The code changed")
  } catch {
    // No recorded base: nothing to compare the code with.
  }
  return out
}

/**
 * Whether an assignment's judge still reads what is there: the Plan, the deviations, the task's
 * commits and what its own files hold uncommitted are as they were when it was handed out.
 */
export async function assignmentCurrent(
  ctx: Ctx,
  task: Task,
  assignment: Assignment,
): Promise<boolean> {
  if ((await staleInputs(ctx, task, assignment)).length > 0) return false
  const loose = await looseOwn(ctx, task, assignment.combined === true)
  return loose !== null && loose.digest === assignment.loose
}

/** The Plan and the deviations that changed since an assignment was handed out, in words. */
async function staleContext(ctx: Ctx, task: Task, assignment: Assignment): Promise<string[]> {
  const out: string[] = []
  if (assignment.inputs === undefined) return out
  const now = await contextInputs(ctx, task)
  if (now.plan !== assignment.inputs.plan) out.push(`The Plan (${folderDoc("plan")}) changed`)
  for (const line of now.deviations)
    if (!assignment.inputs.deviations.includes(line)) out.push(`A deviation was added: ${line}`)
  for (const line of assignment.inputs.deviations)
    if (!now.deviations.includes(line)) out.push(`A deviation was taken out: ${line}`)
  return out
}

/** What the judge checks against: the approved Plan. */
async function requirementsRevision(ctx: Ctx, task: Task): Promise<string> {
  return gateRevision(ctx, task, folderDoc("plan"))
}

/** The current assignment was judged (its verdicts are in the log) but never read back. */
async function judgedUnread(ctx: Ctx, task: Task, assignment: Assignment): Promise<boolean> {
  if (assignment.result !== undefined) return false
  return (await readBuildRecord(ctx, task)).verification.some((i) => i.assignment === assignment.id)
}

export async function readAssignment(ctx: Ctx, task: Task): Promise<Assignment | null> {
  try {
    const record: unknown = JSON.parse(await ctx.fs.readFile(receiptPath(task)))
    if (record === null || typeof record !== "object" || Array.isArray(record)) return null
    const assignment = record as Assignment
    if (
      assignment.source === null &&
      (typeof assignment.id !== "string" ||
        !/^[A-Za-z0-9-]{1,128}$/.test(assignment.id) ||
        !Number.isSafeInteger(assignment.iteration) ||
        assignment.iteration < 1 ||
        typeof assignment.head !== "string" ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(assignment.head) ||
        typeof assignment.revision !== "string" ||
        assignment.revision.length === 0 ||
        typeof assignment.context !== "string" ||
        assignment.context.length === 0 ||
        typeof assignment.note !== "string" ||
        assignment.note.length === 0 ||
        assignment.note.length > 8192)
    )
      return null
    return assignment
  } catch {
    return null
  }
}

export type JudgeAdmission = {
  source: JudgeInputs | null
  head?: string
  /** Why the judge reads current HEAD in full, when the recorded history was rewritten. */
  note?: string
}
/** The judge reads and runs the working tree; `source` records the task's own commits when known. */
export async function prepareJudgeAdmission(ctx: Ctx, task: Task): Promise<JudgeAdmission> {
  const rev = await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"])
  const currentHead = rev.code === 0 ? rev.stdout.trim() : undefined
  let source: JudgeInputs | null = null
  let unowned: { message: string; head: string | undefined } | null = null
  if (rev.code === 0 && /^[a-f0-9]{40,64}$/.test(rev.stdout.trim())) {
    try {
      source = await judgeInputs(ctx, task)
    } catch (cause) {
      // Rewritten history, or a commit no slice recorded on the build's files (another session's,
      // in a shared checkout): the judge reads the current tree in full instead. A refusal here
      // would leave the agent only moves its instructions forbid, such as registering a commit
      // that is not its own.
      if (cause instanceof RecordedHistoryRewritten)
        unowned = { message: cause.message, head: cause.head }
      else if (cause instanceof OwnedTreeMoved)
        unowned = {
          message:
            "A commit no slice recorded changed the task's committed files, as another session's commit in a shared checkout does",
          head: currentHead,
        }
      else throw cause
    }
  }
  const head = unowned?.head ?? currentHead
  return {
    source,
    head,
    ...(unowned
      ? {
          note: `${unowned.message.replace(/\.$/, "")}. Read and run the current working tree in full (HEAD ${head ?? "unknown"} plus local edits). The diff against the effective base includes tracked working edits with the normal exclusions; inspect untracked files directly. No committed-source ownership is claimed.`,
        }
      : {}),
  }
}
export async function prepareVerification(
  ctx: Ctx,
  task: Task,
  admitted?: JudgeAdmission,
): Promise<Result<Assignment>> {
  const release = await releaseWaiting(ctx, task)
  if (release !== null)
    return err({ code: "bad_args", message: `${release.instructions} Run ${release.then}.` })
  const waiting = await refuseWhileOpen(ctx, task, await rolesOf(ctx, task), "The judge")
  if (waiting !== null) return waiting
  try {
    const previous = await readAssignment(ctx, task)
    const admission = admitted ?? (await prepareJudgeAdmission(ctx, task))
    const context = await verificationContextRevision(ctx, task)
    const requirements = await requirementsRevision(ctx, task)
    const { source, head } = admission
    // A run after a judge already ruled on this round's requirements (a failed round, stale
    // verdicts, or a fix asked for in Review) records `after`: the reviewer rechecks what failed
    // and what the fix since then touched, and chooses its own scope.
    const judgedBefore =
      previous !== null &&
      ((previous.result === "fail" && previous.iteration === task.iterations) ||
        (previous.result === "pass" && previous.iteration === task.iterations) ||
        (previous.iteration === task.iterations + 1 && (await judgedUnread(ctx, task, previous))))
    const sameRequirements =
      previous !== null &&
      (previous.requirements !== undefined
        ? previous.requirements === requirements
        : previous.context === context)
    const flowed = await taskFlow(ctx, task)
    const outline = flowed.plan
    const ignored = outline !== null ? await ignoredPaths(ctx, task, outline) : []
    const assignment: Assignment = {
      id: randomUUID(),
      revision: await buildRevision(ctx, task),
      context,
      requirements,
      inputs: await contextInputs(ctx, task),
      iteration: task.iterations + 1,
      ...(head !== undefined ? { head } : {}),
      ...(source !== null ? { source } : admission.note !== undefined ? { source: null } : {}),
      ...(judgedBefore && sameRequirements && previous?.head !== undefined
        ? { after: { iteration: previous.iteration, head: previous.head } }
        : // Handed out again for the same round (its judge died or was replaced before it
          // ruled): it is still the run after that judged round, so its brief keeps "the next
          // run" and that round's lines that did not pass.
          previous !== null &&
            previous.result === undefined &&
            previous.iteration === task.iterations + 1 &&
            previous.after !== undefined &&
            sameRequirements
          ? { after: previous.after }
          : {}),
    }
    if (ignored.length > 0) assignment.ignored = ignored
    if (flowed.flow.combinedReview === true) assignment.combined = true
    await ctx.fs.mkdir(task.runtimeDir)
    // This judge reads the code as it is now: what the task changed before it needs no record.
    await clearOwnChanges(ctx, task.runtimeDir, assignment.id)
    const loose = await looseOwn(ctx, task, assignment.combined === true)
    if (loose?.digest !== undefined) {
      assignment.loose = loose.digest
      assignment.looseFiles = loose.files
    }
    // Hook presence, not a surviving edit record: a session of the task ran both tool hooks.
    if (await toolHooksSeen(ctx, task.runtimeDir)) assignment.observed = true
    if (admission.note !== undefined) assignment.note = admission.note
    assignment.outline = outline ?? EMPTY_OUTLINE
    const basis = await acceptanceBasis(ctx, task.dir)
    assignment.acceptance = [...basis.ids]
    if (basis.texts !== undefined) assignment.stepTexts = basis.texts
    await ctx.fs.mkdir(join(task.runtimeDir, "judgements"))
    await ctx.fs.atomicWrite(
      join(task.runtimeDir, "judgements", `${assignment.id}.json`),
      `${JSON.stringify(assignment)}\n`,
    )
    await ctx.fs.atomicWrite(receiptPath(task), `${JSON.stringify(assignment)}\n`)
    await saveSnapshot(ctx, task, `verify-${assignment.id}`)
    return ok(assignment)
  } catch (cause) {
    return err({
      code: "bad_args",
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

/** The paths the Plan names that git ignores (generated files, local-only folders): never judged. */
async function ignoredPaths(ctx: Ctx, task: Task, outline: Outline): Promise<string[]> {
  const paths = [
    ...new Set(
      outline.slices.flatMap((slice) => [
        ...slice.tasks.flatMap((t) => t.files),
        ...slice.tree.map((f) => f.path),
      ]),
    ),
  ]
  if (paths.length === 0) return []
  const result = await ctx.git.run(task.repoRoot, ["check-ignore", "--", ...paths])
  if (result.code !== 0) return []
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && paths.includes(line))
}

const EMPTY_OUTLINE: Outline = emptyOutline()

/**
 * A judge names its assignment and copies no hash: the iteration, or each judge's part, that holds
 * the current assignment and no revision is stamped with the revision the assignment was handed
 * out at. Returns whether it stamped any.
 */
export async function stampVerification(
  ctx: Ctx,
  task: Task,
  iteration: Iteration,
  assignment: Assignment,
): Promise<boolean> {
  const unstamped = (
    iteration.parts ?? [
      { line: iteration.line, assignment: iteration.assignment, revision: iteration.revision },
    ]
  ).filter((part) => part.assignment === assignment.id && part.revision === undefined)
  if (unstamped.length === 0) return false
  let record = await ctx.fs.readFile(verifyLogPath(task))
  // Insert from the end so a stamp cannot shift another part's original line.
  for (const part of unstamped.toSorted((a, b) => b.line - a.line))
    record = stampRevision(record, part.line, assignment.revision)
  await ctx.fs.writeFile(verifyLogPath(task), record)
  return true
}

/**
 * A judge's record faithful to its assignment, read after the tree moved: nothing refuses it for
 * that. Keep the assigned revision: a changed tree was never judged by this record. What changed
 * is listed in the build log. A record that copied no revision is stamped first.
 */
export async function acceptMovedVerification(
  ctx: Ctx,
  task: Task,
  outline: Outline | null,
  recorded: Iteration,
): Promise<boolean> {
  const assignment = await readAssignment(ctx, task)
  const stamped = assignment !== null && (await stampVerification(ctx, task, recorded, assignment))
  const iteration = stamped
    ? (lastIteration(await readBuildRecord(ctx, task)) ?? recorded)
    : recorded
  if (
    assignment === null ||
    assignment.id !== iteration.assignment ||
    assignment.revision !== iteration.revision ||
    assignment.iteration !== iteration.n ||
    iteration.n !== task.iterations + 1
  )
    return stamped
  const revision = await buildRevision(ctx, task)
  if (assignment.revision === revision) return stamped
  const moved = await movedSince(ctx, task, outline, `verify-${assignment.id}`)
  // The note belongs to the Implement agents' file.
  await ctx.fs.writeFile(
    implementAgentsPath(task),
    await recordMoved(
      ctx,
      task,
      { iteration: iteration.n, ...moved },
      `verification round ${iteration.n}`,
      await ctx.fs.readFile(implementAgentsPath(task)),
    ),
  )
  return stamped
}

export async function judgedHeadWarning(
  ctx: Ctx,
  task: Task,
  iteration: Iteration,
): Promise<string | null> {
  const assignment = await readAssignment(ctx, task)
  if (
    assignment === null ||
    assignment.id !== iteration.assignment ||
    assignment.head === undefined
  )
    return null
  const now = await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"])
  const head = now.stdout.trim()
  if (now.code !== 0 || head === assignment.head) return null
  // HEAD moved by other sessions' commits only: the task's own revision is the one judged, so the
  // verdicts still cover its code (Max, 2026-10-13: other sessions' work never holds a task).
  if (
    assignment.revision !== undefined &&
    assignment.revision === (await buildRevision(ctx, task).catch(() => null))
  )
    return null
  // The reviewer's added tests and docs, committed after it ruled, leave its verdicts standing.
  if (
    assignment.combined === true &&
    (await codeDiffCode(ctx, task, assignment.head, head, { combined: true })) === 0
  )
    return null
  return `HEAD is ${head}; iteration ${iteration.n} judged ${assignment.head}. Its verdicts cover that commit, not the later changes. Follow the returned phase. Recheck the affected production changes before the person's review; do not claim later changes were independently judged.`
}

export async function verificationErrors(
  ctx: Ctx,
  task: Task,
  iteration: Iteration,
  outline: Outline | null,
): Promise<ValidationError[]> {
  const original = await assignedPlan(ctx, task.runtimeDir, iteration.assignment)
  // A recheck of a points Plan carries the passes whose evidence is still in the task folder. A
  // round already counted was read when its files were there and is not asked again.
  const recheck = await recheckOf(
    ctx,
    task.runtimeDir,
    await roundAssignment(ctx, task.runtimeDir, iteration.assignment),
    (await readBuildRecord(ctx, task)).verification,
    iteration.n > task.iterations ? evidenceExists(ctx, task) : undefined,
  )
  const errors = verdictsComplete(original?.outline ?? outline ?? EMPTY_OUTLINE, iteration, {
    ...(await acceptanceBasis(ctx, task.dir)),
    ...(original?.acceptance ? { ids: original.acceptance } : {}),
    ...(recheck !== null ? { recheck } : {}),
  })
  const assignment = await readAssignment(ctx, task)
  if (
    assignment !== null &&
    assignment.id === iteration.assignment &&
    iteration.revision !== undefined &&
    iteration.revision !== assignment?.revision
  ) {
    errors.push(
      verr(
        iteration.line,
        "verification-revision",
        "This record names a different revision from its judge assignment",
        "Remove the copied Revision field; QualityLayer stamps the assigned revision",
      ),
    )
  }
  if (
    !assignment ||
    assignment.id !== iteration.assignment ||
    assignment.iteration !== iteration.n ||
    iteration.n !== task.iterations + 1
  ) {
    const changed = assignment ? await staleInputs(ctx, task, assignment) : []
    // With an assignment open for this round, another `verify judge` hands out a second one and the
    // block stays as wrong as it is: the move is to record under the open one.
    const open = assignment?.iteration === task.iterations + 1 && changed.length === 0
    errors.push(
      verr(
        iteration.line,
        "verification-assignment",
        changed.length > 0
          ? `This judgment has no matching current assignment; since it was handed out: ${changed.join("; ")}`
          : "This judgment has no matching current assignment",
        open && assignment
          ? `Record the round as \`### Iteration ${assignment.iteration}\` with \`**Assignment:** ${assignment.id}\` and leave Revision for QualityLayer. A block under another assignment belongs to a reviewer that was replaced; it is set aside, not read.`
          : "Run qualitylayer verify judge after checks pass; copy its Assignment field and leave Revision for QualityLayer",
      ),
    )
  }
  errors.push(...(await evidenceResolves(iteration, evidenceExists(ctx, task))))
  return errors
}

/** Whether a cited file is in the task folder and holds something. */
export const evidenceExists = (ctx: Ctx, task: Task) => async (path: string) => {
  try {
    const file = join(task.dir, path)
    if (!(await ctx.fs.exists(file))) return false
    const bytes = ctx.fs.readBytes
      ? await ctx.fs.readBytes(file)
      : new TextEncoder().encode(await ctx.fs.readFile(file))
    return bytes.byteLength > 0
  } catch {
    return false
  }
}

/**
 * The files a round cites that the task folder no longer has: its own, and those of the earlier
 * passes a recheck of a points Plan carries, which it rests on as much as on its own.
 */
export async function lostEvidence(ctx: Ctx, task: Task, iteration: Iteration): Promise<string[]> {
  const exists = evidenceExists(ctx, task)
  const carried = await recheckOf(
    ctx,
    task.runtimeDir,
    await roundAssignment(ctx, task.runtimeDir, iteration.assignment),
    (await readBuildRecord(ctx, task)).verification,
  )
  const cited = [
    ...citedFiles(iteration),
    ...[...(carried?.carried.values() ?? [])].flatMap((step) => step.evidence),
  ]
  const lost: string[] = []
  for (const path of new Set(cited))
    if (!isEvidencePath(path) || !(await exists(path))) lost.push(path)
  return lost
}

/**
 * What a counted round cites and the task folder no longer has. The round was read when its files
 * were there and stays as it is, so this is a warning in `validate` and in `next`, never a block;
 * only the round being read is held to its files. The move is a fresh reviewer, not a repair.
 */
export async function lostEvidenceWarnings(
  ctx: Ctx,
  task: Task,
  iterations: Iteration[],
): Promise<ValidationError[]> {
  const warnings: ValidationError[] = []
  for (const iteration of iterations.filter((i) => i.n <= task.iterations)) {
    const lost = await lostEvidence(ctx, task, iteration)
    if (lost.length === 0) continue
    const shown = lost
      .slice(0, 3)
      .map((path) => `\`${path}\``)
      .join(", ")
    warnings.push(
      verr(
        iteration.line,
        "evidence-history",
        `Round ${iteration.n} cites ${shown}${lost.length > 3 ? ` and ${lost.length - 3} more` : ""}, no longer in the task folder. The round is counted and stays as written.`,
        "Nothing to restore. If a verdict that still stands rests on it, run `qualitylayer verify judge`: a fresh reviewer runs that point again.",
        "warning",
      ),
    )
  }
  return warnings
}

export async function finishVerification(
  ctx: Ctx,
  task: Task,
  iteration: Iteration,
): Promise<void> {
  const assignment = await readAssignment(ctx, task)
  if (!assignment) throw new Error("Verification assignment disappeared")
  const proof: Record<string, string> = {}
  for (const verdict of iteration.verdicts)
    for (const path of evidenceIn(verdict.text)) {
      proof[path] = await evidenceRevision(ctx, join(task.dir, path))
    }
  await ctx.fs.atomicWrite(
    receiptPath(task),
    `${JSON.stringify({ ...assignment, result: iteration.result, proof, counted: ctx.clock.now() })}\n`,
  )
}

/**
 * After a failed judge round: the build session committed code since the commit that round judged,
 * so its fix is in and the next round can judge it. The plan folder does not count.
 */
export async function fixCommittedSinceFailedRound(ctx: Ctx, task: Task): Promise<boolean> {
  const receipt = await readAssignment(ctx, task)
  // A failed round with no receipt names no commit to compare with: the next round judges the
  // build as it stands, so its gaps never hold the session in a loop it cannot leave.
  if (receipt === null || receipt.result !== "fail") return true
  const head = receipt.source?.commit ?? receipt.head
  if (head === undefined) return true
  return (
    (await codeDiffCode(ctx, task, head, "HEAD", { combined: receipt.combined === true })) === 1
  )
}

/** Code was committed since the commit the judge ruled on (a fix in Review); the plan folder does not count. */
export async function codeCommittedSinceJudged(ctx: Ctx, task: Task): Promise<boolean> {
  const receipt = await readAssignment(ctx, task)
  const head = receipt?.head
  if (receipt?.result !== "pass" || head === undefined) return false
  // Only the build's own files: in a shared checkout other sessions commit all day, and their
  // commits elsewhere do not change what the judge passed.
  const own = await buildOwnPaths(ctx, task).catch(() => null)
  // Git takes only paths inside the checkout; a plan may also name inputs outside it.
  const local = own === null ? null : revisionPaths(task.repoRoot, own).local
  if (local !== null && local.length === 0) return false
  return (
    (await codeDiffCode(ctx, task, head, "HEAD", {
      combined: receipt?.combined === true,
      only: local,
    })) === 1
  )
}

/**
 * A session of the task edited these files or created these commits, as its hook saw it: kept with
 * the task from the moment a judge is handed out, so the pass that follows knows the task's own
 * changes for as long as it stands (the sessions' own records expire after three days).
 */
export async function noteOwnChange(ctx: Ctx, task: Task, change: OwnChange): Promise<void> {
  const receipt = await readAssignment(ctx, task)
  if (receipt === null) return
  await keepOwnChanges(ctx, task.runtimeDir, change)
  // The record binds to the change, not to the path for ever: a file this left at the bytes the
  // judge read (an edit that puts them back, a commit of what it read uncommitted) holds nothing
  // of the task's own, so a later change to it by someone else is not the task's.
  const combined = receipt.combined === true
  const paths = new Set(change.files ?? [])
  for (const commit of [...(change.commits ?? []), ...(change.window ?? [])])
    for (const path of (await commitPaths(ctx, task, commit, combined)) ?? []) paths.add(path)
  if (paths.size === 0) return
  // What is noted is what was seen: the record as it stood before the files were sampled.
  const seen = await keptOwnChanges(ctx, task.runtimeDir)
  const at = await headNow(ctx, task)
  await restore(ctx, task, receipt, seen, at, await asJudged(ctx, task, receipt, [...paths]))
}

/** HEAD's commit, or undefined when git cannot name it. */
async function headNow(ctx: Ctx, task: Task): Promise<string | undefined> {
  const head = await ctx.git.run(task.repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"], {
    fresh: true,
  })
  const sha = head.stdout.trim()
  return head.code === 0 && OBJECT_ID.test(sha) ? sha : undefined
}

/**
 * Notes files found back at the bytes the judge read (`keepRestored`), bound to what the observer
 * saw: the record (`seen`) and HEAD (`head`) as they were read before the files were sampled, and
 * each file's digest. The task's later edits and commits are never ended by it.
 */
async function restore(
  ctx: Ctx,
  task: Task,
  receipt: Assignment,
  seen: OwnChanges,
  head: string | undefined,
  back: string[],
): Promise<void> {
  if (back.length === 0) return
  const digestNow = (path: string) => fileRevision(ctx, join(task.repoRoot, path))
  const files: Record<string, string> = {}
  for (const path of back) files[path] = await digestNow(path)
  await keepRestored(
    ctx,
    task.runtimeDir,
    {
      generation: seen.generation,
      // The judge whose bytes `back` was compared with: accepted only in that judge's record.
      judge: receipt.id,
      upto: seen.count,
      asOf: seen.asOf,
      ...(head !== undefined ? { head } : {}),
      files,
    },
    digestNow,
  ).catch(() => {})
}

/**
 * The production files a commit changed. A merge names the files it left unlike every parent: what
 * it took over whole is not its own. Null when git cannot say.
 */
async function commitPaths(
  ctx: Ctx,
  task: Task,
  commit: string,
  combined: boolean,
): Promise<string[] | null> {
  const names = await ctx.git.run(
    task.repoRoot,
    [
      ...["diff-tree", "--no-commit-id", "--name-only", "-r", "-c", "--root", "-z", commit],
      ...["--", ".", ":(exclude)docs/plans/**", ...(combined ? REVIEWER_TEST_PATHS : [])],
    ],
    { fresh: true },
  )
  return names.code === 0 ? names.stdout.split("\0").filter((path) => path !== "") : null
}

/**
 * Whether a commit holds, for one file, exactly what the judge read: the bytes it read
 * uncommitted (their digest is on the receipt), or for a file it read committed the judged
 * commit's own blob. Such a commit contributed nothing unjudged to the file. False when that
 * cannot be shown (a file too large or not text to compare by its bytes, a git failure).
 */
async function holdsJudged(
  ctx: Ctx,
  task: Task,
  receipt: Assignment,
  commit: string,
  path: string,
): Promise<boolean> {
  try {
    const head = receipt.head
    if (head === undefined || !OBJECT_ID.test(head)) return false
    const options = { fresh: true } as const
    const was = receipt.looseFiles?.[path]
    if (was === undefined) {
      // One object a call: `rev-parse --verify` takes a single revision.
      const blob = async (at: string) => {
        const id = await ctx.git.run(
          task.repoRoot,
          ["rev-parse", "--verify", `${at}:${path}`],
          options,
        )
        return id.code === 0 && OBJECT_ID.test(id.stdout.trim()) ? id.stdout.trim() : null
      }
      const mine = await blob(commit)
      return mine !== null && mine === (await blob(head))
    }
    return (await committedDigest(ctx, task, commit, path)) === was
  } catch {
    return false
  }
}

/**
 * The digest of a file's bytes as a commit holds them and the working tree would (filters
 * applied): what a judge's digest and a session's edit record are taken of. Null for a file too
 * large or not text to compare that way, one the commit does not hold, or a git failure.
 */
async function committedDigest(
  ctx: Ctx,
  task: Task,
  commit: string,
  path: string,
): Promise<string | null> {
  try {
    const options = { fresh: true } as const
    const size = await ctx.git.run(task.repoRoot, ["cat-file", "-s", `${commit}:${path}`], options)
    if (size.code !== 0 || !/^\d+$/.test(size.stdout.trim())) return null
    if (Number(size.stdout.trim()) > 1024 * 1024) return null
    const blob = await ctx.git.run(
      task.repoRoot,
      ["cat-file", "--filters", `${commit}:${path}`],
      options,
    )
    if (blob.code !== 0 || blob.stdout.includes("�")) return null
    return createHash("sha256").update(blob.stdout).digest("hex")
  } catch {
    return null
  }
}

/**
 * Of `paths`, those whose bytes in the working tree are what the judge read: the judged commit's,
 * or for a file it read uncommitted those bytes. Empty when that cannot be said.
 */
async function asJudged(
  ctx: Ctx,
  task: Task,
  receipt: Assignment,
  paths: string[],
): Promise<string[]> {
  try {
    const head = receipt.head
    if (head === undefined || !OBJECT_ID.test(head) || paths.length === 0) return []
    // A receipt from before each uncommitted file's digest was kept cannot say.
    if (receipt.loose !== undefined && receipt.looseFiles === undefined) return []
    const local = revisionPaths(task.repoRoot, paths).local
    if (local.length === 0 || local.length > 4096) return []
    const specs = local.map((path) => `:(literal)${path}`)
    const run = (args: string[]) =>
      ctx.git.run(task.repoRoot, [...args, "--", ...specs], { fresh: true })
    const [differs, untracked] = await Promise.all([
      run(["diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", head]),
      run(["ls-files", "--others", "--exclude-standard", "-z"]),
    ])
    if (differs.code !== 0 || untracked.code !== 0) return []
    const split = (out: string) => out.split("\0").filter((path) => path !== "")
    const changed = new Set([...split(differs.stdout), ...split(untracked.stdout)])
    const back: string[] = []
    for (const path of local) {
      const was = receipt.looseFiles?.[path]
      const same =
        was === undefined
          ? !changed.has(path)
          : was === (await fileRevision(ctx, join(task.repoRoot, path)))
      if (same) back.push(path)
    }
    return back
  } catch {
    return []
  }
}

/**
 * Of uncommitted `paths`, those that are positively another task's: by that task's session record
 * (`foreignLooseEdits`, read without its three days), or because the pass found them so before
 * and they still hold those bytes. What is found is kept with the pass, so neither time nor the
 * other session's rewritten record takes the attribution away.
 */
async function theirLoose(
  ctx: Ctx,
  task: Task,
  paths: string[],
  kept: OwnChanges,
): Promise<Set<string>> {
  const theirs = new Set<string>()
  if (paths.length === 0) return theirs
  const digests = new Map<string, string>()
  for (const path of paths) {
    digests.set(path, await fileRevision(ctx, join(task.repoRoot, path)))
    if (kept.foreign.get(path) === digests.get(path)) theirs.add(path)
  }
  const ownAt = new Map(
    [...kept.files]
      .filter(([path, edit]) => edit.seq >= (kept.restored.get(path)?.upto ?? 0))
      .map(([path, edit]): [string, number] => [path, edit.at]),
  )
  const found = await foreignLooseEdits(
    ctx,
    { id: task.repoId, root: task.repoRoot },
    task.slug,
    paths.filter((path) => !theirs.has(path)),
    { lasting: true, ownAt },
  )
  const fresh: Record<string, string> = {}
  for (const path of found) {
    theirs.add(path)
    fresh[path] = digests.get(path) ?? "missing"
  }
  if (found.length > 0)
    await keepOwnChanges(ctx, task.runtimeDir, { foreign: fresh }).catch(() => {})
  return theirs
}

export type PassStanding = { stands: true } | { stands: false; moved: string[] }

/** The files and commits behind "the code changed", in words. */
async function codeMovedWords(
  ctx: Ctx,
  task: Task,
  receipt: Assignment,
  uncommitted: string[] = [],
): Promise<string> {
  const head = receipt.head
  const now = await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"]).catch(() => null)
  const at = now?.code === 0 ? now.stdout.trim() : ""
  let files: string[] = []
  if (head !== undefined && at !== "") {
    // Only the files that decide: the build's own. Other sessions' commits in the range are not named.
    const own = await buildOwnPaths(ctx, task).catch(() => null)
    const local = own === null ? [] : revisionPaths(task.repoRoot, own).local
    const scope = local.length > 0 ? local.map((path) => `:(literal)${path}`) : ["."]
    const changed = await ctx.git
      .run(task.repoRoot, [
        "diff",
        "--name-only",
        head,
        at,
        "--",
        ...scope,
        ":(exclude)docs/plans/**",
      ])
      .catch(() => null)
    if (changed?.code === 0) files = changed.stdout.split("\n").filter((line) => line.trim() !== "")
  }
  // What the task's own files hold uncommitted comes first: it is what a commit would settle.
  files = [...new Set([...uncommitted, ...files])]
  const short = (sha: string) => sha.slice(0, 7)
  const range = head !== undefined && at !== "" ? ` (${short(head)} to ${short(at)})` : ""
  const named = files.slice(0, 3).join(", ")
  const more = files.length > 3 ? ` and ${files.length - 3} more` : ""
  return `The code changed after the judge ruled${range}${named === "" ? "" : `: ${named}${more}`}`
}

/** What moved the code the counted pass was judged on, or null while it still covers the code. */
async function codeMoved(ctx: Ctx, task: Task, receipt: Assignment): Promise<string | null> {
  let revision: string
  try {
    revision = await buildRevision(ctx, task)
  } catch {
    return "The code could not be compared with the code the judge ruled on"
  }
  // After Implement the revision is the task's commits alone: what its own files hold uncommitted is
  // read before an unchanged revision keeps the pass. Another task's unfinished edit is not counted.
  const loose = await looseOwn(ctx, task, receipt.combined === true)
  if (loose === null) return codeMovedWords(ctx, task, receipt)
  // What the judge read uncommitted, file by file. A receipt from before those were kept has the
  // digest of all of them alone: the same files with the same bytes, or a change.
  const judged = receipt.looseFiles ?? (loose.digest === receipt.loose ? loose.files : null)
  if (judged === null) return codeMovedWords(ctx, task, receipt, loose.paths)
  const edited = loose.paths.filter((path) => loose.files[path] !== judged[path])
  if (edited.length > 0) return codeMovedWords(ctx, task, receipt, edited)
  // A file the judge read uncommitted that is no longer so: committed as it was, or changed.
  const landed = Object.keys(judged).some((path) => loose.files[path] === undefined)
  // The task's own commits and edits since the judge are read before an unchanged revision keeps
  // the pass: a commit its session made by hand may hold a file no card names.
  const kept = await keptOwnChanges(ctx, task.runtimeDir)
  const sessions = await ownRecordSpan(ctx, { id: task.repoId }, task.slug)
  const ownSince = !kept.complete || kept.files.size + kept.commits.size + sessions.commits.size > 0
  // Production code committed since the judge ruled; a combined review's added tests and docs are not.
  const differs =
    landed ||
    ownSince ||
    (receipt.revision !== revision && !(await combinedCodeCurrent(ctx, task, receipt))) ||
    (await codeCommittedSinceJudged(ctx, task))
  if (!differs) return null
  const own = await ownMoves(ctx, task, receipt, judged, kept, receipt.revision !== revision)
  return own === null ? null : codeMovedWords(ctx, task, receipt, own)
}

const zPaths = (out: string) => out.split("\0").filter((path) => path !== "")

/** The pathspecs of a task's own production code: its paths, without the plan folder and, for a combined review, tests and docs. */
const productionSpecs = (local: string[], combined: boolean) => [
  ...local.map((path) => `:(literal)${path}`),
  ":(exclude)docs/plans/**",
  ...(combined ? REVIEWER_TEST_PATHS : []),
]

/**
 * The task's own production files that differ from HEAD in the working tree (changed, staged or
 * new), without those that are positively another task's unfinished edit, and a digest of their
 * bytes (undefined when there are none). A judge reads the working tree, so an assignment keeps
 * this digest and each file's own (`files`): the same files with the same bytes are the code it
 * ruled on, anything else is a change. No paths for a plan that names no files; null when git
 * cannot say.
 */
async function looseOwn(
  ctx: Ctx,
  task: Task,
  combined: boolean,
): Promise<{ paths: string[]; digest?: string; files: Record<string, string> } | null> {
  try {
    const owned = await buildOwnPaths(ctx, task)
    if (owned === null) return { paths: [], files: {} }
    const repo = { id: task.repoId, root: task.repoRoot }
    const edits = await ownEdits(ctx, repo, task.slug)
    const local = revisionPaths(task.repoRoot, [...new Set([...owned, ...edits])]).local
    if (local.length === 0) return { paths: [], files: {} }
    if (local.length > 4096) return null
    const specs = productionSpecs(local, combined)
    const run = (args: string[]) =>
      ctx.git.run(task.repoRoot, [...args, "--", ...specs], { fresh: true })
    const [uncommitted, untracked] = await Promise.all([
      run(["diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "HEAD"]),
      run(["ls-files", "--others", "--exclude-standard", "-z"]),
    ])
    if (uncommitted.code !== 0 || untracked.code !== 0) return null
    const loose = [...new Set([...zPaths(uncommitted.stdout), ...zPaths(untracked.stdout)])].sort()
    if (loose.length === 0) return { paths: [], files: {} }
    const kept = await keptOwnChanges(ctx, task.runtimeDir)
    const theirs = await theirLoose(ctx, task, loose, kept)
    const paths = loose.filter((path) => !theirs.has(path))
    if (paths.length === 0) return { paths, files: {} }
    const state: [string, string][] = []
    for (const path of paths) state.push([path, await fileRevision(ctx, join(task.repoRoot, path))])
    return {
      paths,
      digest: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
      files: Object.fromEntries(state),
    }
  } catch {
    return null
  }
}

/**
 * Only the task's own changes withdraw its pass (Max, 10 November 2026): in a shared checkout
 * another session's commit to a file the task also names is not the task's change, also when that
 * session is no QualityLayer task and leaves no record. Null when the task's code is as the judge
 * read it, or every difference is shown to be someone else's; otherwise the files that are the
 * task's own change, or that nobody can be named for (empty when nothing can be said at all).
 *
 * The source decides first, not the history: a file counts as changed only when its bytes differ
 * from what the judge read, which is the judged commit, or for a file it read uncommitted those
 * bytes (`judgedFiles`). So a commit of the judged bytes, a reworded or rebased history and a
 * change that was taken back are no change. A changed file is the task's own when its sessions
 * edited it since (their records, and the changes kept with the task, `kept`), or when a commit
 * the task registered or one of its sessions made by hand since the judged commit changed it:
 * such a commit's files join the files compared, also one no card names.
 *
 * Own evidence binds to the change, not to the path for ever: once a file is found back at the
 * judged bytes (`restored`), what the task did to it before no longer counts.
 *
 * Without an own change, the rest is someone else's when the records can say so. For a receipt
 * marked `observed` they can: the task's changes since the judge are kept with it and do not
 * expire, so neither time nor another session's rewrite of the history withdraws the pass. The
 * mark covers only what the hooks could see: when the kept record says they could not tell what
 * the session committed, a changed file keeps the pass only if it is positively someone else's.
 * A receipt without the mark (an older one, an agent without hooks) follows that same rule from
 * the start: no hooks saw its sessions, so a changed file keeps the pass only when it is
 * positively someone else's. No receipt is withdrawn because time passed or because someone
 * rewrote the history: files that hold the judged bytes are not changed. An uncommitted
 * difference must be another task's by its record either way; that attribution is kept with the
 * pass and does not expire. Anything that cannot be read at all (no judged commit, no judged
 * time, a git failure) withdraws.
 */
async function ownMoves(
  ctx: Ctx,
  task: Task,
  receipt: Assignment,
  judgedFiles: Record<string, string>,
  kept: OwnChanges,
  /** The build's revision is no longer the one the judge was handed out on. */
  revisionMoved: boolean,
): Promise<string[] | null> {
  const unknown: string[] = []
  try {
    const head = receipt.head
    if (head === undefined || !OBJECT_ID.test(head)) return unknown
    const passed = (await readEvents(ctx, task))
      .filter(
        (event) =>
          event.event === "verify_result" &&
          event.passed === true &&
          event.iteration === receipt.iteration &&
          typeof event.ts === "number",
      )
      .pop()
    // The pass is recorded only once the page may turn (after the final checks); the round was
    // counted before, when its verdicts were read, and what changed after that is not judged.
    const judged = receipt.counted ?? (passed?.ts as number | undefined)
    if (judged === undefined) return unknown
    if (!Number.isFinite(judged)) return unknown
    const repo = { id: task.repoId, root: task.repoRoot }
    const times = await ownEditTimes(ctx, repo, task.slug)
    const span = await ownRecordSpan(ctx, repo, task.slug)
    const options = { fresh: true } as const
    const combined = receipt.combined === true
    const within = async (commit: string, line: string) =>
      (await ctx.git.run(task.repoRoot, ["merge-base", "--is-ancestor", commit, line], options))
        .code === 0
    const owned = await buildOwnPaths(ctx, task)
    if (owned === null) return unknown
    // HEAD before anything is sampled: a restoration noted below is bound to it.
    const headBefore = await headNow(ctx, task)
    // The files the task's sessions changed since the judge (`touched`), and of those the ones
    // whose change still stands (`own`). A file found back at the judged bytes holds nothing of
    // what the task did before that was seen: evidence in a line of the kept record below the
    // restoration's place, timed before it was observed, or a commit HEAD held then. Evidence
    // from after the observation always stands, however late the restoration was written.
    const touched = new Set<string>()
    const own = new Set<string>()
    const stands = (path: string, still: boolean) => {
      touched.add(path)
      if (still) own.add(path)
    }
    const bySeq = (path: string, seq: number) =>
      stands(path, seq >= (kept.restored.get(path)?.upto ?? 0))
    const byTime = (path: string, at: number) =>
      stands(path, at >= (kept.restored.get(path)?.asOf ?? Number.NEGATIVE_INFINITY))
    for (const [path, edit] of kept.files) bySeq(path, edit.seq)
    for (const [path, at] of times) if (at > judged) byTime(path, at)
    // The commits that are the task's: registered, made by hand since the pass, and kept with the
    // task. One HEAD gained while a call of the task was open stays the task's, also when another
    // task's session recorded it: that record comes from an overlap in time too and is no proof
    // of who wrote the commit. Both tasks are checked again.
    const registered = await sliceCommits(ctx, task)
    type Evidence =
      | { kind: "registered" }
      | { kind: "time"; at: number }
      | { kind: "seq"; seq: number }
    const commits = new Map<string, Evidence>(
      registered.map((sha) => [sha, { kind: "registered" }]),
    )
    for (const [sha, at] of span.commits)
      if (at > judged && !commits.has(sha)) commits.set(sha, { kind: "time", at })
    for (const [sha, made] of kept.commits)
      if (!commits.has(sha)) commits.set(sha, { kind: "seq", seq: made.seq })
    for (const [commit, evidence] of commits) {
      if (await within(commit, head)) continue
      const paths = await commitPaths(ctx, task, commit, combined)
      if (paths === null) return unknown
      for (const path of paths) {
        if (evidence.kind === "seq") bySeq(path, evidence.seq)
        else if (evidence.kind === "time") byTime(path, evidence.at)
        else {
          // A registered commit has its place in history: one that HEAD already held when the
          // file was seen back at the judged bytes left nothing of its own in it.
          // And one that holds, for the file, exactly the bytes the judge read contributed
          // nothing unjudged: read off the commit itself, whether or not anyone looked since.
          let held = await holdsJudged(ctx, task, receipt, commit, path)
          for (const seen of kept.restored.get(path)?.heads ?? [])
            held = held || (await within(commit, seen))
          stands(path, !held)
        }
      }
    }
    const scope = revisionPaths(task.repoRoot, [
      ...new Set([...owned, ...times.keys(), ...touched]),
    ])
    // A planned input outside the checkout is part of the judged revision, and git cannot compare
    // it with what the judge read. When the revision moved and the Plan names such an input, the
    // content check below cannot vouch for it: the pass is withdrawn, naming those inputs.
    if (revisionMoved && scope.external.length > 0) return scope.external
    const local = scope.local
    if (local.length === 0 || local.length > 4096) return unknown
    const specs = productionSpecs(local, combined)
    const names = ["diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv"]
    const run = (args: string[]) => ctx.git.run(task.repoRoot, [...args, "--", ...specs], options)
    const [sinceJudged, uncommitted, untracked, committed] = await Promise.all([
      run([...names, head]),
      run([...names, "HEAD"]),
      run(["ls-files", "--others", "--exclude-standard", "-z"]),
      run([...names, head, "HEAD"]),
    ])
    if ([sinceJudged, uncommitted, untracked, committed].some((result) => result.code !== 0))
      return unknown
    const loose = new Set([...zPaths(uncommitted.stdout), ...zPaths(untracked.stdout)])
    const changed: string[] = []
    for (const path of new Set([
      ...zPaths(sinceJudged.stdout),
      ...zPaths(untracked.stdout),
      ...Object.keys(judgedFiles),
    ])) {
      const was = judgedFiles[path]
      // Read uncommitted by the judge and the same bytes now, wherever they are kept.
      if (was !== undefined && was === (await fileRevision(ctx, join(task.repoRoot, path))))
        continue
      changed.push(path)
    }
    // The task's own files that are as the judge read them: what it did to them is undone, and a
    // later change to one of them by someone else is not the task's.
    await restore(
      ctx,
      task,
      receipt,
      kept,
      headBefore,
      [...own].filter((path) => !changed.includes(path)),
    )
    if (changed.length === 0) return null
    const mine = changed.filter((path) => own.has(path))
    if (mine.length > 0) return mine
    const open = changed.filter((path) => loose.has(path))
    const theirs = await theirLoose(ctx, task, open, kept)
    if (receipt.observed !== true || !kept.complete) {
      // No hooks saw the task's sessions (an older receipt, an agent without hooks), or they
      // could not tell what a session committed, or the kept record cannot be read: nothing
      // shows that an unrecorded change is not the task's own. A changed file keeps the pass only
      // on content evidence that it is someone else's. Uncommitted: another task's by its bytes
      // (`theirLoose`). Committed: every version of the file a commit since the judged one holds
      // is either the bytes the judge read, or bytes another task's session recorded for that
      // file when it edited it, which no record of this task's sessions holds too. Bytes another
      // session wrote and recorded are that session's work. A record that a commit fell into
      // another task's window is no such evidence: it does not say who wrote the commit. Where
      // no digest decides, the pass is withdrawn. Time decides nothing here, and neither does a
      // rewritten history: files that hold the judged bytes are not changed.
      const doubtful: string[] = []
      for (const path of changed) {
        if (loose.has(path)) {
          if (!theirs.has(path)) doubtful.push(path)
          continue
        }
        const log = await ctx.git.run(
          task.repoRoot,
          ["log", "--format=%H", "-n", "17", `${head}..HEAD`, "--", `:(literal)${path}`],
          options,
        )
        const versions = log.stdout.split("\n").filter((sha) => sha.trim() !== "")
        // Too many versions to read each: undecided.
        let foreign = log.code === 0 && versions.length > 0 && versions.length <= 16
        const recorded = foreign ? await recordedBytes(ctx, repo, task.slug, path) : null
        for (const commit of foreign ? versions : []) {
          const digest = await committedDigest(ctx, task, commit, path)
          const theirBytes =
            digest !== null && recorded?.theirs.has(digest) === true && !recorded.ours.has(digest)
          if (!theirBytes && !(await holdsJudged(ctx, task, receipt, commit, path))) foreign = false
        }
        if (!foreign) doubtful.push(path)
      }
      return doubtful.length > 0 ? doubtful : null
    }
    // Read uncommitted by the judge, different now, and neither uncommitted nor committed since:
    // taken back in the working tree, by a hand no record names.
    const landed = new Set(zPaths(committed.stdout))
    const takenBack = changed.filter(
      (path) => judgedFiles[path] !== undefined && !loose.has(path) && !landed.has(path),
    )
    if (takenBack.length > 0) return takenBack
    const unclaimed = open.filter((path) => !theirs.has(path))
    return unclaimed.length > 0 ? unclaimed : null
  } catch {
    return unknown
  }
}

/**
 * The one answer to "does the counted pass cover this task as it is": the round passed, no fresh
 * review was asked for, and neither the Plan, a deviation nor the code moved since the judge was
 * handed out. A combined review's tests and docs added after it ruled do not move it. Verify
 * and Review both ask this, so they cannot disagree; `moved` says what changed.
 */
export async function passStanding(ctx: Ctx, task: Task): Promise<PassStanding> {
  if (await checkedWithoutIndependentJudge(ctx, task)) return { stands: true }
  if (!(await verificationCurrent(ctx, task)))
    return { stands: false, moved: ["No judge's pass is counted for this round"] }
  const receipt = await readAssignment(ctx, task)
  if (receipt === null || receipt.result !== "pass")
    return { stands: false, moved: ["The last round is not recorded as passed"] }
  if (receipt.withdrawn === true) return { stands: false, moved: ["A fresh review was asked for"] }
  const moved: string[] = []
  if (receipt.context !== (await verificationContextRevision(ctx, task))) {
    const words = await staleContext(ctx, task, receipt)
    moved.push(...(words.length > 0 ? words : ["The Plan or a deviation changed"]))
  }
  const code = await codeMoved(ctx, task, receipt)
  if (code !== null) moved.push(code)
  return moved.length === 0 ? { stands: true } : { stands: false, moved }
}

/** The build is verified: the round's judge passed it. Later edits do not undo that. */
export async function verificationCurrent(ctx: Ctx, task: Task): Promise<boolean> {
  const receipt = await readAssignment(ctx, task)
  if (await checkedWithoutIndependentJudge(ctx, task)) return true
  // A round counter that moved on without a new judge being handed out (Review sent the task back
  // and nothing of the task changed) does not void the last judged round: the same pass is read
  // again, never a fresh reviewer for unchanged work (Max, 10 November 2026, a tenth round).
  if (receipt === null || receipt.iteration > task.iterations) return false
  if (receipt.iteration !== task.iterations && receipt.result !== "pass") return false
  try {
    const iteration = lastIteration(await readBuildRecord(ctx, task))
    return iteration?.assignment === receipt.id && iteration.result === "pass"
  } catch {
    return false
  }
}

export { evidenceFolder }
