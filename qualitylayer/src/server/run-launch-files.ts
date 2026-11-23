import { lstat } from "node:fs/promises"
import { join } from "node:path"
import {
  type Attachment,
  attachmentProblem,
  type Incoming,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
} from "../core/interaction-docs/attachments.ts"
import type { RunRecord } from "../core/run/contracts.ts"
import { runDir } from "../core/run/registry.ts"
import type { Ctx } from "../ctx.ts"
import { readArtifactBody } from "./request-body.ts"
import {
  assertSafeLaunchDirs,
  boundedLaunchFile,
  fileDigest,
  hasSafeFileName,
  verifyExistingLaunchFiles,
  writeTemporaryLaunchFiles,
} from "./run-launch-files-io.ts"

/** Client fields contain no file paths: only bounded uploaded bytes can create launch attachments. */
export async function readLaunchBody(
  request: Request,
  readJson: (request: Request) => Promise<unknown>,
): Promise<{ input: unknown; files: Incoming[] }> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.startsWith("multipart/form-data"))
    return { input: await readJson(request), files: [] }
  const bytes = await readArtifactBody(request, MAX_ATTACHMENTS * MAX_ATTACHMENT_BYTES + 128 * 1024)
  const form = await new Response(bytes, { headers: { "content-type": contentType } }).formData()
  if ([...form.keys()].some((key) => key !== "request" && key !== "file"))
    throw new Error("Unknown launch upload field")
  const values = form.getAll("request")
  if (values.length !== 1 || typeof values[0] !== "string" || values[0].length > 64 * 1024)
    throw new Error("Expected one bounded launch request")
  const parts = form.getAll("file")
  if (
    !parts.length ||
    parts.length > MAX_ATTACHMENTS ||
    parts.some((part) => typeof part === "string" || part.size > MAX_ATTACHMENT_BYTES)
  )
    throw new Error("Attach one to six files, each 10 MB or smaller.")
  const files: Incoming[] = []
  for (const part of parts)
    if (typeof part !== "string")
      files.push({ name: part.name, bytes: new Uint8Array(await part.arrayBuffer()) })
  const problem = attachmentProblem(files)
  if (problem) throw new Error(problem.replace("to a comment", "to this launch"))
  return { input: JSON.parse(values[0]), files }
}

function matchesRegisteredFile(
  folder: string,
  saved: Attachment,
  registered: Attachment | undefined,
): boolean {
  if (!registered || !hasSafeFileName(saved.name)) return false
  return (
    saved.path === join(folder, "files", saved.name) &&
    JSON.stringify(saved) === JSON.stringify(registered)
  )
}

async function readRegisteredLaunchEntries(
  folder: string,
  receiptFiles: Attachment[],
  registeredFiles: Attachment[],
): Promise<Incoming[]> {
  const files: Incoming[] = []
  for (const [index, saved] of receiptFiles.entries()) {
    if (!matchesRegisteredFile(folder, saved, registeredFiles[index]))
      throw new Error(
        "The original launch file receipt changed. The previous conversation is kept.",
      )
    const bytes = await boundedLaunchFile(saved.path, MAX_ATTACHMENT_BYTES)
    if (bytes.length !== saved.size || saved.missing)
      throw new Error(
        "An original launch file is missing or changed. The previous conversation is kept.",
      )
    files.push({ name: saved.name, bytes })
  }
  return files
}

/** Reads only registered launch files with an intact, bounded receipt; never a caller-supplied path. */
export async function readLaunchFiles(
  ctx: Ctx,
  run: RunRecord,
): Promise<{ files: Incoming[]; hash: string }> {
  const folder = join(runDir(ctx.home, run.id), "launch-files")
  if (!run.launchFiles?.length) {
    const stored = await lstat(folder).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== "ENOENT") throw cause
      return undefined
    })
    if (stored)
      throw new Error(
        "The original launch file registration is missing. The previous conversation is kept.",
      )
    return { files: [], hash: fileDigest([]) }
  }
  if (run.launchFiles.length > MAX_ATTACHMENTS)
    throw new Error("Too many original launch files. The previous conversation is kept.")
  await ctx.fs.assertSafeDirectory?.(runDir(ctx.home, run.id))
  await assertSafeLaunchDirs(
    folder,
    "Unsafe original launch file folder. The previous conversation is kept.",
  )
  const receipt = JSON.parse(
    (await boundedLaunchFile(join(folder, "receipt.json"), 4096)).toString("utf8"),
  ) as { hash?: string; contentHash?: string; files?: Attachment[] }
  if (!Array.isArray(receipt.files) || receipt.files.length !== run.launchFiles.length)
    throw new Error(
      "The original launch file receipt is incomplete. The previous conversation is kept.",
    )
  const files = await readRegisteredLaunchEntries(folder, receipt.files, run.launchFiles)
  const hash = fileDigest(files)
  if (hash !== (receipt.contentHash ?? receipt.hash) || attachmentProblem(files))
    throw new Error(
      "The original launch file integrity could not be verified. The previous conversation is kept.",
    )
  return { files, hash }
}

/** Called under start.lock. A failed start keeps the same files; changed retries cannot reuse it. */
export async function keepLaunchFiles(
  ctx: Ctx,
  run: RunRecord,
  files: Incoming[],
): Promise<Attachment[]> {
  const directory = runDir(ctx.home, run.id)
  await ctx.fs.assertSafeDirectory?.(directory)
  const folder = join(directory, "launch-files")
  const exists = await lstat(folder).catch(() => null)
  if (!exists && !files.length) return []
  const problem = attachmentProblem(files)
  if (problem) throw new Error(problem.replace("to a comment", "to this launch"))
  const hash = fileDigest(files)
  if (exists) return verifyExistingLaunchFiles(folder, hash, files)
  if (!files.length) return []
  return writeTemporaryLaunchFiles(ctx, directory, folder, hash, files)
}
