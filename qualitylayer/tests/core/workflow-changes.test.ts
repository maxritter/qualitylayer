import { expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { recordSliceCommit } from "../../src/core/git/build-start.ts"
import {
  ownedPartOf,
  scopeWalkthrough,
  workflowChanges,
  workflowChangesView,
  workflowPatch,
} from "../../src/core/git/workflow-changes.ts"
import { committedSource } from "../../src/core/git/workflow-parts.ts"
import { captureWorkingEdit } from "../../src/core/git/working-capture.ts"
import {
  admitWorkingRecord,
  clearWorkingRecords,
  digest,
  readWorkingLedger,
  workingSource,
  workingTaskKey,
} from "../../src/core/git/working-records.ts"
import { bindSession } from "../../src/core/task/binding.ts"
import type { Ctx } from "../../src/ctx.ts"
import { cachingGit } from "../../src/server/git-cache.ts"
import { withWorkingCaptureClock, world } from "../helpers/lastingWorld.ts"
import { walkthroughView } from "../helpers/walkthroughView.ts"

const boundContext = (ctx: Ctx, agent: string, session: string): Ctx => ({
  ...withWorkingCaptureClock(ctx),
  env: {
    cwd: ctx.env.cwd,
    get: (name) =>
      name === "QUALITYLAYER_AGENT"
        ? agent
        : name === "QUALITYLAYER_SESSION" ||
            name ===
              (
                {
                  "claude-code": "CLAUDE_SESSION_ID",
                  codex: "CODEX_THREAD_ID",
                  pi: "PI_SESSION_ID",
                  opencode: "OPENCODE_SESSION_ID",
                } as Record<string, string>
              )[agent]
          ? session
          : ctx.env.get(name),
  },
})

test("a Verify range keeps its exact committed file inventory, diff and source after later work", async () => {
  const w = await world()
  try {
    const repo = await w.repo("checked-range-source")
    await repo.write({ "src/held.ts": "export const held = 1\n" })
    const base = await repo.commit("base")
    const task = await repo.task("review the assigned commit")
    await repo.write({ "src/held.ts": "export const held = 2\n" })
    const head = await repo.commit("approved candidate")
    await repo.write({ "src/held.ts": "export const held = 3\n", "later.txt": "later\n" })
    await repo.commit("another task advanced HEAD")
    await repo.write({ "src/held.ts": "export const held = 4\n" })

    const range = { base, head, commits: [head] }
    const projection = await workflowChanges(repo.ctx, task, { range })
    expect(projection.candidate).toBe(true)
    expect(projection.localOnlyFiles).toEqual([])
    expect(projection.files.map((file) => file.path)).toEqual(["src/held.ts"])
    const file = projection.files[0]
    const stamp = file?.parts?.[0]?.stamp
    if (!file || !stamp) throw new Error("Missing committed file identity")
    const page = await workflowChanges(repo.ctx, task, {
      range,
      page: { path: file.path, revision: file.stamp },
    })
    expect(page.page?.diff).toContain("+export const held = 2")
    expect(page.page?.diff).not.toMatch(/held = [34]/)
    const source = ownedPartOf(projection, file.path, stamp)?.after
    if (source?.kind !== "git") throw new Error("Missing committed source blob")
    expect(await committedSource(repo.ctx, task, source)).toBe("export const held = 2\n")
    expect(scopeWalkthrough(walkthroughView(), projection).changeScope?.candidate).toBe(true)
    await expect(
      workflowChanges(repo.ctx, task, { range, page: { path: "later.txt" } }),
    ).rejects.toThrow("This path is not part of the reviewed commit")
  } finally {
    await w.cleanup()
  }
})

test("task risk facts keep owned source and exclude foreign branch dependencies", async () => {
  const w = await world()
  try {
    const repo = await w.repo("task-risk-scope")
    await repo.write({ "seed.txt": "base\n" })
    await repo.commit("base")
    const task = await repo.task("owned risk facts")
    await repo.write({ "src/owned.ts": "owned\n", "package.json": '{"private":true}\n' })
    await recordSliceCommit(repo.ctx, task, await repo.commit("task source"))
    await repo.write({ "requirements.txt": "foreign-package\n", "foreign.txt": "foreign\n" })
    await repo.commit("another task")
    const projection = await workflowChanges(repo.ctx, task, { metadata: true, current: false })
    const view = walkthroughView({
      risk: {
        outside: ["src/owned.ts", "foreign.txt"],
        dependencies: ["package.json", "requirements.txt"],
        amendments: 2,
      },
    })
    const scoped = scopeWalkthrough(view, projection)
    expect(scoped.risk).toEqual({
      outside: ["src/owned.ts"],
      dependencies: ["package.json"],
      amendments: 2,
    })
    expect(scoped.acceptance).toEqual(view.acceptance)
    expect(scoped.changeScope?.pending).toEqual(projection.pending)
    expect(scoped.decided.map((file) => file.path).sort()).toEqual(["package.json", "src/owned.ts"])
    expect(view.risk?.dependencies).toContain("requirements.txt")
  } finally {
    await w.cleanup()
  }
})

test("another native edit of an untracked file changes the App diff revision", async () => {
  const w = await world()
  try {
    const repo = await w.repo("untracked-diff-revision")
    await repo.write({ "base.txt": "base\n" })
    const head = await repo.commit("base")
    const task = await repo.task("keep a new file current")
    let before: string | null = null
    const edit = async (id: string, content: string) => {
      await repo.write({ "new.txt": content })
      const at = Date.now()
      await admitWorkingRecord(
        repo.ctx,
        {
          id: digest(id),
          task: workingTaskKey(task),
          repository: task.repoId,
          session: "fixture",
          agent: "claude-code",
          run: "fixture",
          generation: 1,
          input: digest(id),
          at,
          end: at,
          head,
          state: "verified",
          operations: [
            {
              path: "new.txt",
              before: before === null ? null : digest(before),
              after: digest(content),
            },
          ],
        },
        new Map([
          ...(before === null ? [] : [[digest(before), before] as [string, string]]),
          [digest(content), content],
        ]),
      )
      before = content
      return workflowChanges(repo.ctx, task)
    }
    const first = await edit("new-1", "first version\n")
    const second = await edit("new-2", "second version\n")
    expect(first.files.map((file) => file.path)).toEqual(["new.txt"])
    expect(second.files.map((file) => file.path)).toEqual(["new.txt"])
    expect(workflowChangesView(second).revision).not.toBe(workflowChangesView(first).revision)
    expect(workflowPatch(second, "new.txt")).toContain("+second version")
  } finally {
    await w.cleanup()
  }
})

test("committed native history is compared as metadata before any per-edit diff process", async () => {
  const w = await world()
  try {
    const repo = await w.repo("metadata-first")
    await repo.write({ "file.txt": "v0\n" })
    const base = await repo.commit("base")
    const task = await repo.task("many native edits, one commit"),
      at = Date.now()
    for (let n = 1; n <= 40; n++) {
      const before = `v${n - 1}\n`,
        after = `v${n}\n`
      await admitWorkingRecord(
        repo.ctx,
        {
          id: digest(`native-${n}`),
          task: workingTaskKey(task),
          repository: task.repoId,
          session: "fixture",
          agent: "claude-code",
          run: "fixture",
          generation: 1,
          input: digest("fixture"),
          at: at + n,
          end: at + n,
          head: base,
          state: "verified",
          operations: [{ path: "file.txt", before: digest(before), after: digest(after) }],
        },
        new Map([
          [digest(before), before],
          [digest(after), after],
        ]),
      )
    }
    await repo.write({ "file.txt": "v40\n" })
    await recordSliceCommit(repo.ctx, task, await repo.commit("all owned changes"))
    let diffs = 0
    const measured = {
      ...repo.ctx,
      git: {
        ...repo.ctx.git,
        run: (...args: Parameters<typeof repo.ctx.git.run>) => {
          if (args[1].includes("--no-index")) diffs++
          return repo.ctx.git.run(...args)
        },
      },
    }
    const projection = await workflowChanges(measured, task)
    expect(diffs).toBe(0)
    expect(projection.files).toHaveLength(1)
    expect(projection.files[0]!.parts).toHaveLength(1)
    expect(workflowPatch(projection, "file.txt")).toContain("+v40")
  } finally {
    await w.cleanup()
  }
})

test("a renamed outer file authorizes the exact earlier source without relying on Git rename preferences", async () => {
  const w = await world()
  try {
    const repo = await w.repo("renamed-parts")
    const base = `export const n = 1\n${"// unchanged context\n".repeat(30)}`
    await repo.write({ "old.ts": base })
    await repo.commit("base")
    const task = await repo.task("rename one workflow file")
    await repo.write({ "old.ts": base.replace("= 1", "= 2") })
    const one = await repo.commit("A1")
    await recordSliceCommit(repo.ctx, task, one)
    await repo.git("config", "diff.renames", "false")
    await repo.git("mv", "old.ts", "new.ts")
    const two = await repo.commit("A2 rename")
    await recordSliceCommit(repo.ctx, task, two)
    const projection = await workflowChanges(repo.ctx, task)
    expect(projection.files.map((file) => file.path)).toEqual(["new.ts"])
    const first = projection.files[0]!.parts![0]!,
      part = ownedPartOf(projection, "new.ts", first.stamp)!
    expect(first.path).toBe("old.ts")
    expect(part.after?.kind).toBe("git")
    if (part.after?.kind !== "git") throw new Error("Expected committed source")
    expect(await committedSource(repo.ctx, task, part.after)).toBe(base.replace("= 1", "= 2"))
    expect(ownedPartOf(projection, "other.ts", first.stamp)).toBeNull()
  } finally {
    await w.cleanup()
  }
})

test("native delete and rename preserve their absent sides and old path identities", async () => {
  const w = await world()
  try {
    const repo = await w.repo("native-path-operations")
    await repo.write({ "delete.txt": "remove me\n", "old.txt": "before\n" })
    await repo.commit("base")
    const task = await repo.task("native path changes"),
      ctx = boundContext(repo.ctx, "codex", "native-A")
    await bindSession(ctx, task)
    const run = async (id: string, patch: string, apply: () => Promise<unknown>) => {
      const call = {
        session_id: "native-A",
        cwd: repo.dir,
        tool_use_id: id,
        tool_name: "apply_patch",
        tool_input: { input: patch },
      }
      await captureWorkingEdit(ctx, task, { ...call, hook_event_name: "PreToolUse" })
      await apply()
      await captureWorkingEdit(ctx, task, {
        ...call,
        hook_event_name: "PostToolUse",
        tool_response: "Success. Updated the following files:",
      })
    }
    await run("delete", "*** Begin Patch\n*** Delete File: delete.txt\n*** End Patch\n", () =>
      repo.ctx.fs.remove(join(repo.dir, "delete.txt")),
    )
    await run(
      "rename",
      "*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n@@\n-before\n+after\n*** End Patch\n",
      async () => {
        await repo.git("mv", "old.txt", "new.txt")
        await repo.write({ "new.txt": "after\n" })
      },
    )
    const projection = await workflowChanges(ctx, task)
    const deleted = projection.files.find((file) => file.path === "delete.txt")!,
      renamed = projection.files.find((file) => file.path === "new.txt")!
    expect(deleted.status).toBe("D")
    expect(ownedPartOf(projection, deleted.path, deleted.parts![0]!.stamp)!.after).toBeNull()
    expect(renamed.from).toBe("old.txt")
    expect(workflowPatch(projection, "new.txt")).toContain("+after")
  } finally {
    await w.cleanup()
  }
})

test("one workflow retains A1 and A2 but never an interleaved B patch or B-only file", async () => {
  const w = await world()
  try {
    const repo = await w.repo("workflow-parts")
    await repo.write({ "shared.txt": "first\nsecond\nthird\n" })
    await repo.commit("base")
    const a = await repo.task("A")
    await repo.write({ "shared.txt": "first-A\nsecond\nthird\n" })
    const a1 = await repo.commit("A1")
    await recordSliceCommit(repo.ctx, a, a1)
    await repo.write({
      "shared.txt": "first-A\nsecond-B\nthird\n",
      "planned-but-B.txt": "B only\n",
    })
    await repo.commit("B1")
    await repo.write({ "shared.txt": "first-A\nsecond-B\nthird-A\n" })
    const a2 = await repo.commit("A2")
    await recordSliceCommit(repo.ctx, a, a2)
    const projected = await workflowChanges(repo.ctx, a)
    expect(projected.files.map((file) => file.path)).toEqual(["shared.txt"])
    expect(projected.files[0]!.parts).toHaveLength(2)
    const patch = workflowPatch(projected, "shared.txt")!
    expect(patch).toContain("+first-A")
    expect(patch).toContain("+third-A")
    expect(patch).not.toContain("+second-B")
    expect(workflowPatch(projected, "planned-but-B.txt")).toBeNull()
  } finally {
    await w.cleanup()
  }
})

test("real Git pre/post captures an eligible native edit and excludes ignored inputs", async () => {
  const w = await world()
  try {
    const repo = await w.repo("native-receipt")
    await repo.write({ "owned.txt": "before\n", ".gitignore": "ignored.txt\n" })
    await repo.commit("base")
    const task = await repo.task("capture")
    const ctx = boundContext(repo.ctx, "claude-code", "native-A")
    await bindSession(ctx, task)
    const payload = {
      session_id: "native-A",
      cwd: repo.dir,
      tool_use_id: "edit-1",
      tool_name: "Edit",
      tool_input: {
        file_path: join(repo.dir, "owned.txt"),
        old_string: "before",
        new_string: "after",
      },
    }
    await captureWorkingEdit(ctx, task, { ...payload, hook_event_name: "PreToolUse" })
    await repo.write({ "owned.txt": "after\n" })
    await captureWorkingEdit(ctx, task, {
      ...payload,
      hook_event_name: "PostToolUse",
      tool_response: {
        filePath: join(repo.dir, "owned.txt"),
        oldString: "before",
        newString: "after",
      },
    })
    const projection = await workflowChanges(ctx, task)
    expect(projection.files.map((file) => file.path)).toEqual(["owned.txt"])
    expect(workflowPatch(projection, "owned.txt")).toContain("+after")
    expect(workflowPatch(projection, "owned.txt")).not.toContain("100600")
    const ignored = {
      ...payload,
      tool_use_id: "ignored",
      tool_name: "Write",
      tool_input: { file_path: join(repo.dir, "ignored.txt"), content: "secret\n" },
    }
    await captureWorkingEdit(ctx, task, { ...ignored, hook_event_name: "PreToolUse" })
    await repo.write({ "ignored.txt": "secret\n" })
    await captureWorkingEdit(ctx, task, {
      ...ignored,
      hook_event_name: "PostToolUse",
      tool_response: { filePath: join(repo.dir, "ignored.txt") },
    })
    expect((await readWorkingLedger(ctx)).records).toHaveLength(1)
    expect(workflowPatch(await workflowChanges(ctx, task), "ignored.txt")).toBeNull()
  } finally {
    await w.cleanup()
  }
})

test("a registered full-file commit cannot absorb B's preexisting dirty hunk", async () => {
  const w = await world()
  try {
    const repo = await w.repo("mixed-commit")
    await repo.write({ "shared.txt": "first\nsecond\n" })
    await repo.commit("base")
    const task = await repo.task("A only")
    const ctx = boundContext(repo.ctx, "claude-code", "native-A")
    await bindSession(ctx, task)
    await repo.write({ "shared.txt": "first\nsecond-B\n" })
    const payload = {
      session_id: "native-A",
      cwd: repo.dir,
      tool_use_id: "edit-A",
      tool_name: "Edit",
      tool_input: {
        file_path: join(repo.dir, "shared.txt"),
        old_string: "first",
        new_string: "first-A",
      },
    }
    await captureWorkingEdit(ctx, task, { ...payload, hook_event_name: "PreToolUse" })
    await repo.write({ "shared.txt": "first-A\nsecond-B\n" })
    await captureWorkingEdit(ctx, task, {
      ...payload,
      hook_event_name: "PostToolUse",
      tool_response: { filePath: join(repo.dir, "shared.txt") },
    })
    const sha = await repo.commit("A commit with B dirty content")
    await recordSliceCommit(ctx, task, sha)
    const projection = await workflowChanges(ctx, task)
    const patch = workflowPatch(projection, "shared.txt")!
    expect(patch).toContain("+first-A")
    expect(patch).not.toContain("+second-B")
    expect(patch.match(/^\+first-A$/gm)).toHaveLength(1)
    const file = projection.files[0]!,
      part = ownedPartOf(projection, file.path, file.parts![0]!.stamp)!
    expect(part.before?.kind).toBe("working")
    expect(await workingSource(ctx, part.before!.hash)).toBe("first\nsecond-B\n")
    await clearWorkingRecords(ctx, task)
    const cleared = await workflowChanges(ctx, task)
    expect(workflowPatch(cleared, "shared.txt") ?? "").not.toContain("+second-B")
    expect(cleared.pending.some((row) => row.path === "shared.txt")).toBe(true)
  } finally {
    await w.cleanup()
  }
})

test("37-file Review pages retain exact native ownership with bounded immutable Git size reads", async () => {
  const w = await world()
  try {
    const repo = await w.repo("review-page-resource")
    const before = new Map<string, string>(),
      after = new Map<string, string>()
    for (let n = 0; n < 37; n++) {
      const path = `file-${String(n).padStart(2, "0")}.txt`
      const lines = n === 0 ? 2950 : 93
      before.set(
        path,
        Array.from({ length: lines }, (_, i) => `before ${n} ${i}`).join("\n") + "\n",
      )
      after.set(path, Array.from({ length: lines }, (_, i) => `after ${n} ${i}`).join("\n") + "\n")
    }
    await repo.write(Object.fromEntries(before))
    const base = await repo.commit("baseline")
    const task = await repo.task("read a sizeable owned change"),
      at = Date.now()
    await admitWorkingRecord(
      repo.ctx,
      {
        id: digest("review-page-native-edit"),
        task: workingTaskKey(task),
        repository: task.repoId,
        session: "fixture",
        agent: "claude-code",
        run: "fixture",
        generation: 1,
        input: digest("review-page-native-input"),
        at,
        end: at,
        head: base,
        state: "verified",
        operations: [...before].map(([path, content]) => ({
          path,
          before: digest(content),
          after: digest(after.get(path)!),
        })),
      },
      new Map([...before.values(), ...after.values()].map((content) => [digest(content), content])),
    )
    await repo.write(Object.fromEntries(after))
    await recordSliceCommit(repo.ctx, task, await repo.commit("registered owned change"))
    let sizeReads = 0,
      filterReads = 0
    const measured = {
      ...repo.ctx,
      git: {
        ...repo.ctx.git,
        run: (...args: Parameters<typeof repo.ctx.git.run>) => {
          if (args[1][0] === "cat-file" && args[1][1] === "-s") sizeReads++
          if (args[1][0] === "cat-file" && args[1][1] === "--filters") filterReads++
          return repo.ctx.git.run(...args)
        },
      },
    }
    const git = cachingGit(measured),
      ctx = { ...measured, git }
    const started = performance.now()
    const inventory = await workflowChanges(ctx, task, { metadata: true, current: false })
    expect(inventory.files).toHaveLength(37)
    expect(inventory.pending).toHaveLength(0)
    // A committed source never changes, so what the inventory read of it is kept: a page read
    // after it starts no git for those sources again.
    const inventoryReads = filterReads
    expect(inventoryReads).toBeGreaterThan(0)
    const lone = inventory.files[0]
    if (!lone) throw new Error("The inventory has no file to read")
    await workflowChanges(ctx, task, { page: { path: lone.path, revision: lone.stamp } })
    expect(filterReads - inventoryReads).toBe(0)
    for (let start = 0; start < inventory.files.length; start += 4) {
      await Promise.all(
        inventory.files.slice(start, start + 4).map(async (file) => {
          const page = await workflowChanges(ctx, task, {
            page: { path: file.path, revision: file.stamp },
          })
          expect(page.page?.revision).toBe(file.stamp)
          expect(page.page?.next).toBeUndefined()
          expect(page.page?.diff).toContain(`+after ${Number(file.path.slice(5, 7))} 0`)
          expect(page.files.map((row) => row.path)).toEqual(inventory.files.map((row) => row.path))
          expect(page.pending).toHaveLength(0)
        }),
      )
    }
    const measurement = {
      fixture: "37-file-review-pages",
      files: 37,
      addedLines: 6298,
      largestLines: 2950,
      actualGitProcesses: git.spawns(),
      sizeReads,
      filterReads,
      milliseconds: Math.round(performance.now() - started),
      postReadRevisionChecksRetained: true,
      measurementOnly: true,
      sourceSha256: Object.fromEntries(
        await Promise.all(
          [
            "../../src/server/git-cache.ts",
            "../../src/core/git/workflow-changes.ts",
            "../../src/core/git/workflow-parts.ts",
            "../../src/core/git/workflow-coverage.ts",
            "../../src/ui/review-workspace/useDiffFiles.ts",
            "./workflow-changes.test.ts",
          ].map(async (path) => [
            path,
            digest(await Bun.file(new URL(path, import.meta.url)).text()),
          ]),
        ),
      ),
    }
    console.log(JSON.stringify(measurement))
    const proof = process.env.QUALITYLAYER_REVIEW_RESOURCE_PROOF
    if (proof) {
      if (!isAbsolute(proof))
        throw new Error("Review resource proof needs an explicit absolute output path")
      writeFileSync(proof, `${JSON.stringify(measurement, null, 2)}\n`, { mode: 0o600, flag: "wx" })
    }
    expect(sizeReads).toBeLessThanOrEqual(74)
  } finally {
    await w.cleanup()
  }
})

// A whole commit's patches are read file by file, a few git processes at a time (a textconv
// driver runs once per file). The result is the one `git show` would give, part for part.
test("a multi-file commit with a rename reads the same patches and counts as one git show", async () => {
  const w = await world()
  try {
    const repo = await w.repo("per-file-parity")
    await repo.write({ "old/name.txt": "a\nb\nc\nd\ne\nf\n", "keep.txt": "1\n2\n3\n" })
    await repo.commit("base")
    const task = await repo.task("per-file reads")
    // A rename with an edit: the new path is written, the old one removed; Git pairs them (-M).
    rmSync(join(repo.dir, "old/name.txt"))
    await repo.write({
      "new/name.txt": "a\nb\nc\nd\ne\nf-changed\n",
      "keep.txt": "1\n2-changed\n3\n4\n",
      "added.txt": "one\ntwo\n",
      "docs/plans/skip.md": "not part of the change\n",
    })
    const sha = await repo.commit("rename, edit, add")
    await recordSliceCommit(repo.ctx, task, sha)
    let shows = 0
    const ctx: Ctx = {
      ...repo.ctx,
      git: {
        ...repo.ctx.git,
        run: (...args: Parameters<typeof repo.ctx.git.run>) => {
          if (args[1][0] === "show") shows++
          return repo.ctx.git.run(...args)
        },
      },
    }
    const projection = await workflowChanges(ctx, task, { current: false })
    expect(shows).toBe(3)
    const whole = await repo.git(
      "show",
      "-M",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--format=fuller",
      "--first-parent",
      "--patch",
      "--textconv",
      "--no-ext-diff",
      sha,
      "--",
      ".",
      ":(exclude)docs/plans/**",
    )
    const starts = [...whole.matchAll(/^diff --git /gm)].map((match) => match.index!)
    const slices = starts.map((start, i) => whole.slice(start, starts[i + 1] ?? whole.length))
    const byPath = (text: string) =>
      text.match(/^\+\+\+ b\/(.+)$/m)?.[1] ?? text.match(/ b\/(\S+)\n/)?.[1]
    const expected = new Map(slices.map((text) => [byPath(text), text]))
    expect(projection.files.map((file) => file.path).sort()).toEqual([
      "added.txt",
      "keep.txt",
      "new/name.txt",
    ])
    for (const file of projection.files) {
      const part = ownedPartOf(projection, file.path, file.parts![0]!.stamp)!
      expect(part.patch).toBe(expected.get(file.path)!)
      const counts = { additions: file.additions, deletions: file.deletions }
      const lines = expected.get(file.path)!.split("\n")
      const hunk = lines.slice(lines.findIndex((line) => line.startsWith("@@")))
      expect(counts).toEqual({
        additions: hunk.filter((line) => line.startsWith("+")).length,
        deletions: hunk.filter((line) => line.startsWith("-")).length,
      })
    }
    const renamed = projection.files.find((file) => file.path === "new/name.txt")!
    expect(renamed.status).toBe("R")
    expect(renamed.from).toBe("old/name.txt")
  } finally {
    await w.cleanup()
  }
})

test("per-file reads stop at the commit's patch limit and start no further reads", async () => {
  const w = await world()
  try {
    const repo = await w.repo("per-file-limit")
    await repo.write({ "seed.txt": "seed\n" })
    await repo.commit("base")
    const task = await repo.task("large commit")
    const line = `${"x".repeat(1023)}\n`
    const files: Record<string, string> = {}
    // 24 files of 512 KiB each: 12 MiB of patch against the 8 MiB limit.
    for (let i = 0; i < 24; i++)
      files[`big/file-${String(i).padStart(2, "0")}.txt`] = line.repeat(512)
    await repo.write(files)
    const sha = await repo.commit("too large to read whole")
    await recordSliceCommit(repo.ctx, task, sha)
    let shows = 0
    const ctx: Ctx = {
      ...repo.ctx,
      git: {
        ...repo.ctx.git,
        run: (...args: Parameters<typeof repo.ctx.git.run>) => {
          if (args[1][0] === "show") shows++
          return repo.ctx.git.run(...args)
        },
      },
    }
    await expect(workflowChanges(ctx, task, { current: false })).rejects.toThrow(
      "exceeds the reading limit",
    )
    // 24 files go as at most eight runs of three: the total crosses the limit within them.
    expect(shows).toBeLessThanOrEqual(8)
  } finally {
    await w.cleanup()
  }
})

test("a multi-file commit just under the patch limit is still read whole", async () => {
  const w = await world()
  try {
    const LIMIT = 8 * 1024 * 1024
    const names = Array.from(
      { length: 16 },
      (_, i) => `near/file-${String(i).padStart(2, "0")}.txt`,
    )
    const show = (repo: Awaited<ReturnType<typeof w.repo>>, sha: string) =>
      repo.git(
        "show",
        "-M",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--format=fuller",
        "--first-parent",
        "--patch",
        "--textconv",
        "--no-ext-diff",
        sha,
        "--",
        ".",
        ":(exclude)docs/plans/**",
      )
    // The same commit shape with one character per file gives the fixed bytes around the content.
    const probe = await w.repo("near-limit-probe")
    await probe.write(Object.fromEntries(names.map((name) => [name, "x\n"])))
    const fixed = Buffer.byteLength(await show(probe, await probe.commit("near the limit"))) - 16
    const each = Math.floor((LIMIT - 3000 - fixed) / 16)
    const repo = await w.repo("near-limit")
    const task = await repo.task("near the limit")
    await repo.write(Object.fromEntries(names.map((name) => [name, `${"x".repeat(each)}\n`])))
    const sha = await repo.commit("near the limit")
    await recordSliceCommit(repo.ctx, task, sha)
    const whole = Buffer.byteLength(await show(repo, sha))
    expect(whole).toBeLessThan(LIMIT)
    expect(whole).toBeGreaterThan(LIMIT - 6000)
    const projection = await workflowChanges(repo.ctx, task, { current: false })
    expect(projection.files).toHaveLength(16)
    expect(projection.files.every((file) => file.additions === 1 && file.deletions === 0)).toBe(
      true,
    )
  } finally {
    await w.cleanup()
  }
})

test("a wide commit behind a diff driver is read in at most eight processes, counts intact", async () => {
  const w = await world()
  try {
    const repo = await w.repo("wide-commit")
    await repo.write({ "old/moved.dat": "a\nb\nc\nd\ne\nf\n" })
    await repo.commit("base")
    const task = await repo.task("wide commit")
    // A textconv driver, as git-crypt's: every .dat file goes through it.
    const driver = join(repo.dir, "..", "wide-driver.sh")
    writeFileSync(driver, '#!/bin/sh\ncat "$1"\n', { mode: 0o755 })
    await repo.git("config", "diff.wide.textconv", driver)
    const files: Record<string, string> = { ".gitattributes": "*.dat diff=wide\n" }
    for (let i = 0; i < 300; i++)
      files[`wide/file-${String(i).padStart(3, "0")}.dat`] = `line ${i}\n`
    rmSync(join(repo.dir, "old/moved.dat"))
    files["new/moved.dat"] = "a\nb\nc\nd\ne\nf-changed\n"
    await repo.write(files)
    const sha = await repo.commit("wide")
    await recordSliceCommit(repo.ctx, task, sha)
    let shows = 0
    const ctx: Ctx = {
      ...repo.ctx,
      git: {
        ...repo.ctx.git,
        run: (...args: Parameters<typeof repo.ctx.git.run>) => {
          if (args[1][0] === "show") shows++
          return repo.ctx.git.run(...args)
        },
      },
    }
    const projection = await workflowChanges(ctx, task, { current: false })
    expect(shows).toBeLessThanOrEqual(8)
    const wide = projection.files.filter((file) => file.path.startsWith("wide/"))
    expect(wide).toHaveLength(300)
    expect(wide.every((file) => file.additions === 1 && file.deletions === 0)).toBe(true)
    const moved = projection.files.find((file) => file.path === "new/moved.dat")!
    expect(moved.status).toBe("R")
    expect(moved.from).toBe("old/moved.dat")
    expect({ additions: moved.additions, deletions: moved.deletions }).toEqual({
      additions: 1,
      deletions: 1,
    })
    // Each part's patch is its own: the run's output was split at the right file.
    for (const file of wide.slice(0, 5)) {
      const part = ownedPartOf(projection, file.path, file.parts![0]!.stamp)!
      expect(part.patch).toContain(`+++ b/${file.path}`)
      expect(part.patch.match(/^diff --git /gm)).toHaveLength(1)
    }
  } finally {
    await w.cleanup()
  }
})

test("deep paths split runs further to keep each command line in the platform bound, eight at a time", async () => {
  const w = await world()
  try {
    const repo = await w.repo("deep-paths")
    const deep = Array.from({ length: 5 }, (_, i) => `level-${i}-${"d".repeat(50)}`).join("/")
    await repo.write({ [`${deep}/old-name.txt`]: "a\nb\nc\nd\ne\nf\n" })
    await repo.commit("base")
    const task = await repo.task("deep paths")
    const files: Record<string, string> = {}
    for (let i = 0; i < 600; i++)
      files[`${deep}/file-${String(i).padStart(3, "0")}.txt`] = `line ${i}\n`
    rmSync(join(repo.dir, deep, "old-name.txt"))
    files[`${deep}/new-name.txt`] = "a\nb\nc\nd\ne\nf-changed\n"
    await repo.write(files)
    const sha = await repo.commit("deep")
    await recordSliceCommit(repo.ctx, task, sha)
    let shows = 0,
      inFlight = 0,
      most = 0,
      longest = 0
    const ctx: Ctx = {
      ...repo.ctx,
      git: {
        ...repo.ctx.git,
        run: async (...args: Parameters<typeof repo.ctx.git.run>) => {
          if (args[1][0] !== "show") return repo.ctx.git.run(...args)
          shows++
          longest = Math.max(longest, ["git", ...args[1]].join(" ").length)
          most = Math.max(most, ++inFlight)
          try {
            return await repo.ctx.git.run(...args)
          } finally {
            inFlight--
          }
        },
      },
    }
    const projection = await workflowChanges(ctx, task, { current: false })
    // About 190 KiB of pathspecs: more than eight runs, each command line far inside 32,767.
    expect(shows).toBeGreaterThan(8)
    expect(longest).toBeLessThan(32_767)
    expect(most).toBeLessThanOrEqual(8)
    const counted = projection.files.filter((file) => file.path.includes("/file-"))
    expect(counted).toHaveLength(600)
    expect(counted.every((file) => file.additions === 1 && file.deletions === 0)).toBe(true)
    const moved = projection.files.find((file) => file.path === `${deep}/new-name.txt`)!
    expect(moved.status).toBe("R")
    expect(moved.from).toBe(`${deep}/old-name.txt`)
    expect({ additions: moved.additions, deletions: moved.deletions }).toEqual({
      additions: 1,
      deletions: 1,
    })
  } finally {
    await w.cleanup()
  }
})
