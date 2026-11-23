// `commit slice <n> [--message "<text>"] [--leave <path>]...`: commit the slice's files without
// touching what anyone else staged; `commit fix` does the same for the files the latest fix helper
// changed. Thin parsing over core/git/slice-commit.ts.

import { type Ctx, err, type Result } from "../../ctx.ts"
import { commitFix } from "./commit-fix.ts"
import { registerFix } from "./commit-register.ts"
import {
  COMMIT_USAGE,
  changedOf,
  deferredCommitReply,
  deferredTaskCommit,
  fixSubject,
  valuesOf,
} from "./commit-shared.ts"
import { runSliceCommitCmd } from "./commit-slice.ts"
import { receiptsCanonicalizeCmd, taskCommitCmd } from "./commit-task.ts"
import { parseArgs, requireTask } from "./shared.ts"

export { changedOf, fixSubject }

type Flags = Record<string, string | true>

function isInvalidRepoFlag(args: string[], flags: Flags, what: string | undefined): boolean {
  if (args.some((arg) => arg.startsWith("--repo="))) return true
  if (flags.repo === undefined) return false
  if (typeof flags.repo !== "string" || !flags.repo || typeof flags.commit !== "string") return true
  if (what !== "slice" || valuesOf(args, "--repo").length !== 1) return true
  return Object.keys(flags).some((flag) => !["repo", "commit", "json"].includes(flag))
}

function validateCommitFlags(
  args: string[],
  flags: Flags,
  what: string | undefined,
): Result<never> | null {
  if (
    args.some((arg) => arg.startsWith("--take=")) ||
    flags.take === true ||
    (typeof flags.take === "string" && (!flags.take || flags.take.startsWith("--")))
  )
    return err({
      code: "bad_args",
      message: `--take needs a separate exact repository-relative file: --take <file>. Nothing was committed. ${COMMIT_USAGE}`,
    })
  if (flags.take !== undefined && flags.commit !== undefined)
    return err({
      code: "bad_args",
      message:
        "--take cannot claim content while --commit records an existing manual commit. Nothing was committed.",
    })
  if (
    Object.keys(flags).some((flag) => flag.startsWith("leave=")) ||
    flags.leave === true ||
    (typeof flags.leave === "string" && (flags.leave === "" || flags.leave.startsWith("--")))
  )
    return err({
      code: "bad_args",
      message: `--leave needs a separate repository-relative path: --leave <path>. Nothing was committed. ${COMMIT_USAGE}`,
    })
  if (isInvalidRepoFlag(args, flags, what))
    return err({
      code: "bad_args",
      message: "usage: qualitylayer commit slice <n> --commit <hash> --repo <approved checkout>",
    })
  return null
}

async function runManualFixRegister(ctx: Ctx, commit: string | true): Promise<Result<unknown>> {
  if (typeof commit !== "string")
    return err({
      code: "bad_args",
      message: "usage: qualitylayer commit fix --commit <hash of a fix you committed by hand>",
    })
  const task = await requireTask(ctx)
  if (!task.ok) return task
  if (deferredTaskCommit(task.data)) return deferredCommitReply()
  return registerFix(ctx, task.data, commit)
}

async function runFixDispatch(ctx: Ctx, args: string[], flags: Flags): Promise<Result<unknown>> {
  if (flags.take !== undefined)
    return err({
      code: "bad_args",
      message:
        "--take is only for an approved slice's captured pre-build content; commit fix does not claim it. Nothing was committed.",
    })
  return flags.commit === undefined
    ? commitFix(ctx, args, flags.message)
    : runManualFixRegister(ctx, flags.commit)
}

function validateSliceNumbers(
  args: string[],
  what: string | undefined,
  numbers: string[],
): Result<boolean> {
  const group = what === "slices"
  // `--take-staged a.ts b.ts` leaves b.ts as a stray word: name the fix instead of the usage line.
  const stray = numbers.find((n) => !/^\d+$/.test(n))
  const listed = ["--take-staged", "--take", "--leave"].find((flag) => args.includes(flag))
  if (stray !== undefined && listed !== undefined)
    return err({
      code: "bad_args",
      message: `${stray} was read as a slice number. Give each file its own flag: ${listed} a.ts ${listed} b.ts`,
    })
  const validKind = what === "slice" || group
  const validCount = group ? numbers.length >= 2 : numbers.length === 1
  const validIds =
    numbers.every((n) => /^[1-9]\d*$/.test(n) && Number.isSafeInteger(Number(n))) &&
    new Set(numbers.map(Number)).size === numbers.length
  if (!validKind || !validCount || !validIds)
    return err({ code: "bad_args", message: COMMIT_USAGE })
  return { ok: true, data: group }
}

function dispatchNonTaskCommit(
  ctx: Ctx,
  args: string[],
  what: string | undefined,
  numbers: string[],
  flags: Flags,
): Promise<Result<unknown>> | Result<unknown> {
  if (what === "receipts" && numbers.length === 0) return receiptsCanonicalizeCmd(ctx, flags)
  if (what === "fix" && numbers.length === 0) return runFixDispatch(ctx, args, flags)
  const sliceCheck = validateSliceNumbers(args, what, numbers)
  if (!sliceCheck.ok) return sliceCheck
  return runSliceCommitCmd(ctx, { args, group: sliceCheck.data, numbers, flags })
}

export async function commitCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  if (args[0] === "task") return taskCommitCmd(ctx, args.slice(1))
  const { positional, flags } = parseArgs(args, [
    "message",
    "leave",
    "take-staged",
    "take",
    "accept-edits",
    "commit",
    "repo",
  ])
  const [what, ...numbers] = positional
  const badFlag = validateCommitFlags(args, flags, what)
  if (badFlag !== null) return badFlag
  return dispatchNonTaskCommit(ctx, args, what, numbers, flags)
}
