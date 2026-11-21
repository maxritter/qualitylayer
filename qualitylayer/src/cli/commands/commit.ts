import {
  decideTaskCommit,
  precommitDiff,
  precommitSource,
  readPrecommit,
} from "../../core/task/precommit.ts"
// `commit slice <n> [--message "<text>"] [--leave <path>]...`: commit the slice's files without
// touching what anyone else staged; `commit fix` does the same for the files the latest fix helper
// changed. Thin parsing over core/git/slice-commit.ts.

import { materializeChecksRecord } from "../../core/check-receipts.ts"
import { readCheckRecords } from "../../core/checks.ts"
import { backticked } from "../../core/docs/commands.ts"
import { commitGroup } from "../../core/docs/outline.ts"
import { buildBase } from "../../core/git/base.ts"
import {
  canonicalizeSliceCommits,
  committedSlices,
  planFolder,
  readBuildStart,
  recordCommitBlocked,
  recordCommittedSlice,
  recordSliceCommit,
  sliceCommits,
} from "../../core/git/build-start.ts"
import { commitScopeError } from "../../core/git/commit-scope.ts"
import { foreignOwners } from "../../core/git/foreign-refusal.ts"
import { registerExternalSlice } from "../../core/git/implement-repository.ts"
import { ownEdits, ownEditTimes, ownRecordSpan } from "../../core/git/session-edits.ts"
import {
  commitSlice,
  covers,
  existingSliceCommit,
  type UnnamedCheck,
} from "../../core/git/slice-commit.ts"
import { missingSliceCheck } from "../../core/helpers.ts"
import { openExitQuestion, readVerifyExit } from "../../core/next/verify-exit.ts"
import { resolveRepo } from "../../core/paths.ts"
import { noteOwnCommit } from "../../core/ship/landing.ts"
import type { Task } from "../../core/task/store.ts"
import { readVerifyMode } from "../../core/task/verify-mode.ts"
import { readOutline } from "../../core/task-flow.ts"
import { REVIEWER_TEST_PATHS } from "../../core/verification.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { parseArgs, requireTask } from "./shared.ts"

const USAGE =
  'usage: qualitylayer commit slice <n> [--message "<text>"] [--take <file>]... [--accept-edits <file>]... [--commit <hash of a commit you made by hand> [--repo <approved checkout>]] | slices <n> <m> ... [--message "<text>"] [--take <file>]... | task | receipts --canonicalize | fix [--message "<text>"] [--leave <path>]... [--take-staged <file>]... | fix --commit <hash of a fix you committed by hand>; one finished slice uses commit slice <n>, not commit slices; --take explicitly claims a captured unstaged pre-build file approved for this slice; --accept-edits says every change in a file belongs to this task, after the commit refused it as changed since the last edit of the task; --leave names a changed path outside the selected slice, relative to the repository root even from a subfolder; with commit fix, --leave may also name a file of the fix itself, which then stays uncommitted'

/** Every value of a repeated flag, in the order given. */
function valuesOf(args: string[], flag: string): string[] {
  const values: string[] = []
  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1]
    if (args[i] !== flag || value === undefined || value.startsWith("--")) continue
    values.push(value)
    i++
  }
  return values
}

/** What the commit needs to know of changed files no card names: the task's own records and edits. */
async function unnamedCheck(
  ctx: Ctx,
  task: Task,
  args: string[],
  /** The files of the cards no commit has taken yet. */
  named: string[],
  otherSlices: UnnamedCheck["otherSlices"] = [],
): Promise<UnnamedCheck> {
  const start = await readBuildStart(ctx, task)
  const repo = await resolveRepo(ctx)
  const accepted = ["--accept-edits", "--take", "--take-staged"].flatMap((flag) =>
    valuesOf(args, flag),
  )
  return {
    named,
    otherSlices,
    records: [planFolder(task)],
    start: start?.state ?? null,
    ...(start?.blobs !== undefined ? { blobs: start.blobs } : {}),
    ...(start?.head !== undefined ? { baselineHead: start.head } : {}),
    ownCommits: await sliceCommits(ctx, task),
    ...(start?.approvedFiles !== undefined
      ? { approvedFiles: start.approvedFiles, stagedBeforeBuild: start.staged }
      : {}),
    leave: valuesOf(args, "--leave"),
    foreign: async (paths) =>
      repo.ok
        ? foreignOwners(ctx, repo.data, task.slug, paths, (path) =>
            // The task's plan folder is also written by QualityLayer itself; a file a person
            // said is all this task's, or took on purpose, is no unrecorded change.
            [planFolder(task), ...accepted].some(
              (entry) => path === entry || (entry.endsWith("/") && path.startsWith(entry)),
            ),
          )
        : {},
  }
}

/**
 * `commit fix`: the files this task's sessions edited since the latest fix helper was handed out
 * (all of the task's recorded edits when none was), committed as `commit slice` does.
 */
/** A fix commit's subject without `--message`: what it touched, not who made it. */
export function fixSubject(files: string[]): string {
  const names = [...new Set(files.map((f) => f.split("/").pop() ?? f))]
  const shown = names.slice(0, 3).join(", ")
  return `fix: ${shown}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`
}

/**
 * The files among `files` the commit will carry: changed from HEAD, deleted or new. A session's
 * recorded edits also hold files it already committed, which no subject may name.
 */
export async function changedOf(ctx: Ctx, root: string, files: string[]): Promise<string[]> {
  if (files.length === 0) return []
  const literal = files.map((f) => `:(literal)${f}`)
  const tracked = await ctx.git.run(root, ["diff", "--name-only", "-z", "HEAD", "--", ...literal])
  const fresh = await ctx.git.run(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...literal,
  ])
  const changed = new Set(
    [tracked, fresh].flatMap((r) => (r.code === 0 ? r.stdout.split("\0") : [])).filter(Boolean),
  )
  const kept = files.filter((f) => changed.has(f))
  return kept.length > 0 ? kept : files
}

/**
 * Of the files this task's sessions edited, those one of the task's own commits took after their
 * last edit of them: an earlier slice's files, which no fix round has touched. They are not part
 * of a fix. What such a file holds now in the checkout is another session's work, or nothing.
 */
async function committedSinceEdit(
  ctx: Ctx,
  task: Task,
  repo: { id: string; root: string },
  edited: string[],
): Promise<Set<string>> {
  const settled = new Set<string>()
  if (edited.length === 0) return settled
  const editedAt = await ownEditTimes(ctx, repo, task.slug)
  const committedAt = new Map<string, number>()
  for (const sha of await sliceCommits(ctx, task)) {
    const when = await ctx.git.run(task.repoRoot, ["log", "-1", "--format=%ct", sha])
    const touched = await ctx.git.run(task.repoRoot, [
      "diff-tree",
      "--root",
      "-m",
      "--no-commit-id",
      "--name-only",
      "-r",
      "-z",
      sha,
    ])
    const at = Number(when.stdout.trim()) * 1000
    if (when.code !== 0 || touched.code !== 0 || !Number.isFinite(at) || at <= 0) continue
    for (const path of touched.stdout.split("\0"))
      if (path !== "" && at > (committedAt.get(path) ?? 0)) committedAt.set(path, at)
  }
  for (const path of edited) {
    const [last, taken] = [editedAt.get(path), committedAt.get(path)]
    if (last !== undefined && taken !== undefined && last < taken) settled.add(path)
  }
  return settled
}

async function commitFix(ctx: Ctx, args: string[], message: unknown): Promise<Result<unknown>> {
  const task = await requireTask(ctx)
  if (!task.ok) return task
  if (deferredTaskCommit(task.data)) return deferredCommitReply()
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  const folder = planFolder(task.data)
  const edited = (await ownEdits(ctx, repo.data, task.data.slug, 0)).filter(
    (path) => !path.startsWith(folder),
  )
  // A fix has no card that fixes its files, so a file may be left out of it by name.
  const left = valuesOf(args, "--leave")
  const settled = await committedSinceEdit(ctx, task.data, repo.data, edited)
  const recorded = edited.filter(
    (path) => !settled.has(path) && !left.some((entry) => covers(entry, path)),
  )
  if (edited.length === 0) {
    // The fix may be committed already, by the agent itself: register it instead.
    const registered = await registerOwnCommits(ctx, task.data, repo.data)
    if (registered !== null) return registered
    return err({
      code: "bad_args",
      message:
        "No file edit is recorded for this task and no unregistered commit of its own is on HEAD. Nothing was committed. Commit the fix's hunks with git (with a private index on HEAD when other work shares the checkout, preserving the shared index), then register the commit with `qualitylayer commit fix --commit <hash>`.",
    })
  }

  const plan = await readOutline(ctx, task.data)
  const done = await committedSlices(ctx, task.data)
  const committed = await commitSlice(
    task.data.repoRoot,
    recorded,
    [],
    typeof message === "string" && message.trim() !== ""
      ? message
      : fixSubject(await changedOf(ctx, task.data.repoRoot, recorded)),
    {
      ...(await unnamedCheck(
        ctx,
        task.data,
        args,
        (plan?.slices ?? [])
          .filter((s) => !done.includes(s.n))
          .flatMap((s) => s.tasks.flatMap((t) => t.files)),
      )),
      foreignMove: (path) =>
        `Nothing was committed, because ${path} holds another session's uncommitted work. To commit the rest of this fix now, run \`qualitylayer commit fix --leave ${path}\`: that file stays as it is and goes in with a later \`qualitylayer commit fix\`. The other ways: `,
    },
    valuesOf(args, "--take-staged"),
  )
  if (committed.ok && committed.data.commit !== null) {
    await recordSliceCommit(ctx, task.data, committed.data.commit)
    // After the approval the fix is this task's own change, shown on Review for Approve change.
    if (task.data.stage === "shipped") await noteOwnCommit(ctx, task.data, committed.data.commit)
  }
  // Nothing left to commit: the agent committed the fix itself, so its commits are registered.
  if (committed.ok && committed.data.commit === null) {
    const registered = await registerOwnCommits(ctx, task.data, repo.data)
    if (registered !== null) return registered
  }
  return committed
}

/**
 * The task's own commits on HEAD since the build's base that no receipt holds: those its sessions
 * made (the hooks' record), and those that touch a file its sessions edited. Oldest first.
 */
async function unregisteredOwnCommits(
  ctx: Ctx,
  task: Task,
  repo: { id: string; root: string },
): Promise<string[]> {
  const base = await buildBase(ctx, task).catch(() => null)
  if (base === null) return []
  const run = (args: string[]) => ctx.git.run(task.repoRoot, args)
  const listed = await run(["rev-list", "--reverse", "--no-merges", `${base}..HEAD`])
  if (listed.code !== 0) return []
  const receipts = await sliceCommits(ctx, task)
  const made = (await ownRecordSpan(ctx, { id: repo.id }, task.slug)).commits
  const edited = new Set(
    (await ownEdits(ctx, repo, task.slug, 0)).filter((path) => !path.startsWith(planFolder(task))),
  )
  const own: string[] = []
  for (const sha of listed.stdout.split("\n").map((line) => line.trim())) {
    if (sha === "" || receipts.some((receipt) => sha.startsWith(receipt))) continue
    if (made.has(sha)) {
      own.push(sha)
      continue
    }
    const touched = await run([
      "diff-tree",
      "--root",
      "--no-commit-id",
      "--name-only",
      "-r",
      "-z",
      sha,
    ])
    if (touched.code === 0 && touched.stdout.split("\0").some((path) => edited.has(path)))
      own.push(sha)
  }
  return own
}

/** Registers each of the task's own unregistered commits; null when there is none. */
async function registerOwnCommits(
  ctx: Ctx,
  task: Task,
  repo: { id: string; root: string },
): Promise<Result<unknown> | null> {
  const commits = await unregisteredOwnCommits(ctx, task, repo)
  if (commits.length === 0) return null
  const registered: { commit: string; subject: string; files: string[] }[] = []
  for (const sha of commits) {
    const one = await registerFix(ctx, task, sha)
    if (!one.ok) return one
    registered.push(one.data as { commit: string; subject: string; files: string[] })
  }
  const named = registered.map((r) => `${r.commit.slice(0, 9)} (${r.subject})`).join(", ")
  return ok({
    commit: registered.at(-1)?.commit ?? null,
    registered: registered.map((r) => r.commit),
    files: [...new Set(registered.flatMap((r) => r.files))],
    message: `Nothing was left to commit: the fix is in the commits you made, now registered as this task's: ${named}.`,
  })
}

/**
 * `commit fix --commit <hash>`: a fix was committed by hand (a judge's new test, a fixer's commit
 * after `commit fix` refused). It is checked (one commit on this branch, after the build's base,
 * touching a file this task owns) and recorded beside the slice receipts, none replaced; a file no
 * card names is fine. Nothing is committed.
 */
async function registerFix(ctx: Ctx, task: Task, hash: string): Promise<Result<unknown>> {
  const run = (args: string[]) => ctx.git.run(task.repoRoot, args)
  const nothing = "nothing was registered"
  if (!/^[0-9a-f]{4,64}$/i.test(hash))
    return err({
      code: "bad_args",
      message: `--commit needs a commit hash, short or full (hex digits only, at least four); ${nothing}.`,
    })
  const found = await run(["rev-parse", "--verify", "--quiet", `${hash}^{commit}`])
  const commit = found.stdout.trim()
  // The commit found must be the one the digits name: a branch called like a hash is not it.
  if (found.code !== 0 || !commit.toLowerCase().startsWith(hash.toLowerCase())) {
    const candidates = (await run(["rev-parse", `--disambiguate=${hash}`])).stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
    return err({
      code: "bad_args",
      message:
        candidates.length > 1
          ? `${hash} is the start of more than one hash in this repository; give more of its digits or the full hash, as \`git rev-parse HEAD\` prints it; ${nothing}.`
          : `no commit ${hash} in this repository; ${nothing}.`,
    })
  }
  const short = commit.slice(0, 9)
  if ((await run(["merge-base", "--is-ancestor", commit, "HEAD"])).code !== 0)
    return err({
      code: "bad_args",
      message: `commit ${short} is not an ancestor of HEAD: it is not on the branch this checkout is on; ${nothing}.`,
    })
  const base = await buildBase(ctx, task).catch(() => null)
  if (base !== null && (await run(["merge-base", "--is-ancestor", commit, base])).code === 0)
    return err({
      code: "bad_args",
      message: `commit ${short} is part of the history the build started from, not a fix of this task; ${nothing}.`,
    })
  const receipts = await sliceCommits(ctx, task)
  const subject = (await run(["log", "-1", "--format=%s", commit])).stdout.trim()
  if (receipts.some((sha) => commit.startsWith(sha)))
    return ok({
      commit,
      subject,
      files: [],
      message: `Commit ${short} (${subject}) is already registered as this task's; nothing changed.`,
    })
  const touched = await run([
    "diff-tree",
    "--root",
    "-m",
    "--no-commit-id",
    "--name-only",
    "-r",
    "-z",
    commit,
  ])
  const files = [...new Set(touched.stdout.split("\0").filter((path) => path !== ""))]
  // What the task owns by its own records: its Plan's files, its earlier commits' files and its
  // sessions' edits (a judge's new test file is one). Not every commit since the base: that would
  // count this very commit.
  const plan = await readOutline(ctx, task)
  const earlier =
    receipts.length > 0
      ? (await run(["show", "--name-only", "--format=", "-z", ...receipts])).stdout.split("\0")
      : []
  const repo = await resolveRepo(ctx)
  const owned = new Set([
    ...(plan?.slices ?? []).flatMap((s) => s.tasks.flatMap((t) => t.files)),
    ...earlier,
    ...(repo.ok ? await ownEdits(ctx, repo.data, task.slug, 0) : []),
  ])
  const folder = planFolder(task)
  // A commit of tests and docs only (the reviewer's tests, a test written during the review) is
  // the task's when the agent names it: such files are often new and named by no card.
  const production = await run([
    "diff-tree",
    "--root",
    "-m",
    "--no-commit-id",
    "--name-only",
    "-r",
    "-z",
    commit,
    "--",
    ".",
    ":(exclude)docs/plans/**",
    ...REVIEWER_TEST_PATHS,
  ])
  const testsOnly =
    production.code === 0 &&
    production.stdout === "" &&
    files.some((path) => !path.startsWith(folder))
  if (!testsOnly && !files.some((path) => !path.startsWith(folder) && owned.has(path)))
    return err({
      code: "bad_args",
      message: `commit ${short} touches no file this task owns (its Plan's files, its earlier commits' files or its sessions' recorded edits), so it holds other sessions' work; ${nothing} and the commit stays as it is. Register only a commit that carries this task's own fix; another session's commit needs nothing from this task.`,
    })
  try {
    await recordSliceCommit(ctx, task, commit)
  } catch (cause) {
    return err({
      code: "bad_args",
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }
  if (task.stage === "shipped") await noteOwnCommit(ctx, task, commit)
  return ok({
    commit,
    subject,
    files,
    message:
      `Fix commit ${short} (${subject}) is registered as this task's, beside its slice receipts, which are unchanged; the task's review diff now includes it. Nothing was committed now.` +
      (await fixRegisteredWait(ctx, task).catch(() => "")),
  })
}

/** Registration adds to the review diff while an existing Verify exit still needs an answer. */
async function fixRegisteredWait(ctx: Ctx, task: Task): Promise<string> {
  if ((await readVerifyMode(ctx, task)) !== "asked") return ""
  const exit = await readVerifyExit(ctx, task)
  return exit !== null && (await openExitQuestion(ctx, task, exit.id)) !== null
    ? " Verify still needs the person's answer before another review. Run `qualitylayer wait --for answer`."
    : ""
}

/**
 * `commit slice <n> --commit <hash>`: the slice was committed by hand. The commit is checked (it
 * exists, is on HEAD's history, touches a file a card names), then recorded as this slice's, as
 * `commit slice` would have done; nothing is committed.
 */
async function releaseByHand(
  ctx: Ctx,
  task: Task,
  slice: { n: number; tasks: { files: string[] }[] },
  hash: string,
  otherSliceFiles: string[],
): Promise<Result<unknown>> {
  const selectedFiles = slice.tasks.flatMap((t) => t.files)
  const found = await existingSliceCommit(task.repoRoot, hash, selectedFiles)
  if (!found.ok) return found
  const legacyScope = (await commitScopeError(task.repoRoot, otherSliceFiles))
    ? undefined
    : { selectedFiles, otherFiles: otherSliceFiles, replacementFiles: found.data.files }
  const replaced = await recordSliceCommit(ctx, task, found.data.commit, {
    slices: [slice.n],
    replace: true,
    ...(legacyScope ? { legacyScope } : {}),
  })
  await recordCommittedSlice(ctx, task, slice.n)
  return ok({
    commit: found.data.commit,
    subject: found.data.subject,
    files: found.data.files,
    kept_staged: [],
    left_out: [],
    borrowed: [],
    message: `Slice ${slice.n} is recorded as committed in ${found.data.commit.slice(0, 9)} (${found.data.subject}).${replaced > 0 ? ` It replaces the earlier receipt${replaced === 1 ? "" : "s"} of slice ${slice.n}.` : ""} Nothing was committed now.`,
  })
}

async function taskCommit(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const task = await requireTask(ctx)
  if (!task.ok) return task
  const review = await readPrecommit(ctx, task.data)
  if (!review)
    return err({
      code: "bad_args",
      message: "No commit review is open. Run qualitylayer build done when the task is ready.",
    })
  const [option, value, ...rest] = args.filter((arg) => arg !== "--json")
  if (option === undefined)
    return ok({
      ...review,
      ...(review.decision === "pending"
        ? {
            owner_replies: {
              approve: `Approve commit ${review.id}`,
              request_edits: `Request edits ${review.id} <what to change>`,
              manual: `Commit manually ${review.id}`,
            },
            view: "qualitylayer commit task --diff <file>",
          }
        : {}),
    })
  if (!value || (option === "--edits" ? rest.length !== 1 : rest.length > 0))
    return err({
      code: "bad_args",
      message:
        'usage: qualitylayer commit task [--diff <file> | --file <file> | --approve <review id> | --manual <review id> | --edits <review id> "<exact edits>" | --commit <hash>]',
    })
  if (option === "--diff") return precommitDiff(ctx, task.data, value, review.id)
  if (option === "--file")
    return precommitSource(
      ctx,
      task.data,
      value,
      review.id,
      review.files.find((file) => file.path === value)?.status === "D" ? "old" : "new",
    )
  const action =
    option === "--approve"
      ? "approve"
      : option === "--manual"
        ? "manual"
        : option === "--edits"
          ? "edits"
          : option === "--commit"
            ? "register"
            : null
  if (!action)
    return err({
      code: "bad_args",
      message: "Use qualitylayer commit task to inspect the active review.",
    })
  const result = await decideTaskCommit(
    ctx,
    task.data,
    action,
    action === "register" ? review.id : value,
    action === "register" ? value : (rest[0] ?? ""),
    "terminal",
  )
  return result.ok
    ? ok({
        ...result.data,
        next: {
          manual: "qualitylayer commit task --commit <hash>",
          edits: "qualitylayer next",
          approve: "qualitylayer build done",
          register: "qualitylayer build done",
        }[action],
      })
    : result
}

function deferredTaskCommit(task: Task): boolean {
  return (
    task.stage === "implement" && task.commitTiming !== undefined && task.commitTiming !== "slice"
  )
}

const deferredCommitReply = () =>
  err({
    code: "bad_args",
    message:
      "This task commits at the end of Implement. Run qualitylayer build done when the cards are ready.",
  })

export async function commitCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  if (args[0] === "task") return taskCommit(ctx, args.slice(1))
  const { positional, flags } = parseArgs(args, [
    "message",
    "leave",
    "take-staged",
    "take",
    "accept-edits",
    "commit",
    "repo",
  ])
  if (
    args.some((arg) => arg.startsWith("--take=")) ||
    flags.take === true ||
    (typeof flags.take === "string" && (!flags.take || flags.take.startsWith("--")))
  )
    return err({
      code: "bad_args",
      message: `--take needs a separate exact repository-relative file: --take <file>. Nothing was committed. ${USAGE}`,
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
      message: `--leave needs a separate repository-relative path: --leave <path>. Nothing was committed. ${USAGE}`,
    })
  const [what, ...numbers] = positional
  if (
    args.some((arg) => arg.startsWith("--repo=")) ||
    (flags.repo !== undefined &&
      (typeof flags.repo !== "string" ||
        !flags.repo ||
        typeof flags.commit !== "string" ||
        what !== "slice" ||
        valuesOf(args, "--repo").length !== 1 ||
        Object.keys(flags).some((flag) => !["repo", "commit", "json"].includes(flag))))
  )
    return err({
      code: "bad_args",
      message: "usage: qualitylayer commit slice <n> --commit <hash> --repo <approved checkout>",
    })
  if (what === "receipts" && numbers.length === 0) {
    if (
      flags.canonicalize !== true ||
      Object.keys(flags).some((flag) => !["canonicalize", "json"].includes(flag))
    )
      return err({
        code: "bad_args",
        message:
          "usage: qualitylayer commit receipts --canonicalize; only verified identifiers for existing receipts are normalized",
      })
    const task = await requireTask(ctx)
    if (!task.ok) return task
    try {
      return ok({
        task: task.data.slug,
        ...(await canonicalizeSliceCommits(ctx, task.data)),
        history_rewritten: false,
        source_verified: false,
        next: "qualitylayer next",
      })
    } catch (cause) {
      return err({
        code: "bad_args",
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }
  if (what === "fix" && numbers.length === 0) {
    if (flags.take !== undefined)
      return err({
        code: "bad_args",
        message:
          "--take is only for an approved slice's captured pre-build content; commit fix does not claim it. Nothing was committed.",
      })
    if (flags.commit !== undefined) {
      if (typeof flags.commit !== "string")
        return err({
          code: "bad_args",
          message: "usage: qualitylayer commit fix --commit <hash of a fix you committed by hand>",
        })
      const task = await requireTask(ctx)
      if (!task.ok) return task
      if (deferredTaskCommit(task.data)) return deferredCommitReply()
      return registerFix(ctx, task.data, flags.commit)
    }
    return commitFix(ctx, args, flags.message)
  }
  const group = what === "slices"
  // `--take-staged a.ts b.ts` leaves b.ts as a stray word: name the fix instead of the usage line.
  const stray = numbers.find((n) => !/^\d+$/.test(n))
  const listed = ["--take-staged", "--take", "--leave"].find((flag) => args.includes(flag))
  if (stray !== undefined && listed !== undefined)
    return err({
      code: "bad_args",
      message: `${stray} was read as a slice number. Give each file its own flag: ${listed} a.ts ${listed} b.ts`,
    })
  if (
    (what !== "slice" && !group) ||
    numbers.length < (group ? 2 : 1) ||
    (!group && numbers.length !== 1) ||
    numbers.some((n) => !/^[1-9]\d*$/.test(n) || !Number.isSafeInteger(Number(n))) ||
    new Set(numbers.map(Number)).size !== numbers.length
  )
    return err({ code: "bad_args", message: USAGE })
  const task = await requireTask(ctx)
  if (!task.ok) return task
  if (deferredTaskCommit(task.data) && flags.repo === undefined) return deferredCommitReply()
  const plan = await readOutline(ctx, task.data)
  if (plan === null) return err({ code: "bad_args", message: "there is no approved Plan" })
  const selected = plan.slices.filter((s) => numbers.map(Number).includes(s.n))
  const missing = numbers.find((n) => !selected.some((s) => s.n === Number(n)))
  if (missing !== undefined)
    return err({ code: "bad_args", message: `the Plan has no slice ${missing}` })
  // Slices whose cards say they commit together are never split: one replaces what the other
  // still uses, so neither compiles or passes the hook alone.
  for (const slice of selected) {
    const together = commitGroup(plan, slice.n)
    const absent = together.filter((m) => !selected.some((chosen) => chosen.n === m))
    if (absent.length > 0)
      return err({
        code: "bad_args",
        message: `slice ${slice.n} commits with slice${absent.length === 1 ? "" : "s"} ${absent.join(", ")} (its Commits with line): they are committed together once every one of them passed its checks. Run \`qualitylayer commit slices ${together.join(" ")}\` then. Nothing was committed.`,
      })
  }
  // Keep legacy Windows spellings visible even when the cards' path parser omitted them.
  const scopeError = await commitScopeError(
    task.data.repoRoot,
    selected.flatMap((slice) =>
      slice.tasks.flatMap((card) => [...card.files, ...backticked(card.filesRaw)]),
    ),
  )
  if (scopeError) return err({ code: "bad_args", message: scopeError })
  if (group) {
    const records = await readCheckRecords(ctx, task.data)
    for (const slice of selected) {
      const incomplete = slice.tasks.find((t) => !t.checked)
      if (incomplete !== undefined)
        return err({
          code: "bad_args",
          message: `slice ${slice.n} is incomplete: ${incomplete.id} is not checked off. Finish and verify it before committing the group.`,
        })
      const missing = missingSliceCheck(records, slice)
      if (missing !== null)
        return err({
          code: "bad_args",
          message: `slice ${slice.n} has no passing recorded check for \`${missing.command}\`; run \`qualitylayer ${missing.action}\` before committing the group.`,
        })
    }
  }
  if (flags.commit !== undefined) {
    if (group || typeof flags.commit !== "string" || flags.take !== undefined)
      return err({
        code: "bad_args",
        message: "usage: qualitylayer commit slice <n> --commit <hash> (one slice, one commit)",
      })
    const slice = selected[0] as (typeof selected)[number]
    if (typeof flags.repo === "string") {
      const released = await registerExternalSlice(ctx, task.data, {
        slice: slice.n,
        files: slice.tasks.flatMap((card) => card.files),
        path: flags.repo,
        hash: flags.commit,
      })
      if (!released.ok) return released
      const projectionWarning = await materializeChecksRecord(ctx, task.data).then(
        () => "",
        () => " The receipt was saved. Open Records › Checks to retry its display.",
      )
      return ok({
        ...released.data,
        message: `Slice ${slice.n} is recorded as ${released.data.commit.slice(0, 9)} in ${released.data.repository}.${projectionWarning}`,
      })
    }
    return releaseByHand(
      ctx,
      task.data,
      slice,
      flags.commit,
      plan.slices
        .filter((slice) => !selected.some((chosen) => chosen.n === slice.n))
        .flatMap((slice) =>
          slice.tasks.flatMap((card) => [...card.files, ...backticked(card.filesRaw)]),
        ),
    )
  }
  const message =
    typeof flags.message === "string" && flags.message.trim() !== ""
      ? flags.message
      : group
        ? `Build slices ${selected.map((s) => s.n).join(", ")}`
        : `Build slice ${selected[0]?.n}: ${selected[0]?.title}`
  // A file stays another slice's while that slice is not committed; a committed slice's file
  // changed again is this slice's to take.
  const done = await committedSlices(ctx, task.data)
  const committed = await commitSlice(
    task.data.repoRoot,
    group
      ? [...new Set(selected.flatMap((s) => s.tasks.flatMap((t) => t.files)))]
      : selected.flatMap((s) => s.tasks.flatMap((t) => t.files)),
    [],
    message,
    await unnamedCheck(
      ctx,
      task.data,
      args,
      plan.slices
        .filter((s) => selected.some((chosen) => chosen.n === s.n) || !done.includes(s.n))
        .flatMap((s) => s.tasks.flatMap((t) => t.files)),
      plan.slices
        .filter((s) => !selected.some((chosen) => chosen.n === s.n) && !done.includes(s.n))
        .map((s) => ({ n: s.n, files: s.tasks.flatMap((t) => t.files) })),
    ),
    valuesOf(args, "--take-staged"),
    group ? selected.map((s) => s.n) : undefined,
    valuesOf(args, "--take"),
  )
  if (!committed.ok)
    await recordCommitBlocked(
      ctx,
      task.data,
      selected.map((s) => s.n),
      committed.error.message,
      committed.error.code === "commit_rejected" ? "hook" : undefined,
    )
  if (committed.ok) {
    // This task's own commit, known by its hash: the review tells it from another build's.
    if (committed.data.commit !== null)
      await recordSliceCommit(ctx, task.data, committed.data.commit, {
        slices: selected.map((s) => s.n),
        replace: false,
      })
    for (const slice of selected) {
      await recordCommittedSlice(ctx, task.data, slice.n)
    }
  }
  return committed
}
