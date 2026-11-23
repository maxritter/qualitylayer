// Where artifacts live and what the App lists of them: a task's `artifacts/` (and an old task's mockups and
// show-me pages under `artifacts/`), and the project's `docs/artifacts/` for artifact work outside a
// task. Artifacts are personal: the folders go into the repository's `.git/info/exclude` when they are
// made, and comments on a project's artifacts live in QualityLayer's own folder, never the repository.

import { lstatSync } from "node:fs"
import { join } from "node:path"
import { marked } from "marked"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { parseMarkers } from "../docs/markers.ts"
import { isArtifactDoc } from "../gate/comments.ts"
import { projectRuntimeDir } from "../paths.ts"
import {
  ARTIFACT_NAME,
  fillArtifact,
  folderArtifactOf,
  PROJECT_ARTIFACTS,
  STORED_PROJECT_DESIGNS,
  STORED_TASK_DESIGNS,
  TASK_ARTIFACTS,
  titleOfName,
  withMeta,
} from "./format.ts"
import { parseArtifactReference } from "./reference.ts"
import { artifactFiles } from "./store-files.ts"
import { type ProductTokens, withTokens } from "./tokens.ts"

export { artifactFiles } from "./store-files.ts"
export { listArtifacts } from "./store-list.ts"
export { prepareArtifactStage } from "./store-stage.ts"

/** Where an artifact belongs: a task (its folder and runtime folder) or a project's repository. */
export type ArtifactHome =
  | { scope: "task"; dir: string; runtimeDir: string; root?: string; provenance?: ArtifactRecorder }
  | { scope: "project"; root: string; repoId: string; provenance?: ArtifactRecorder }

export type ArtifactRecorder = {
  task?: { id: string; title: string }
  /** Only an agent CLI invocation supplies a native session; the App server does not. */
  captureSession?: true
}

/** The folder whose `comments.json` holds the comments on a home's artifacts. */
export function commentsHolder(ctx: Ctx, home: ArtifactHome): { runtimeDir: string } {
  return home.scope === "task"
    ? { runtimeDir: home.runtimeDir }
    : { runtimeDir: projectArtifactsRuntime(ctx, home.repoId) }
}

/** QualityLayer's folder for a project's artifacts: their comments, thumbnails and pictures. */
export function projectArtifactsRuntime(ctx: Ctx, repoId: string): string {
  const project = projectRuntimeDir(ctx, repoId)
  for (const layout of ["artifacts", "designs"] as const) {
    const path = join(project, layout)
    try {
      const stored = lstatSync(path)
      if (!stored.isDirectory() || stored.isSymbolicLink())
        throw new Error("Unsafe artifact runtime layout")
      return path
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause
    }
  }
  return join(project, "artifacts")
}

/** The folder a home's new artifacts go into. */
export function artifactFolder(home: ArtifactHome): string {
  return home.scope === "task" ? join(home.dir, TASK_ARTIFACTS) : join(home.root, PROJECT_ARTIFACTS)
}

/** The path on disk of an artifact's file, or null for a name that is not one. */
export function artifactPath(home: ArtifactHome, file: string): string | null {
  if (!isArtifactDoc(file)) return null
  const inTask = file.startsWith(`${TASK_ARTIFACTS}/`) || file.startsWith(`${STORED_TASK_DESIGNS}/`)
  const inProject =
    file.startsWith(`${PROJECT_ARTIFACTS}/`) || file.startsWith(`${STORED_PROJECT_DESIGNS}/`)
  if (home.scope === "task" ? !inTask : !inProject) return null
  return join(home.scope === "task" ? home.dir : home.root, file)
}

export type ArtifactFile = {
  /** A single page's file, or the entry page's of a folder artifact. */
  file: string
  name: string
  path: string
  showMe: boolean
  /** An artifact that is a folder: where it is and its pages' file names, the entry first. */
  folder?: { dir: string; pages: string[] }
}

/** The artifact a name points at in a home: the task's own first, then an old one of the same name. */
export async function findArtifact(
  ctx: Ctx,
  home: ArtifactHome,
  name: string,
): Promise<ArtifactFile | null> {
  const named = folderArtifactOf(name)
  const base =
    named !== null
      ? named.name
      : name
          .replace(/\.html$/, "")
          .replace(/^(?:artifacts|design|docs\/(?:artifacts|designs))\//, "")
  return (await artifactFiles(ctx, home)).find((d) => d.name === base) ?? null
}

/** The line in `.git/info/exclude` that keeps a home's artifacts out of git. */
export const EXCLUDE_LINE: Record<ArtifactHome["scope"], string> = {
  task: "/docs/plans/*/artifacts/",
  project: "/docs/artifacts/",
}

/** Keep artifacts out of git on this machine: the line goes into the common git dir's exclude file once. */
export async function excludeArtifacts(
  ctx: Ctx,
  commonDir: string,
  scope: ArtifactHome["scope"],
): Promise<boolean> {
  const line = EXCLUDE_LINE[scope]
  const file = join(commonDir, "info", "exclude")
  const text = (await ctx.fs.exists(file)) ? await ctx.fs.readFile(file) : ""
  if (text.split(/\r?\n/).some((l) => l.trim() === line)) return false
  await ctx.fs.mkdir(join(commonDir, "info"))
  const lead = text === "" || text.endsWith("\n") ? "" : "\n"
  await ctx.fs.writeFile(
    file,
    `${text}${lead}# QualityLayer: artifacts are personal and never shared\n${line}\n`,
  )
  return true
}

/** Write a new artifact from a template; its name is its title until the agent names it. */
export async function createArtifact(
  ...[ctx, home, name, template, purpose, product = null]: [
    ctx: Ctx,
    home: ArtifactHome,
    name: string,
    template: string,
    purpose: string,
    /** The product's tokens and fonts the page starts with; the scaffold's when null. */
    product?: ProductTokens | null,
  ]
): Promise<Result<ArtifactFile>> {
  const base = name.replace(/\.html$/, "")
  if (!ARTIFACT_NAME.test(base))
    return err({
      code: "bad_args",
      message: "artifact names are lower-case letters, digits and dashes",
    })
  const folder = artifactFolder(home)
  const relative = home.scope === "task" ? TASK_ARTIFACTS : PROJECT_ARTIFACTS
  const path = join(folder, `${base}.html`)
  if (await ctx.fs.exists(path))
    return err({
      code: "bad_args",
      message: `${relative}/${base}.html already exists: change it, then run qualitylayer artifact show ${base}`,
    })
  await ctx.fs.mkdir(folder)
  await ctx.fs.writeFile(
    path,
    fillArtifact(withTokens(template, product), titleOfName(base), purpose),
  )
  return ok({ file: `${relative}/${base}.html`, name: base, path, showMe: false })
}

/** `artifact show`: the artifact counts as updated now, with what changed when the agent says it. */
export async function showArtifact(
  ctx: Ctx,
  entry: ArtifactFile,
  changed?: string,
): Promise<{ updated: number }> {
  if (changed !== undefined) {
    const html = await ctx.fs.readFile(entry.path)
    await ctx.fs.writeFile(entry.path, withMeta(html, "ql:changed", changed.trim()))
  }
  const now = ctx.clock.now()
  if (ctx.fs.touch !== undefined) await ctx.fs.touch(entry.path, now)
  return { updated: now }
}

/** The artifacts a document shows: its `artifact` fences and its `ql:artifact <name>` markers. */
export function artifactsInPlan(plan: string): Set<string> {
  const files = new Set<string>()
  const tokens = marked.lexer(plan)
  for (const token of tokens) {
    if (token.type !== "code" || token.lang?.trim() !== "artifact") continue
    const path = token.text.trim()
    if (isArtifactDoc(path)) files.add(path)
  }
  const visible = new Set(
    tokens.filter((token) => token.type === "html").map((token) => token.raw.trim()),
  )
  const lines = plan.split(/\r?\n/)
  for (const marker of parseMarkers(plan).markers) {
    if (marker.name !== "artifact" || !visible.has(lines[marker.line - 1]?.trim() ?? "")) continue
    const reference = parseArtifactReference(marker.args[0] ?? "")
    if (reference) files.add(reference.file)
  }
  return files
}

/** Whether a document's set of artifacts (a Plan's fences and markers) names this artifact. */
export function shownIn(set: Set<string>, entry: ArtifactFile): boolean {
  if (set.has(entry.file)) return true
  // A page stored in the task's old `design/` folder is shown by a marker that names it `artifacts/…`.
  if (
    entry.file.startsWith(`${STORED_TASK_DESIGNS}/`) &&
    set.has(entry.file.replace(`${STORED_TASK_DESIGNS}/`, `${TASK_ARTIFACTS}/`))
  )
    return true
  if (entry.folder === undefined) return false
  if (set.has(`${TASK_ARTIFACTS}/${entry.name}.html`)) return true
  return [...set].some((doc) => {
    const named = folderArtifactOf(doc)
    return named !== null && named.name === entry.name && entry.file.startsWith(`${named.root}/`)
  })
}
