// Where artifacts live and what the App lists of them: a task's `artifacts/` (and an old task's mockups and
// show-me pages under `artifacts/`), and the project's `docs/artifacts/` for artifact work outside a
// task. Artifacts are personal: the folders go into the repository's `.git/info/exclude` when they are
// made, and comments on a project's artifacts live in QualityLayer's own folder, never the repository.

import { createHash, randomUUID } from "node:crypto"
import { lstatSync } from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { marked } from "marked"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { filesIn } from "../../files.ts"
import { parseMarkers } from "../docs/markers.ts"
import { type AnchoredRoot, openRegisteredRoot } from "../filesystem/anchored-root.ts"
import { type Comment, isArtifactDoc } from "../gate/comments.ts"
import { projectRuntimeDir } from "../paths.ts"
import type { RecordOwner } from "../records/contract.ts"
import { readRecordProject } from "../records/files.ts"
import {
  ARTIFACT_FOLDER_MAX_FILES,
  ARTIFACT_NAME,
  ARTIFACT_PAGE_NAME,
  type Artifact,
  type ArtifactMeta,
  type ArtifactPageInfo,
  artifactMeta,
  type DraftOn,
  draftOnFrom,
  fillArtifact,
  folderArtifactOf,
  LASTING_CONFIG,
  LASTING_CONFIG_MAX_BYTES,
  metaContent,
  PROJECT_ARTIFACTS,
  parseDraftOn,
  SHOW_ME_PAGES,
  STORED_LASTING_CONFIG,
  STORED_PROJECT_DESIGNS,
  STORED_TASK_DESIGNS,
  TASK_ARTIFACTS,
  titleOfName,
  withMeta,
} from "./format.ts"
import { parseArtifactReference } from "./reference.ts"
import { type ProductTokens, withTokens } from "./tokens.ts"
import { worktreePointer } from "./worktree-pointer.ts"

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

async function htmlNames(ctx: Ctx, dir: string): Promise<string[]> {
  if (!(await ctx.fs.exists(dir))) return []
  try {
    return (await filesIn(ctx.fs, dir))
      .filter((n) => n.endsWith(".html") && ARTIFACT_NAME.test(n.slice(0, -5)))
      .sort()
  } catch {
    return []
  }
}

/** The pages of a folder artifact's top level, the entry (`artifact.json`'s, else `index.html`) first. */
async function folderPages(ctx: Ctx, dir: string): Promise<string[]> {
  let top: Awaited<ReturnType<Ctx["fs"]["entries"]>>
  try {
    top = await ctx.fs.entries(dir)
  } catch {
    return []
  }
  const pages = top
    .filter((e) => e.kind === "file" && ARTIFACT_PAGE_NAME.test(e.name))
    .map((e) => e.name)
    .sort()
  if (pages.length === 0) return []
  let entry = pages.includes("index.html") ? "index.html" : (pages[0] as string)
  const config =
    top.find((e) => e.kind === "file" && e.name === LASTING_CONFIG) ??
    top.find((e) => e.kind === "file" && e.name === STORED_LASTING_CONFIG)
  if (config !== undefined) {
    try {
      const named = (
        JSON.parse(await ctx.fs.readFile(join(dir, config.name))) as { entry?: unknown }
      ).entry
      if (typeof named === "string" && pages.includes(named)) entry = named
    } catch {
      // an artifact.json that does not read leaves the default entry
    }
  }
  return [entry, ...pages.filter((n) => n !== entry)]
}

/** Every artifact file of a home: a task's `artifacts/` (its show-me pages last), or the project's. */
export async function artifactFiles(ctx: Ctx, home: ArtifactHome): Promise<ArtifactFile[]> {
  const listed = async (base: string, folder: string, showMe: boolean) => {
    const singles: ArtifactFile[] = (await htmlNames(ctx, join(base, folder)))
      .filter((n) => n.startsWith("show-me-") === showMe)
      .map((n) => ({
        file: `${folder}/${n}`,
        name: n.slice(0, -5),
        path: join(base, folder, n),
        showMe,
      }))
    if (showMe) return singles
    // An artifact can also be a folder one level down; a single page of the same name wins.
    const folders: ArtifactFile[] = []
    let inside: Awaited<ReturnType<Ctx["fs"]["entries"]>> = []
    try {
      inside = (await ctx.fs.exists(join(base, folder)))
        ? await ctx.fs.entries(join(base, folder))
        : []
    } catch {
      inside = []
    }
    for (const entry of inside) {
      if (entry.kind !== "directory" || !ARTIFACT_NAME.test(entry.name)) continue
      if (singles.some((s) => s.name === entry.name)) continue
      const dir = join(base, folder, entry.name)
      const pages = await folderPages(ctx, dir)
      const first = pages[0]
      if (first === undefined) continue
      folders.push({
        file: `${folder}/${entry.name}/${first}`,
        name: entry.name,
        path: join(dir, first),
        showMe: false,
        folder: { dir, pages },
      })
    }
    return [...singles, ...folders].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }
  // Designs stored before the rename list as artifacts too; an artifact of the same name wins.
  const withStored = async (current: ArtifactFile[], base: string, stored: string) => {
    const names = new Set(current.map((a) => a.name))
    return [...current, ...(await listed(base, stored, false)).filter((a) => !names.has(a.name))]
  }
  if (home.scope === "project")
    return withStored(
      await listed(home.root, PROJECT_ARTIFACTS, false),
      home.root,
      STORED_PROJECT_DESIGNS,
    )
  return [
    ...(await withStored(
      await listed(home.dir, TASK_ARTIFACTS, false),
      home.dir,
      STORED_TASK_DESIGNS,
    )),
    ...(await listed(home.dir, SHOW_ME_PAGES, true)),
  ]
}

/** A folder artifact's files together: the newest change and the total size, for what depends on them all. */
export async function folderStats(
  ctx: Ctx,
  dir: string,
): Promise<{ mtimeMs: number; size: number; revision: string } | null> {
  if (ctx.fs.stat === undefined) return null
  let mtimeMs = 0
  let size = 0
  let count = 0
  const stamps: string[] = []
  const walk = async (at: string): Promise<boolean> => {
    for (const entry of await ctx.fs.entries(at)) {
      if (entry.name.startsWith(".")) continue
      const path = join(at, entry.name)
      if (entry.kind === "directory") {
        if (!(await walk(path))) return false
      } else if (entry.kind === "file") {
        const seen = await ctx.fs.stat?.(path)
        if (seen === null || seen === undefined) continue
        mtimeMs = Math.max(mtimeMs, seen.mtimeMs)
        size += seen.size
        stamps.push(`${path.slice(dir.length + 1)}\0${seen.mtimeMs}\0${seen.size}`)
        if (++count > ARTIFACT_FOLDER_MAX_FILES) return false
      }
    }
    return true
  }
  try {
    await walk(dir)
  } catch {
    return null
  }
  return {
    mtimeMs,
    size,
    revision: createHash("sha256").update(stamps.sort().join("\n")).digest("hex"),
  }
}

/** What an artifact's file says, read again only when the file changed. */
const known = new Map<
  string,
  { mtime: number; size: number; meta: ArtifactMeta; draftMeta: string | null }
>()
const KNOWN_KEPT = 400

async function readArtifact(
  ctx: Ctx,
  entry: ArtifactFile,
): Promise<{ meta: ArtifactMeta; updated: number; size: number; draftMeta: string | null } | null> {
  const stat = ctx.fs.stat !== undefined ? await ctx.fs.stat(entry.path) : null
  if (stat === null && ctx.fs.stat !== undefined) return null
  const hit = known.get(entry.path)
  if (stat !== null && hit !== undefined && hit.mtime === stat.mtimeMs && hit.size === stat.size)
    return {
      meta: hit.meta,
      updated: stat.mtimeMs,
      size: stat.size,
      draftMeta: hit.draftMeta,
    }
  let html: string
  try {
    html = await ctx.fs.readFile(entry.path)
  } catch {
    return null
  }
  const meta = showMeMeta(entry, artifactMeta(html, entry.name))
  const draftMeta = metaContent(html, "ql:draft-on")
  if (stat !== null) {
    if (known.size >= KNOWN_KEPT) known.delete(known.keys().next().value as string)
    known.set(entry.path, { mtime: stat.mtimeMs, size: stat.size, meta, draftMeta })
  }
  return { meta, updated: stat?.mtimeMs ?? 0, size: stat?.size ?? html.length, draftMeta }
}

/** What a folder draft's `artifact.json` says it was copied from; null for a folder that says nothing. */
async function folderDraftOn(ctx: Ctx, dir: string): Promise<DraftOn | null> {
  const path = join(
    dir,
    (await ctx.fs.exists(join(dir, LASTING_CONFIG))) ? LASTING_CONFIG : STORED_LASTING_CONFIG,
  )
  try {
    const seen = await ctx.fs.stat?.(path)
    if (seen === null || (seen !== undefined && seen.size > LASTING_CONFIG_MAX_BYTES)) return null
    const raw = JSON.parse(await ctx.fs.readFile(path)) as { draftOn?: unknown }
    return draftOnFrom(raw.draftOn)
  } catch {
    return null
  }
}

/** A show-me page without a title of its own is titled by its question. */
function showMeMeta(entry: ArtifactFile, meta: ArtifactMeta): ArtifactMeta {
  if (!entry.showMe) return meta
  const untitled =
    meta.title === "" || meta.title === titleOfName(entry.name) || meta.title === entry.name
  return untitled
    ? { ...meta, title: `Show me: ${entry.name.slice("show-me-".length).replaceAll("-", " ")}` }
    : meta
}

/** The artifacts a document shows: its `artifact` fences and its `ql:artifact <name>` markers. */
export function artifactsInPlan(plan: string): Set<string> {
  const files = new Set<string>()
  for (const token of marked.lexer(plan)) {
    if (token.type !== "code" || token.lang?.trim() !== "artifact") continue
    const path = token.text.trim()
    if (isArtifactDoc(path)) files.add(path)
  }
  const visible = new Set(
    marked
      .lexer(plan)
      .filter((token) => token.type === "html")
      .map((token) => token.raw.trim()),
  )
  for (const marker of parseMarkers(plan).markers)
    if (
      marker.name === "artifact" &&
      visible.has(plan.split(/\r?\n/)[marker.line - 1]?.trim() ?? "")
    ) {
      const reference = parseArtifactReference(marker.args[0] ?? "")
      if (reference) files.add(reference.file)
    }
  return files
}

export type ListOptions = {
  /** Every comment of the home (the task's store, or the project's artifacts folder). */
  comments: Comment[]
  /** The Plan's text, for "Shown in the Plan". */
  plan?: string
  /**
   * The thumbnail's key for an artifact's file as it is now, or null while there is none. A folder
   * artifact asks once per page (`page` is its file name), with the folder's newest change and size:
   * a page is drawn from everything it packs.
   */
  thumb?: (entry: ArtifactFile, updated: number, size: number, page?: string) => string | null
}

/** Whether a document's set of artifacts (a Plan's fences and markers) names this artifact. */
function shownIn(set: Set<string>, entry: ArtifactFile): boolean {
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

/** A home's artifacts, newest first, with what the App shows of each. */
export async function listArtifacts(
  ctx: Ctx,
  home: ArtifactHome,
  options: ListOptions,
): Promise<Artifact[]> {
  const shownInPlan = artifactsInPlan(options.plan ?? "")
  const open = new Map<string, number>()
  // A comment on any page of a folder artifact counts for the artifact.
  const openIn = new Map<string, number>()
  for (const c of options.comments) {
    if (!isArtifactDoc(c.doc) || c.resolved !== undefined) continue
    open.set(c.doc, (open.get(c.doc) ?? 0) + 1)
    const named = folderArtifactOf(c.doc)
    if (named !== null) {
      const key = `${named.root}/${named.name}`
      openIn.set(key, (openIn.get(key) ?? 0) + 1)
    }
  }
  const artifacts: Artifact[] = []
  for (const entry of await artifactFiles(ctx, home)) {
    const read = await readArtifact(ctx, entry)
    if (read === null) continue
    let { updated, size } = read
    let pages: ArtifactPageInfo[] | undefined
    let revision: string | undefined
    let comments = open.get(entry.file) ?? 0
    if (entry.folder !== undefined) {
      const together = await folderStats(ctx, entry.folder.dir)
      if (together !== null) {
        updated = Math.max(updated, together.mtimeMs)
        size = together.size
        revision = together.revision
      }
      const parent = entry.file.slice(0, entry.file.lastIndexOf("/"))
      comments = openIn.get(parent) ?? 0
      pages = []
      for (const name of entry.folder.pages) {
        const file = `${parent}/${name}`
        const page =
          file === entry.file
            ? read
            : await readArtifact(ctx, { ...entry, file, path: join(entry.folder.dir, name) })
        pages.push({
          file,
          page: name,
          title: page?.meta.title ?? titleOfName(name),
          thumb: options.thumb?.(entry, updated, size, name) ?? null,
          ...(page?.meta.group ? { group: page.meta.group } : {}),
          ...(page?.meta.group && page.meta.groupFolded ? { groupFolded: true as const } : {}),
        })
      }
    }
    // What a draft was copied from: its folder's artifact.json, or a single page's meta tag.
    const fromMeta = read.draftMeta === null ? null : parseDraftOn(read.draftMeta)
    const draftOn =
      entry.folder !== undefined ? await folderDraftOn(ctx, entry.folder.dir) : fromMeta
    artifacts.push({
      file: entry.file,
      name: entry.name,
      scope: home.scope,
      ...read.meta,
      ...(draftOn !== null ? { draftOn } : {}),
      updated,
      ...(revision === undefined ? {} : { revision }),
      ...(entry.showMe ? { showMe: true as const } : {}),
      thumb:
        pages !== undefined
          ? (pages[0]?.thumb ?? null)
          : (options.thumb?.(entry, updated, size) ?? null),
      comments,
      ...(pages !== undefined ? { pages } : {}),
      ...(shownIn(shownInPlan, entry) ? { inPlan: true as const } : {}),
    })
  }
  return artifacts.sort((a, b) => b.updated - a.updated || a.name.localeCompare(b.name))
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

const ARTIFACT_STAGE_EXCLUDES = [
  "/docs/.ql-record-stage-*/",
  "/.qualitylayer/.ql-record-stage-*/",
] as const

async function stageGitDirectory(project: AnchoredRoot, root: string, commonDir: string) {
  if (commonDir === join(root, ".git")) return project.directory(".git")
  const marker = project.read(".git", 4096)
  const found = marker && worktreePointer(new TextDecoder("utf8", { fatal: true }).decode(marker))
  if (!found) throw new Error("Registered worktree Git pointer is invalid")
  const admin = resolve(root, found)
  const common = await openRegisteredRoot(commonDir, async () => project.assertCurrentRoot())
  try {
    const scope = relative(commonDir, admin)
    if (isAbsolute(scope) || scope === ".." || scope.startsWith(`..${sep}`))
      throw new Error("Worktree Git directory escaped its registered common directory")
    if (scope) {
      const held = common.directory(scope.split(sep).join("/"))
      try {
        const commonPointer = held.read("commondir", 4096),
          back = held.read("gitdir", 4096)
        if (
          !commonPointer ||
          !back ||
          resolve(admin, new TextDecoder().decode(commonPointer).trim()) !== commonDir ||
          resolve(admin, new TextDecoder().decode(back).trim()) !== join(root, ".git")
        )
          throw new Error("Registered worktree Git backlinks changed")
      } finally {
        held.close()
      }
    }
    return common
  } catch (cause) {
    common.close()
    throw cause
  }
}

/** Establish the fixed private transaction namespace before any artifact payload is staged. */
export async function prepareArtifactStage(ctx: Ctx, owner: RecordOwner, project: AnchoredRoot) {
  if (owner.address.kind !== "artifact")
    throw new Error("Artifact stages require a standalone owner")
  const root = owner.address.root
  const registration = JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(
      await readRecordProject(ctx, owner.address.projectId),
    ),
  ) as { id?: unknown; paths?: unknown; commonDir?: unknown }
  if (
    registration.id !== owner.address.projectId ||
    !Array.isArray(registration.paths) ||
    !registration.paths.includes(root)
  )
    throw new Error("Artifact staging owner is not registered")
  const commonDir = registration.commonDir
  if (typeof commonDir !== "string" || !isAbsolute(commonDir) || resolve(commonDir) !== commonDir)
    throw new Error("Registered Git common directory is unavailable")
  const [top, common] = await Promise.all([ctx.git.topLevel(root), ctx.git.commonDir(root)])
  if (top !== root || common !== commonDir)
    throw new Error("Registered artifact repository changed")
  project.assertCurrentRoot()
  const metadata = await stageGitDirectory(project, root, commonDir)
  try {
    if (!metadata.tryLock("info/qualitylayer-artifact-stages.lock"))
      throw new Error("Artifact staging exclude is busy")
    const original = metadata.read("info/exclude", 1024 * 1024) ?? new Uint8Array()
    const lines = new TextDecoder().decode(original).split(/\r?\n/)
    const missing = ARTIFACT_STAGE_EXCLUDES.filter((line) => !lines.includes(line))
    if (missing.length) {
      const suffix = `${original.length && original[original.length - 1] !== 10 ? "\n" : ""}# QualityLayer private artifact transactions\n${missing.join("\n")}\n`
      const updated = Buffer.concat([original, new TextEncoder().encode(suffix)])
      if (updated.length > 1024 * 1024)
        throw new Error("Artifact staging exclude exceeds its supported bound")
      metadata.write("info/exclude", updated, true)
      const saved = metadata.read("info/exclude", 1024 * 1024)
      if (!saved || !Buffer.from(saved).equals(updated))
        throw new Error("Artifact staging exclude changed during write")
    }
    metadata.assertCurrentRoot()
    project.assertCurrentRoot()
  } finally {
    metadata.close()
  }
  const stage = `${owner.address.file.startsWith(".qualitylayer/") ? ".qualitylayer" : "docs"}/.ql-record-stage-${randomUUID()}`
  project.write(`${stage}/.gitignore`, new TextEncoder().encode("*\n"), false)
  const marker = project.snapshot(`${stage}/.gitignore`, 16)
  try {
    const ignored = await ctx.git.run(root, [
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "check-ignore",
      "--no-index",
      "--quiet",
      "--",
      `${stage}/0`,
    ])
    if (ignored.code !== 0) throw new Error("Private artifact staging is not excluded from Git")
    project.assertCurrentRoot()
    return stage
  } catch (cause) {
    const current = project.snapshot(`${stage}/.gitignore`, 16)
    if (
      marker &&
      current?.identity === marker.identity &&
      Buffer.from(current.bytes).toString() === "*\n"
    ) {
      project.unlinkFile(`${stage}/.gitignore`)
      try {
        project.removeEmptyDirectory(stage)
      } catch (cleanup) {
        throw new AggregateError(
          [cause, cleanup],
          "Artifact staging failed; temporary namespace retained",
        )
      }
    }
    throw cause
  }
}

/** Write a new artifact from a template; its name is its title until the agent names it. */
export async function createArtifact(
  ctx: Ctx,
  home: ArtifactHome,
  name: string,
  template: string,
  purpose: string,
  /** The product's tokens and fonts the page starts with; the scaffold's when null. */
  product: ProductTokens | null = null,
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
