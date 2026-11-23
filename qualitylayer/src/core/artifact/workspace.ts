import { createHash } from "node:crypto"
import { dirname } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { ARTIFACT_SOURCE_MAX_BYTES, ARTIFACT_SOURCE_TOO_LARGE } from "../home-caps.ts"
import {
  ARTIFACT_NAME,
  ARTIFACT_PAGE_NAME,
  type ArtifactMeta,
  artifactMeta,
  folderArtifactOf,
} from "./format.ts"
import { type ArtifactHome, artifactPath } from "./store.ts"

export {
  type ArtifactAttribution,
  type ArtifactHistory,
  type ArtifactRevision,
  artifactHistory,
  keepArtifactRevision,
} from "./workspace-history.ts"
export { mutateArtifact } from "./workspace-mutate.ts"

export type ArtifactSource = { file: string; html: string; revision: string; meta: ArtifactMeta }
/** Another file of the same folder artifact written with the page, guarded by the sha256 it was read with. */
export type SiblingWrite = { path: string; expectedSha: string; content: string }
export type ArtifactMutation =
  | { action: "write"; html: string; expected: string; siblings?: SiblingWrite[] }
  | { action: "metadata"; title?: string; purpose?: string; expected: string }
  | { action: "copy" | "rename"; name: string; expected: string }
  | { action: "delete"; expected: string }
  | { action: "restore"; id: string; expected: string }

export const sourceRevision = (html: string): string =>
  createHash("sha256").update(html).digest("hex")

export function workspaceFile(home: ArtifactHome, name: string): string | null {
  const base = name.replace(/\.html$/, "")
  return ARTIFACT_NAME.test(base) && base.length <= 100
    ? `${home.scope === "task" ? "artifacts" : "docs/artifacts"}/${base}.html`
    : null
}

/** A page of a folder artifact beside `file`, under another name; null when the name is not a page's. */
export function siblingPage(file: string, name: string): string | null {
  const folder = folderArtifactOf(file)
  const page = name.endsWith(".html") ? name : `${name}.html`
  if (folder === null || !ARTIFACT_PAGE_NAME.test(page) || page.length > 100) return null
  return `${folder.root}/${folder.name}/${page}`
}

/** The folder a home's artifacts are checked from: every folder between it and an artifact is no link. */
export function artifactAnchor(home: ArtifactHome): string {
  return home.scope === "task" ? (home.root ?? dirname(dirname(dirname(home.dir)))) : home.root
}

export async function safeArtifactPath(ctx: Ctx, anchor: string, path: string): Promise<void> {
  if (!ctx.fs.lstat) throw new Error("The filesystem cannot verify artifact paths")
  const parts: string[] = []
  for (let at = path; ; at = dirname(at)) {
    parts.unshift(at)
    if (at === anchor) break
    if (dirname(at) === at) throw new Error("The path is outside the artifact workspace")
  }
  for (const part of parts) {
    const entry = await ctx.fs.lstat(part)
    if (entry && (entry.kind === "symlink" || entry.kind === "other"))
      throw new Error("Artifact files and folders cannot be symbolic links")
  }
}

export async function checkedPath(ctx: Ctx, home: ArtifactHome, file: string): Promise<string> {
  const path = artifactPath(home, file)
  // A page of a folder artifact has been checked as one by `artifactPath`; a single page's name is too.
  if (
    !path ||
    (folderArtifactOf(file) === null && !workspaceFile(home, file.split("/").at(-1) ?? ""))
  )
    throw new Error("Use a lower-case artifact name with letters, digits and dashes")
  await safeArtifactPath(ctx, artifactAnchor(home), path)
  return path
}

export const failure = (cause: unknown) =>
  err({ code: "bad_args", message: cause instanceof Error ? cause.message : String(cause) })

export async function boundedRead(
  ctx: Ctx,
  path: string,
  limit = ARTIFACT_SOURCE_MAX_BYTES,
): Promise<string> {
  const stat = await ctx.fs.stat?.(path)
  if (stat && stat.size > limit) throw new Error(ARTIFACT_SOURCE_TOO_LARGE)
  const html = await ctx.fs.readFile(path)
  if (Buffer.byteLength(html) > limit) throw new Error(ARTIFACT_SOURCE_TOO_LARGE)
  return html
}

export async function readArtifactSource(
  ctx: Ctx,
  home: ArtifactHome,
  file: string,
): Promise<Result<ArtifactSource>> {
  try {
    const html = await boundedRead(ctx, await checkedPath(ctx, home, file))
    return ok({ file, html, revision: sourceRevision(html), meta: artifactMeta(html) })
  } catch (cause) {
    return failure(cause)
  }
}
