// `plan export`: a task's Plan as a folder anyone can read without QualityLayer. The Plan is copied
// with its pictures beside it and relative Markdown links; each artifact and diagram it
// shows becomes a PNG, and whatever could not be drawn is listed in manifest.json and left as text.
// Nothing is written into the task, so exporting never changes an approval. Drawing is injected
// (`render`): tests use a fake, the CLI the machine's Chrome.

import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { basename, extname, join, posix, relative, resolve } from "node:path"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { artifactMeta } from "./artifact/format.ts"
import { parseArtifactReference } from "./artifact/reference.ts"
import { artifactReferenceRevision, artifactReferenceSource } from "./artifact/reference-source.ts"
import { extractFences } from "./docs/fence-scanner.ts"
import { parseDoc } from "./docs/frontmatter.ts"
import { parseMarkers } from "./docs/markers.ts"
import { NAMES } from "./docs/names.ts"
import { proseLines } from "./docs/rules/types.ts"
import { artifactPath } from "./docs/visuals.ts"
import { approvalCurrent } from "./gate/revision.ts"
import { currentPlanAsset } from "./plan-assets.ts"
import {
  classicMermaid,
  DIAGRAM_SECTION,
  DIAGRAM_WIDTH,
  diagramPage,
  pictureProblem,
} from "./plan-export-picture.ts"
import { isAdopted, ORIGINAL_FILE, originalPath } from "./task/adoption.ts"
import type { Task } from "./task/store.ts"
import { codeEnds } from "./text-boundaries.ts"

export type Approval = "approved-current" | "approved-changed" | "not-approved"
export type AssetStatus = "captured" | "copied" | "missing" | "failed" | "unsupported"
export type ExportedAsset = {
  ref: string
  file?: string
  status: AssetStatus
  reason?: string
  state?: string
  revision?: string
}

/** One page to draw: its HTML and width, and the part of it wanted when the reference names a section. */
export type RenderJob = { html: string; width: number; section?: string }
/** One picture, or the reason there is none, per job and in the jobs' order. */
export type Renderer = (jobs: RenderJob[]) => Promise<(Uint8Array | Error)[]>

export type PlanExportOptions = {
  out: string
  render: Renderer
  /** The Mermaid bundle the App serves (an ES module); asked for only when the Plan holds a diagram. */
  mermaidScript?: () => Promise<string | null>
  /** The App's Geist (base64 woff2), so a diagram is measured and drawn in the App's face. */
  font?: () => Promise<string | null>
}

export type PlanExport = {
  out: string
  files: { name: string; sha256: string }[]
  assets: ExportedAsset[]
  approval: Approval
}

const IMAGE_TYPES = /\.(?:png|jpe?g|gif|webp|svg)$/i
const IMAGE_MAX_BYTES = 25 * 1024 * 1024
const NOT_DRAWN = "not drawn"

const failure = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))
const plain = (text: string): string => text.replace(/\s+/g, " ").trim()
const noBrackets = (text: string): string => plain(text).replace(/[[\]]/g, "")
const safeName = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\.html$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "image"

/** Remove the first local-only caption and its preceding whitespace without rescanning that run. */
function withoutLocalNotice(text: string): string {
  let start = -1
  let end = -1
  for (const sentence of [
    "Shown in QualityLayer, on the author's Mac only",
    "Shown in QualityLayer, on the author’s Mac only",
  ]) {
    const found = text.indexOf(sentence)
    if (found >= 0 && (start < 0 || found < start)) {
      start = found
      end = found + sentence.length
    }
  }
  if (start < 0) return text
  while (start > 0 && /\s/.test(text[start - 1] ?? "")) start--
  if (text[end] === ".") end++
  return text.slice(0, start) + text.slice(end)
}
type InlineImage = { start: number; end: number; alt: string; target: string; title: string }

/**
 * The inline image syntax this exporter supports, with exact source titles and offsets. Boundary
 * tables are built once per delimiter kind, so nested malformed starts never rescan the same tail.
 */
function inlineImages(text: string): InlineImage[] {
  const stops = {
    alt: (char: string) => char === "]",
    angle: (char: string) => char === ">",
    single: (char: string) => char === "'",
    double: (char: string) => char === '"',
    space: (char: string) => !/\s/.test(char),
    target: (char: string) => char === ")" || /\s/.test(char),
  }
  const tables = new Map<keyof typeof stops, Uint32Array>()
  const endAt = (kind: keyof typeof stops, from: number): number => {
    let table = tables.get(kind)
    if (!table) {
      table = new Uint32Array(text.length + 1)
      table[text.length] = text.length
      for (let at = text.length - 1; at >= 0; at--)
        table[at] = stops[kind](text[at] ?? "") ? at : (table[at + 1] ?? text.length)
      tables.set(kind, table)
    }
    return table[from] ?? text.length
  }
  const tail = (from: number): { end: number; title: string } | null => {
    const afterSpace = endAt("space", from)
    if (text[afterSpace] === ")") return { end: afterSpace + 1, title: "" }
    if (afterSpace === from) return null
    const quote = text[afterSpace]
    if (quote !== '"' && quote !== "'") return null
    const close = endAt(quote === '"' ? "double" : "single", afterSpace + 1)
    if (close === text.length) return null
    const end = endAt("space", close + 1)
    return text[end] === ")" ? { end: end + 1, title: text.slice(from, close + 1) } : null
  }
  const code = codeEnds(text)
  const images: InlineImage[] = []
  for (let at = 0; at < text.length; ) {
    const codeEnd = code.get(at)
    if (codeEnd !== undefined) {
      at = codeEnd
      continue
    }
    if (text[at] !== "!" || text[at + 1] !== "[") {
      at++
      continue
    }
    const bracket = endAt("alt", at + 2)
    const start = endAt("space", bracket + 2)
    if (text[bracket + 1] !== "(" || start === text.length) {
      at += 2
      continue
    }
    const angle = text[start] === "<" ? endAt("angle", start + 1) : text.length
    let targetEnd = angle < text.length ? angle + 1 : start
    let ending = targetEnd > start ? tail(targetEnd) : null
    if (ending === null) {
      targetEnd = endAt("target", start)
      ending = targetEnd > start ? tail(targetEnd) : null
    }
    if (ending === null) {
      at += 2
      continue
    }
    images.push({
      start: at,
      end: ending.end,
      alt: text.slice(at + 2, bracket),
      target: text.slice(start, targetEnd),
      title: ending.title,
    })
    at = ending.end
  }
  return images
}

/** A picture to draw: what it stands for, the file it will be, and the job that draws it (absent when it cannot be built). */
type Shot = { asset: ExportedAsset; file: string; title: string; job?: RenderJob }
/** Lines [from, to) of the Plan, replaced by what `lines` returns once every picture is settled. */
type Edit = { from: number; to: number; lines: () => string[] }

class Exporter {
  readonly files = new Map<string, string | Uint8Array>()
  readonly assets: ExportedAsset[] = []
  readonly edits: Edit[] = []
  private readonly taken = new Set<string>()
  private readonly shots = new Map<string, Shot>()
  private readonly images = new Map<string, ExportedAsset>()
  private mermaid: Promise<string | null> | undefined
  private font: Promise<string | null> | undefined
  /** Whether the Plan on disk is the approved one: a picture's caption says when it is not. */
  approval: Approval = "not-approved"

  constructor(
    private readonly ctx: Ctx,
    private readonly task: Task,
    private readonly options: PlanExportOptions,
  ) {}

  /** A name under assets/ that nothing else has. */
  private claim(base: string, extension: string): string {
    let name = `${base}${extension}`
    for (let n = 2; this.taken.has(name); n++) name = `${base}-${n}${extension}`
    this.taken.add(name)
    return `assets/${name}`
  }

  private record(asset: ExportedAsset): ExportedAsset {
    this.assets.push(asset)
    return asset
  }

  /** An asset the export could not use, with the reason. */
  refuse(ref: string, status: AssetStatus, reason: string): void {
    this.record({ ref, status, reason })
  }

  /** An artifact reference, drawn once however often the Plan shows it. */
  async artifact(ref: string): Promise<Shot> {
    const known = this.shots.get(ref)
    if (known !== undefined) return known
    const reference = parseArtifactReference(ref)
    const state = reference?.section ? `#${reference.section}` : "default view"
    const asset = this.record({ ref, status: "failed", reason: NOT_DRAWN, state })
    const shot: Shot = {
      asset,
      title: ref,
      file: this.claim(safeName(reference?.key ?? ref), ".png"),
    }
    this.shots.set(ref, shot)
    if (reference === null) {
      Object.assign(asset, { status: "unsupported", reason: "not a supported local artifact path" })
      return shot
    }
    const home = { taskDir: this.task.dir, repoRoot: this.task.repoRoot }
    try {
      const source = await artifactReferenceSource(this.ctx, home, reference)
      const meta = artifactMeta(source.html, reference.key)
      shot.title = meta.title
      shot.job = {
        html: source.html,
        width: meta.width ?? 1280,
        ...(reference.section !== undefined ? { section: reference.section } : {}),
      }
      const revision = await artifactReferenceRevision(this.ctx, home, reference).catch(() => null)
      if (revision !== null) asset.revision = revision
      // The Plan's own picture of this exact source revision (plan draft) is the one to ship.
      const own = await currentPlanAsset(this.ctx, this.task, ref).catch(() => null)
      const bytes =
        own !== null
          ? await (this.ctx.fs.readRegularFile
              ? this.ctx.fs.readRegularFile(join(this.task.dir, own.file), IMAGE_MAX_BYTES)
              : this.ctx.fs.readBytes?.(join(this.task.dir, own.file))
            )?.catch(() => undefined)
          : undefined
      if (bytes !== undefined && pictureProblem(bytes) === null) {
        Object.assign(asset, { status: "copied", file: shot.file })
        delete asset.reason
        this.files.set(shot.file, bytes)
        delete shot.job
      }
    } catch (cause) {
      const reason = failure(cause)
      Object.assign(asset, { status: /does not exist/.test(reason) ? "missing" : "failed", reason })
    }
    return shot
  }

  /** A picture of Mermaid source: `diagram-<n>` for a fence. */
  async diagram(ref: string, source: string): Promise<Shot> {
    const asset = this.record({ ref, status: "failed", reason: NOT_DRAWN })
    const shot: Shot = { asset, title: ref, file: this.claim(ref, ".png") }
    // An artifact name never holds a colon, so the two kinds of key cannot meet.
    this.shots.set(`diagram:${ref}`, shot)
    this.mermaid ??= (this.options.mermaidScript?.() ?? Promise.resolve(null)).then(
      (script) => (script === null ? null : classicMermaid(script)),
      () => null,
    )
    this.font ??= (this.options.font?.() ?? Promise.resolve(null)).catch(() => null)
    const script = await this.mermaid
    if (script === null)
      asset.reason = "the Mermaid bundle the App serves was not found or has an unexpected shape"
    else
      shot.job = {
        html: diagramPage(source, script, await this.font),
        width: DIAGRAM_WIDTH,
        section: DIAGRAM_SECTION,
      }
    return shot
  }

  /** Draw every job with one call to the renderer; a picture is kept only when it is a PNG with something in it. */
  async draw(): Promise<void> {
    const pending = [...this.shots.values()].filter((shot) => shot.job !== undefined)
    if (pending.length === 0) return
    let pictures: (Uint8Array | Error)[]
    try {
      pictures = await this.options.render(pending.map((shot) => shot.job as RenderJob))
    } catch (cause) {
      pictures = pending.map(() => new Error(failure(cause)))
    }
    pending.forEach((shot, index) => {
      const picture = pictures[index] ?? new Error("the renderer returned no picture")
      const problem = picture instanceof Error ? picture.message : pictureProblem(picture)
      if (problem !== null || picture instanceof Error) {
        shot.asset.reason = problem ?? "no picture"
        return
      }
      Object.assign(shot.asset, { status: "captured", file: shot.file })
      delete shot.asset.reason
      this.files.set(shot.file, picture)
    })
  }

  /** A Markdown image copied into assets/ (its new path), or null with the reason recorded. */
  async image(target: string): Promise<string | null> {
    const known = this.images.get(target)
    if (known !== undefined) return known.file ?? null
    const asset = this.record({ ref: target, status: "unsupported" })
    this.images.set(target, asset)
    const refuse = (reason: string, status: AssetStatus = "unsupported") => {
      Object.assign(asset, { status, reason })
      return null
    }
    let written = target.replace(/^<|>$/g, "")
    try {
      written = decodeURI(written)
    } catch {}
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(written))
      return refuse("a web, data or drive address is not fetched or copied")
    if (/^[/\\]/.test(written))
      return refuse("an absolute path is not copied; only images inside the task folder are")
    const clean = posix.normalize(written.replaceAll("\\", "/"))
    if (clean === ".." || clean.startsWith("../"))
      return refuse("the image is outside the task folder")
    if (!IMAGE_TYPES.test(clean))
      return refuse("not an image type (png, jpg, jpeg, gif, webp, svg)")
    const parts = clean.split("/")
    let at = this.task.dir
    for (const [index, part] of parts.entries()) {
      at = join(at, part)
      const entry = await this.ctx.fs.lstat?.(at)
      if (entry === null) return refuse("the file does not exist", "missing")
      if (entry === undefined) return refuse("the file system cannot check for symbolic links")
      if (entry.kind === "symlink") return refuse("a symbolic link is not copied")
      if (entry.kind !== (index === parts.length - 1 ? "file" : "directory"))
        return refuse("the path is not a regular file")
    }
    try {
      const bytes = this.ctx.fs.readRegularFile
        ? await this.ctx.fs.readRegularFile(at, IMAGE_MAX_BYTES)
        : await this.ctx.fs.readBytes?.(at)
      if (bytes === undefined) return refuse("the file system cannot read image bytes", "failed")
      const extension = extname(clean).toLowerCase()
      const file = this.claim(safeName(basename(clean, extname(clean))), extension)
      this.files.set(file, bytes)
      Object.assign(asset, { status: "copied", file })
    } catch (cause) {
      return refuse(failure(cause), "failed")
    }
    return asset.file ?? null
  }
}

/** The Plan for reading outside QualityLayer: pictures instead of live blocks, relative links. */
async function transform(plan: string, exporter: Exporter): Promise<string> {
  const lines = plan.split("\n")
  const cr = lines[0]?.endsWith("\r") ? "\r" : ""
  const indentOf = (index: number) => /^[ \t]*/.exec(lines[index] ?? "")?.[0] ?? ""

  // An artifact block becomes its picture and caption; one that could not be drawn stays as written, with the reason after it.
  const artifactBlock = async (ref: string, from: number, to: number, fallback: string) => {
    const shot = await exporter.artifact(ref)
    const indent = indentOf(from)
    exporter.edits.push({
      from,
      to,
      lines: () => {
        if (shot.asset.status !== "captured" && shot.asset.status !== "copied")
          return [
            ...lines.slice(from, to).map((line) => line.replace(/\r$/, "")),
            `${indent}*Artifact ${ref} could not be captured: ${plain(shot.asset.reason ?? "no picture").replace(/\.$/, "")}.*`,
          ]
        const title = plain(shot.title).replace(/\.$/, "")
        // QualityLayer's own text, without its in-task picture link: the export links its own copy.
        const kept = withoutLocalNotice(fallback)
          .replace(/^[ \t]*!\[[^\]]*\]\([^)]*\)[ \t]*$/gm, "")
          .trim()
        return [
          `${indent}![${noBrackets(title)}](${shot.file})`,
          "",
          `${indent}*${title} — captured state: ${shot.asset.state}${
            exporter.approval === "approved-current"
              ? ""
              : exporter.approval === "approved-changed"
                ? "; the current version, which differs from the approved Plan"
                : "; the current draft, not approved yet"
          }. Behaviour is described in the Plan text.*`,
          ...(kept === "" ? [] : ["", ...kept.split("\n").map((line) => `${indent}${line}`)]),
        ]
      },
    })
  }
  const markers = parseMarkers(plan).markers.filter((marker) => marker.name === "artifact")
  for (const marker of markers)
    await artifactBlock(marker.args[0] ?? "", marker.line - 1, marker.endLine, marker.fallback)

  let diagrams = 0
  for (const fence of extractFences(plan)) {
    const from = fence.line - 1
    const indent = indentOf(from)
    if (fence.kind === "artifact") {
      const path = artifactPath(fence)
      if ("error" in path) {
        exporter.refuse(fence.body.trim(), "unsupported", path.error)
        exporter.edits.push({
          from,
          to: fence.endLine,
          lines: () => [
            ...lines.slice(from, fence.endLine).map((line) => line.replace(/\r$/, "")),
            `${indent}*Artifact ${fence.body.trim()} could not be captured: ${path.error}.*`,
          ],
        })
      } else await artifactBlock(path.path, from, fence.endLine, "")
    } else if (fence.kind === "mermaid") {
      const n = ++diagrams
      const shot = await exporter.diagram(`diagram-${n}`, fence.body)
      exporter.edits.push({
        from: fence.endLine,
        to: fence.endLine,
        lines: () =>
          shot.asset.status === "captured"
            ? ["", `${indent}![Diagram ${n}](${shot.file})`, ""]
            : [],
      })
    }
  }

  // Images in the prose. An artifact block is replaced whole, so what is inside it is not read.
  for (const { text, line } of proseLines(plan)) {
    if (!text.includes("![") || markers.some((m) => line >= m.line && line <= m.endLine)) continue
    const parts: string[] = []
    let from = 0
    for (const image of inlineImages(text)) {
      const copied = await exporter.image(image.target)
      if (copied === null) continue
      parts.push(text.slice(from, image.start), `![${image.alt}](${copied}${image.title})`)
      from = image.end
    }
    if (from === 0) continue
    parts.push(text.slice(from))
    exporter.edits.push({ from: line - 1, to: line, lines: () => [parts.join("")] })
  }

  await exporter.draw()
  const body = [...lines]
  // Last block first, so earlier line numbers stay true; at one line, the replacement before the insertion at its start.
  const edits = [...exporter.edits].sort((a, b) => b.from - a.from || b.to - a.to)
  for (const edit of edits)
    body.splice(
      edit.from,
      edit.to - edit.from,
      ...edit
        .lines()
        .map((line) => (line === "" && cr === "" ? line : `${line.replace(/\r$/, "")}${cr}`)),
    )
  return body.join("\n")
}

const sha256 = (content: string | Uint8Array): string =>
  createHash("sha256")
    .update(content as string)
    .digest("hex")

/** Export a task's Plan into `options.out`: a folder that does not exist yet, or an empty one. */
export async function exportPlan(
  ctx: Ctx,
  task: Task,
  options: PlanExportOptions,
): Promise<Result<PlanExport>> {
  const planPath = join(task.dir, NAMES.plan)
  if (!(await ctx.fs.exists(planPath)))
    return err({ code: "bad_args", message: `The task has no Plan yet (${NAMES.plan}).` })
  const root = resolve(ctx.env.cwd(), options.out)
  const inTask = relative(task.dir, root)
  if (inTask === "" || !(inTask.startsWith("..") || resolve(inTask) === inTask))
    return err({
      code: "bad_args",
      message: "Choose a folder outside the task folder; exporting never writes into the task.",
    })
  try {
    if (!ctx.fs.lstat || !ctx.fs.assertSafeDirectory)
      throw new Error("Safe filesystem checks are unavailable")
    await ctx.fs.assertSafeDirectory(root)
    const existing = await ctx.fs.lstat(root)
    if (
      existing !== null &&
      (existing.kind !== "directory" || (await ctx.fs.readdir(root)).length > 0)
    )
      return err({
        code: "bad_args",
        message: "The output folder is not empty; choose a new folder",
      })
  } catch {
    return err({
      code: "open_failed",
      message:
        "Could not use the output folder. Use a directory whose ancestry is protected from other users and contains no symbolic links.",
    })
  }

  const plan = await ctx.fs.readFile(planPath)
  const approval: Approval = (await approvalCurrent(ctx, task, NAMES.plan))
    ? "approved-current"
    : parseDoc(plan).frontmatter?.approved === true
      ? "approved-changed"
      : "not-approved"
  const exporter = new Exporter(ctx, task, options)
  exporter.approval = approval
  const written = new Map<string, string | Uint8Array>([
    [NAMES.plan, await transform(plan, exporter)],
  ])
  if (isAdopted(task) && (await ctx.fs.exists(originalPath(task))))
    written.set(ORIGINAL_FILE, await ctx.fs.readFile(originalPath(task)))
  for (const [name, content] of exporter.files) written.set(name, content)

  const files = [...written].map(([name, content]) => ({ name, sha256: sha256(content) }))
  // Complete means every referenced asset is in the folder: a link refused for safety (outside the
  // task, a symbolic link, a web address) is reported with its reason and also leaves it incomplete.
  const unfinished = exporter.assets.filter(
    (a) => a.status === "missing" || a.status === "failed" || a.status === "unsupported",
  )
  const manifest = {
    plan: NAMES.plan,
    task: task.slug,
    approval,
    complete: unfinished.length === 0,
    files,
    assets: exporter.assets,
  }
  try {
    await ctx.fs.mkdir(root, { mode: 0o700 })
    await ctx.fs.assertSafeDirectory(root)
    if (exporter.files.size > 0) {
      await ctx.fs.mkdir(join(root, "assets"), { mode: 0o700 })
      await ctx.fs.assertSafeDirectory(join(root, "assets"))
    }
    for (const [name, content] of written) {
      if (typeof content === "string")
        await ctx.fs.writeFile(join(root, name), content, { mode: 0o600, exclusive: true })
      else await writeFile(join(root, name), content, { flag: "wx", mode: 0o600 })
    }
    await ctx.fs.writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
      exclusive: true,
    })
  } catch {
    // Nothing is removed on failure: another writer may have changed the folder.
    return err({
      code: "open_failed",
      message:
        "Could not write the export. Earlier files were preserved; an incomplete folder may remain.",
    })
  }
  if (unfinished.length > 0)
    return err({
      code: "bad_args",
      message: `Exported with ${unfinished.length} assets not packaged: ${unfinished
        .map((a) => `${a.ref} (${a.status}: ${a.reason})`)
        .join(", ")}. See ${join(root, "manifest.json")}.`,
    })
  return ok({ out: root, files, assets: exporter.assets, approval })
}
