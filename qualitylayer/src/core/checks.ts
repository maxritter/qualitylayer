// `qualitylayer check`: the CLI runs the commands the Plan approved and records
// their exit codes, so a check is the CLI's record, not the agent's claim.
// `check slice N` runs a slice's Validation commands, `check task T<n>` a card's
// verify command, `check all` the Plan's project checks. A command an agent
// changed after the approval is not run: the record says so, and the agent runs
// it through its own permission prompt. Bounded raw output goes to the runtime folder;
// one line per command goes in the task's Checks record. A red record is evidence
// the reviewer rules on; nothing here classifies, reruns or splits a failure.

import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { boundedLog, capturedOutput } from "./bounded-log.ts"
import {
  type CheckProgress,
  type CommandResult,
  checkProgressPath,
  progressParser,
  readCheckProgress,
  writeCheckProgress,
} from "./check-progress.ts"
import {
  materializeChecksRecord,
  REFUSED_CHECK,
  readCheckRecords,
  saveCheckReceipt,
} from "./check-receipts.ts"
import { commandBun } from "./checks-runtime.ts"
import { scanLine } from "./code-quality/scanners/scan.ts"
import { runTaskScans } from "./code-quality/scanners/task-scans.ts"
import {
  type ApprovedCommands,
  projectChecks,
  sliceCommands,
  taskCommands,
} from "./docs/commands.ts"
import { allTasks } from "./docs/outline.ts"
import { readCards } from "./docs/outline-files.ts"
import { readBaseline } from "./gate/baseline.ts"
import { buildOwnPaths, buildRevision, fileRevision, within } from "./gate/revision.ts"
import { currentBranch } from "./git/repo.ts"
import { revisionPaths } from "./git/revision-paths.ts"
import { foreignLooseEdits, keptOwnChanges, ownEdits } from "./git/session-edits.ts"
import { notIsolatedWords, onSliceTree, ownFiles } from "./git/slice-tree.ts"
import { CHECKS_ALL_KIND, recordDuration } from "./helper-history.ts"
import { mergedPath, processLoginPath, toolchainFolders } from "./login-path.ts"
import { killProcessTree } from "./platform.ts"
import { skippedRequiredRuns } from "./required-skips.ts"
import { hasReviewCandidate, selectedReviewCandidate } from "./review-candidate.ts"
import { pidAlive, selfCommand } from "./self.ts"
import { planDetailsText, type Task } from "./task/store.ts"

export { readCheckRecords, recordsPath } from "./check-receipts.ts"

/** Each command may run this long before it is stopped. */
export const CHECK_TIMEOUT_MS = 15 * 60_000
/** How long a check waits for another running check of the task: longer than one check may run. */
export const CHECK_LOCK_WAIT_MS = 20 * 60_000

/** What to do with a red project check: the moves in the order to think of them, for every reply that reports one. */
export const RED_CHECK_MOVES =
  "A project check is red. Fix what the task caused within the approved scope. If you believe it was red before this task, run `qualitylayer check all --base`: it runs the same checks on a copy of the task's base commit and matches failing tests by name. Only a test that also fails there is excused. A lint, type or build check names no test, so a red base run requires the person's decision. Ask when only the person can decide how to proceed."

/** An explicit budget for a slow approved check; invalid values keep the default. */
export function checkTimeoutMs(ctx: Ctx): number {
  const value = Number(ctx.env.get("QUALITYLAYER_CHECK_TIMEOUT_MS"))
  return Number.isSafeInteger(value) && value > 0 && value <= 2 * 60 * 60_000
    ? value
    : CHECK_TIMEOUT_MS
}

/** A null exit alone cannot distinguish a timeout from another interruption. */
export type Ran = {
  exit: number | null
  ms: number
  output: string
  timedOut?: true
  /** The files other sessions changed in the checkout that a rerun on HEAD plus the slice's files left out. */
  isolated?: string[]
  /**
   * Of those, the untracked files that no card names and no session of the task wrote: not the
   * task's source, whoever left them (slice-tree.ts, `onSliceTree`).
   */
  strays?: string[]
  /** The run in the checkout that failed before that rerun; `output` begins with its output. */
  first?: { exit: number | null; output: string }
  /**
   * For that rerun: why it did none of its work, or null when it did, decided in the copy it ran in
   * before the copy was removed. The checkout cannot say: its package.json may be another session's.
   */
  notRun?: string | null
  /**
   * For a failed run that was not run again on a clean copy: why (slice-tree.ts, `onSliceTree`).
   * `unclaimed` carries the changed files its output names that no other session's record claims.
   */
  notIsolated?: { why: "nothing-else-changed" | "unclaimed" | "unnamed"; named?: string[] }
}

/** Runs one command in the repository with its input closed; tests pass their own. */
export type CommandRunner = (
  command: string,
  cwd: string,
  timeoutMs: number,
  stream?: {
    output(chunk: string): Promise<void>
    env?: Record<string, string | undefined>
    isolated?: boolean
  },
) => Promise<Ran>

/** Windows descendants share the hidden console; Unix checks need a group for timeout cleanup. */
export const checkProcessOptions = (platform: string = process.platform) => ({
  detached: platform !== "win32",
  windowsHide: true,
})

/** A killed shell can exit before its descendants receive SIGKILL and init reaps them. */
async function awaitStoppedCommandGroup(pid: number, deadline: number): Promise<void> {
  if (process.platform === "win32") return
  for (;;) {
    try {
      process.kill(-pid, 0)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ESRCH") return
      throw cause
    }
    if (Date.now() >= deadline)
      throw new Error("The stopped command's process group still exists at its deadline")
    await Bun.sleep(1)
  }
}

/** The real runner: the platform's shell, input closed, stopped at the time limit. */
export const shellRunner: CommandRunner = async (command, cwd, timeoutMs, stream) => {
  const started = Date.now()
  const windows = process.platform === "win32"
  const shell = windows ? ["cmd", "/d", "/s", "/c", `"${command}"`] : ["sh", "-c", command]
  // The person's login PATH is merged in: an agent's tool shell often lacks folders such as
  // ~/.cargo/bin, and a check must find the tools the person's own terminal finds.
  const base = stream?.env ?? process.env
  const login = stream?.isolated ? null : await processLoginPath()
  // Then the toolchains' own folders (~/.cargo/bin and the like), which a login PATH can lack too.
  const env =
    login === null
      ? base
      : {
          ...base,
          PATH: mergedPath(
            mergedPath(base.PATH, login),
            toolchainFolders(base.HOME ?? process.env.HOME),
          ),
        }
  const proc = Bun.spawn(shell, {
    cwd,
    ...checkProcessOptions(),
    windowsVerbatimArguments: windows,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env,
  })
  const deadline = Date.now() + timeoutMs
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      killProcessTree(proc.pid)
    } catch {
      proc.kill("SIGKILL")
    }
  }, timeoutMs)
  let output = ""
  let writes = Promise.resolve()
  const consume = async (pipe: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    for await (const bytes of pipe) {
      const chunk = decoder.decode(bytes, { stream: true })
      output = capturedOutput(output, chunk)
      if (stream) {
        writes = writes.then(() => stream.output(chunk))
        await writes
      }
    }
    const tail = decoder.decode()
    output = capturedOutput(output, tail)
    if (tail && stream) await stream.output(tail)
  }
  const consumers = [consume(proc.stdout), consume(proc.stderr)]
  try {
    const [, , code] = await Promise.all([...consumers, proc.exited])
    return {
      exit: timedOut ? null : (code as number),
      ms: Date.now() - started,
      output,
      ...(timedOut ? { timedOut: true as const } : {}),
    }
  } catch (cause) {
    try {
      killProcessTree(proc.pid)
    } catch {
      proc.kill("SIGKILL")
    }
    await Promise.allSettled([...consumers, proc.exited])
    try {
      await awaitStoppedCommandGroup(proc.pid, Math.min(deadline, Date.now() + 1000))
    } catch (cleanup) {
      throw new AggregateError(
        [cause, cleanup],
        `${String(cause)}; command cleanup did not complete`,
      )
    }
    throw cause
  } finally {
    clearTimeout(timer)
  }
}

export type CheckScope =
  | { kind: "slice"; n: number }
  | { kind: "task"; id: string }
  | { kind: "all" }

export type CheckResult = {
  timedOut?: true
  timeoutMs?: number
  reused?: true
  command: string
  /** False when QualityLayer did not run it: it changed after the approval. */
  ran: boolean
  exit: number | null
  secs: number
  /** The full output, in the runtime folder; null when it did not run. */
  log: string | null
  passed: boolean
  /** Why the command did none of its work although it ran, whatever its exit code said. */
  notRun?: string
}

export type CheckReply = {
  scope: string
  revision: string
  passed: boolean
  results: CheckResult[]
  /** The commands the agent must run itself: they changed after the approval. */
  run_yourself?: string[]
  message?: string
}

/** What a check's key was made of, per own file, so a reply can name what changed since. */
export type CheckParts = { files: Record<string, string>; toolchain: string }

/** One record per run, kept in the runtime folder: what the judge and Verify read. */
export type CheckRecord = {
  timedOut?: true
  timeoutMs?: number
  key?: string
  /** The key without the PATH of the process that ran it: what the source and toolchain were. */
  inputs?: string
  /** For a build with its own files: each file's digest and the toolchain's, to name what changed. */
  parts?: CheckParts
  reused?: true
  check?: string
  /** HEAD when this check started, for release readiness and CI comparisons. */
  head?: string
  /** The checkout's branch when the check started. Detached and older receipts have no branch. */
  branch?: string
  /** `all`, `slice N`, a task id, or `base`: the project checks run on a copy of the task's base commit (then `revision` is that commit). */
  scope: string
  command: string
  exit: number | null
  revision: string
  at: number
  ran: boolean
  /** How long the command ran, for the Verify header's minutes. */
  ms?: number
  /** The full output of the run, in the runtime folder. */
  log?: string
  /** Why the command did none of its work; such a record is never a pass, whatever `exit` says. */
  notRun?: string
  /**
   * The result is of a run on a clean copy (HEAD plus the task's own files), made after the
   * command failed in the checkout: the files that copy left out. A reviewer reads this run as
   * the check's result.
   */
  leftOut?: string[]
  /** Of those, the untracked files no card names and no session of the task wrote. */
  strays?: string[]
  /** Exact display lines for this run, stored once with its final command. */
  display?: { version: 1; lines: string[] }
}

export const lockPath = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "check.lock")

/**
 * Each scope's latest run, one record per command: a later run of a scope replaces the earlier one
 * whole, so a command it no longer runs (the Plan's checks changed) leaves no stale red result.
 */
export function latestRuns(records: readonly CheckRecord[]): CheckRecord[] {
  const lastRun = new Map<string, string | undefined>()
  for (const check of records) lastRun.set(check.scope, check.check)
  return [
    ...new Map(
      records
        .filter((check) => check.check === undefined || check.check === lastRun.get(check.scope))
        .map((check) => [`${check.scope}:${check.command}`, check]),
    ).values(),
  ]
}

/** A link's identity and current terminal content, with no directory walk or cycle following. */
async function inputEntry(ctx: Ctx, absolute: string): Promise<unknown> {
  if (!ctx.fs.lstat) throw new Error("Filesystem entry metadata is unavailable")
  const links: [string, number][] = []
  let current = absolute
  for (let depth = 0; depth <= 40; depth++) {
    const entry = await ctx.fs.lstat(current)
    if (entry === null) {
      if (links.length > 0) throw new Error(`Dangling link at ${absolute}; restore its target`)
      return { kind: "missing" }
    }
    if (entry.kind === "symlink") {
      if (!ctx.fs.readlink) throw new Error(`Link metadata is unavailable for ${absolute}`)
      const target = await ctx.fs.readlink(current)
      links.push([target, entry.mode & 0o111])
      current = resolve(dirname(current), target)
      continue
    }
    if (entry.kind !== "file")
      throw new Error(
        `Cannot prove ${entry.kind} input at ${absolute}; use a regular file or initialized Git submodule`,
      )
    return {
      kind: links.length > 0 ? "symlink" : "file",
      links,
      revision: await fileRevision(ctx, current),
      executable: entry.mode & 0o111,
    }
  }
  throw new Error(`Link chain at ${absolute} exceeds 40 links; remove the cycle or shorten it`)
}

/** Parent queries keep their namespace/index; modules use their own actual checkout. */
async function repositoryInputs(
  ctx: Ctx,
  root: string,
  own: string[] | null,
  depth = 0,
): Promise<unknown[]> {
  if (depth > 32) throw new Error(`Submodule nesting exceeds 32 levels at ${root}`)
  const options = depth > 0 ? ({ childRepository: true } as const) : undefined
  const files = await ctx.git.run(
    root,
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    options,
  )
  const staged = await ctx.git.run(root, ["ls-files", "--stage", "-z"], options)
  if (files.code !== 0 || staged.code !== 0)
    throw new Error(`Git input inventory is unavailable at ${root}`)
  const modules = new Set<string>()
  for (const entry of staged.stdout.split("\0")) {
    const link = entry.match(/^160000 [0-9a-f]+ [0-3]\t(.+)$/s)
    if (link?.[1]) modules.add(link[1])
  }
  const paths = new Set([...files.stdout.split("\0").filter(Boolean), ...modules])
  const contents: unknown[] = []
  for (const path of [...paths].sort()) {
    if (depth === 0 && path.startsWith("docs/plans/")) continue
    // Another session's file in the same checkout is not the build's input.
    if (depth === 0 && own !== null && !modules.has(path) && !within(own, path)) continue
    const absolute = join(root, path)
    if (!modules.has(path)) {
      contents.push([path, await inputEntry(ctx, absolute)])
      continue
    }
    const entry = await ctx.fs.lstat?.(absolute)
    // Presence of its own .git prevents git from walking up to the parent for an empty module.
    const marker = await ctx.fs.lstat?.(join(absolute, ".git"))
    if (entry?.kind !== "directory" || (marker?.kind !== "file" && marker?.kind !== "directory"))
      throw new Error(
        `Submodule ${absolute} is uninitialized; initialize it locally before recording check proof`,
      )
    const head = await ctx.git.run(absolute, ["rev-parse", "--verify", "HEAD"], {
      childRepository: true,
    })
    if (head.code !== 0 || !/^[0-9a-f]{40,64}$/.test(head.stdout.trim()))
      throw new Error(`Submodule revision is unavailable at ${absolute}; restore its checkout`)
    contents.push([
      path,
      {
        kind: "gitlink",
        head: head.stdout.trim(),
        executable: entry.mode & 0o111,
        contents: await repositoryInputs(ctx, absolute, null, depth + 1),
      },
    ])
  }
  return contents
}

/**
 * The hash of a command's complete working inputs (the build's own files, lockfiles, the Bun
 * version, a supplied test program): the freshness proof of a check record. Null when the inputs
 * cannot be read; `unavailable` says why.
 */
export async function checkKey(
  ctx: Ctx,
  task: Task,
  command: string,
  bunVersion?: string,
  unavailable?: (reason: string) => void,
): Promise<string | null> {
  return (await checkKeys(ctx, task, command, bunVersion, unavailable))?.key ?? null
}

/**
 * `key` is the proof of freshness a rerun may reuse. `inputs` is the same hash without the calling
 * process's PATH: what the source and the toolchain were, so that another session on the same task
 * (a different shell, an activated environment) still reads a record as current.
 */
export async function checkKeys(
  ctx: Ctx,
  task: Task,
  command: string,
  bunVersion?: string,
  unavailable?: (reason: string) => void,
): Promise<{ key: string; inputs: string; parts?: CheckParts } | null> {
  let bun = bunVersion
  if (bun === undefined) {
    // Only a command that uses Bun is bound by its version; a project without Bun is proven by
    // its own inputs, as on a customer's machine that has none.
    const found = await commandBun(ctx, task.repoRoot, command, async () => {
      if (ctx.runtime) return ctx.runtime.bunVersion(task.repoRoot)
      const version = await shellRunner("bun --version", task.repoRoot, 10_000)
      return version.exit === 0 && version.output.trim() ? version.output.trim() : null
    })
    if ("unavailable" in found) {
      unavailable?.(found.unavailable)
      return null
    }
    bun = found.bun
  }
  let contents: unknown[]
  const locks: [string, unknown][] = []
  let program: string | null = null
  let own: string[] | null = null
  try {
    own = await buildOwnPaths(ctx, task)
    contents = await repositoryInputs(ctx, task.repoRoot, own)
    for (const path of [
      "bun.lock",
      "bun.lockb",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "qualitylayer/bun.lock",
    ])
      if (await ctx.fs.lstat?.(join(task.repoRoot, path)))
        locks.push([path, await inputEntry(ctx, join(task.repoRoot, path))])
    // A suite that drives a supplied program is bound by that program's bytes, never its path.
    const supplied = ctx.env.get("QUALITYLAYER_TEST_BINARY")
    if (supplied !== undefined && supplied.trim() !== "")
      program = await fileRevision(ctx, resolve(task.repoRoot, supplied))
  } catch (cause) {
    unavailable?.(cause instanceof Error ? cause.message : String(cause))
    return null
  }
  const inputs = {
    inputFormat: 4,
    contents,
    locks,
    program,
    command,
    os: process.platform,
    arch: process.arch,
    bun,
  }
  const digest = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex")
  const short = (value: unknown) => digest(value).slice(0, 16)
  return {
    key: digest({ ...inputs, path: ctx.env.get("PATH") ?? "" }),
    inputs: digest(inputs),
    // Only a build with its own files keeps them one by one: a whole repository would be too many.
    ...(own !== null
      ? {
          parts: {
            files: Object.fromEntries(
              (contents as [string, unknown][]).map(([path, entry]) => [path, short(entry)]),
            ),
            toolchain: short({ ...inputs, contents: undefined }),
          },
        }
      : {}),
  }
}

/** A moment as the hour and minute on this machine's clock: `14:32`. */
function clockTime(at: number): string {
  const when = new Date(at)
  return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`
}

const scopeName = (scope: CheckScope) =>
  scope.kind === "slice" ? `slice ${scope.n}` : scope.kind === "task" ? scope.id : scope.kind

function initialProgress(
  ctx: Ctx,
  check: string,
  scope: string,
  commands: string[],
): CheckProgress {
  const started = ctx.clock.now()
  return {
    check,
    scope,
    started,
    command: commands[0] ?? "",
    i: 1,
    of: commands.length,
    files: { done: 0, total: null },
    passed: 0,
    failed: 0,
    pid: process.pid,
    heartbeat: started,
    running: true,
    queued: true,
  }
}

/** Start the same CLI as a detached worker; it records progress even after the starter exits. */
export async function startCheck(
  ctx: Ctx,
  task: Task,
  scope: CheckScope,
): Promise<Result<{ check: string; running: true; wait: string }>> {
  const commands = await commandsFor(ctx, task, scope)
  if (!commands.ok) return commands
  if (commands.data.now.length === 0)
    return err({ code: "bad_args", message: `${scopeName(scope)} names no command to run` })
  const check = randomUUID()
  const progress = initialProgress(ctx, check, scopeName(scope), commands.data.now)
  await writeCheckProgress(ctx, task, progress)
  const args =
    scope.kind === "all"
      ? [scope.kind]
      : scope.kind === "slice"
        ? ["slice", String(scope.n)]
        : ["task", scope.id]
  const [exe, ...rest] = selfCommand(["check", ...args, "--worker", check])
  const child = spawn(exe ?? process.execPath, rest, {
    cwd: task.repoRoot,
    // The worker survives its starter; its command shell uses checkProcessOptions instead.
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, QUALITYLAYER_HOME: ctx.home },
  })
  child.on("error", () => {
    /* a missing worker is reconciled through progress */
  })
  child.unref()
  // The starter stays alive until the worker claims the file; it never overwrites worker progress.
  const deadline = ctx.clock.now() + 2000
  while (child.pid && pidAlive(child.pid) && ctx.clock.now() < deadline) {
    const current = JSON.parse(
      await ctx.fs.readFile(checkProgressPath(task, check)),
    ) as CheckProgress
    if (current.pid === child.pid) break
    await ctx.clock.sleep(20)
  }
  return ok({ check, running: true, wait: "qualitylayer wait" })
}

/** The commands the Plan names for a scope now, and the ones the approval covered. */
export async function commandsFor(
  ctx: Ctx,
  task: Task,
  scope: CheckScope,
): Promise<Result<{ now: string[]; approved: string[] | null }>> {
  const details = await planDetailsText(ctx, task)
  if (details === null) return err({ code: "no_task", message: "the task has no Plan yet" })
  const outline = await readCards(ctx, task.dir)
  const approved: ApprovedCommands | undefined = (await readBaseline(ctx, task))?.commands
  if (scope.kind === "slice") {
    const slice = outline.slices.find((s) => s.n === scope.n)
    if (slice === undefined)
      return err({ code: "bad_args", message: `the Plan has no slice ${scope.n}` })
    return ok({
      now: sliceCommands(slice),
      approved: approved?.slices[String(scope.n)] ?? null,
    })
  }
  if (scope.kind === "task") {
    const card = allTasks(outline).find((t) => t.id.toUpperCase() === scope.id.toUpperCase())
    if (card === undefined)
      return err({ code: "bad_args", message: `the Plan has no task ${scope.id}` })
    return ok({
      now: taskCommands(card),
      approved: approved?.tasks[card.id] ?? null,
    })
  }
  return ok({
    now: projectChecks(details),
    approved: approved?.all ?? null,
  })
}

/** The commit a record line names: short enough to read, exact enough to find. */
async function shortRev(ctx: Ctx, task: Task): Promise<string> {
  const head = await ctx.git.run(task.repoRoot, ["rev-parse", "--short", "HEAD"])
  return head.code === 0 ? head.stdout.trim() : "no-commit"
}

/** A whole output line saying the command could not run, or the test run selected nothing. */
const REFUSALS = [
  /^error: Script not found ".*"$/,
  /^note: a package\.json script ".*" was not found$/,
  /^npm (?:error|ERR!) missing script: .+$/i,
  /^(?:ERR_PNPM_NO_SCRIPT|ERR_PNPM_NO_PKG_MANIFEST)\b.*$/,
  /^error Command ".*" not found\.$/,
  /^(?:\S+: )+(?:command )?not found$/,
  /^(?:sh|bash|zsh|dash): command not found: \S+$/,
  /^'.*' is not recognized as an internal or external command/,
  /^(?:Test Files|Tests)\s+(\d+)\s+skipped\s+\(\1\)$/,
  // A test run that found no test at all (an empty base checkout, say) has proved nothing either way.
  /^error: 0 test files matching\b.*$/,
  /^No tests found\b.*$/i,
  // This repository's own test runner (scripts/test.ts) when it stopped before any test ran.
  /^INCOMPLETE (?:BUILD|RUNTIME|GENERATED UI)\b.*\bno tests ran\b/i,
]

/** `bun run test x`, `cd app && npm run lint`: the folder the script runs in and the script's name. */
const SCRIPT_RUN =
  /^(?:cd\s+(?:"([^"]*)"|'([^']*)'|(\S+))\s*&&\s*)?(bun|npm|pnpm|yarn)\s+run\s+([A-Za-z][\w:.-]*)(?:\s|$)/

/**
 * Why a command that ran did none of its work, or null when it did. The runner's own refusal in its
 * output counts whatever the exit code; so does a script run where no package.json names it, which
 * bun answers by running a system command of that name and exiting 0 with nothing to say.
 */
export async function notRunReason(
  ctx: Ctx,
  command: string,
  cwd: string,
  ran: Ran,
): Promise<string | null> {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips the colour codes of a runner's output
  const lines = ran.output.replace(/\u001b\[[0-9;]*m/g, "").split("\n")
  for (const line of lines) {
    const text = line.trim()
    if (REFUSALS.some((refusal) => refusal.test(text))) return text
  }
  if (ran.exit === 127) return "command not found (exit 127)"
  if (ran.exit !== 0) return null
  const script = command.trim().match(SCRIPT_RUN)
  if (script === null) return null
  const dir = resolve(cwd, script[1] ?? script[2] ?? script[3] ?? ".")
  const name = script[5] ?? ""
  // Bun also runs a file or a local binary by name: that is a run, not a missing script.
  if (
    script[4] === "bun" &&
    ((await ctx.fs.exists(join(dir, name))) ||
      (await ctx.fs.exists(join(dir, "node_modules", ".bin", name))))
  )
    return null
  const manifest = join(dir, "package.json")
  if (!(await ctx.fs.exists(manifest))) return `no package.json in ${dir}`
  try {
    const scripts = (JSON.parse(await ctx.fs.readFile(manifest)) as { scripts?: object }).scripts
    return scripts !== undefined && name in scripts ? null : `package.json has no "${name}" script`
  } catch {
    return `package.json in ${dir} cannot be read`
  }
}

/** What one run returned, in words: `exit 2`, `exit 0, did none of its work (…)`. */
function runOutcome(
  ran: Pick<Ran, "exit" | "timedOut">,
  notRun: string | null,
  where = "",
): string {
  const exit = `${ran.timedOut ? "stopped at the time limit" : ran.exit === null ? "no exit code" : `exit ${ran.exit}`}${where}`
  if (notRun === null) return exit
  return `${exit}, did none of its work (${notRun.length > 160 ? `${notRun.slice(0, 160)}…` : notRun})`
}

/** The failed command's own last line of output, so the reply carries its reason and not only an exit code. */
function lastWord(output: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips the colour codes of a runner's output
  const lines = output.replace(/\u001b\[[0-9;]*m/g, "").split("\n")
  const last = lines.findLast((line) => line.trim() !== "")?.trim()
  if (last === undefined) return ""
  return ` Its output ends: "${last.length > 200 ? `${last.slice(0, 200)}…` : last}".`
}

/** What to do when a card's or slice's check is red for something a later card builds. */
const LATER_CARD_MOVE =
  'If it fails only because it names something a later card builds (a test file or a script step that does not exist yet), move that part of the verify line to the card that builds it, record it with qualitylayer plan amend --by agent --for T<n> --note "<why>", and run the check again.'

/** The reply's line for a failed command: which one, what it returned, and what a rerun on the clean copy returned. */
function failedLine(
  command: string,
  ran: Ran,
  notRun: string | null,
  firstNotRun: string | null,
  whose: "slice" | "task" | null,
): string {
  if (ran.first === undefined)
    return `\`${command}\` failed: ${runOutcome(ran, notRun)}${whose !== null ? notIsolatedWords(ran) : ""}.${lastWord(ran.output)}`
  return `\`${command}\`: ${runOutcome(ran.first, firstNotRun, " in this checkout")}; run again on a copy of HEAD plus this ${whose ?? "slice"}'s own files: ${runOutcome(ran, notRun)}, so it failed.`
}

/**
 * Run a scope's approved commands, one after another, and record each. Two checks of one task
 * never run at the same time.
 */
export async function runCheck(
  ctx: Ctx,
  task: Task,
  scope: CheckScope,
  runner: CommandRunner = shellRunner,
  checkId: string = randomUUID(),
): Promise<Result<CheckReply>> {
  const candidate = task.stage === "verify" ? await selectedReviewCandidate(ctx, task) : null
  if (candidate) task = { ...task, repoRoot: candidate.choice.checkout }
  const found = await commandsFor(ctx, task, scope)
  if (!found.ok) return found
  const noCommands = () =>
    err({
      code: "bad_args",
      message:
        scope.kind === "all"
          ? "the Plan names no `**Project checks:**` commands"
          : `${scopeName(scope)} names no command to run`,
    })
  if (found.data.now.length === 0) return noCommands()
  await ctx.fs.mkdir(task.runtimeDir)
  const name = scopeName(scope)
  // Another check of this task may run for minutes: wait for it as long as it runs.
  const wait = {
    waitMs: Math.max(CHECK_LOCK_WAIT_MS, checkTimeoutMs(ctx) + 5 * 60_000),
    label: `check ${name}`,
    onWait: (line: string) => process.stderr.write(`${line}\n`),
  }
  // Until the lock is held the run waits: it stays pending and alive, but names no running command.
  const progress = initialProgress(ctx, checkId, name, found.data.now)
  await writeCheckProgress(ctx, task, progress)
  let writes = Promise.resolve()
  const beat = setInterval(() => {
    if (!progress.running) return
    progress.heartbeat = ctx.clock.now()
    writes = writes.then(() => writeCheckProgress(ctx, task, progress))
  }, 2000)
  try {
    return await ctx.fs.withLock(
      lockPath(task),
      async () => {
        const selected = task.stage === "verify" ? await selectedReviewCandidate(ctx, task) : null
        if (selected?.id !== candidate?.id)
          return err({
            code: "bad_args",
            message: "The selected review commit changed. Run the check on the current candidate.",
          })
        // Reconcile previous attempts before this run can publish newer evidence.
        await readCheckProgress(ctx, task)
        // The Plan or its approval may have changed while this run waited: run what they say now.
        const current = await commandsFor(ctx, task, scope)
        if (!current.ok) return current
        if (current.data.now.length === 0) return noCommands()
        const commands = current.data
        const rev = await shortRev(ctx, task)
        const base = rev === "no-commit" ? "no commit" : `base ${rev}`
        const workingTree = `working tree (${base})`
        const revision = await buildRevision(ctx, task).catch(() => rev)
        const commit = await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"])
        const head = commit.code === 0 ? commit.stdout.trim() : undefined
        const branch = scope.kind === "all" ? await currentBranch(ctx, task.repoRoot) : null
        const logs = join(task.runtimeDir, "checks")
        await ctx.fs.mkdir(logs)
        const results: CheckResult[] = []
        progress.results = []
        const finish = (result: CheckResult) => {
          results.push(result)
          const done: CommandResult = {
            command: result.command,
            ran: result.ran,
            passed: result.passed,
            ...(result.timedOut ? { timedOut: true, timeoutMs: result.timeoutMs } : {}),
          }
          progress.results?.push(result.reused ? { ...done, reused: true } : done)
        }
        // When the commands began: the forecast's "checks-all" time leaves out any wait for the lock.
        const commandsBegan = ctx.clock.now()
        // The security scans run beside the project's commands; their record never decides a check.
        const scans =
          scope.kind === "all" && !candidate ? runTaskScans(ctx, task) : Promise.resolve(null)
        const lines: string[] = []
        // A command fails in a shared checkout for others' unfinished edits too: such a failure is run
        // again on HEAD plus the slice's (or, for `all`, the whole task's) own files, and that run is
        // the verdict. A task that names no files has nothing to lay over HEAD. Whatever this task's
        // own sessions edited stays in the copy, on a card or not. Left out are others' files: those
        // another session's record claims, and untracked files no session of this task wrote.
        const whose = scope.kind === "all" ? "task" : "slice"
        const named = candidate
          ? null
          : scope.kind === "all"
            ? await buildOwnPaths(ctx, task).catch(() => null)
            : await ownFiles(ctx, task, scope)
        const repoIds = { id: task.repoId, root: task.repoRoot }
        // What the task's sessions recorded writing: their edit records (three days), and the
        // record kept with the task's judge, which does not expire.
        const edited = await ownEdits(ctx, repoIds, task.slug)
        const kept = await keptOwnChanges(ctx, task.runtimeDir).catch(() => null)
        const own =
          named === null ? null : [...new Set([...named, ...edited, ...(kept?.files.keys() ?? [])])]
        const notRunIn = (ran: Ran, command: string, cwd: string) =>
          notRunReason(ctx, command, cwd, ran)
        // Another task's file by the bytes its record holds, where it holds them: a file written
        // again since by nobody's record stays in the copy.
        const theirs = (paths: string[]) => foreignLooseEdits(ctx, repoIds, task.slug, paths)
        const judge =
          own === null
            ? runner
            : onSliceTree(task, own, runner, { notRun: notRunIn, theirs, whose })
        const isolatedFiles = new Set<string>()
        /** Of those, the untracked files no card names and no session of the task wrote. */
        const strayFiles = new Set<string>()
        /** The commands that were run again on the clean copy. */
        const isolatedCommands: string[] = []
        /** The commands whose files were saved under both of their runs: no result, not a failure. */
        const unsettledCommands = new Set<string>()
        /** One line per command that was run again because its files were saved during its first run. */
        const rerunNotes: string[] = []
        /** One line per command that failed, for the reply's message. */
        const failed: string[] = []
        const records = await readCheckRecords(ctx, task)
        const initialRecords = records.length
        const unavailableInputs = new Set<string>()
        const unavailable = (reason: string) => unavailableInputs.add(reason)
        /** True when a command's inputs changed while it ran: the record keeps no key. */
        let changedWhileRunning = false
        /** The command being run: its log once written, its result once it ended. */
        let running: { log: string; ran?: Awaited<ReturnType<typeof judge>> } | null = null
        try {
          for (const [i, command] of commands.now.entries()) {
            running = null
            delete progress.queued
            Object.assign(progress, {
              command,
              i: i + 1,
              of: commands.now.length,
              updated: ctx.clock.now(),
              files: { done: 0, total: null },
              passed: 0,
              failed: 0,
              reused: false,
            })
            await writeCheckProgress(ctx, task, progress)
            // A command no approval covers, or one changed since, is the agent's to run.
            const approved = commands.approved?.includes(command) === true
            if (!approved) {
              finish({ command, ran: false, exit: null, secs: 0, log: null, passed: false })
              lines.push(`- ${name} · ${workingTree} · \`${command}\` · ${REFUSED_CHECK}`)
              records.push({
                check: checkId,
                ...(head !== undefined ? { head } : {}),
                scope: name,
                command,
                exit: null,
                revision,
                at: ctx.clock.now(),
                ran: false,
              })
              continue
            }
            const keys = await checkKeys(ctx, task, command, undefined, unavailable)
            const key = keys?.key ?? null
            const previous = records
              .filter((r) => r.scope !== "base" && r.command === command)
              .at(-1)
            if (
              key !== null &&
              previous?.key === key &&
              (!candidate || previous.revision === revision) &&
              previous.ran &&
              previous.exit === 0 &&
              !previous.notRun &&
              !previous.timedOut
            ) {
              finish({
                command,
                ran: true,
                exit: 0,
                secs: 0,
                log: previous.log ?? null,
                passed: true,
                reused: true,
              })
              // The run it passed in, not a reuse of it.
              const passedAt =
                records
                  .filter(
                    (r) =>
                      r.command === command &&
                      r.key === key &&
                      r.ran &&
                      !r.reused &&
                      r.exit === 0 &&
                      !r.notRun,
                  )
                  .at(-1)?.at ?? previous.at
              lines.push(
                `- ${name} · ${workingTree} · \`${command}\` · reused: nothing changed since it passed at ${clockTime(passedAt)}`,
              )
              const { display: _display, ...passed } = previous
              records.push({
                ...passed,
                ...(head !== undefined ? { head } : {}),
                scope: name,
                revision,
                at: ctx.clock.now(),
                ms: 0,
                reused: true,
                check: checkId,
              })
              progress.reused = true
              continue
            }
            const log = join(logs, `${checkId}-${i + 1}.log`)
            await ctx.fs.writeFile(log, "")
            running = { log }
            const parse = progressParser(progress, () => ctx.clock.now())
            const append = boundedLog(ctx, log)
            const timeoutMs = checkTimeoutMs(ctx)
            /** One run of the command by the check's own path, with what it returned and whether its inputs held still. */
            const runOnce = async (before: typeof keys, earlier: string) => {
              const ran = await judge(command, task.repoRoot, timeoutMs, {
                output: async (chunk: string) => {
                  await append(chunk)
                  parse(chunk)
                },
              })
              if (running !== null) running.ran = ran
              for (const file of ran.isolated ?? []) isolatedFiles.add(file)
              for (const file of ran.strays ?? []) strayFiles.add(file)
              if (ran.isolated !== undefined) isolatedCommands.push(command)
              // A runner that did not stream leaves its output only in `ran`.
              await ctx.fs.writeFile(log, `${earlier}${ran.output}`)
              // After a rerun on the clean copy that run is the verdict: the first run's refusal is not.
              const verdict = ran.first
                ? { ...ran, output: ran.output.slice(ran.first.output.length) }
                : ran
              // The rerun said, in its copy, whether it did its work; one that did not say is no pass.
              const notRun =
                ran.first === undefined
                  ? await notRunReason(ctx, command, task.repoRoot, verdict)
                  : ran.notRun === undefined
                    ? "the run on the clean copy did not say whether it did its work"
                    : ran.notRun
              // A command that did none of its work is a failure, so the exit code the record keeps is not 0.
              const exitCode = ran.timedOut
                ? null
                : notRun !== null && ran.exit === 0
                  ? 1
                  : ran.exit
              const afterKey =
                (await checkKeys(ctx, task, command, undefined, unavailable))?.key ?? null
              const startKey = before?.key ?? null
              return {
                ran,
                notRun,
                exitCode,
                keys: before,
                /** The inputs were the same before and after: the record may carry their key. */
                stable: startKey !== null && startKey === afterKey,
                /** The command's own files were saved while it ran: its result is of no one tree. */
                moved: startKey !== null && afterKey !== null && startKey !== afterKey,
              }
            }
            let run = await runOnce(keys, "")
            // A failure while the task's files were being saved says nothing about either state of
            // them: the same command is run once more, and that run is the result.
            const firstMoved =
              run.moved && run.exitCode !== 0 && !run.ran.timedOut
                ? { outcome: runOutcome(run.ran, run.notRun) }
                : null
            if (firstMoved !== null) {
              const header = `\n--- run again: this task's files were saved while the run above was going (${firstMoved.outcome}) ---\n`
              const earlier = `${run.ran.output}${header}`
              await ctx.fs.writeFile(log, earlier)
              run = await runOnce(
                await checkKeys(ctx, task, command, undefined, unavailable),
                earlier,
              )
            }
            const { ran } = run
            // Saved under both runs, and neither passed: no result is established, which is not a failure.
            const unsettled = firstMoved !== null && run.moved && run.exitCode !== 0
            const notRun = unsettled
              ? `this task's files were saved while it ran, on both runs, so no result is established (first run: ${firstMoved.outcome}; second run: ${runOutcome(ran, run.notRun)})`
              : run.notRun
            const exitCode = unsettled ? null : run.exitCode
            const timeout = ran.timedOut ? { timedOut: true as const, timeoutMs } : {}
            const text = unsettled
              ? `not established: ${notRun}`
              : notRun !== null
                ? `failed: ${notRun}`
                : ran.timedOut
                  ? `stopped at the time limit (${timeoutMs}ms)`
                  : ran.exit === null
                    ? "stopped without an exit result"
                    : `exit ${ran.exit}`
            const secs = Math.round(ran.ms / 100) / 10
            finish({
              command,
              ran: true,
              exit: exitCode,
              secs,
              log,
              passed: exitCode === 0,
              ...timeout,
              ...(notRun !== null ? { notRun } : {}),
            })
            // The line a reviewer reads under Checks says when the result is the clean copy's.
            const onCopy =
              ran.isolated === undefined
                ? ""
                : ` · on a clean copy of HEAD plus this ${whose}'s own files (in the checkout: ${runOutcome(ran.first ?? ran, null)}; left out ${ran.isolated.length} file${ran.isolated.length === 1 ? "" : "s"} that ${ran.isolated.length === 1 ? "is" : "are"} not this ${whose}'s: ${ran.isolated.slice(0, 5).join(", ")}${ran.isolated.length > 5 ? ", …" : ""})`
            const checkedTree = ran.isolated === undefined ? workingTree : `isolated copy (${base})`
            lines.push(`- ${name} · ${checkedTree} · \`${command}\` · ${text} · ${secs}s${onCopy}`)
            if (unsettled) {
              unsettledCommands.add(command)
              failed.push(
                `\`${command}\`: no result is established, because ${notRun?.replace(", so no result is established", "")}. This is not a failure of the code. Run the check again when no edit of this task's files is in progress.`,
              )
            } else if (exitCode !== 0) {
              const firstNotRun = ran.first
                ? await notRunReason(ctx, command, task.repoRoot, { ...ran.first, ms: 0 })
                : null
              failed.push(
                failedLine(command, ran, notRun, firstNotRun, own === null ? null : whose),
              )
            }
            if (firstMoved !== null && !unsettled)
              rerunNotes.push(
                `\`${command}\` was run again, because this task's files were saved during its first run (${firstMoved.outcome}); the second run is the result.`,
              )
            if (run.moved && exitCode === 0) changedWhileRunning = true
            const { keys: ranKeys } = run
            records.push({
              ...(ranKeys?.key && run.stable
                ? {
                    key: ranKeys.key,
                    inputs: ranKeys.inputs,
                    ...(ranKeys.parts ? { parts: ranKeys.parts } : {}),
                  }
                : {}),
              check: checkId,
              ...(head !== undefined ? { head } : {}),
              scope: name,
              command,
              exit: exitCode,
              revision,
              at: ctx.clock.now(),
              ran: true,
              ms: ran.ms,
              log,
              ...timeout,
              ...(ran.isolated !== undefined ? { leftOut: ran.isolated } : {}),
              ...(ran.strays !== undefined ? { strays: ran.strays } : {}),
              ...(notRun !== null ? { notRun } : {}),
            })
          }
        } catch (error) {
          // The record keeps what the run really did: its exit, time and log when it got that far.
          const why = error instanceof Error ? error.message : String(error)
          const ended = running?.ran
          const notRun =
            ended === undefined
              ? `stopped before its result (${why})`
              : `its record could not be completed (${why})`
          const exit = ended === undefined || ended.timedOut ? null : ended.exit
          results.push({
            command: progress.command,
            ran: true,
            exit,
            secs: ended === undefined ? 0 : Math.round(ended.ms / 100) / 10,
            log: running?.log ?? null,
            passed: false,
            notRun,
          })
          records.push({
            scope: name,
            command: progress.command,
            revision,
            at: ctx.clock.now(),
            ran: true,
            exit,
            ...(ended !== undefined ? { ms: ended.ms } : {}),
            ...(running !== null ? { log: running.log } : {}),
            notRun,
            check: checkId,
          })
          progress.notRun = notRun
          lines.push(`- ${name} · ${workingTree} · \`${progress.command}\` · failed: ${notRun}`)
        } finally {
          await writes
        }
        const scanned = await scans
        if (scanned !== null)
          for (const result of scanned.results)
            lines.push(`- scans · ${scanned.head.slice(0, 7)} · ${scanLine(result)}`)
        const receipt = records.slice(initialRecords).map(({ branch: _branch, ...row }) => ({
          ...row,
          ...(branch === null ? {} : { branch }),
        }))
        await saveCheckReceipt(ctx, task, checkId, receipt, lines)
        Object.assign(progress, {
          running: false,
          ended: ctx.clock.now(),
          exit: results.find((r) => !r.passed)?.exit ?? (results.every((r) => r.passed) ? 0 : null),
        })
        await writeCheckProgress(ctx, task, progress)
        const projectionProblem = await materializeChecksRecord(ctx, task).then(
          () => [],
          (cause: unknown) => [
            `The check receipt was saved, but records/checks.md could not be written. ${String(cause)}`,
          ],
        )
        // A full run that passed with every command run (nothing reused) shows what the checks take.
        if (
          scope.kind === "all" &&
          results.length > 0 &&
          results.every((r) => r.ran && r.reused !== true && r.passed)
        )
          await recordDuration(ctx, CHECKS_ALL_KIND, ctx.clock.now() - commandsBegan)
        const yourself = results.filter((r) => !r.ran).map((r) => r.command)
        // A rerun on the clean copy that passed reads as a pass; one that failed says whose it is.
        const passedCommand = (command: string) =>
          results.some((result) => result.command === command && result.passed)
        const cleanPassed = isolatedCommands.filter(passedCommand)
        const cleanFailed = isolatedCommands.some((command) => !passedCommand(command))
        /** A command that ran and failed; one with no result established is not red. */
        const red = (result: CheckResult) =>
          result.ran && !result.passed && !unsettledCommands.has(result.command)
        // What was left out, each kind by its reason: another session's uncommitted files, and
        // untracked files no session of this task wrote.
        const shownFiles = (files: string[]) =>
          `(${files.slice(0, 5).join(", ")}${files.length > 5 ? ", …" : ""})`
        const othersOut = [...isolatedFiles].filter((file) => !strayFiles.has(file))
        const leftOut = [
          ...(othersOut.length > 0 || strayFiles.size === 0
            ? [
                `${othersOut.length} file${othersOut.length === 1 ? "" : "s"} other sessions changed here and have not committed ${shownFiles(othersOut)}`,
              ]
            : []),
          ...(strayFiles.size > 0
            ? [
                `${strayFiles.size} untracked file${strayFiles.size === 1 ? "" : "s"} no session of this task wrote ${shownFiles([...strayFiles])}`,
              ]
            : []),
        ].join(" and the ")
        const messages = [
          ...projectionProblem,
          ...(cleanPassed.length > 0
            ? [
                `Passed on a clean copy: ${cleanPassed.map((command) => `\`${command}\``).join(", ")} failed in this checkout and passed on HEAD plus this ${whose}'s own files, without the ${leftOut}. The pass is recorded and nothing is left to fix for it; the log keeps both outputs.`,
              ]
            : []),
          ...rerunNotes,
          ...failed,
          ...(scope.kind !== "all" && results.some(red) ? [LATER_CARD_MOVE] : []),
          ...(scope.kind === "all" && results.some(red) ? [RED_CHECK_MOVES] : []),
          ...(results.some((result) => result.timedOut)
            ? [
                `A check timed out after its recorded timeoutMs budget. Set QUALITYLAYER_CHECK_TIMEOUT_MS to a larger budget in milliseconds (up to 7200000), then rerun this scope; unchanged passing commands are reused. The timeout remains unverified evidence, never a pass.`,
              ]
            : []),
          ...(cleanFailed
            ? [
                `The clean copy left out the ${leftOut}. The failure is not theirs: fix it and run the check again. Installed dependencies were borrowed from this checkout; other ignored files, such as build output, are not in the copy.`,
              ]
            : []),
          ...(yourself.length > 0
            ? [
                'For a technical command change, update its card or Plan and record qualitylayer plan amend --by agent --note "<what changed and why>", adding --for T<n> for a card. Otherwise run the command through your harness permission flow and keep its result for Verify. Preserve the person\'s approved decisions.',
              ]
            : []),
          ...(unavailableInputs.size > 0
            ? [
                `Check input proof is unavailable: ${[...unavailableInputs].join("; ")}. These results carry no proof until the inputs can be read and checks run again.`,
              ]
            : changedWhileRunning
              ? [
                  "One of this task's files was saved while the check ran. The result stands as recorded; the next run of this check runs the command again instead of reusing it. Nothing to fix: go on, and run the check once more after your last edit if you need it as proof of the finished code.",
                ]
              : []),
        ]
        return ok({
          scope: name,
          revision: rev,
          passed: results.every((r) => r.passed),
          results,
          ...(yourself.length > 0 ? { run_yourself: yourself } : {}),
          ...(messages.length > 0 ? { message: messages.join(" ") } : {}),
        })
      },
      wait,
    )
  } finally {
    clearInterval(beat)
    await writes
    if (progress.running) {
      Object.assign(progress, {
        running: false,
        exit: null,
        ended: ctx.clock.now(),
        notRun: "worker stopped",
      })
      await writeCheckProgress(ctx, task, progress)
    }
  }
}

/**
 * What keeps the approved project checks from standing for the current source, in words, or null
 * when they stand: every command has a record that ran, whose inputs (the source and the toolchain,
 * not the shell's PATH) are the ones now. With `readyForReview` a red record counts, because the
 * judge rules on it, and so does a record that ran while its own files changed (it carries no key):
 * the judge reads it as recorded, bound to the build's code. Without it only keyed passes count.
 */
async function checksGapOf(ctx: Ctx, task: Task, readyForReview: boolean): Promise<string | null> {
  let recoveryRevision: string | undefined
  if (task.stage === "verify" && (await hasReviewCandidate(ctx, task))) {
    const candidate = await selectedReviewCandidate(ctx, task).catch(() => null)
    if (!candidate) return "the selected review commit changed. Choose its current worktree commit."
    task = { ...task, repoRoot: candidate.choice.checkout }
    recoveryRevision = await buildRevision(ctx, task)
  }
  const found = await commandsFor(ctx, task, { kind: "all" })
  if (!found.ok) return found.error.message
  if (found.data.now.length === 0) return "the Plan names no project check to run."
  const runs = (await readCheckRecords(ctx, task)).filter(
    (r) => r.scope === "all" && (recoveryRevision === undefined || r.revision === recoveryRevision),
  )
  // A required line's command that could not run here and was skipped with a reason is review evidence.
  const skipped =
    readyForReview && recoveryRevision === undefined ? await skippedRequiredRuns(ctx, task) : []
  for (const command of found.data.now) {
    const name = `\`${command}\``
    if (!found.data.approved?.includes(command))
      return `${name} changed after the Plan was approved, so QualityLayer does not run it.`
    const last = runs.filter((r) => r.command === command).at(-1)
    if (last === undefined) return `${name} has not run on this task yet.`
    if (!last.ran) return `${name} was not run by QualityLayer.`
    if (last.notRun && !skipped.includes(command))
      return `${name} ran but did none of its work: ${last.notRun}.`
    // A known timeout is unverified review evidence; an unknown interruption is not.
    if (last.exit === null && !(readyForReview && last.timedOut && last.timeoutMs))
      return `${name} stopped without an exit result.`
    if (!readyForReview && (last.exit !== 0 || last.timedOut)) return `${name} did not pass.`
    if (!last.key) {
      if (!readyForReview)
        return `${name} ran while its own files changed, so its result carries no key.`
      if (last.revision !== (await buildRevision(ctx, task).catch(() => null)))
        return `the build's code changed after ${name} last ran.`
      continue
    }
    const current = await checkKeys(ctx, task, command)
    if (current === null) return `the inputs of ${name} cannot be read now.`
    if (last.inputs === undefined ? current.key !== last.key : current.inputs !== last.inputs) {
      return `the source changed after ${name} last ran${changedParts(last.parts, current.parts)}.`
    }
  }
  return null
}

/**
 * What differs between a record's key parts and the current ones, for the reply that names why a
 * check no longer stands: ` (changed: a.ts, b.ts; the toolchain)`, or nothing when unknown.
 */
function changedParts(was: CheckParts | undefined, now: CheckParts | undefined): string {
  if (was === undefined || now === undefined) return ""
  const paths = [...new Set([...Object.keys(was.files), ...Object.keys(now.files)])].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  const files = paths.filter((path) => was.files[path] !== now.files[path])
  const named = files
    .slice(0, 5)
    .map((path) =>
      was.files[path] === undefined
        ? `${path} (new)`
        : now.files[path] === undefined
          ? `${path} (gone)`
          : path,
    )
  if (files.length > 5) named.push(`${files.length - 5} more`)
  if (was.toolchain !== now.toolchain)
    named.push("the toolchain (lockfile, Bun or the test program)")
  return named.length > 0 ? ` (changed: ${named.join(", ")})` : ""
}

const checksSatisfied = async (ctx: Ctx, task: Task, readyForReview: boolean) =>
  (await checksGapOf(ctx, task, readyForReview)) === null

const checksAskedPath = (task: Task) => join(task.runtimeDir, "checks-asked.json")

/** `next` asked for `check all`: how many check records existed then, so a later `next` can tell the agent did it. */
export async function noteChecksAsked(ctx: Ctx, task: Task): Promise<void> {
  const records = (await readCheckRecords(ctx, task)).length
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(checksAskedPath(task), `${JSON.stringify({ records })}\n`)
}

/**
 * The agent ran every approved project check after `next` last asked for them. When their inputs
 * moved again meanwhile (files another session edits in a shared checkout), asking once more
 * would only send the agent from `check all` to `next judge` and back for ever: the judge gets
 * these runs as recorded instead, and reads the code as it is.
 */
export async function checksRanSinceAsked(ctx: Ctx, task: Task): Promise<boolean> {
  let asked: number
  try {
    asked = (JSON.parse(await ctx.fs.readFile(checksAskedPath(task))) as { records: number })
      .records
  } catch {
    return false
  }
  if (typeof asked !== "number") return false
  const found = await commandsFor(ctx, task, { kind: "all" })
  if (!found.ok || found.data.now.length === 0) return false
  const since = (await readCheckRecords(ctx, task)).slice(asked).filter((r) => r.scope === "all")
  const lasts = found.data.now.map((command) => since.filter((r) => r.command === command).at(-1))
  const ran = lasts.every(
    (last, i) =>
      found.data.approved?.includes(found.data.now[i] as string) === true &&
      last !== undefined &&
      last.ran &&
      !last.notRun &&
      (last.exit !== null || (last.timedOut === true && last.timeoutMs !== undefined)),
  )
  if (!ran) return false
  // An edit of the task's own sessions after the runs began is new code the checks never saw: that
  // needs its run. Only what moved without them (another session's edit) stands as recorded.
  const began = Math.min(...lasts.map((last) => (last ? last.at - (last.ms ?? 0) : 0)))
  const named = await buildOwnPaths(ctx, task).catch(() => null)
  const own = named === null ? null : revisionPaths(task.repoRoot, named).local
  const edited = await ownEdits(ctx, { id: task.repoId, root: task.repoRoot }, task.slug, began)
  return !edited.some((path) => own === null || within(own, path))
}

/** Why no project check stands for the current source (null when they do), for the reply that asks for them. */
export const checksGap = (ctx: Ctx, task: Task) => checksGapOf(ctx, task, true)

/** Actual approved project checks with passing proof for the current inputs. */
export function allChecksPassed(ctx: Ctx, task: Task): Promise<boolean> {
  return checksSatisfied(ctx, task, false)
}

/** Every approved project check ran on the current inputs; a red one goes to the judge as evidence. */
export function checksReadyForReview(ctx: Ctx, task: Task): Promise<boolean> {
  return checksSatisfied(ctx, task, true)
}

/** Whether a task's verify command has passed, by task id: the App shows it as verified. */
export async function verifiedTasks(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<Set<string>> {
  const latest = new Map<string, boolean>()
  for (const record of await readCheckRecords(ctx, task))
    if (/^T\d+$/i.test(record.scope)) latest.set(record.scope.toUpperCase(), record.exit === 0)
  return new Set([...latest].filter(([, passed]) => passed).map(([id]) => id))
}
