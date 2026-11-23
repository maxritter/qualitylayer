import { lstat, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "../core/interaction-docs/attachment-rules.ts"
import { attachmentProblem, type Incoming } from "../core/interaction-docs/attachments.ts"
import { readRun, runDir } from "../core/run/registry.ts"
import type { Ctx } from "../ctx.ts"
import { ArtifactBodyError, readArtifactBody } from "./request-body.ts"
import {
  describeMessageFiles,
  messageFilesDigest,
  messageFilesReply,
  verifyExistingMessageBatch,
  writeNewMessageBatch,
} from "./run-message-files-store.ts"

export const messageFilesRunId = (path: string) =>
  /^\/api\/agent-runs\/([a-f0-9-]{1,128})\/message-files$/.exec(path)?.[1]

function isRunAvailable(
  ctx: Ctx,
  id: string,
  authorized: () => boolean,
  generation?: number,
): boolean {
  const run = readRun(ctx.home, id)
  if (run?.status !== "running" || run.agent === "other") return false
  const isShell = run.purpose.kind === "terminal" && run.purpose.shell === true
  const matchesGeneration = generation === undefined || run.generation === generation
  return !isShell && matchesGeneration && authorized()
}

type ParsedMessageUpload =
  | { ok: true; batch: string; generation: number; files: Incoming[]; uploadBytes: number }
  | { ok: false; response: Response }

async function parseMessageUpload(request: Request): Promise<ParsedMessageUpload> {
  const contentType = request.headers.get("content-type")
  if (!contentType?.startsWith("multipart/form-data"))
    return {
      ok: false,
      response: messageFilesReply(
        { error: "Attach files with the file picker, paste or drop." },
        400,
      ),
    }
  const bytes = await readArtifactBody(request, MAX_ATTACHMENTS * MAX_ATTACHMENT_BYTES + 64 * 1024)
  const form = await new Response(bytes, { headers: { "content-type": contentType } }).formData()
  const batch = form.get("draft")
  const generation = Number(form.get("generation"))
  const validBatch = typeof batch === "string" && /^[a-f0-9-]{36}$/.test(batch)
  const validGeneration = Number.isSafeInteger(generation) && generation >= 1
  if (!validBatch || !validGeneration)
    return {
      ok: false,
      response: messageFilesReply({ error: "Refresh this agent window and try again." }, 400),
    }
  const parts = form.getAll("file")
  if (
    !parts.length ||
    parts.length > MAX_ATTACHMENTS ||
    parts.some((part) => typeof part === "string" || part.size > MAX_ATTACHMENT_BYTES)
  ) {
    return {
      ok: false,
      response: messageFilesReply(
        { error: "Attach one to six files, each 10 MB or smaller." },
        400,
      ),
    }
  }
  const files: Incoming[] = []
  for (const part of parts) {
    if (typeof part !== "string")
      files.push({ name: part.name, bytes: new Uint8Array(await part.arrayBuffer()) })
  }
  const problem = attachmentProblem(files, { allowAnyType: true })
  if (problem)
    return {
      ok: false,
      response: messageFilesReply({ error: problem.replace("to a comment", "to a message") }, 400),
    }
  return { ok: true, batch, generation, files, uploadBytes: bytes.byteLength }
}

/** Uploads do not send a prompt. The controlling window sends the returned paths with its message. */
export async function messageFilesResponse(
  ctx: Ctx,
  request: Request,
  id: string,
  authorized: () => boolean,
  options: { onCreated?: (folder: string) => void } = {},
): Promise<Response> {
  const available = (generation?: number) => isRunAvailable(ctx, id, authorized, generation)
  if (!available())
    return messageFilesReply(
      { error: "Take control of the running agent before attaching files." },
      403,
    )
  try {
    const parsed = await parseMessageUpload(request)
    if (!parsed.ok) return parsed.response
    const directory = runDir(ctx.home, id)
    await ctx.fs.assertSafeDirectory?.(directory)
    return await ctx.fs.withLock(join(directory, ".message-files.lock"), async () => {
      if (!available(parsed.generation)) {
        return messageFilesReply(
          { error: "This agent window changed. Your files are kept; reconnect and try again." },
          409,
        )
      }
      const root = join(directory, "message-files")
      await mkdir(root, { recursive: true, mode: 0o700 })
      if ((await lstat(root)).isSymbolicLink()) throw new Error("Unsafe message attachment folder")
      const folder = join(root, parsed.batch)
      const hash = messageFilesDigest(parsed.files)
      const described = describeMessageFiles(parsed.files, folder)
      const existing = await lstat(folder).catch(() => null)
      if (existing) {
        if (!existing.isDirectory() || existing.isSymbolicLink())
          throw new Error("Unsafe message attachment folder")
        return verifyExistingMessageBatch(folder, {
          hash,
          generation: parsed.generation,
          files: parsed.files,
          described,
        })
      }
      return writeNewMessageBatch({
        ctx,
        id,
        root,
        folder,
        uploadBytes: parsed.uploadBytes,
        hash,
        generation: parsed.generation,
        files: parsed.files,
        described,
        available,
        onCreated: options.onCreated,
      })
    })
  } catch (cause) {
    return messageFilesReply(
      {
        error:
          cause instanceof ArtifactBodyError
            ? "The attached files exceed the upload limit."
            : "Could not attach these files. Your draft is kept; try again.",
      },
      cause instanceof ArtifactBodyError ? cause.status : 400,
    )
  }
}
