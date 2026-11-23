// `plan export`: a task's Plan as a folder anyone can read without QualityLayer. The Plan is copied
// with its pictures beside it and relative Markdown links; each artifact and diagram it
// shows becomes a PNG, and whatever could not be drawn is listed in manifest.json and left as text.
// Nothing is written into the task, so exporting never changes an approval. Drawing is injected
// (`render`): tests use a fake, the CLI the machine's Chrome.

import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { parseDoc } from "./docs/frontmatter.ts"
import { NAMES } from "./docs/names.ts"
import { approvalCurrent } from "./gate/revision.ts"
import { Exporter } from "./plan-export-exporter.ts"
import { transformPlanMarkdown } from "./plan-export-transform.ts"
import { isAdopted, ORIGINAL_FILE, originalPath } from "./task/adoption.ts"
import type { Task } from "./task/store.ts"

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

const sha256 = (content: string | Uint8Array): string =>
  createHash("sha256")
    .update(content as string)
    .digest("hex")

async function validateOutputFolder(ctx: Ctx, task: Task, out: string): Promise<Result<string>> {
  const root = resolve(ctx.env.cwd(), out)
  const inTask = relative(task.dir, root)
  if (inTask === "" || !(inTask.startsWith("..") || resolve(inTask) === inTask)) {
    return err({
      code: "bad_args",
      message: "Choose a folder outside the task folder; exporting never writes into the task.",
    })
  }
  try {
    if (!ctx.fs.lstat || !ctx.fs.assertSafeDirectory)
      throw new Error("Safe filesystem checks are unavailable")
    await ctx.fs.assertSafeDirectory(root)
    const existing = await ctx.fs.lstat(root)
    if (existing && (existing.kind !== "directory" || (await ctx.fs.readdir(root)).length > 0)) {
      return err({
        code: "bad_args",
        message: "The output folder is not empty; choose a new folder",
      })
    }
    return ok(root)
  } catch {
    return err({
      code: "open_failed",
      message:
        "Could not use the output folder. Use a directory whose ancestry is protected from other users and contains no symbolic links.",
    })
  }
}

async function writeExportDirectory(
  ctx: Ctx,
  root: string,
  written: Map<string, string | Uint8Array>,
  hasAssets: boolean,
  manifest: Record<string, unknown>,
): Promise<Result<void>> {
  try {
    await ctx.fs.mkdir(root, { mode: 0o700 })
    await ctx.fs.assertSafeDirectory?.(root)
    if (hasAssets) {
      await ctx.fs.mkdir(join(root, "assets"), { mode: 0o700 })
      await ctx.fs.assertSafeDirectory?.(join(root, "assets"))
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
    return ok(undefined)
  } catch {
    // Nothing is removed on failure: another writer may have changed the folder.
    return err({
      code: "open_failed",
      message:
        "Could not write the export. Earlier files were preserved; an incomplete folder may remain.",
    })
  }
}

/** Export a task's Plan into `options.out`: a folder that does not exist yet, or an empty one. */
export async function exportPlan(
  ctx: Ctx,
  task: Task,
  options: PlanExportOptions,
): Promise<Result<PlanExport>> {
  const planPath = join(task.dir, NAMES.plan)
  if (!(await ctx.fs.exists(planPath)))
    return err({ code: "bad_args", message: `The task has no Plan yet (${NAMES.plan}).` })
  const folder = await validateOutputFolder(ctx, task, options.out)
  if (!folder.ok) return folder
  const root = folder.data
  const plan = await ctx.fs.readFile(planPath)
  const approval: Approval = (await approvalCurrent(ctx, task, NAMES.plan))
    ? "approved-current"
    : parseDoc(plan).frontmatter?.approved === true
      ? "approved-changed"
      : "not-approved"
  const exporter = new Exporter(ctx, task, options)
  exporter.approval = approval
  const written = new Map<string, string | Uint8Array>([
    [NAMES.plan, await transformPlanMarkdown(plan, exporter)],
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
  const saved = await writeExportDirectory(ctx, root, written, exporter.files.size > 0, {
    plan: NAMES.plan,
    task: task.slug,
    approval,
    complete: unfinished.length === 0,
    files,
    assets: exporter.assets,
  })
  if (!saved.ok) return saved
  if (unfinished.length > 0) {
    return err({
      code: "bad_args",
      message: `Exported with ${unfinished.length} assets not packaged: ${unfinished
        .map((a) => `${a.ref} (${a.status}: ${a.reason})`)
        .join(", ")}. See ${join(root, "manifest.json")}.`,
    })
  }
  return ok({ out: root, files, assets: exporter.assets, approval })
}
