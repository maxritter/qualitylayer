// The server's git, cached on what changes its answers. An open App page reads a task's list,
// detail, changes, branch and artifacts again on every file event, and each read asked git the same
// questions again (the base, the branch, the status, the diff): about 200 git processes a second
// while an agent worked, enough to keep a core busy. A read-only question is now asked once and its
// answer kept while the repository's HEAD, refs and index stand (seen with a few `stat`s, no
// process); a question that also reads the working tree is kept until a watched file changes, and
// a few seconds at most. Anything else (add, commit, push, switch) runs as before and forgets what
// was kept. The command line keeps the questions about commits and refs the same way for the one
// command it runs (`trees: false`): a verdict check asks the same thirty questions a hundred and
// fifty times, and it never learns that a file changed, so what reads the working tree always asks git.

import type { Ctx, Git, GitResult } from "../ctx.ts"
import {
  ANSWER_CHARS_EACH,
  ANSWER_CHARS_KEPT,
  ANSWERS_KEPT,
  boundedBlobRead,
  type CachedAnswer,
  isAnswerFresh,
  readKind,
  readsOnly,
} from "./git-cache-classify.ts"
import { createStampTracker, stableMemo } from "./git-cache-stamp.ts"

export { readKind, readsOnly } from "./git-cache-classify.ts"

/** The stamp of a repository is looked at again after this long; one burst of reads shares it. */
const STAMP_MS = 250

export type CachedGit = Git & {
  /** A watched file in a working tree changed: answers that read the working tree are asked again. */
  treeChanged(): void
  /** Forget every kept answer and checkout fact (the resource guard's back-off); the next read asks again. */
  dropCaches(): void
  /** Git processes this server started, for its resource check. */
  spawns(): number
}

class GitCacheStore {
  private readonly answers = new Map<string, CachedAnswer>()
  private readonly filteredReads = new Map<string, Promise<GitResult>>()
  private readonly tops = new Map<string, Promise<string | null>>()
  private readonly commons = new Map<string, Promise<string | null>>()
  private readonly tracker: ReturnType<typeof createStampTracker>
  private readonly keepTrees: boolean
  private chars = 0
  private epoch = 0
  private spawned = 0

  constructor(
    private readonly inner: Git,
    fs: Ctx["fs"],
    keepTrees: boolean,
  ) {
    this.keepTrees = keepTrees
    // A command that starts programs of the project (a check, a build) must see a commit one of them
    // made at once: its stamp is read for every question, a few `stat`s against a git process.
    this.tracker = createStampTracker(fs, keepTrees ? STAMP_MS : 0)
  }

  private spawn(cwd: string, args: string[], options?: Parameters<Git["run"]>[2]) {
    this.spawned++
    return this.inner.run(cwd, args, options)
  }

  private forget(key: string): void {
    const answer = this.answers.get(key)
    if (answer === undefined) return
    this.answers.delete(key)
    this.chars -= answer.chars
  }

  private forgetAll(): void {
    this.answers.clear()
    this.tracker.clearStamps()
    this.chars = 0
  }

  /**
   * After a command that may write: what was kept of the repository it ran in. A clone only writes
   * its destination, and a command in one repository leaves another's answers right; one that names
   * another place itself (`-C`, `--git-dir`) or runs outside any repository cannot be placed, and
   * forgets everything.
   */
  async forgetAfterWrite(cwd: string, args: string[]): Promise<void> {
    if (args[0] === "clone") return
    this.filteredReads.clear()
    const placed = !args.some(
      (a) => a === "-C" || a.startsWith("--git-dir") || a.startsWith("--work-tree"),
    )
    const found = placed ? await this.tracker.gitDirsOf(cwd) : null
    if (found === null) return this.forgetAll()
    this.tracker.clearStamps()
    for (const [key, answer] of this.answers) {
      if (answer.common === found.common) this.forget(key)
    }
  }

  private dedupeFiltered(
    key: string,
    cwd: string,
    args: string[],
    options?: Parameters<Git["run"]>[2],
  ): Promise<GitResult> {
    const pendingKey = `${this.epoch}\0${key}`
    const pending = this.filteredReads.get(pendingKey)
    if (pending) return pending
    const result = this.spawn(cwd, args, options)
    if (this.filteredReads.size < ANSWERS_KEPT) {
      this.filteredReads.set(pendingKey, result)
      const clear = () => {
        if (this.filteredReads.get(pendingKey) === result) this.filteredReads.delete(pendingKey)
      }
      void result.then(clear, clear)
    }
    return result
  }

  private storeAnswer(
    key: string,
    answer: CachedAnswer,
    bounded: "size" | "filtered" | null,
  ): void {
    this.answers.set(key, answer)
    answer.result.then(
      (done) => {
        if (this.answers.get(key) !== answer) return
        const size = done.stdout.length + done.stderr.length
        // A git that could not start is asked again; a large answer is used once.
        if (
          done.code === 127 ||
          (bounded === "size" && done.code !== 0) ||
          size > ANSWER_CHARS_EACH
        ) {
          this.forget(key)
          return
        }
        answer.chars = size
        this.chars += size
        for (const [oldest] of this.answers) {
          if (this.answers.size <= ANSWERS_KEPT && this.chars <= ANSWER_CHARS_KEPT) break
          this.forget(oldest)
        }
      },
      () => this.forget(key),
    )
  }

  private async runStampedRead(
    key: string,
    kind: "ref" | "tree",
    bounded: "size" | "filtered" | null,
    call: { cwd: string; args: string[]; options?: Parameters<Git["run"]>[2] },
  ): Promise<GitResult> {
    const stamp = await this.tracker.stampOf(call.cwd)
    if (stamp === null) return this.spawn(call.cwd, call.args, call.options)
    // Before the lookup: from the lookup to keeping the answer nothing may wait.
    const common = (await this.tracker.gitDirsOf(call.cwd))?.common ?? null
    const kept = this.answers.get(key)
    const at = Date.now()
    if (isAnswerFresh(kept, stamp, at, this.epoch)) {
      // Most recently used last, so the oldest answer is the one that goes.
      this.answers.delete(key)
      this.answers.set(key, kept)
      return kept.result
    }
    this.forget(key)
    const result = this.spawn(call.cwd, call.args, call.options)
    this.storeAnswer(key, { kind, stamp, epoch: this.epoch, at, result, chars: 0, common }, bounded)
    return result
  }

  run: Git["run"] = async (cwd, args, options) => {
    if (options?.fresh) return this.spawn(cwd, args, options)
    const bounded = options?.maxOutputBytes === undefined ? null : boundedBlobRead(args)
    if (options?.maxOutputBytes !== undefined && bounded === null)
      return this.spawn(cwd, args, options)
    const key = `${options?.childRepository === true ? "child" : ""}\0${cwd}\0${args.join("\0")}\0${options?.maxOutputBytes ?? ""}`
    if (bounded === "filtered") return this.dedupeFiltered(key, cwd, args, options)
    const kind = readKind(args)
    if (kind === null) return this.runUncachedOrWrite(cwd, args, options)
    // A read of the working tree, where nothing tells this git that a file changed: always asked.
    if (kind === "tree" && !this.keepTrees) return this.spawn(cwd, args, options)
    return this.runStampedRead(key, kind, bounded, { cwd, args, options })
  }

  private async runUncachedOrWrite(
    cwd: string,
    args: string[],
    options?: Parameters<Git["run"]>[2],
  ): Promise<GitResult> {
    if (readsOnly(args)) return this.spawn(cwd, args, options)
    // A command that may write: whatever was kept of that repository may be wrong now.
    const result = await this.spawn(cwd, args, options)
    await this.forgetAfterWrite(cwd, args)
    return result
  }

  toCachedGit(): CachedGit {
    const bump = () => {
      this.spawned++
    }
    return {
      run: this.run,
      commitPaths: async (cwd, paths, message, authority) => {
        try {
          return await this.inner.commitPaths(cwd, paths, message, authority)
        } finally {
          await this.forgetAfterWrite(cwd, ["commit"])
        }
      },
      topLevel: stableMemo(this.tops, (cwd) => this.inner.topLevel(cwd), bump),
      commonDir: stableMemo(this.commons, (cwd) => this.inner.commonDir(cwd), bump),
      treeChanged: () => {
        this.epoch++
      },
      dropCaches: () => {
        this.forgetAll()
        this.filteredReads.clear()
        this.tracker.clearAll()
        this.tops.clear()
        this.commons.clear()
      },
      spawns: () => this.spawned,
    }
  }
}

/**
 * `ctx.git` with the server's cache in front. Without `fs.stat` (a test's file system) nothing can be
 * stamped, and every question goes to git as before.
 */
export function cachingGit(ctx: Ctx, options: { trees?: boolean } = {}): CachedGit {
  return new GitCacheStore(ctx.git, ctx.fs, options.trees !== false).toCachedGit()
}
