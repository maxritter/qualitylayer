import { dirname, join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { packFolderPage } from "../../server/artifact-pack.ts"
import { artifactSourceWitness } from "./agent-context.ts"
import { folderArtifactOf, lastingDocOf, STORED_TASK_DESIGNS } from "./format.ts"
import { readLasting } from "./lasting.ts"
import { type ArtifactReference, parseArtifactReference } from "./reference.ts"
import { safeArtifactPath } from "./workspace.ts"

async function resolveReferenceTarget(
  ctx: Ctx,
  home: { taskDir: string; repoRoot: string | null },
  reference: ArtifactReference,
): Promise<{ path: string; root: string; packed: boolean }> {
  if (reference.scope === "project") {
    const lasting = lastingDocOf(reference.file)
    if (!lasting || !home.repoRoot) throw new Error("This artifact has no local project checkout.")
    const found = await readLasting(home.repoRoot, lasting.name)
    if (!found.ok) throw new Error(found.error.message)
    if (!found.data.pages.includes(lasting.page))
      throw new Error("The registered artifact has no such page.")
    return { path: join(found.data.dir, lasting.page), root: home.repoRoot, packed: true }
  }
  let path = join(home.taskDir, reference.file)
  // A design stored in the task's old `design/` folder is read where it is.
  const stored = join(
    home.taskDir,
    reference.file.replace(/^artifacts\//, `${STORED_TASK_DESIGNS}/`),
  )
  if (!(await ctx.fs.exists(path)) && (await ctx.fs.exists(stored))) path = stored
  return { path, root: home.taskDir, packed: folderArtifactOf(reference.file) !== null }
}

/** Resolve registered source inside this checkout; no arbitrary project or filesystem fallback. */
export async function artifactReferenceSource(
  ctx: Ctx,
  home: { taskDir: string; repoRoot: string | null },
  reference: ArtifactReference,
  options: { pack?: boolean } = {},
): Promise<{ path: string; html: string }> {
  const checked = parseArtifactReference(
    reference.file + (reference.section ? `#${reference.section}` : ""),
  )
  if (!checked || checked.scope !== reference.scope)
    throw new Error("The artifact reference is not a supported local artifact path.")
  const { path, root, packed } = await resolveReferenceTarget(ctx, home, reference)
  await safeArtifactPath(ctx, root, path)
  if (!(await ctx.fs.exists(path))) throw new Error("The referenced artifact page does not exist.")
  if (packed && options.pack !== false) {
    const page = path.split(/[\\/]/).at(-1) ?? ""
    const result = await packFolderPage(dirname(path), page)
    if (!result.ok) throw new Error(result.error.message)
    return { path, html: result.data.html }
  }
  return { path, html: await ctx.fs.readFile(path) }
}

/** Approval uses source bytes, independent of the renderer's timestamp-based packing cache. */
export async function artifactReferenceRevision(
  ctx: Ctx,
  home: { taskDir: string; repoRoot: string | null },
  reference: ArtifactReference,
): Promise<string> {
  const source = await artifactReferenceSource(ctx, home, reference, { pack: false })
  const root = reference.scope === "project" ? home.repoRoot : home.taskDir
  if (!root) throw new Error("This artifact has no local project checkout.")
  const witnessed = await artifactSourceWitness(ctx, {
    address: {
      scope: reference.scope,
      id: "document-reference",
      file: reference.file,
      revision: "",
    },
    root,
    folder: dirname(source.path),
    sourcePath: source.path,
    runtimeDir: "",
    title: "Referenced artifact",
    pages: [reference.file],
    kind: folderArtifactOf(reference.file) ? "folder" : "file",
  })
  if (!witnessed.ok) throw new Error(witnessed.error.message)
  return witnessed.data.revision
}
