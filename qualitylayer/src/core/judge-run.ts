// `qualitylayer verdict run <assignment> -- <program> [args…]`: a judge runs one project command in
// the tree it was handed, with the environment its lease binds, and keeps the output as evidence.
// Without it the judge built a long `eval env -i … bash -c '… rm …'` script by hand, which Claude
// Code stops to ask about (e2e r5), and no agent can answer unattended. One argv, no shell: nothing
// here can be written as a pipeline, so nothing needs a person's click.

import { spawn } from "node:child_process"
import { basename, join } from "node:path"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { commandsFor, notRunReason, shellRunner } from "./checks.ts"
import { EVIDENCE_DIR } from "./docs/names.ts"
import { killProcessTree } from "./platform.ts"
import { hasReviewCandidate, selectedReviewCandidate } from "./review-candidate.ts"
import type { Task } from "./task/store.ts"
import { readAssignment } from "./verification.ts"

/** What one stream keeps of a command's output: its end, where a failure says why. */
export const RUN_OUTPUT_CAP = 256 * 1024
export const RUN_DEFAULT_SECONDS = 300
export const RUN_MAX_SECONDS = 900

/** Programs that make a pipeline of the argv: the one thing this command exists to avoid. */
const SHELLS = new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "fish",
  "ksh",
  "cmd",
  "cmd.exe",
  "powershell",
  "pwsh",
  "powershell.exe",
])
const REFUSED_WORDS = new Set(["env", "eval", "xargs"])

export type RunInput = {
  assignment: string
  argv: string[]
  /** The evidence file's name (letters, digits, `.`, `_`, `-`); `run-<n>.txt` when none. */
  name?: string
  seconds?: number
}

export type RunOutcome = {
  /** The file under `evidence/`, from the task folder: cite it in the verdict's text and `--evidence`. */
  evidence: string
  exit: number | null
  timedOut: boolean
  /** The last lines of the output, so the judge sees the result without reading the file. */
  tail: string
}

/** Why this argv is not run, or null. */
export function refusedArgv(argv: string[]): string | null {
  const program = basename(argv[0] ?? "").toLowerCase()
  if (program === "") return "name the program to run after `--`"
  if (REFUSED_WORDS.has(program))
    return `\`${program}\` builds a pipeline around the real command; run the project program itself (the held environment is already set)`
  if (SHELLS.has(program) && argv.slice(1).some((word) => /^(?:-[a-z]*c|-command)$/i.test(word)))
    return "a `-c` script is a pipeline that cannot be checked; run one program with its arguments, or run a script file by path"
  return null
}

/** A check's command without the folder it changes into first: `cd app && bun test` → `bun test`. */
const withoutFolder = (check: string): string =>
  check
    .trim()
    .replace(/^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*)+/, "")
    .replace(/\s+/g, " ")

/**
 * The task's check a judge's argv names, or null when it names none: the check's own words, or
 * its command without the folder it changes into (the brief lists `cd app && bun run typecheck`,
 * and a judge types `bun run typecheck`). Such a command is run as the check runner runs it.
 */
export function checkCommandFor(argv: string[], checks: readonly string[]): string | null {
  const typed = argv.join(" ").trim().replace(/\s+/g, " ")
  if (typed === "") return null
  return (
    checks.find((check) => check.trim().replace(/\s+/g, " ") === typed) ??
    checks.find((check) => withoutFolder(check) === typed) ??
    null
  )
}

const keepEnd = (text: string): string =>
  text.length <= RUN_OUTPUT_CAP ? text : `[earlier output dropped]\n${text.slice(-RUN_OUTPUT_CAP)}`

function runArgv(
  argv: string[],
  cwd: string,
  env: Record<string, string>,
  seconds: number,
): Promise<{ exit: number | null; timedOut: boolean; output: string }> {
  return new Promise((resolve) => {
    let output = ""
    let timedOut = false
    const child = spawn(argv[0] as string, argv.slice(1), {
      cwd,
      env,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const take = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.length > RUN_OUTPUT_CAP * 2) output = output.slice(-RUN_OUTPUT_CAP)
    }
    child.stdout.on("data", take)
    child.stderr.on("data", take)
    const stop = () => {
      try {
        if (child.pid !== undefined) killProcessTree(child.pid)
      } catch {
        child.kill("SIGKILL")
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, seconds * 1000)
    const done = (exit: number | null, extra = "") => {
      clearTimeout(timer)
      // Whatever the command left running goes with it.
      stop()
      resolve({ exit, timedOut, output: keepEnd(output + extra) })
    }
    child.on("error", (cause) => done(127, `${String(cause)}\n`))
    child.on("close", (code) => done(code))
  })
}

export async function judgeRun(ctx: Ctx, task: Task, input: RunInput): Promise<Result<RunOutcome>> {
  const current = await readAssignment(ctx, task)
  if (current === null || current.id !== input.assignment)
    return err({
      code: "bad_args",
      message:
        "that assignment was replaced by a later one (or the id is mistyped), so nothing runs under it. Stop: you were replaced, and the current assignment belongs to another reviewer.",
    })
  let scoped = task
  if (current.recovery || (await hasReviewCandidate(ctx, task))) {
    const candidate = await selectedReviewCandidate(ctx, task).catch(() => null)
    if (!candidate || current.recovery !== candidate.id || current.head !== candidate.choice.head)
      return err({
        code: "bad_args",
        message: "This assignment no longer matches the selected review candidate.",
      })
    scoped = { ...task, repoRoot: candidate.choice.checkout }
  }
  // One of the task's checks is run as the check runner runs it: its whole command (the folder it
  // changes into, a shell for `cd x && y`), from the repository. QualityLayer runs that shell, not
  // the judge: the judge's own call stays one program with its arguments.
  const found = await commandsFor(ctx, scoped, { kind: "all" }).catch(() => null)
  const checks = found?.ok ? found.data.now : []
  const check = checkCommandFor(input.argv, checks)
  const refused = check === null ? refusedArgv(input.argv) : null
  if (refused !== null) return err({ code: "bad_args", message: refused })
  const name = input.name ?? ""
  if (name !== "" && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))
    return err({ code: "bad_args", message: "--name takes letters, digits, `.`, `_` and `-`" })
  const seconds = Math.min(input.seconds ?? RUN_DEFAULT_SECONDS, RUN_MAX_SECONDS)
  if (!Number.isFinite(seconds) || seconds < 1)
    return err({ code: "bad_args", message: "--timeout takes a number of seconds, at least 1" })
  const where = {
    cwd: scoped.repoRoot,
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  }
  const command = check ?? input.argv.join(" ")
  const result =
    check === null
      ? await runArgv(input.argv, where.cwd, where.env, seconds)
      : await shellRunner(check, where.cwd, seconds * 1000).then((ran) => ({
          exit: ran.exit,
          timedOut: ran.timedOut === true,
          output: keepEnd(ran.output),
        }))
  // A command that could not be started ran nothing: its output is no evidence of the code. It
  // is not recorded, and the reply says how the task's checks are run.
  const notStarted = result.timedOut
    ? null
    : await notRunReason(ctx, command, where.cwd, {
        exit: result.exit,
        ms: 0,
        output: result.output,
      })
  if (notStarted !== null) {
    const listed = checks.map((entry) => `\`${entry}\``).join(", ")
    const asRun = checks
      .map((entry) => `qualitylayer verdict run ${input.assignment} -- ${withoutFolder(entry)}`)
      .join("; ")
    return err({
      code: "bad_args",
      message:
        `\`${command}\` could not be started from ${where.cwd}: ${notStarted}. Nothing was recorded: a command that did not run is no evidence. ` +
        (checks.length > 0
          ? `The task's checks run from the repository as ${listed}. Name one by its command, and it runs that way: ${asRun}.`
          : "Run the program from the folder it lives in, by its path."),
    })
  }
  const folder = join(task.dir, EVIDENCE_DIR)
  await ctx.fs.mkdir(folder)
  let file = name === "" ? "" : name.includes(".") ? name : `${name}.txt`
  if (file === "") {
    let n = 1
    while (await ctx.fs.exists(join(folder, `run-${n}.txt`))) n++
    file = `run-${n}.txt`
  }
  const text =
    `$ ${command}\n` +
    `cwd: ${where.cwd}\n` +
    `exit: ${result.exit === null ? "none" : result.exit}${result.timedOut ? ` (stopped after ${seconds} s)` : ""}\n\n` +
    result.output
  await ctx.fs.writeFile(join(folder, file), text.endsWith("\n") ? text : `${text}\n`)
  return ok({
    evidence: `${EVIDENCE_DIR}/${file}`,
    exit: result.exit,
    timedOut: result.timedOut,
    tail: result.output.trimEnd().split("\n").slice(-20).join("\n"),
  })
}
