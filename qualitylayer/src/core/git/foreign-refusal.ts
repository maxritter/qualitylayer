// A slice commit takes a file whole, so a file that also holds someone else's uncommitted edits is
// refused by name. Two sources name such a file: a session building another task that edited it
// after its latest commit (its record says which task), and a change nobody recorded: the file's
// content differs, beyond formatting, from what this task's own sessions left (own-edit-shapes).

import type { Ctx } from "../../ctx.ts"
import { changedAfterOwnEdit } from "./own-edit-shapes.ts"
import { foreignEdits } from "./session-edits.ts"

/** The owner given for a file changed after this task's last edit: nobody is named. */
export const UNRECORDED = "\0unrecorded"

/**
 * Of `paths`, the files that hold edits of another session: each mapped to the task whose session
 * edited it, or to `UNRECORDED`. A path `skip` names (a file the person said is all this task's)
 * is never an unrecorded change.
 */
export async function foreignOwners(
  ctx: Ctx,
  repo: { id: string; root: string },
  task: string,
  paths: string[],
  skip: (path: string) => boolean,
): Promise<Record<string, string>> {
  const named = await foreignEdits(ctx, repo, task, paths)
  const rest = paths.filter((path) => named[path] === undefined && !skip(path))
  const found: Record<string, string> = { ...named }
  for (const path of await changedAfterOwnEdit(ctx, repo, task, rest)) found[path] = UNRECORDED
  return found
}

/** The refusal for a file that holds another session's edits; `who` is its owner as `foreignOwners` gives it. */
export function foreignRefusal(path: string, who: string): string {
  const byHand =
    "commit this task's hunks through a private index on HEAD, then register with `qualitylayer commit slice <n> --commit <hash>` or `qualitylayer commit fix --commit <hash>`"
  if (who === UNRECORDED)
    return `${path} changed after this task's last edit; nothing was committed. If \`git diff -- ${path}\` is all this task's, retry with \`--accept-edits ${path}\` (or \`--accept-edits all\` / \`--accept-edits <dir>/\` for several files); otherwise, ${byHand}.`
  return `${path} holds uncommitted edits from ${who}; nothing was committed. ${byHand[0]?.toUpperCase()}${byHand.slice(1)}.`
}

/** Format refusals across one or more paths, grouping multiple unrecorded paths into one actionable reply. */
export function foreignRefusals(
  paths: readonly string[],
  foreign: Readonly<Record<string, string>>,
): string | null {
  const named = paths.find((path) => foreign[path] !== undefined && foreign[path] !== UNRECORDED)
  if (named !== undefined) return foreignRefusal(named, foreign[named] as string)
  const unrecorded = paths.filter((path) => foreign[path] === UNRECORDED)
  if (unrecorded.length === 0) return null
  if (unrecorded.length === 1) return foreignRefusal(unrecorded[0] as string, UNRECORDED)
  const shown = unrecorded.slice(0, 5).join(", ")
  const more = unrecorded.length > 5 ? ` and ${unrecorded.length - 5} more` : ""
  const byHand =
    "commit this task's hunks through a private index on HEAD, then register with `qualitylayer commit slice <n> --commit <hash>` or `qualitylayer commit fix --commit <hash>`"
  return `${unrecorded.length} files changed after this task's last edit (${shown}${more}); nothing was committed. If their diffs are all this task's, retry with \`--accept-edits all\` (or repeat/comma-separate \`--accept-edits <file|dir/>\`); otherwise, ${byHand}.`
}
