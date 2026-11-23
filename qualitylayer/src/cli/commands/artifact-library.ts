import { readLasting } from "../../core/artifact/lasting.ts"
import { libraryRevision } from "../../core/artifact/library-manage.ts"
import { resolveRepo } from "../../core/paths.ts"
import { registerProject } from "../../core/task/store.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { manageLasting } from "../../server/artifact-library.ts"
import { parseArgs } from "./shared.ts"

export const ARTIFACT_LIBRARY_USAGE =
  "qualitylayer artifact library inspect|rename|copy|archive|restore|delete <name> [--title <title>] [--purpose <line>] [--to <copy-name>] [--to-project <project-id>] [--if-match <revision>] [--confirm-in-use]"
const bad = (message: string): Result<never> => err({ code: "bad_args", message })

const ALLOWED_FLAGS: Record<string, readonly string[]> = {
  inspect: [],
  rename: ["if-match", "title", "purpose"],
  copy: ["if-match", "title", "purpose", "to", "to-project"],
  archive: ["if-match"],
  restore: ["if-match"],
  delete: ["if-match", "confirm-in-use"],
}

type Flags = Record<string, string | true>

async function inspectLasting(
  name: string,
  data: Awaited<ReturnType<typeof readLasting>> extends Result<infer T> ? T : never,
): Promise<Result<unknown>> {
  const revision = await libraryRevision(data)
  if (!revision.ok) return revision
  return ok({
    artifact: name,
    revision: revision.data,
    title: data.config.title,
    purpose: data.config.purpose,
    pages: data.pages,
    source: data.folder,
    archived: data.config.archivedAt !== undefined,
    deleted: data.config.deletedAt !== undefined,
  })
}

function addTitleFields(
  change: Record<string, unknown>,
  flags: Flags,
  fallbackPurpose: string | undefined,
): Result<null> {
  if (typeof flags.title !== "string" || !flags.title.trim())
    return bad("--title names the artifact's display title; existing links keep their identity")
  if (flags.purpose !== undefined && typeof flags.purpose !== "string")
    return bad("--purpose needs a description")
  change.title = flags.title
  change.purpose = flags.purpose ?? fallbackPurpose
  return ok(null)
}

function addCopyFields(
  change: Record<string, unknown>,
  flags: Flags,
  repoId: string,
): Result<null> {
  if (typeof flags.to !== "string" || !flags.to.trim())
    return bad("--to names the independent copy")
  if (flags["to-project"] !== undefined && typeof flags["to-project"] !== "string")
    return bad("--to-project needs an exact registered project id")
  change.name = flags.to
  change.project = flags["to-project"] ?? repoId
  return ok(null)
}

function buildLibraryChange(
  action: string,
  flags: Flags,
  fallbackPurpose: string | undefined,
  repoId: string,
): Result<Record<string, unknown>> {
  if (typeof flags["if-match"] !== "string")
    return bad("Read artifact library inspect first and pass its revision with --if-match")
  const change: Record<string, unknown> = { action, expected: flags["if-match"] }
  if (action === "rename" || action === "copy") {
    const titled = addTitleFields(change, flags, fallbackPurpose)
    if (!titled.ok) return titled
  }
  if (action === "copy") {
    const copied = addCopyFields(change, flags, repoId)
    if (!copied.ok) return copied
  }
  if (action === "delete" && flags["confirm-in-use"] === true) change.confirmInUse = true
  return ok(change)
}

function parseLibraryArgs(args: string[]): Result<{ action: string; name: string; flags: Flags }> {
  const { positional, flags } = parseArgs(args, [
    "if-match",
    "title",
    "purpose",
    "to",
    "to-project",
  ])
  const [action, name, ...rest] = positional
  const allowed = action ? ALLOWED_FLAGS[action] : undefined
  if (!action || !name || rest.length || !allowed) return bad(ARTIFACT_LIBRARY_USAGE)
  if (Object.keys(flags).some((key) => !allowed.includes(key))) return bad(ARTIFACT_LIBRARY_USAGE)
  return ok({ action, name, flags })
}

async function applyLibraryAction(
  ctx: Ctx,
  repo: Awaited<ReturnType<typeof resolveRepo>> extends Result<infer T> ? T : never,
  action: string,
  name: string,
  flags: Flags,
): Promise<Result<unknown>> {
  const read = await readLasting(repo.root, name, { includeDeleted: true })
  if (!read.ok) return read
  if (action === "inspect") return inspectLasting(name, read.data)
  const change = buildLibraryChange(action, flags, read.data.config.purpose, repo.id)
  if (!change.ok) return change
  await registerProject(ctx, repo)
  return manageLasting(ctx, repo.id, name, change.data)
}

/** Library commands use the same identity, revision and active-draft guard as the App. */
export async function artifactLibraryCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const parsed = parseLibraryArgs(args)
  if (!parsed.ok) return parsed
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  return applyLibraryAction(ctx, repo.data, parsed.data.action, parsed.data.name, parsed.data.flags)
}
