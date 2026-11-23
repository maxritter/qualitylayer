// Fold in at Review: a task's draft on a lasting artifact lands in the artifact's folder as part of the
// task's changes. `foldPreview` says what would land and what is in the way, writing nothing;
// `foldArtifact` writes the chosen pages (and the files they changed) and commits exactly those paths
// through the private-index commit QualityLayer's slice commits use, then records the commit as the
// task's so the artifact's history can name the task.
//
// What is in the way: a page the lasting artifact changed since the draft began (a blob that differs
// from the draft's `base`), a page it lost or gained meanwhile, all blocking until the person goes on
// anyway; and another open task drafting on the same page, which only warns.

import { mkdir } from "node:fs/promises"
import { dirname, join, relative, sep } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { recordSliceCommit } from "../git/build-start.ts"
import { commitSlice } from "../git/slice-commit.ts"
import { type FoldPreview, type FoldResult, LASTING_ARTIFACTS } from "./format.ts"
import { adoptStored } from "./lasting.ts"
import { changedInputs, updateBase } from "./lasting-fold-base.ts"
import {
  type FileWitness,
  readAtIdentity,
  restoreFoldFiles,
  rollbackNote,
  sha256,
  witness,
  writeGuarded,
} from "./lasting-fold-io.ts"
import { type FoldPlan, type OtherDrafts, planFold } from "./lasting-fold-plan.ts"
import { bad, keepAllFiles, LASTING_KEEP_ALL, type WriteTask } from "./lasting-write.ts"

export type { OtherDrafts } from "./lasting-fold-plan.ts"

/** What folding a task's draft into its lasting artifact would write, and what is in the way. Writes nothing. */
export async function foldPreview(
  task: WriteTask,
  draft: string,
  others: OtherDrafts = async () => [],
): Promise<Result<FoldPreview>> {
  const planned = await planFold(task, draft, others)
  return planned.ok ? ok(planned.data.preview) : planned
}

export type FoldInput = {
  draft: string
  pages: string[]
  force?: boolean
}

async function prepareFoldPlan(
  ctx: Ctx,
  task: WriteTask,
  draft: string,
  others: OtherDrafts,
): Promise<Result<FoldPlan>> {
  const planned = await planFold(task, draft, others)
  if (!planned.ok || !planned.data.lasting.stored) return planned
  // A design stored before the rename: the fold lands in the artifact folder, copied from it first.
  const adopted = await adoptStored(task.repoRoot, planned.data.lasting.name, ctx)
  return adopted.ok ? planFold(task, draft, others) : adopted
}

function validateFoldPages(preview: FoldPreview, input: FoldInput): Result<string[]> {
  if (
    !Array.isArray(input.pages) ||
    input.pages.length === 0 ||
    input.pages.some((p) => typeof p !== "string")
  )
    return bad("choose the pages to fold in")
  const chosen = [...new Set(input.pages)]
  for (const name of chosen) {
    if (!preview.pages.some((p) => p.page === name))
      return bad(`${input.draft} has no page ${name} to fold in`)
  }
  return ok(chosen)
}

type StageFoldInput = {
  task: WriteTask
  state: FoldPlan
  writes: Map<string, string>
  paths: string[]
  before: Map<string, Buffer | null>
  written: Map<string, FileWitness>
}

async function stageFoldFiles({
  task,
  state,
  writes,
  paths,
  before,
  written,
}: StageFoldInput): Promise<void> {
  // An artifact kept before the rule existed gets it with its first fold, in the same commit.
  // An artifact whose files live in a source folder of the project follows that folder's own rules.
  const rule = state.lasting.folder.startsWith(`${LASTING_ARTIFACTS}/`)
    ? await keepAllFiles(task.repoRoot)
    : null
  if (rule !== null) {
    const at = join(task.repoRoot, ...LASTING_KEEP_ALL.split("/"))
    before.set(at, null)
    const applied = await witness(at)
    if (applied.kind !== "file") throw new Error(`${at} changed while it was created`)
    written.set(at, applied)
    paths.push(rule)
  }
  for (const [rel, from] of writes) {
    const at = join(state.lasting.dir, rel)
    const expected = state.inputs.get(at)
    const source = state.inputs.get(from)
    if (!expected || !source?.identity || source.kind !== "file")
      throw new Error(`${from} is no longer a regular draft input`)
    const bytes = await readAtIdentity(from, source.identity, source.size)
    if (sha256(bytes) !== source.sha256) throw new Error(`${from} changed before copying`)
    before.set(
      at,
      expected.kind === "missing"
        ? null
        : await readAtIdentity(at, expected.identity as string, expected.size),
    )
    await mkdir(dirname(at), { recursive: true })
    written.set(at, await writeGuarded(at, bytes, expected))
  }
}

async function reconcileHookWrites(
  ctx: Ctx,
  repoRoot: string,
  commit: string | null,
  written: Map<string, FileWitness>,
): Promise<void> {
  if (commit === null) return
  // Hook formatting is accepted only when the current file is exactly the recorded commit's input.
  for (const [at, own] of written) {
    const current = await witness(at)
    if (current.version === own.version) continue
    const saved = await ctx.git.run(repoRoot, [
      "cat-file",
      "--filters",
      `${commit}:${relative(repoRoot, at).split(sep).join("/")}`,
    ])
    if (saved.code === 0 && sha256(Buffer.from(saved.stdout)) === current.sha256)
      written.set(at, current)
  }
}

async function commitStagedFold(
  ctx: Ctx,
  task: WriteTask,
  state: FoldPlan,
  chosen: string[],
  writes: Map<string, string>,
): Promise<Result<FoldResult>> {
  const paths = [...writes.keys()].map((rel) => `${state.lasting.folder}/${rel}`)
  const before = new Map<string, Buffer | null>()
  const written = new Map<string, FileWitness>()
  try {
    await stageFoldFiles({ task, state, writes, paths, before, written })
  } catch (cause) {
    const kept = await restoreFoldFiles(written, before)
    return bad(`${cause instanceof Error ? cause.message : String(cause)}${rollbackNote(kept)}`)
  }
  const committed = await commitSlice(task.repoRoot, paths, [], state.preview.message, {
    named: paths,
    records: [],
    leave: [],
    start: null,
    written: Object.fromEntries(
      [...written].map(([at, value]) => [
        relative(task.repoRoot, at).split(sep).join("/"),
        value.sha256 as string,
      ]),
    ),
    foreign: async () =>
      (await changedInputs(state, chosen, written)).length > 0
        ? Object.fromEntries(paths.map((path) => [path, "another artifact writer"]))
        : {},
  })
  if (!committed.ok) {
    const kept = await restoreFoldFiles(written, before)
    return err({ ...committed.error, message: committed.error.message + rollbackNote(kept) })
  }
  const { commit, subject } = committed.data
  if (commit !== null) await recordSliceCommit(ctx, task, commit)
  await reconcileHookWrites(ctx, task.repoRoot, commit, written)
  const rebased = await updateBase(state, chosen, written)
  return rebased.ok
    ? ok({ folded: true, commit, subject, files: paths, preview: state.preview })
    : bad(
        `${commit === null ? "The fold matched the existing commit" : `Committed ${commit}`}, but ${rebased.error.message}. Refresh the draft before retrying.`,
      )
}

async function executeValidatedFold(
  ctx: Ctx,
  task: WriteTask,
  state: FoldPlan,
  chosen: string[],
): Promise<Result<FoldResult>> {
  const writes = new Map<string, string>()
  for (const name of chosen) {
    for (const { from, rel } of state.copies.get(name) ?? []) writes.set(rel, from)
  }
  if ((await changedInputs(state, chosen)).length > 0)
    return bad("The draft or lasting artifact changed since the fold was prepared")
  if (writes.size === 0) {
    const rebased = await updateBase(state, chosen, new Map())
    return rebased.ok
      ? ok({ folded: true, commit: null, subject: null, files: [], preview: state.preview })
      : rebased
  }
  return commitStagedFold(ctx, task, state, chosen, writes)
}

/**
 * Copy the chosen pages (and the files they changed) from the task's draft into the lasting artifact's
 * folder and commit exactly those paths. A blocking conflict on a chosen page answers the preview
 * and writes nothing, unless `force`. A refused commit restores only files still owned by the fold.
 */
export async function foldArtifact(
  ctx: Ctx,
  task: WriteTask,
  input: FoldInput,
  others: OtherDrafts = async () => [],
): Promise<Result<FoldResult>> {
  const planned = await prepareFoldPlan(ctx, task, input.draft, others)
  if (!planned.ok) return planned
  const state = planned.data
  const chosenResult = validateFoldPages(state.preview, input)
  if (!chosenResult.ok) return chosenResult
  const chosen = chosenResult.data
  const stops = state.preview.conflicts.filter((c) => c.blocking && chosen.includes(c.page))
  if (stops.length > 0 && input.force !== true) return ok({ folded: false, preview: state.preview })
  return executeValidatedFold(ctx, task, state, chosen)
}
