// Putting a slice's checked commit on a HEAD that moved while it was being checked.
//
// A slice is planned, checked out and run through the repository's hooks on the HEAD it started
// from, and the hooks and the checkout take longer than the gap between other sessions' commits.
// Starting over on every move would never finish, so when the commits that landed meanwhile touch
// none of the slice's paths, the slice is carried onto them instead: the snapshot that was checked
// (a private index plus its checkout) takes over what those commits changed, and the commit is made
// on the new HEAD with `commit-tree` and moved into place with a compare-and-swap of the ref. It is
// the fast rebase of changes that cannot conflict. The other commits passed their own hooks and the
// slice's files are byte for byte what was checked, so the hooks do not run again. When a moved
// commit does touch a slice file, the caller's `rebase` merges the two changes onto the new HEAD,
// as a rebase would; only when that cannot be done does the caller plan and check the slice again.

import { access } from "node:fs/promises"
import { resolve } from "node:path"
import { err, ok, type Result } from "../../ctx.ts"
import { followToHead, type Rebase } from "./slice-follow.ts"
import { git } from "./slice-git.ts"

export { collisions, currentRef, followToHead, type Rebase } from "./slice-follow.ts"
export { runHook, runHookFile, runPostCommit } from "./slice-hooks.ts"

/** How long the placing keeps trying while HEAD moves again under it, each try taking milliseconds. */
const PLACE_WAIT_MS = 60_000

/** What git keeps in its directory while an operation is under way, with the command that finishes it and the one that drops it. */
const OPERATIONS = [
  { mark: "MERGE_HEAD", what: "a merge", finish: "git commit", drop: "git merge --abort" },
  {
    mark: "CHERRY_PICK_HEAD",
    what: "a cherry-pick",
    finish: "git cherry-pick --continue",
    drop: "git cherry-pick --abort",
  },
  {
    mark: "REVERT_HEAD",
    what: "a revert",
    finish: "git revert --continue",
    drop: "git revert --abort",
  },
  {
    mark: "rebase-merge",
    what: "a rebase",
    finish: "git rebase --continue",
    drop: "git rebase --abort",
  },
  {
    mark: "rebase-apply",
    what: "a rebase",
    finish: "git rebase --continue",
    drop: "git rebase --abort",
  },
  { mark: "BISECT_LOG", what: "a bisect", finish: "git bisect reset", drop: null },
] as const

/**
 * Why no slice commit is made now: the checkout has a merge, cherry-pick, revert, rebase or bisect
 * in progress. `git commit` would record or advance it; a commit made with `commit-tree` has one
 * parent and leaves it pending, so the slice's commit waits until it is finished. Null when
 * nothing is in progress. The checkout may be shared, so the words say whose step finishing it is.
 */
export async function operationInProgress(root: string): Promise<string | null> {
  const where = await git(root, [
    "rev-parse",
    ...OPERATIONS.flatMap(({ mark }) => ["--git-path", mark]),
  ])
  if (where.code !== 0) return null
  const paths = where.text.split("\n").filter((line) => line !== "")
  for (const [i, operation] of OPERATIONS.entries()) {
    const path = paths[i]
    if (path === undefined) continue
    const there = await access(resolve(root, path)).then(
      () => true,
      () => false,
    )
    if (!there) continue
    const { what, finish, drop } = operation
    return `This checkout has ${what} in progress (it may be another session's), so nothing was committed: a commit made now would leave it pending. Whoever started it finishes it with \`${finish}\`. If it is yours, do that; if it is another session's, wait for that session. Then run this command again.${drop === null ? "" : ` Only the session that started it drops it, with \`${drop}\`.`}`
  }
  return null
}

/** The commit's signing flag, as `git commit` would take it from the configuration. */
async function signing(root: string): Promise<string[]> {
  const run = await git(root, ["config", "--type=bool", "--get", "commit.gpgsign"])
  return run.text.trim() === "true" ? ["-S"] : []
}

type CommitTreeOpts = {
  index: string
  parent: string
  message: string
  sign: string[]
  author?: Record<string, string>
  expectedTree?: string
}

/** The commit of the snapshot's tree on `parent`, made but not yet on any ref. */
async function commitTree(root: string, o: CommitTreeOpts): Promise<Result<string>> {
  const written = await git(root, ["write-tree"], { env: { GIT_INDEX_FILE: o.index } })
  if (written.code !== 0)
    return err({ code: "bad_args", message: `git write-tree failed: ${written.stderr.trim()}` })
  const tree = written.text.trim()
  if (o.expectedTree !== undefined && tree !== o.expectedTree)
    return err({
      code: "bad_args",
      message:
        "The commit hook changed the reviewed tree. Refresh the diff and run the checks again.",
    })
  const made = await git(root, ["commit-tree", tree, "-p", o.parent, ...o.sign], {
    input: o.message,
    env: o.author ?? {},
  })
  if (made.code !== 0)
    return err({
      code: "commit_rejected",
      message: `git could not make the slice's commit; nothing was committed:\n${made.stderr.trim()}`,
    })
  return ok(made.text.trim())
}

type PlaceOptions = {
  from: string
  ref: string | null
  index: string
  tree?: string
  reviewed?: { tree: string; ref: string | null }
  message: string
  /** The author as the commit's hooks were told it (`GIT_AUTHOR_*`), so the commit carries the same. */
  author?: Record<string, string>
  ready?: (head: string) => Promise<Result<true>>
  rebase?: Rebase
}

type PlaceAttempt =
  | { done: true; outcome: Result<{ sha: string; parent: string }> | { replan: string[] } }
  | { done: false; head: string; why: string }

async function tryPlaceOnce(
  root: string,
  o: PlaceOptions,
  state: { current: string; message: string; subject: string; sign: string[] },
): Promise<PlaceAttempt> {
  const followed = await followToHead(root, {
    from: state.current,
    ref: o.ref,
    index: o.index,
    tree: o.tree,
    rebase: o.rebase,
  })
  if (!followed.ok) return { done: true, outcome: followed }
  if ("replan" in followed.data) return { done: true, outcome: followed.data }
  const head = followed.data.head
  const admitted = await o.ready?.(head)
  if (admitted && !admitted.ok) return { done: true, outcome: admitted }
  const made = await commitTree(root, {
    index: o.index,
    parent: head,
    message: state.message,
    sign: state.sign,
    author: o.author,
    expectedTree: o.reviewed?.tree,
  })
  if (!made.ok) return { done: true, outcome: made }
  const swapped = await git(root, [
    "update-ref",
    "-m",
    `commit: ${state.subject}`,
    o.reviewed?.ref ?? "HEAD",
    made.data,
    head,
  ])
  return swapped.code === 0
    ? { done: true, outcome: ok({ sha: made.data, parent: head }) }
    : { done: false, head, why: swapped.stderr.trim() }
}

/**
 * Make the slice's commit on the HEAD now, from the checked snapshot, and move the ref to it only
 * if HEAD is still what the commit was made on; when it is not, the snapshot follows HEAD again and
 * the commit is remade. `replan` names the slice paths a moved commit collides with (empty when the
 * checkout changed branch): then nothing is committed and the slice is planned and checked again.
 * `ready` runs before each swap, on the snapshot as it will be committed on that HEAD: the caller's
 * last checks. The message is the caller's, as its hooks left it in the commit's own message file;
 * git's shared `COMMIT_EDITMSG` is never read, since another session's commit may be writing it.
 */
export async function placeOnHead(
  root: string,
  o: PlaceOptions,
): Promise<Result<{ sha: string; parent: string }> | { replan: string[] }> {
  const message = `${o.message.trimEnd()}\n`
  const sign = await signing(root)
  const subject = message.split("\n")[0] ?? ""
  let current = o.from
  let why = ""
  const until = Date.now() + PLACE_WAIT_MS
  let tries = 0
  for (; tries === 0 || Date.now() < until; tries++) {
    const attempt = await tryPlaceOnce(root, o, { current, message, subject, sign })
    if (attempt.done) return attempt.outcome
    current = attempt.head
    why = attempt.why
    // Another commit landing is no reason to wait; a ref that another writer holds for a moment is.
    if ((await git(root, ["rev-parse", "--verify", "HEAD"])).text.trim() === attempt.head)
      await Bun.sleep(50)
  }
  return err({
    code: "bad_args",
    message: `HEAD moved on each of ${tries} tries in ${Math.round(PLACE_WAIT_MS / 1000)} s, so the slice's checked commit could not be put on it${why === "" ? "" : ` (${why})`}; nothing was committed. Run the same command again.`,
  })
}
