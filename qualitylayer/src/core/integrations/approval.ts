// A pull request on GitHub for approval (Max, 11 Nov 2026: GitHub only, the person creates it in GitHub's
// own UI). `gate open plan --via github` puts the people's Plan (01-plan.md and its assets as readers see
// them, never the agents' file) on a branch `ql/plan/<slug>` built from the base without touching the
// person's working tree and pushes it; `gate open final --via github` pushes the task's own branch. Each
// send answers with GitHub's compare page, prefilled with a title and a short description ending in
// QualityLayer's marker line: the person creates the pull request there. QualityLayer then finds it by
// its branch; `wait --for approval` reads it: an approving review on the pushed commit, by someone other
// than the sender who can write to the repository, settles the gate as that named approver; every comment
// comes back as feedback, to the planner on the Plan and to the fixing agents on the change. A Plan
// approved in QualityLayer instead closes its request with a note and deletes its branch. Everything runs
// with the person's own git and gh login; nothing goes through a QualityLayer service.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { NAMES } from "../docs/names.ts"
import type { Comment } from "../gate/comments.ts"
import * as gate from "../gate/gate.ts"
import { gateRevision } from "../gate/revision.ts"
import { currentBranch } from "../git/repo.ts"
import { type Missing, refused } from "../next/refusal.ts"
import { writeShipRecord } from "../ship/choice.ts"
import { ensureDraftDescription } from "../ship/closing-record.ts"
import { pullRequestBody } from "../ship/pr-body.ts"
import type { Task } from "../task/store.ts"
import { forReaders } from "./for-readers.ts"

export type Via = "github"
/** What goes out: the Plan (its own branch) or the change for the final review (the task's branch). */
export type Target = "plan" | "final"

/** What was pushed, kept beside the task's gate (`outside-approval.json`, `outside-approval-final.json`). */
export type Sent = {
  version: 1
  /** Absent for the Plan. */
  target?: "final"
  via: Via
  /** GitHub's compare page, prefilled: where the person creates the pull request. */
  compare?: string
  /** The pull request, once the person created it (found by its branch). */
  url?: string
  number?: number
  branch: string
  base: string
  /** The commit pushed: an approval counts only on it. */
  head: string
  /** The Plan revision that commit holds; for the change, the commit itself. */
  revision: string
  /** The Plan only: for each line of the pushed 01-plan.md, its line in the task's own file. */
  planLines?: number[]
  /** Who pushed it: their own review never approves. */
  sender: string
  at: number
  /** Comments and reviews already handed to the agents, by id. */
  seen: string[]
  /** The request was closed or merged on GitHub: nothing waits there, the next send starts again. */
  closed?: true
}

const GH = {
  program: "gh",
  login: "gh auth login",
  install: "install GitHub's gh (https://cli.github.com)",
}

const sentPath = (task: Pick<Task, "runtimeDir">, target: Target) =>
  join(
    task.runtimeDir,
    target === "final" ? "outside-approval-final.json" : "outside-approval.json",
  )

export async function readSent(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  target: Target = "plan",
): Promise<Sent | null> {
  try {
    const sent = JSON.parse(await ctx.fs.readFile(sentPath(task, target))) as Sent
    return sent.version === 1 && sent.via === "github" ? sent : null
  } catch {
    return null
  }
}

async function writeSent(ctx: Ctx, task: Pick<Task, "runtimeDir">, sent: Sent): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(
    sentPath(task, sent.target ?? "plan"),
    `${JSON.stringify(sent, null, 2)}\n`,
  )
}

/** The words for what goes out, in refusals and replies. */
const WHAT: Record<Target, string> = { plan: "the Plan", final: "the change" }

type Run = { code: number; stdout: string; stderr: string }

/** A program in a folder with the person's environment; `env` adds to it. Null when not installed. */
async function exec(
  ctx: Ctx,
  cwd: string,
  cmd: string[],
  env: Record<string, string> = {},
): Promise<Run | null> {
  const path = ctx.env.get("PATH") ?? ""
  const program = Bun.which(cmd[0] as string, { PATH: path })
  if (program === null) return null
  const base = Object.fromEntries(
    Object.keys(process.env).flatMap((key) => {
      const value = ctx.env.get(key)
      return value === undefined ? [] : [[key, value]]
    }),
  )
  const proc = Bun.spawn([program, ...cmd.slice(1)], {
    cwd,
    env: { ...base, PATH: path, HOME: ctx.env.get("HOME") ?? "", GH_PROMPT_DISABLED: "1", ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(60_000),
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

const said = (run: Run) => run.stderr.trim().split("\n").slice(0, 2).join(" ").slice(0, 300)

async function git(ctx: Ctx, cwd: string, args: string[], env: Record<string, string> = {}) {
  const done = await exec(ctx, cwd, ["git", ...args], env)
  return done ?? { code: 127, stdout: "", stderr: "git is not installed" }
}

function ghMissing(target: Target = "plan"): Result<never> {
  return refused(`gh is not installed, so ${WHAT[target]} cannot go to GitHub.`, [
    { what: "gh", move: `${GH.install}, then ${GH.login}` },
    { what: "another way to get it approved", move: "approve in the QualityLayer App" },
  ])
}

const failed = (what: string, run: Run, moves: Missing[]): Result<never> =>
  refused(`${what}${said(run) ? `: ${said(run)}` : ""}`, moves)

/** The branch a pull request goes into: origin's default branch, else the one checked out. */
async function baseBranch(ctx: Ctx, root: string): Promise<string | null> {
  const head = await git(ctx, root, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ])
  if (head.code === 0 && head.stdout.trim().startsWith("origin/"))
    return head.stdout.trim().slice("origin/".length)
  const current = await git(ctx, root, ["rev-parse", "--abbrev-ref", "HEAD"])
  const name = current.stdout.trim()
  return current.code === 0 && name !== "" && name !== "HEAD" ? name : null
}

/** The people's Plan files in the task folder: 01-plan.md and its assets, never the agents' file. */
async function planFiles(ctx: Ctx, task: Task): Promise<string[]> {
  const files = [join(task.dir, NAMES.plan)]
  const assets = join(task.dir, "assets")
  const walk = async (dir: string): Promise<void> => {
    if (!(await ctx.fs.exists(dir))) return
    for (const entry of await ctx.fs.entries(dir)) {
      const path = join(dir, entry.name)
      if (entry.kind === "directory") await walk(path)
      else files.push(path)
    }
  }
  await walk(assets)
  return files
}

/**
 * The commit holding the Plan on top of `parent`, built in a private index so the person's working
 * tree and index stay as they are. Its message carries the Plan revision as a trailer.
 */
async function planCommit(
  ctx: Ctx,
  task: Task,
  parent: string,
  revision: string,
): Promise<Result<{ commit: string; lines: number[] }>> {
  const root = task.repoRoot
  const scratch = mkdtempSync(join(tmpdir(), "ql-plan-index-"))
  const env = { GIT_INDEX_FILE: join(scratch, "index") }
  // The Plan as reviewers read it: no front matter, no empty section.
  const plan = forReaders(await ctx.fs.readFile(join(task.dir, NAMES.plan)))
  const planCopy = join(scratch, NAMES.plan)
  writeFileSync(planCopy, plan.text)
  try {
    const read = await git(ctx, root, ["read-tree", parent], env)
    if (read.code !== 0) return failed("The base branch could not be read", read, [])
    for (const file of await planFiles(ctx, task)) {
      const path = relative(root, file).split("\\").join("/")
      const source = file === join(task.dir, NAMES.plan) ? planCopy : file
      const blob = await git(ctx, root, ["hash-object", "-w", "--path", path, source])
      if (blob.code !== 0) return failed(`${path} could not be stored`, blob, [])
      const added = await git(
        ctx,
        root,
        ["update-index", "--add", "--cacheinfo", `100644,${blob.stdout.trim()},${path}`],
        env,
      )
      if (added.code !== 0) return failed(`${path} could not be staged`, added, [])
    }
    const tree = await git(ctx, root, ["write-tree"], env)
    if (tree.code !== 0) return failed("The Plan's tree could not be written", tree, [])
    const message = `Plan: ${task.title}\n\nThe Plan for review in QualityLayer; approve its pull request to approve it.\n\nQualityLayer-Plan-Revision: ${revision}\n`
    const commit = await git(ctx, root, [
      "commit-tree",
      tree.stdout.trim(),
      "-p",
      parent,
      "-m",
      message,
    ])
    if (commit.code !== 0)
      return failed("The Plan's commit could not be made", commit, [
        {
          what: "your git identity",
          move: 'git config user.name "<you>" && git config user.email <you@…>',
        },
      ])
    return ok({ commit: commit.stdout.trim(), lines: plan.lines })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** The signed-in account: whose own review never approves. */
async function senderOf(ctx: Ctx, root: string): Promise<string | null> {
  const done = await exec(ctx, root, ["gh", "api", "user", "--jq", ".login"])
  if (done === null || done.code !== 0) return null
  return done.stdout.trim() || null
}

/** The host origin is on, as configured ("local" for a folder); null without an origin. */
export async function originHost(ctx: Ctx, root: string): Promise<string | null> {
  const url = await originUrl(ctx, root)
  if (url === "") return null
  // A folder on this computer is a remote all the same, on no host.
  if (url.startsWith("/") || url.startsWith("file:") || /^[A-Za-z]:[\\/]/.test(url)) return "local"
  const scp = url.match(/^[^@/]+@([^:]+):/)
  if (scp) return (scp[1] as string).toLowerCase()
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** origin's URL as configured: a test or a mirror may route it elsewhere with insteadOf. */
export async function originUrl(ctx: Ctx, root: string): Promise<string> {
  const done = await ctx.git.run(root, ["config", "--get", "remote.origin.url"])
  return done.code === 0 ? done.stdout.trim() : ""
}

/** `owner/name` of a GitHub origin, or null. */
async function repoOf(ctx: Ctx, root: string): Promise<string | null> {
  const url = await originUrl(ctx, root)
  const found = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  return found ? `${found[1]}/${found[2]}` : null
}

/** Why `via` cannot be used from an origin on `host`, or null when it can. */
export function hostProblem(host: string | null): string | null {
  if (host === null) return "This repository has no origin remote"
  return host === "github.com" ? null : "origin is not on GitHub"
}

/** The longest prefilled compare page QualityLayer opens: browsers and GitHub take about 8 000 characters. */
const MAX_LINK = 7000

/** GitHub's compare page for `branch` into `base`, with the title and description filled in. */
export function compareUrl(
  repo: string,
  base: string,
  branch: string,
  title: string,
  body: string,
): string {
  const path = `https://github.com/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`
  return `${path}?expand=1&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
}

/**
 * A description that fits in the compare page's link: whole sections of `page` while they fit, then a
 * line that says the rest stays in QualityLayer, then `marker`.
 */
export function fitBody(page: string, marker: string, budget: number): string {
  const whole = `${page.trim()}\n\n${marker}`
  if (encodeURIComponent(whole).length <= budget) return whole
  const rest = "_The rest of this review is on its Verify page in QualityLayer._"
  const sections = page.trim().split(/\n(?=## )/)
  let kept = ""
  for (const section of sections) {
    const next = kept === "" ? section : `${kept}\n${section}`
    if (encodeURIComponent(`${next}\n\n${rest}\n\n${marker}`).length > budget) break
    kept = next
  }
  return `${kept === "" ? "" : `${kept.trim()}\n\n`}${rest}\n\n${marker}`
}

/** What every send needs first: gh, its login, an origin on GitHub and a base branch. */
async function preflight(
  ctx: Ctx,
  root: string,
  target: Target,
): Promise<Result<{ sender: string; base: string; repo: string }>> {
  const what = WHAT[target]
  if (Bun.which("gh", { PATH: ctx.env.get("PATH") ?? "" }) === null) return ghMissing(target)
  const sender = await senderOf(ctx, root)
  if (sender === null)
    return refused(`gh is not signed in, so ${what} cannot go to GitHub.`, [
      { what: "a gh login", move: GH.login },
    ])
  const remote = await git(ctx, root, ["remote", "get-url", "origin"])
  if (remote.code !== 0)
    return refused("This repository has no `origin` to push to.", [
      { what: "a remote named origin on GitHub", move: "git remote add origin <url>" },
    ])
  const host = await originHost(ctx, root)
  const repo = await repoOf(ctx, root)
  const offHost = hostProblem(host) ?? (repo === null ? "origin names no GitHub repository" : null)
  if (offHost !== null)
    return refused(
      `${offHost} (${host === "local" ? "a folder on this computer" : (host ?? "no host")}), so ${what} cannot go to GitHub.`,
      [
        {
          what: "an origin on GitHub",
          move: "approve in the QualityLayer App, or point origin at GitHub",
        },
      ],
    )
  const base = await baseBranch(ctx, root)
  if (base === null)
    return refused(
      "No base branch for the pull request: origin names no default and HEAD is detached.",
      [{ what: "a branch", move: "git switch <branch>" }],
    )
  return ok({ sender, base, repo: repo as string })
}

/** The open pull request for `branch`, found with gh; null when the person has not created one yet. */
async function findRequest(
  ctx: Ctx,
  root: string,
  sent: Pick<Sent, "branch" | "base">,
): Promise<{ url: string; number: number } | null> {
  const repo = await repoOf(ctx, root)
  if (repo === null) return null
  const found = json(
    await exec(ctx, root, [
      "gh",
      "pr",
      "list",
      "--repo",
      repo,
      "--head",
      sent.branch,
      "--base",
      sent.base,
      "--state",
      "open",
      "--json",
      "number,url",
      "--limit",
      "1",
    ]),
  )
  const first = list(found)[0]
  const number = Number(first?.number)
  return first !== undefined && Number.isInteger(number) && number > 0
    ? { url: str(first.url), number }
    : null
}

/** Whether the request is still open there; when GitHub cannot be asked, it counts as open. */
async function requestOpen(ctx: Ctx, root: string, sent: Sent): Promise<boolean> {
  if (sent.url === undefined) return true
  const done = await exec(ctx, root, [
    "gh",
    "pr",
    "view",
    sent.url,
    "--json",
    "state",
    "--jq",
    ".state",
  ])
  if (done === null || done.code !== 0) return true
  return done.stdout.trim() === "OPEN"
}

/**
 * The send before, while it still stands: pushed and waiting for the person, or a request open there.
 * A closed or merged request is not reused: the next send starts again.
 */
async function standing(ctx: Ctx, task: Task, target: Target): Promise<Sent | null> {
  const before = await readSent(ctx, task, target)
  if (before === null || before.closed === true) return null
  return (await requestOpen(ctx, task.repoRoot, before)) ? before : null
}

/** The link the person opens: the request once it exists, else the compare page. */
export const linkOf = (sent: Sent): string => sent.url ?? sent.compare ?? ""

/**
 * Send the Plan for approval: commit it on `ql/plan/<slug>`, push, and answer with GitHub's compare page
 * for it. Sending a changed Plan again pushes the new revision; an open request follows by itself.
 */
export async function sendPlan(ctx: Ctx, task: Task): Promise<Result<Sent>> {
  const root = task.repoRoot
  const ready = await preflight(ctx, root, "plan")
  if (!ready.ok) return ready
  const { sender, base, repo } = ready.data
  const branch = `ql/plan/${task.slug}`
  const fetched = await git(ctx, root, ["fetch", "--quiet", "origin", `refs/heads/${base}`])
  if (fetched.code !== 0)
    return failed(`origin's ${base} could not be read`, fetched, [
      { what: `${base} on origin`, move: `git push origin ${base}` },
    ])
  const baseCommit = (await git(ctx, root, ["rev-parse", "FETCH_HEAD"])).stdout.trim()
  const previous = await readSent(ctx, task, "plan")
  const live = await standing(ctx, task, "plan")
  const revision = await gateRevision(ctx, task, NAMES.plan)
  if (live !== null && live.revision === revision) return ok(live)
  // A Plan sent before gets the new revision on top of what its branch shows.
  const kept =
    live !== null
      ? await git(ctx, root, ["fetch", "--quiet", "origin", `refs/heads/${branch}`])
      : null
  const parent =
    kept !== null && kept.code === 0
      ? (await git(ctx, root, ["rev-parse", "FETCH_HEAD"])).stdout.trim()
      : baseCommit
  const commit = await planCommit(ctx, task, parent, revision)
  if (!commit.ok) return commit
  // The branch is QualityLayer's own: after a closed request it starts again from the base.
  const pushed = await git(ctx, root, [
    "push",
    "--quiet",
    "--force",
    "origin",
    `${commit.data.commit}:refs/heads/${branch}`,
  ])
  if (pushed.code !== 0)
    return failed(`The Plan's branch could not be pushed to origin`, pushed, [
      { what: "push access to origin", move: `${GH.login}, or check the remote` },
    ])
  const file = relative(root, join(task.dir, NAMES.plan)).split("\\").join("/")
  const body =
    `The Plan for **${task.title}**: \`${file}\` in this pull request. Approve to approve it; comments go to the planner.\n\n` +
    `QualityLayer-Plan-Revision: ${revision}`
  const sent: Sent = {
    version: 1,
    via: "github",
    compare: compareUrl(repo, base, branch, `Plan: ${task.title}`, body),
    ...(live?.url !== undefined && live.number !== undefined
      ? { url: live.url, number: live.number }
      : {}),
    branch,
    base,
    head: commit.data.commit,
    revision,
    planLines: commit.data.lines,
    sender,
    at: ctx.clock.now(),
    seen: previous?.seen ?? [],
  }
  await writeSent(ctx, task, sent)
  return ok(sent)
}

/** The change's description: the Verify page while it fits in a link, then how an approval counts. */
async function finalBody(ctx: Ctx, task: Task, head: string, room: number): Promise<string> {
  const page = pullRequestBody(await ensureDraftDescription(ctx, task)).trim()
  return fitBody(
    page,
    `---\n\nQualityLayer: approve to approve this commit; comments go to the agents.\n\nQualityLayer-Commit: ${head}`,
    room,
  )
}

/**
 * Why the change has no pull request from this checkout, or null when it has one: it is on no branch,
 * on another branch than the task's, or on the branch a pull request goes into.
 */
export async function finalBranchProblem(ctx: Ctx, task: Task): Promise<string | null> {
  const branch = await currentBranch(ctx, task.repoRoot)
  if (branch === null) return "The checkout is on no branch, so the change has no pull request"
  if (task.branch !== undefined && task.branch !== branch)
    return `This task was built on ${task.branch}; the checkout is on ${branch}`
  const base = await baseBranch(ctx, task.repoRoot)
  if (branch === base)
    return `The change is on ${base}, the branch a pull request goes into, so there is no pull request to open`
  return null
}

/**
 * Send the change for its final review: push the task's own branch as it is now and answer with GitHub's
 * compare page for it, the Verify page as its description. A change on the base branch has none.
 */
export async function sendFinal(ctx: Ctx, task: Task): Promise<Result<Sent>> {
  const root = task.repoRoot
  const ready = await preflight(ctx, root, "final")
  if (!ready.ok) return ready
  const { sender, base, repo } = ready.data
  const inApp = {
    what: "the person's approval in the App",
    move: "qualitylayer wait --for approval",
  }
  const problem = await finalBranchProblem(ctx, task)
  const branch = await currentBranch(ctx, root)
  if (problem !== null || branch === null)
    return refused(
      `${problem ?? "The checkout is on no branch"}: the person approves it in the App.`,
      [
        ...(task.branch !== undefined && task.branch !== branch
          ? [{ what: "the task's branch", move: `git switch ${task.branch}` }]
          : []),
        inApp,
      ],
    )
  const head = (await git(ctx, root, ["rev-parse", "HEAD"])).stdout.trim()
  const previous = await readSent(ctx, task, "final")
  const live = await standing(ctx, task, "final")
  if (live !== null && live.head === head) return ok(live)
  const pushed = await git(ctx, root, ["push", "--quiet", "origin", `HEAD:refs/heads/${branch}`])
  if (pushed.code !== 0)
    return failed(`${branch} could not be pushed to origin`, pushed, [
      { what: "push access to origin", move: `${GH.login}, or check the remote` },
      inApp,
    ])
  const link = compareUrl(repo, base, branch, task.title, "")
  const body = await finalBody(ctx, task, head, MAX_LINK - link.length)
  const sent: Sent = {
    version: 1,
    target: "final",
    via: "github",
    compare: compareUrl(repo, base, branch, task.title, body),
    ...(live?.url !== undefined && live.number !== undefined
      ? { url: live.url, number: live.number }
      : {}),
    branch,
    base,
    head,
    revision: head,
    sender,
    at: ctx.clock.now(),
    seen: previous?.seen ?? [],
  }
  await writeSent(ctx, task, sent)
  return ok(sent)
}

/** The request for what was pushed, recorded once the person created it; null while there is none. */
export async function requestFor(ctx: Ctx, task: Task, sent: Sent): Promise<Sent | null> {
  if (sent.number !== undefined) return sent
  const found = await findRequest(ctx, task.repoRoot, sent)
  if (found === null) return null
  const named = { ...sent, url: found.url, number: found.number }
  await writeSent(ctx, task, named)
  return named
}

/**
 * After the Plan is approved in QualityLayer (the App, the person's terminal or their words), its pull
 * request is done: a note says so, the request closes and its branch goes. A branch pushed but never
 * opened as a request just goes. Only what QualityLayer pushed itself; best effort, never in the way.
 */
export async function closeAfterApproval(ctx: Ctx, task: Task): Promise<void> {
  const before = await readSent(ctx, task, "plan")
  if (before === null || before.closed === true) return
  const sent = (await requestFor(ctx, task, before)) ?? before
  const root = task.repoRoot
  if (sent.url !== undefined) {
    const login = (await senderOf(ctx, root)) ?? sent.sender
    const closed = await exec(ctx, root, [
      "gh",
      "pr",
      "close",
      sent.url,
      "--comment",
      `Approved in QualityLayer by @${login}.`,
    ])
    if (closed === null || closed.code !== 0) return
  }
  // The branch held only the Plan: it goes with the request.
  await git(ctx, root, ["push", "--quiet", "origin", "--delete", sent.branch])
  await writeSent(ctx, task, { ...sent, closed: true })
}

// ---------------------------------------------------------------- what comes back

type Review = {
  id: string
  login: string
  name?: string
  state: string
  commit: string
  body: string
  url: string
}
type Note = { id: string; login: string; body: string; url: string }
type Read = {
  /** Still open there: a closed or merged request brings no approval. */
  open: boolean
  head: string
  reviews: Review[]
  notes: Note[]
  canWrite: (login: string) => Promise<boolean>
}

const str = (value: unknown) =>
  typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : []
const json = (run: Run | null): unknown => {
  if (run === null || run.code !== 0) return null
  try {
    return JSON.parse(run.stdout)
  } catch {
    return null
  }
}

// One query for what `wait` reads: the state, the head, the reviews with the comments on lines of the
// request's files, and the comments below; each review with its own link.
const PR_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state headRefOid
      reviews(last: 100) { nodes { id state body url commit { oid } author { login }
        comments(first: 100) { nodes { id body url path line originalLine author { login } } } } }
      comments(last: 100) { nodes { id body url author { login } } }
    }
  }
}`

const nodes = (value: unknown): Record<string, unknown>[] =>
  list((value as Record<string, unknown> | null | undefined)?.nodes)
const author = (value: Record<string, unknown>) => ({
  login: str((value.author as Record<string, unknown> | undefined)?.login),
})

async function readGitHub(
  ctx: Ctx,
  root: string,
  sent: Sent & { url: string; number: number },
): Promise<Read | null> {
  const repo = sent.url.match(/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1] ?? ""
  const [owner, name] = repo.split("/")
  const answer = json(
    await exec(ctx, root, [
      "gh",
      "api",
      "graphql",
      "-f",
      `query=${PR_QUERY}`,
      "-f",
      `owner=${owner ?? ""}`,
      "-f",
      `name=${name ?? ""}`,
      "-F",
      `number=${sent.number}`,
    ]),
  ) as { data?: { repository?: { pullRequest?: Record<string, unknown> | null } } } | null
  const pr = answer?.data?.repository?.pullRequest
  if (pr === undefined || pr === null) return null
  const reviews = nodes(pr.reviews)
  return {
    open: str(pr.state) === "OPEN",
    head: str(pr.headRefOid),
    reviews: reviews.map((r) => ({
      id: str(r.id),
      ...author(r),
      state: str(r.state),
      commit: str((r.commit as Record<string, unknown> | undefined)?.oid),
      body: str(r.body),
      url: str(r.url) || sent.url,
    })),
    notes: [
      ...nodes(pr.comments).map((c) => ({
        id: str(c.id),
        ...author(c),
        body: str(c.body),
        url: str(c.url) || sent.url,
      })),
      // A comment on a line of the Plan's file: the most natural review of a Plan in a pull request.
      ...reviews.flatMap((r) =>
        nodes(r.comments).map((c) => {
          const file = str(c.path).split("/").at(-1) ?? ""
          // The pushed Plan has no front matter: the line is named as it is in the task's own file.
          const sentLine = Number(c.line ?? c.originalLine)
          const line =
            file === NAMES.plan &&
            sent.planLines !== undefined &&
            Number.isInteger(sentLine) &&
            sentLine > 0
              ? (sent.planLines[sentLine - 1] ?? sentLine)
              : (c.line ?? c.originalLine)
          return {
            id: str(c.id),
            ...author(c),
            body: `${file}${line === null || line === undefined ? "" : ` line ${str(line)}`}: ${str(c.body)}`,
            url: str(c.url) || sent.url,
          }
        }),
      ),
    ],
    canWrite: async (login) => {
      const permission = await exec(ctx, root, [
        "gh",
        "api",
        `repos/${repo}/collaborators/${login}/permission`,
        "--jq",
        ".permission",
      ])
      return (
        permission !== null &&
        permission.code === 0 &&
        /^(admin|maintain|write)$/.test(permission.stdout.trim())
      )
    },
  }
}

function pollMs(ctx: Ctx): number {
  const given = Number(ctx.env.get("QUALITYLAYER_OUTSIDE_POLL_MS"))
  return Number.isFinite(given) && given > 0 ? given : 30_000
}

/** How a send is named in the agents' next move: the command that pushes it again. */
const sendAgain = (target: Target) =>
  `qualitylayer gate open ${target === "final" ? "final" : "plan"} --via github`

/**
 * What `wait --for approval` asks of the pushed branch's pull request while its gate is open, at most once
 * every 30 seconds: an approval it records, or feedback for the agents, or nothing new.
 */
export function outsidePoller(
  ctx: Ctx,
  task: Task,
  /**
   * `feedback: false` (the App's look): an approval is recorded, comments stay for the agents' wait.
   * `target`: the Plan's request (default) or the change's.
   */
  options: { feedback?: boolean; target?: Target } = {},
): () => Promise<gate.GateOutcome | null> {
  const feedback = options.feedback !== false
  const target = options.target ?? "plan"
  const what = target === "final" ? "the change" : "the Plan"
  let due = 0
  return async () => {
    const now = ctx.clock.now()
    if (now < due) return null
    due = now + pollMs(ctx)
    const pushed = await readSent(ctx, task, target)
    if (pushed === null || pushed.closed === true) return null
    // Nothing to read until the person created the pull request on GitHub's page.
    const sent = await requestFor(ctx, task, pushed)
    if (sent?.url === undefined || sent.number === undefined) return null
    const read = await readGitHub(ctx, task.repoRoot, {
      ...sent,
      url: sent.url,
      number: sent.number,
    })
    if (read === null) return null
    const again = sendAgain(target)
    const seen = new Set(sent.seen)
    const fresh: Comment[] = []
    const note = (id: string, login: string, body: string) => {
      seen.add(id)
      fresh.push({
        id: `outside-${id}`,
        doc: target === "final" ? NAMES.verify : NAMES.plan,
        quote: "",
        remark: `${login} on GitHub: ${body.trim()}`,
        created: now,
      })
    }
    // Every comment is feedback: the sender's own, other people's and a review app's alike.
    if (feedback) {
      for (const n of read.notes)
        if (!seen.has(n.id) && n.body.trim() !== "") note(n.id, n.login, n.body)
      for (const r of read.reviews)
        if (!seen.has(r.id) && r.state !== "APPROVED" && r.body.trim() !== "")
          note(r.id, r.login, r.body)
    }
    const heard = (): gate.GateOutcome => ({
      decision: "comments",
      comments: fresh,
      then:
        target === "final"
          ? `Review feedback on the change from GitHub (${sent.url}). Fix what it asks as you would the person's review comments (qualitylayer commit fix, then qualitylayer verify recheck), push the fixed change with ${again}, then qualitylayer wait --for approval.`
          : `Feedback on the Plan from GitHub (${sent.url}). Apply it like the person's feedback, push the changed Plan with ${again}, then qualitylayer wait --for approval.`,
    })
    // A closed or merged request brings no approval: the agents hear it once, and the App offers a
    // new send.
    if (!read.open) {
      const told = `closed-${sent.number}`
      const tell = feedback && fresh.length === 0 && !seen.has(told)
      if (tell) seen.add(told)
      await writeSent(ctx, task, { ...sent, seen: [...seen], closed: true })
      if (fresh.length > 0) return heard()
      if (!tell) return null
      return {
        decision: "pending",
        again: true,
        gate: "open",
        status: `#${sent.number} is closed on GitHub, so no approval can come from it.`,
        then: `The person approves in the App; or, when they ask for it, ${again} pushes it again for a new pull request. Then qualitylayer wait --for approval.`,
      }
    }
    // An approval counts on the commit that was pushed, by someone else who can write to the repository.
    let stale: Review | null = null
    for (const r of read.reviews) {
      if (r.state !== "APPROVED" || r.login === "" || r.login === sent.sender || seen.has(r.id))
        continue
      if (r.commit !== sent.head || read.head !== sent.head) {
        if (!feedback) continue
        seen.add(r.id)
        stale = r
        continue
      }
      if (!(await read.canWrite(r.login))) {
        if (!feedback) continue
        seen.add(r.id)
        note(
          r.id,
          r.login,
          `approved, but cannot write to this repository, so it does not approve ${what}.`,
        )
        continue
      }
      // The change approved there ships through its request.
      if (target === "final")
        await writeShipRecord(ctx, task, { choice: "pull-request", state: "open", url: sent.url })
      const recorded = await gate.record(ctx, task, "approved", {
        by: "outside",
        outside: {
          via: "github",
          url: r.url,
          login: r.login,
          ...(r.name ? { name: r.name } : {}),
          revision: sent.revision,
        },
      })
      seen.add(r.id)
      await writeSent(ctx, task, { ...sent, seen: [...seen] })
      if (recorded.ok) return null
      return {
        decision: "pending",
        again: true,
        gate: "open",
        status: recorded.error.message,
        then: `Push the current ${target === "final" ? "change" : "Plan"} with ${again}, then qualitylayer wait --for approval.`,
      }
    }
    if (!feedback) return null
    await writeSent(ctx, task, { ...sent, seen: [...seen] })
    if (fresh.length > 0) return heard()
    if (stale !== null)
      return {
        decision: "pending",
        again: true,
        gate: "open",
        status: `${stale.login} approved an earlier commit of ${what}'s pull request; it counts only on the one pushed.`,
        then: `${again}, then qualitylayer wait --for approval`,
      }
    return null
  }
}

/** Refuse a send the person did not ask for: a push is theirs. */
export const SEND_REFUSAL =
  'Sending pushes a branch, which is the person\'s act: run it in your own terminal, or ask them and pass their words: qualitylayer gate open plan|final --via github --asked "<their words>".'

export const viaOf = (word: string | undefined): Via | null => (word === "github" ? word : null)

export const viaUsage = () => err({ code: "bad_args", message: "--via is github" })
