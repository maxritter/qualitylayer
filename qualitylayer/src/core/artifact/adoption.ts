import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { ARTIFACT_ADOPTIONS_MAX, ARTIFACT_ADOPTIONS_MAX_BYTES } from "../home-caps.ts"
import { projectRuntimeDir, type RepoRef } from "../paths.ts"
import { ARTIFACT_NAME } from "./format.ts"
import { readLasting } from "./lasting.ts"
import { libraryRevision } from "./library-manage.ts"
import { stampFolder } from "./pack.ts"
import { type ArtifactFile, type ArtifactHome, findArtifact } from "./store.ts"
import { readArtifactSource, sourceRevision } from "./workspace.ts"

export type ArtifactAdoption = {
  draft: string
  file: string
  draftRevision: string
  artifact: string
  artifactRevision: string
  at: number
}
const bad = (message: string): Result<never> => err({ code: "bad_args", message })
const revision = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
const receiptPath = (ctx: Ctx, repo: RepoRef) =>
  join(projectRuntimeDir(ctx, repo.id), "artifact-adoptions.json")

/** Folder drafts bind every dependency; HTML editing keeps its existing, separate revision guard. */
export async function adoptionRevision(entry: ArtifactFile, html: string): Promise<Result<string>> {
  if (!entry.folder) return ok(sourceRevision(html))
  const stamp = await stampFolder(entry.folder.dir)
  return stamp.ok ? ok(stamp.data.key) : stamp
}

function isValidAdoptionRow(row: unknown): row is ArtifactAdoption {
  if (!row || typeof row !== "object") return false
  const item = row as Record<string, unknown>
  const validNames =
    typeof item.draft === "string" &&
    ARTIFACT_NAME.test(item.draft) &&
    typeof item.artifact === "string" &&
    ARTIFACT_NAME.test(item.artifact)
  if (!validNames || typeof item.file !== "string" || item.file.length > 1024) return false
  return revision(item.draftRevision) && revision(item.artifactRevision) && Number.isFinite(item.at)
}

async function readCheckedAdoptionText(
  ctx: Ctx,
  repo: RepoRef,
  path: string,
): Promise<Result<string>> {
  await ctx.fs.assertSafeDirectory?.(projectRuntimeDir(ctx, repo.id))
  const info = await ctx.fs.lstat?.(path)
  if (info && info.kind !== "file") return bad("The artifact adoption record is not a regular file")
  if (((await ctx.fs.stat?.(path))?.size ?? 0) > ARTIFACT_ADOPTIONS_MAX_BYTES)
    return bad("The artifact adoption record exceeds its byte cap")
  const text = await ctx.fs.readFile(path)
  return Buffer.byteLength(text) > ARTIFACT_ADOPTIONS_MAX_BYTES
    ? bad("The artifact adoption record exceeds its byte cap")
    : ok(text)
}

async function records(ctx: Ctx, repo: RepoRef): Promise<Result<ArtifactAdoption[]>> {
  const path = receiptPath(ctx, repo)
  const initial = await ctx.fs.lstat?.(path)
  if (initial && initial.kind !== "file")
    return bad("The artifact adoption record is not a regular file")
  if (!(await ctx.fs.exists(path))) return ok([])
  try {
    const text = await readCheckedAdoptionText(ctx, repo, path)
    if (!text.ok) return text
    const values: unknown = JSON.parse(text.data)
    return Array.isArray(values) &&
      values.length <= ARTIFACT_ADOPTIONS_MAX &&
      values.every(isValidAdoptionRow)
      ? ok(values)
      : bad("The artifact adoption history cannot be read; its records were kept")
  } catch {
    return bad("The artifact adoption history cannot be read; its records were kept")
  }
}

async function targetRevision(repo: RepoRef, name: string): Promise<Result<string>> {
  const target = await readLasting(repo.root, name)
  if (!target.ok) return target
  if (target.data.config.archivedAt !== undefined || target.data.config.deletedAt !== undefined)
    return bad("Restore the target artifact before recording an adoption")
  return libraryRevision(target.data)
}

export async function adoptionDetails(ctx: Ctx, repo: RepoRef, draft: string, current: string) {
  const history = await records(ctx, repo)
  if (!history.ok) return { adoption_error: history.error.message }
  const latest = history.data.findLast((row) => row.draft === draft.replace(/\.html$/, ""))
  if (!latest) return {}
  const target = await targetRevision(repo, latest.artifact)
  return {
    adoption: {
      ...latest,
      draftCurrent: current === latest.draftRevision,
      targetCurrent: target.ok ? target.data === latest.artifactRevision : "unavailable",
    },
  }
}

type AdoptStandaloneInput = {
  draft: string
  artifact: string
  expectedDraft: string
  expectedTarget: string
}

function isValidAdoptInput(draft: string, input: AdoptStandaloneInput): boolean {
  if (!ARTIFACT_NAME.test(draft) || !ARTIFACT_NAME.test(input.artifact) || draft === input.artifact)
    return false
  return revision(input.expectedDraft) && revision(input.expectedTarget)
}

async function readDraftAdoptionRevision(
  ctx: Ctx,
  home: ArtifactHome,
  draft: string,
): Promise<Result<{ file: string; revision: string }>> {
  const entry = await findArtifact(ctx, home, draft)
  if (!entry)
    return bad(
      "No standalone project draft has that name. Workflow drafts fold at their task's Review",
    )
  const read = await readArtifactSource(ctx, home, entry.file)
  if (!read.ok) return read
  const from = await adoptionRevision(entry, read.data.html)
  return from.ok ? ok({ file: entry.file, revision: from.data }) : from
}

async function resolveAdoptionRevisions(
  ctx: Ctx,
  repo: RepoRef,
  home: ArtifactHome,
  draft: string,
  input: AdoptStandaloneInput,
): Promise<Result<{ file: string; draftRevision: string; artifactRevision: string }>> {
  const from = await readDraftAdoptionRevision(ctx, home, draft)
  if (!from.ok) return from
  const into = await targetRevision(repo, input.artifact)
  if (!into.ok) return into
  if (from.data.revision !== input.expectedDraft)
    return bad(
      "The draft changed. Inspect adoption_revision again before recording its implementation",
    )
  if (into.data !== input.expectedTarget)
    return bad(
      "The target changed. Inspect its Library revision again before recording the adoption",
    )
  return ok({
    file: from.data.file,
    draftRevision: from.data.revision,
    artifactRevision: into.data,
  })
}

/** Records an implemented standalone draft; copying source and workflow approval are separate actions. */
export async function adoptStandalone(
  ctx: Ctx,
  repo: RepoRef,
  input: AdoptStandaloneInput,
): Promise<Result<ArtifactAdoption>> {
  const draft = input.draft.replace(/\.html$/, "")
  if (!isValidAdoptInput(draft, input))
    return bad(
      "Inspect the standalone draft's adoption_revision and the Library target's revision, then provide both exact guards",
    )
  const home: ArtifactHome = { scope: "project", root: repo.root, repoId: repo.id }
  const directory = projectRuntimeDir(ctx, repo.id)
  await ctx.fs.mkdir(directory, { mode: 0o700 })
  await ctx.fs.assertSafeDirectory?.(directory)
  return ctx.fs.withLock(join(directory, "artifact-adoptions.lock"), async () => {
    const resolved = await resolveAdoptionRevisions(ctx, repo, home, draft, input)
    if (!resolved.ok) return resolved
    const history = await records(ctx, repo)
    if (!history.ok) return history
    const { file, draftRevision, artifactRevision } = resolved.data
    const prior = history.data.find(
      (row) =>
        row.draft === draft &&
        row.draftRevision === draftRevision &&
        row.artifact === input.artifact &&
        row.artifactRevision === artifactRevision,
    )
    if (prior) return ok(prior)
    const receipt: ArtifactAdoption = {
      draft,
      file,
      draftRevision,
      artifact: input.artifact,
      artifactRevision,
      at: ctx.clock.now(),
    }
    const next = [...history.data, receipt]
    const text = `${JSON.stringify(next, null, 2)}\n`
    if (
      next.length > ARTIFACT_ADOPTIONS_MAX ||
      Buffer.byteLength(text) > ARTIFACT_ADOPTIONS_MAX_BYTES
    )
      return bad("Artifact adoption history is full. Existing receipts were kept")
    await ctx.fs.atomicWrite(receiptPath(ctx, repo), text)
    return ok(receipt)
  })
}
