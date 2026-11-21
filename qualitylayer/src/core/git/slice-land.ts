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

import { constants } from "node:fs"
import { access, rm, rmdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { err, ok, type Result } from "../../ctx.ts"
import { type Entry, git, infoLine, type Run } from "./slice-git.ts"

/** How long the placing keeps trying while HEAD moves again under it, each try taking milliseconds. */
const PLACE_WAIT_MS = 60_000

/** A path the moved commits changed, with the entry it holds on the new HEAD (none: removed). */
type Moved = { path: string; entry: Entry | null }

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

/** The symbolic ref HEAD names, or null when HEAD is detached. */
export async function currentRef(root: string): Promise<string | null> {
  const run = await git(root, ["symbolic-ref", "-q", "HEAD"])
  return run.code === 0 && run.text.trim() !== "" ? run.text.trim() : null
}

/** What changed from one commit to another, path by path; null when git cannot say. */
async function movedBetween(root: string, from: string, to: string): Promise<Moved[] | null> {
  const run = await git(root, ["diff-tree", "-r", "-z", "--no-renames", "--raw", from, to])
  if (run.code !== 0) return null
  const parts = run.text.split("\0")
  const moved: Moved[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = (parts[i] ?? "").match(/^:\d+ (\d+) \w+ (\w+) /)
    const path = parts[i + 1] ?? ""
    if (meta === null || path === "") return null
    const [, mode = "", sha = ""] = meta
    moved.push({ path, entry: /^0+$/.test(mode) ? null : { mode, sha } })
  }
  return moved
}

/** The paths the private index changes against `from`: what the slice's commit holds of its own. */
async function ownPaths(root: string, index: string, from: string): Promise<string[] | null> {
  const run = await git(
    root,
    ["diff-index", "--cached", "--name-only", "-z", "--no-renames", from],
    {
      env: { GIT_INDEX_FILE: index },
    },
  )
  return run.code === 0 ? run.text.split("\0").filter((path) => path !== "") : null
}

/**
 * The slice paths a moved path collides with: the same path (either side may differ only in case on
 * a case-insensitive disk), or a folder one holds where the other has a file.
 */
export function collisions(own: readonly string[], moved: readonly string[]): string[] {
  const lower = moved.map((path) => path.toLowerCase())
  return own.filter((path) => {
    const mine = path.toLowerCase()
    return lower.some(
      (other) => other === mine || other.startsWith(`${mine}/`) || mine.startsWith(`${other}/`),
    )
  })
}

/** Bring the checkout of the snapshot on: removed paths go (and the folders they empty), changed ones are written again. */
async function syncTree(root: string, index: string, tree: string, moved: Moved[]): Promise<void> {
  for (const { path, entry } of moved) {
    if (entry !== null) continue
    await rm(join(tree, path), { force: true })
    for (let dir = dirname(join(tree, path)); dir.length > tree.length; dir = dirname(dir))
      if (
        !(await rmdir(dir).then(
          () => true,
          () => false,
        ))
      )
        break
  }
  const written = moved.filter(({ entry }) => entry !== null)
  if (written.length === 0) return
  await git(root, ["checkout-index", "-f", "-z", "--stdin", `--prefix=${tree}/`], {
    env: { GIT_INDEX_FILE: index },
    input: written.map(({ path }) => `${path}\0`).join(""),
  })
}

/**
 * Move the checked snapshot, a private index built on `from` (and its checkout in `tree`, when the
 * caller keeps one), onto `to`. Returns the slice's paths the commits in between collide with: none
 * when the snapshot now stands on `to`, else it is left as it was. Entries the slice did not change
 * keep their stat information in the index, so no file is read again.
 */
async function followHead(
  root: string,
  o: { from: string; to: string; index: string; tree?: string; rebase?: Rebase },
): Promise<Result<string[]>> {
  if (o.from === o.to) return ok([])
  const [moved, own] = await Promise.all([
    movedBetween(root, o.from, o.to),
    ownPaths(root, o.index, o.from),
  ])
  if (moved === null || own === null)
    return err({ code: "bad_args", message: "git could not compare the commits HEAD moved across" })
  const collided = collisions(
    own,
    moved.map((m) => m.path),
  )
  // A slice file another commit changed too: both changes merged onto the new HEAD, when none overlap.
  const rebased = collided.length > 0 ? await rebaseOwn(root, o, collided, moved) : []
  if (rebased === null) return ok(collided)
  const landed = moved.map((m) => rebased.find((r) => r.path === m.path) ?? m)
  // Removals first: a folder and a file of one name cannot sit in the index together.
  const lines = [
    ...landed.filter((m) => m.entry === null),
    ...landed.filter((m) => m.entry !== null),
  ]
  if (lines.length > 0) {
    const put = await git(root, ["update-index", "--replace", "-z", "--index-info"], {
      env: { GIT_INDEX_FILE: o.index },
      input: lines.map((m) => infoLine(m.path, m.entry)).join(""),
    })
    if (put.code !== 0)
      return err({ code: "bad_args", message: `git update-index failed: ${put.stderr.trim()}` })
    if (o.tree !== undefined) await syncTree(root, o.index, o.tree, landed)
  }
  return ok([])
}

/**
 * A slice file the moved commits changed too, merged: its base on `from`, the new HEAD's version and
 * the slice's, as the caller merges them. Null when one cannot be merged; the slice is planned again.
 */
export type Rebase = (
  path: string,
  versions: { base: Entry | null; head: Entry | null; slice: Entry | null },
) => Promise<Entry | null>

async function rebaseOwn(
  root: string,
  o: { from: string; index: string; rebase?: Rebase },
  collided: string[],
  moved: Moved[],
): Promise<Moved[] | null> {
  if (o.rebase === undefined) return null
  const out: Moved[] = []
  for (const path of collided) {
    const head = moved.find((m) => m.path === path)
    // A folder against a file, or a path that differs only in case: planned again.
    if (head === undefined) return null
    const [base, slice] = await Promise.all([
      entryAt(root, ["ls-tree", "-z", o.from, "--", path], /^(\d+) \w+ (\w+)\t/),
      entryAt(root, ["ls-files", "-s", "-z", "--", path], /^(\d+) (\w+) 0\t/, o.index),
    ])
    const entry = await o.rebase(path, { base, head: head.entry, slice })
    if (entry === null) return null
    out.push({ path, entry })
  }
  return out
}

async function entryAt(
  root: string,
  args: string[],
  line: RegExp,
  index?: string,
): Promise<Entry | null> {
  const run = await git(root, args, index === undefined ? {} : { env: { GIT_INDEX_FILE: index } })
  const match = run.text.match(line)
  return run.code === 0 && match !== null ? { mode: match[1] ?? "", sha: match[2] ?? "" } : null
}

/**
 * Bring the snapshot onto the HEAD there is now: that HEAD, or `replan` with the slice paths the
 * commits in between collide with (none when the checkout changed branch), the snapshot untouched.
 */
export async function followToHead(
  root: string,
  o: { from: string; ref: string | null; index: string; tree?: string; rebase?: Rebase },
): Promise<Result<{ head: string } | { replan: string[] }>> {
  const head = (await git(root, ["rev-parse", "--verify", "HEAD"])).text.trim()
  if (head === "") return err({ code: "bad_args", message: "git could not read HEAD" })
  if ((await currentRef(root)) !== o.ref) return ok({ replan: [] })
  const collided = await followHead(root, { ...o, to: head })
  if (!collided.ok) return collided
  return ok(collided.data.length > 0 ? { replan: collided.data } : { head })
}

/**
 * Run one of the repository's hooks in `tree`, as `git commit` would: `git hook run`, which knows
 * every place a hook can be configured. A missing hook is a pass. Git before 2.36 has no
 * `git hook`; there the hook's file is run itself.
 */
export async function runHook(
  tree: string,
  env: Record<string, string | undefined>,
  name: string,
  args: string[] = [],
): Promise<Run> {
  const run = await git(
    tree,
    ["hook", "run", "--ignore-missing", name, ...(args.length > 0 ? ["--", ...args] : [])],
    { env },
  )
  if (run.code === 0 || !/is not a git command/.test(run.stderr)) return run
  return runHookFile(tree, env, name, args)
}

/** Run a hook's own file, found where git keeps this repository's hooks; a pass when there is none to run. */
export async function runHookFile(
  tree: string,
  env: Record<string, string | undefined>,
  name: string,
  args: string[] = [],
): Promise<Run> {
  const passed: Run = { code: 0, out: new Uint8Array(), text: "", stderr: "" }
  const where = await git(tree, ["rev-parse", "--git-path", `hooks/${name}`], { env })
  if (where.code !== 0 || where.text.trim() === "") return passed
  const file = resolve(tree, where.text.trim())
  try {
    await access(file, constants.X_OK)
  } catch {
    return passed
  }
  try {
    const proc = Bun.spawn([file, ...args], {
      cwd: tree,
      env: { ...process.env, ...env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [out, stderr, code] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    const bytes = new Uint8Array(out)
    return { code, out: bytes, text: new TextDecoder().decode(bytes), stderr }
  } catch (cause) {
    return { ...passed, code: 127, stderr: String(cause) }
  }
}

/** `git commit` runs post-commit once HEAD has moved; a commit put on HEAD with plumbing runs it here. Its result never matters, as with `git commit`. */
export async function runPostCommit(
  tree: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  await runHook(tree, env, "post-commit")
}

/** The commit's signing flag, as `git commit` would take it from the configuration. */
async function signing(root: string): Promise<string[]> {
  const run = await git(root, ["config", "--type=bool", "--get", "commit.gpgsign"])
  return run.text.trim() === "true" ? ["-S"] : []
}

/** The commit of the snapshot's tree on `parent`, made but not yet on any ref. */
async function commitTree(
  root: string,
  index: string,
  parent: string,
  message: string,
  sign: string[],
  author: Record<string, string> = {},
  expectedTree?: string,
): Promise<Result<string>> {
  const written = await git(root, ["write-tree"], { env: { GIT_INDEX_FILE: index } })
  if (written.code !== 0)
    return err({ code: "bad_args", message: `git write-tree failed: ${written.stderr.trim()}` })
  const tree = written.text.trim()
  if (expectedTree !== undefined && tree !== expectedTree)
    return err({
      code: "bad_args",
      message:
        "The commit hook changed the reviewed tree. Refresh the diff and run the checks again.",
    })
  const made = await git(root, ["commit-tree", tree, "-p", parent, ...sign], {
    input: message,
    env: author,
  })
  if (made.code !== 0)
    return err({
      code: "commit_rejected",
      message: `git could not make the slice's commit; nothing was committed:\n${made.stderr.trim()}`,
    })
  return ok(made.text.trim())
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
  o: {
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
  },
): Promise<Result<{ sha: string; parent: string }> | { replan: string[] }> {
  const message = `${o.message.trimEnd()}\n`
  const sign = await signing(root)
  const subject = message.split("\n")[0] ?? ""
  let current = o.from
  let why = ""
  const until = Date.now() + PLACE_WAIT_MS
  let tries = 0
  for (; tries === 0 || Date.now() < until; tries++) {
    const followed = await followToHead(root, {
      from: current,
      ref: o.ref,
      index: o.index,
      tree: o.tree,
      rebase: o.rebase,
    })
    if (!followed.ok) return followed
    if ("replan" in followed.data) return followed.data
    const head = followed.data.head
    current = head
    const admitted = await o.ready?.(head)
    if (admitted && !admitted.ok) return admitted
    const made = await commitTree(root, o.index, head, message, sign, o.author, o.reviewed?.tree)
    if (!made.ok) return made
    const sha = made.data
    const swapped = await git(root, [
      "update-ref",
      "-m",
      `commit: ${subject}`,
      o.reviewed?.ref ?? "HEAD",
      sha,
      head,
    ])
    if (swapped.code === 0) return ok({ sha, parent: head })
    why = swapped.stderr.trim()
    // Another commit landing is no reason to wait; a ref that another writer holds for a moment is.
    if ((await git(root, ["rev-parse", "--verify", "HEAD"])).text.trim() === head)
      await Bun.sleep(50)
  }
  return err({
    code: "bad_args",
    message: `HEAD moved on each of ${tries} tries in ${Math.round(PLACE_WAIT_MS / 1000)} s, so the slice's checked commit could not be put on it${why === "" ? "" : ` (${why})`}; nothing was committed. Run the same command again.`,
  })
}
