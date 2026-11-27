import { realpath } from "node:fs/promises"
import { dirname } from "node:path"
import {
  type ArtifactAgentBinding,
  readArtifactAgentContext,
} from "../core/artifact/agent-context.ts"
import { artifactMeta, folderArtifactOf, lastingDocOf } from "../core/artifact/format.ts"
import { readLasting } from "../core/artifact/lasting.ts"
import { artifactFiles, commentsHolder } from "../core/artifact/store.ts"
import { artifactAnchor } from "../core/artifact/workspace.ts"
import { isArchived } from "../core/task/archive.ts"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { locate } from "./api.ts"
import { artifactWorkspaceRead, locateArtifact } from "./artifacts.ts"

export type ArtifactAgentInput = {
  scope: "task" | "project"
  id: string
  file: string
  revision?: string
  request: string
}

export async function refreshArtifactAgentContext(
  ctx: Ctx,
  binding: ArtifactAgentBinding,
  request: string,
  options: { expectedRevision?: string } = {},
): ReturnType<typeof readArtifactAgentContext> {
  return readArtifactAgentContext(ctx, binding, request, options)
}

const ALLOWED_KEYS = new Set(["scope", "id", "file", "revision", "request"])

function isValidArtifactAgentInput(input: ArtifactAgentInput): boolean {
  if (!input || typeof input !== "object") return false
  if (Object.keys(input).some((key) => !ALLOWED_KEYS.has(key))) return false
  if (input.scope !== "task" && input.scope !== "project") return false
  if (
    typeof input.id !== "string" ||
    typeof input.file !== "string" ||
    typeof input.request !== "string"
  )
    return false
  return input.revision === undefined || /^[a-f0-9]{64}$/.test(input.revision)
}

async function ensureTaskOpen(ctx: Ctx, id: string): Promise<ReturnType<typeof err> | null> {
  const task = await locate(ctx, id)
  if (!task.ok) return task
  const closed =
    (await isArchived(ctx, task.data.task)) ||
    task.data.task.stage === "shipped" ||
    task.data.task.stage === "abandoned"
  return closed
    ? err({
        code: "bad_args",
        message: "Restore or reopen this task before starting its artifact agent.",
      })
    : null
}

async function resolvePagesAndTitle(
  ctx: Ctx,
  home: Parameters<typeof artifactFiles>[1],
  foundPath: string,
  file: string,
  root: string,
): Promise<Result<{ pages: string[]; ownTitle: string; kind: "folder" | "file" }>> {
  const folder = folderArtifactOf(file)
  const lasting = lastingDocOf(file)
  if (lasting) {
    const read = await readLasting(root, lasting.name)
    if (!read.ok) return read
    return ok({
      pages: read.data.pages.map((page) => `${dirname(file)}/${page}`),
      ownTitle: read.data.config.title.trim(),
      kind: "folder",
    })
  }
  let pages = [file]
  if (folder) {
    const entries = await artifactFiles(ctx, home)
    const entry = entries.find((item) => item.folder?.dir === dirname(foundPath))
    if (entry?.folder)
      pages = entry.folder.pages.map((page) => `${folder.root}/${folder.name}/${page}`)
  }
  return ok({ pages, ownTitle: "", kind: folder ? "folder" : "file" })
}

async function loadArtifactSource(ctx: Ctx, input: ArtifactAgentInput) {
  if (!isValidArtifactAgentInput(input)) {
    return err({
      code: "bad_args",
      message: "Expected an exact artifact address, revision and request.",
    })
  }
  if (input.scope === "task") {
    const closed = await ensureTaskOpen(ctx, input.id)
    if (closed) return closed
  }
  const located = await locateArtifact(ctx, input.scope, input.id, input.file)
  if (!located.ok) return located
  if (input.file.endsWith("/design.json")) {
    const manifest = await ctx.fs.readFile(located.data.path).catch(() => "{}")
    return ok({
      found: located.data,
      html: `<!-- design-artifact -->\n${manifest}`,
    })
  }
  const source = await artifactWorkspaceRead(ctx, input.scope, input.id, input.file, "source")
  if (!source.ok) return source
  return ok({ found: located.data, html: (source.data as { html: string }).html })
}

/** Preview and launch share one resolver; native hooks retain only its server-derived binding. */
export async function resolveArtifactAgentContext(
  ctx: Ctx,
  input: ArtifactAgentInput,
): ReturnType<typeof readArtifactAgentContext> {
  const loaded = await loadArtifactSource(ctx, input)
  if (!loaded.ok) return loaded
  const { found, html } = loaded.data
  const root = artifactAnchor(found.home)
  const resolved = await resolvePagesAndTitle(ctx, found.home, found.path, input.file, root)
  if (!resolved.ok) return resolved
  const binding: ArtifactAgentBinding = {
    address: { scope: input.scope, id: input.id, file: input.file, revision: input.revision ?? "" },
    root: await realpath(root),
    sourcePath: found.path,
    folder: dirname(found.path),
    runtimeDir: commentsHolder(ctx, found.home).runtimeDir,
    title:
      resolved.data.ownTitle ||
      artifactMeta(html).title ||
      input.file.split("/").at(-1) ||
      "Artifact",
    pages: resolved.data.pages,
    kind: resolved.data.kind,
  }
  return refreshArtifactAgentContext(ctx, binding, input.request, {
    expectedRevision: input.revision,
  })
}
