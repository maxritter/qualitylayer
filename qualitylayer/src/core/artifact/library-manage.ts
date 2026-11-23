import { createHash } from "node:crypto"
import { lstat, readFile } from "node:fs/promises"
import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { repoIdFrom } from "../paths.ts"
import {
  type KeepResult,
  LASTING_ARTIFACTS,
  LASTING_CONFIG,
  LASTING_CONFIG_MAX_BYTES,
  lastingDocOf,
} from "./format.ts"
import {
  adoptStored,
  type LastingRead,
  listLasting,
  parseLastingConfig,
  readLasting,
} from "./lasting.ts"
import { keepArtifact } from "./lasting-write.ts"
import { stampFolder } from "./pack.ts"
import { readArtifactShares } from "./share-state.ts"
import { projectArtifactsRuntime } from "./store.ts"

export type LibraryMutation =
  | { action: "rename"; expected: string; title: string; purpose: string }
  | { action: "archive" | "restore" | "delete"; expected: string; confirmInUse?: boolean }
  | {
      action: "copy"
      expected: string
      project: string
      name: string
      title: string
      purpose: string
    }

export type LibraryResult = { name: string; revision: string; result?: KeepResult }

const bad = (message: string): Result<never> => err({ code: "bad_args", message })

/** Metadata and every source dependency participate, including a registered external source folder. */
export async function libraryRevision(read: LastingRead): Promise<Result<string>> {
  const stamp = await stampFolder(read.dir)
  if (!stamp.ok) return stamp
  const config = await readFile(read.configPath)
  return ok(createHash("sha256").update(config).update(stamp.data.key).digest("hex"))
}

async function titleTaken(root: string, title: string, except?: string): Promise<boolean> {
  const comparable = (text: string) => text.normalize("NFKC").toLocaleLowerCase().trim()
  return (await listLasting(root)).some(
    (entry) =>
      entry.ok &&
      entry.name !== except &&
      comparable(entry.read.config.title) === comparable(title),
  )
}

/** Whether this computer shares the artifact with the team: the owner's registry holds a share of it. */
async function sharedLive(ctx: Ctx, root: string, name: string): Promise<boolean> {
  const common = await ctx.git.commonDir(root)
  if (common === null) return false
  const id = repoIdFrom(common)
  const shares = await readArtifactShares(ctx, {
    runtimeDir: projectArtifactsRuntime(ctx, id),
  }).catch(() => [])
  return shares.some(
    (share) =>
      share.ownerToken !== undefined &&
      share.address.scope === "project" &&
      share.address.id === id &&
      lastingDocOf(share.address.file)?.name === name,
  )
}

const STALE_MESSAGE =
  "The artifact changed since you opened it. Reload its saved details and try again; your input is kept."

async function readCurrentLibraryRevision(root: string, name: string): Promise<Result<string>> {
  const now = await readLasting(root, name, { includeDeleted: true })
  return now.ok ? libraryRevision(now.data) : now
}

async function adoptStoredIfNeeded(
  ctx: Ctx,
  root: string,
  name: string,
  change: LibraryMutation,
): Promise<Result<LibraryMutation>> {
  const initial = await readLasting(root, name, { includeDeleted: true })
  if (!initial.ok) return initial
  if (initial.data.stored !== true) return ok(change)
  // A design stored before the rename: this change was made against it; the save goes to the artifact folder.
  const before = await libraryRevision(initial.data)
  if (!before.ok || before.data !== change.expected) return before.ok ? bad(STALE_MESSAGE) : before
  const adopted = await adoptStored(root, name, ctx)
  if (!adopted.ok) return adopted
  const revision = await readCurrentLibraryRevision(root, name)
  return revision.ok ? ok({ ...change, expected: revision.data }) : revision
}

async function copyLibraryArtifact(
  ctx: Ctx,
  sourceDir: string,
  change: Extract<LibraryMutation, { action: "copy" }>,
  destination: string | undefined,
): Promise<Result<LibraryResult>> {
  if (destination === undefined) return bad("Choose an available destination project")
  if (await titleTaken(destination, change.title))
    return bad("An artifact with that title already exists in the destination project")
  const copied = await keepArtifact(ctx, destination, sourceDir, {
    name: change.name,
    title: change.title,
    purpose: change.purpose,
    where: "repository",
  })
  if (!copied.ok) return copied
  const target = await readLasting(destination, change.name)
  if (!target.ok) return target
  const revision = await libraryRevision(target.data)
  return revision.ok
    ? ok({ name: change.name, revision: revision.data, result: copied.data })
    : revision
}

type MetadataMutationContext = {
  ctx: Ctx
  root: string
  name: string
  config: Record<string, unknown>
  change: Exclude<LibraryMutation, { action: "copy" }>
  inUse: string[] | undefined
}

async function applyMetadataChange({
  ctx,
  root,
  name,
  config,
  change,
  inUse,
}: MetadataMutationContext): Promise<Result<void>> {
  if (change.action === "rename") {
    const checked = parseLastingConfig(
      JSON.stringify({ ...config, title: change.title, purpose: change.purpose }),
    )
    if (!checked.ok) return checked
    if (await titleTaken(root, checked.data.title, name))
      return bad("An artifact with that title already exists; choose another title")
    config.title = checked.data.title
    config.purpose = checked.data.purpose
  } else if (change.action === "archive") {
    config.archivedAt ??= ctx.clock.now()
  } else if (change.action === "restore") {
    delete config.archivedAt
    delete config.deletedAt
  } else {
    if (inUse?.length && !change.confirmInUse)
      return bad(
        `This artifact has active drafts in ${inUse.join(", ")}. Archive it instead, or confirm deletion.`,
      )
    config.deletedAt = ctx.clock.now()
  }
  return ok(undefined)
}

async function loadExpectedLibraryEntry(
  root: string,
  name: string,
  expected: string,
): Promise<Result<{ found: LastingRead; config: Record<string, unknown> }>> {
  const found = await readLasting(root, name, { includeDeleted: true })
  if (!found.ok) return found
  const current = await libraryRevision(found.data)
  if (!current.ok) return current
  if (current.data !== expected) return bad(STALE_MESSAGE)
  const config = {
    ...(JSON.parse(await readFile(join(found.data.configDir, LASTING_CONFIG), "utf8")) as Record<
      string,
      unknown
    >),
    ...found.data.config,
  }
  return ok({ found: found.data, config })
}

async function saveLibraryConfig(
  ctx: Ctx,
  root: string,
  name: string,
  configDir: string,
  config: Record<string, unknown>,
): Promise<Result<LibraryResult>> {
  const serialized = `${JSON.stringify(config, null, 2)}\n`
  if (Buffer.byteLength(serialized) > LASTING_CONFIG_MAX_BYTES)
    return bad("The artifact's metadata is too large. Shorten its description before saving.")
  await ctx.fs.atomicWrite(join(configDir, LASTING_CONFIG), serialized)
  const revision = await readCurrentLibraryRevision(root, name)
  return revision.ok ? ok({ name, revision: revision.data }) : revision
}

async function executeLockedMutation(
  ctx: Ctx,
  root: string,
  name: string,
  change: LibraryMutation,
  options: { inUse?: string[]; destination?: string },
): Promise<Result<LibraryResult>> {
  const loaded = await loadExpectedLibraryEntry(root, name, change.expected)
  if (!loaded.ok) return loaded
  const { found, config } = loaded.data
  if (config.deletedAt !== undefined && change.action !== "restore")
    return bad("This artifact was deleted. Restore it before changing it.")
  if (
    (change.action === "delete" || change.action === "archive") &&
    (await sharedLive(ctx, root, name))
  )
    return bad("Stop sharing first: teammates can still open and edit it.")
  if (change.action === "copy")
    return copyLibraryArtifact(ctx, found.dir, change, options.destination)
  const mutated = await applyMetadataChange({
    ctx,
    root,
    name,
    config,
    change,
    inUse: options.inUse,
  })
  return mutated.ok ? saveLibraryConfig(ctx, root, name, found.configDir, config) : mutated
}

/** Library writes never move the identity folder or delete its source. The registry is the recovery record. */
export async function manageLibrary(
  ctx: Ctx,
  root: string,
  name: string,
  change: LibraryMutation,
  options: { inUse?: string[]; destination?: string } = {},
): Promise<Result<LibraryResult>> {
  if (!/^[a-f0-9]{64}$/.test(change.expected))
    return bad("Read the Library artifact before changing it")
  const prepared = await adoptStoredIfNeeded(ctx, root, name, change)
  if (!prepared.ok) return prepared
  const lock = join(root, LASTING_ARTIFACTS, ".library-lock")
  const lockInfo = await lstat(lock).catch(() => null)
  if (lockInfo?.isSymbolicLink()) return bad("The library lock cannot be a symbolic link")
  try {
    return await ctx.fs.withLock(lock, () =>
      executeLockedMutation(ctx, root, name, prepared.data, options),
    )
  } catch (cause) {
    return bad(cause instanceof Error ? cause.message : "Could not save the Library change")
  }
}
