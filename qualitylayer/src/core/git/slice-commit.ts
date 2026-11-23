// A slice's commit, built in a temporary index from HEAD plus the slice's own changes, so edits
// someone staged before the build never go into it and are still staged afterwards.
//
// Model: qualitylayer/artifacts/app/workflow/commit-ownership-contract.md

import { err, ok, type Result } from "../../ctx.ts"
import { commitScopeError } from "./commit-scope.ts"
import { commitOnce } from "./slice-commit-once.ts"
import { movedRefusal } from "./slice-hints.ts"
import { operationInProgress } from "./slice-land.ts"
import type { SliceAuthority, SliceCommit, UnnamedCheck } from "./slice-primitives.ts"

export { indexNotBroughtOn } from "./slice-checkout.ts"
export { existingSliceCommit } from "./slice-hints.ts"
export {
  covers,
  type SliceAuthority,
  type SliceCommit,
  stagedPaths,
  startBlobs,
  statusEntries,
  type UnnamedCheck,
  workFileState,
  workState,
} from "./slice-primitives.ts"

function precedingDigits(text: string, end: number, minimum: number): number {
  let start = end
  while (start > minimum && /\d/.test(text[start - 1] ?? "")) start--
  return start
}

function withoutRunTimes(text: string): string {
  const parts: string[] = []
  let copied = 0
  for (const unit of text.matchAll(/(?:ms|s|sec|secs|seconds|min)\b/g)) {
    const end = unit.index ?? 0
    let digits = end
    while (digits > copied && /\s/.test(text[digits - 1] ?? "")) digits--
    let start = precedingDigits(text, digits, copied)
    if (start === digits) continue
    if (text[start - 1] === "." || text[start - 1] === ",") {
      const whole = precedingDigits(text, start - 1, copied)
      if (whole < start - 1) start = whole
    }
    parts.push(text.slice(copied, start), "<time>")
    copied = end + unit[0].length
  }
  return parts.join("") + text.slice(copied)
}

/** Whether two refusals say the same thing, colour codes and run times aside. */
export function sameRefusal(a: string, b: string): boolean {
  const plain = (text: string) =>
    withoutRunTimes(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strips the colour codes of a hook's output
      text.replace(/\u001b\[[0-9;]*m/g, ""),
    )
      .replace(/\s+/g, " ")
      .trim()
  return plain(a) === plain(b)
}

/** How many times a slice is planned again because another writer moved HEAD onto its own files while it was committing. */
const ATTEMPTS = 3

export type CommitSliceArgs = [
  root: string,
  listed: string[],
  alsoIfTracked: string[],
  message: string,
  unnamed?: UnnamedCheck,
  takeStaged?: string[],
  selectedSlices?: number[],
  take?: string[],
  authority?: SliceAuthority,
]

async function runCommitAttempts(args: CommitSliceArgs): Promise<Result<SliceCommit>> {
  const [
    root,
    listed,
    alsoIfTracked,
    message,
    unnamed,
    takeStaged = [],
    selectedSlices,
    take = [],
    authority,
  ] = args
  let collided: string[] = []
  let refused: string | undefined
  let hint = ""
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const made = await commitOnce({
      root,
      listed,
      alsoIfTracked,
      message,
      unnamed,
      takeStaged,
      selectedSlices,
      take,
      authority,
    })
    if (!("moved" in made))
      return made.ok && attempt > 1 ? ok({ ...made.data, parentRetries: attempt - 1 }) : made
    collided = made.moved
    if (made.refused !== undefined && refused !== undefined && sameRefusal(made.refused, refused))
      return err({
        code: "commit_rejected",
        message: `git commit refused the slice's commit; nothing was committed. HEAD moved while the hooks ran, so the slice was checked again on the new HEAD and got the same refusal: it is about the slice or its message, and running the command again will not change it. Fix what it names, then commit again:\n${made.refused}${made.hint ?? ""}`,
      })
    refused = made.refused
    hint = made.hint ?? ""
    if (attempt < ATTEMPTS)
      process.stderr.write(
        `Commit parent changed${collided.length > 0 ? ` in ${collided.slice(0, 5).join(", ")}` : " while the hooks ran"}; preparing and checking the new tree (attempt ${attempt + 1} of ${ATTEMPTS}). Other commits are kept.\n`,
      )
  }
  if (refused !== undefined)
    return err({
      code: "commit_rejected",
      message: `git commit refused the slice's commit; nothing was committed. HEAD moved while the hooks ran, ${ATTEMPTS} times in a row, and the hooks' refusals differed, so they may come from the HEAD that moved. If the last one, below, names the slice's own files or message, fix that; otherwise run the command again:\n${refused}${hint}`,
    })
  return err({ code: "bad_args", message: movedRefusal(collided, ATTEMPTS) })
}

/**
 * Commit the slice's files: `listed` are the paths its cards name (a folder stands for every
 * changed file below it), `alsoIfTracked` ones such as the build log go in only when git tracks
 * them. Refuses, naming the file, when a file's staged edits and the slice's edits cannot be told
 * apart; then nothing has changed. The commit is built on the HEAD it was planned from: when
 * another commit lands meanwhile, it is planned again on the new HEAD rather than reverting it.
 */
export async function commitSlice(...args: CommitSliceArgs): Promise<Result<SliceCommit>> {
  const [root, listed] = args
  // A merge or another operation under way is refused before anything is read or written.
  const pending = await operationInProgress(root)
  if (pending !== null) return err({ code: "bad_args", message: pending })
  const scopeError = await commitScopeError(root, listed)
  if (scopeError) return err({ code: "bad_args", message: scopeError })
  return runCommitAttempts(args)
}
