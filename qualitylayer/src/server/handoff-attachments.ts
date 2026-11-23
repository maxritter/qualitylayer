// POST /api/handoff-attachments: the files behind a prompt the person copies into their own agent.
// The agent runs outside the App, so it cannot open the browser's files. Each upload is saved on
// this computer under <QualityLayer home>/attachments/<date>-<time>-<random>/ and answered by
// absolute path, which the prompt lists. multipart/form-data, one `file` part per file.
//
// Guard: an ordinary mutating /api call: a loopback host, the page's own origin and the key or a
// paired session (`refuse`, the check `createHandler` runs first and a test can run on its own).

import { randomBytes } from "node:crypto"
import { lstat, mkdir, writeFile } from "node:fs/promises"
import { extname, join, resolve } from "node:path"
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  pickProblem,
} from "../core/interaction-docs/attachment-rules.ts"
import type { Ctx } from "../ctx.ts"
import { type GuardConfig, refuse } from "./guard.ts"
import { ArtifactBodyError, readArtifactBody } from "./request-body.ts"

export const HANDOFF_ATTACHMENTS_PATH = "/api/handoff-attachments"

const reply = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } })
const bad = (message: string, status = 400) =>
  reply({ ok: false, error: { code: "bad_args", message } }, status)

/** The file's own name without any folder, or null when nothing usable is left. */
function plainName(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? ""
  // biome-ignore lint/suspicious/noControlCharactersInRegex: a control character cannot be in a prompt's path
  if (base === "" || base === "." || base === ".." || /[\u0000-\u001f\u007f]/.test(base))
    return null
  return Buffer.byteLength(base) > 200 ? null : base
}

/** The name, or the name with " (2)" before its extension, that no earlier file of this upload has. */
function uniqueName(base: string, taken: Set<string>): string {
  const ext = extname(base)
  const stem = base.slice(0, base.length - ext.length)
  let name = base
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${stem} (${n})${ext}`
  taken.add(name.toLowerCase())
  return name
}

const pad = (n: number) => String(n).padStart(2, "0")
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"

/** `2026-10-20-1904-k3x9qa`: when, in this computer's time, and six random characters. */
function folderName(at: number): string {
  const d = new Date(at)
  const random = Array.from(randomBytes(6), (byte) => ALPHABET[byte % ALPHABET.length]).join("")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${random}`
}

type UploadBatch = { parts: File[]; names: string[] }

async function readUploadForm(request: Request): Promise<FormData | Response> {
  const contentType = request.headers.get("content-type")
  if (!contentType?.startsWith("multipart/form-data"))
    return bad("Attach files with the file picker, paste or drop.")
  try {
    const bytes = await readArtifactBody(
      request,
      MAX_ATTACHMENTS * MAX_ATTACHMENT_BYTES + 64 * 1024,
    )
    return await new Response(bytes, { headers: { "content-type": contentType } }).formData()
  } catch (cause) {
    return cause instanceof ArtifactBodyError
      ? bad("The attached files exceed the upload limit.", cause.status)
      : bad("Could not read these files. Try attaching them again.")
  }
}

function validateUploadParts(form: FormData): UploadBatch | Response {
  if ([...form.keys()].some((key) => key !== "file")) return bad("Unknown upload field.")
  const all = form.getAll("file")
  const parts = all.filter((part): part is File => typeof part !== "string")
  if (parts.length === 0 || parts.length !== all.length) return bad("Attach at least one file.")
  if (parts.length > MAX_ATTACHMENTS)
    return bad(`Attach at most ${MAX_ATTACHMENTS} files to a prompt.`)
  // Bun gives a part sent without a file name no `name` at all.
  const names: string[] = []
  const taken = new Set<string>()
  for (const part of parts) {
    const base = plainName(typeof part.name === "string" ? part.name : "")
    if (base === null) return bad("A file needs a plain name.")
    names.push(uniqueName(base, taken))
  }
  const problem = pickProblem(
    parts.map((part, index) => ({
      name: names[index] as string,
      size: part.size,
      type: part.type,
    })),
  )
  return problem === null ? { parts, names } : bad(problem.replace("to a comment", "to a prompt"))
}

async function allocateAttachmentFolder(ctx: Ctx): Promise<string> {
  const root = join(resolve(ctx.home), "attachments")
  await mkdir(root, { recursive: true, mode: 0o700 })
  const seen = await lstat(root)
  if (!seen.isDirectory() || seen.isSymbolicLink()) throw new Error("Unsafe attachment folder")
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = join(root, folderName(ctx.clock.now()))
    try {
      await mkdir(candidate, { mode: 0o700 })
      return candidate
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause
    }
  }
  throw new Error("No free attachment folder")
}

async function saveUploadBatch(ctx: Ctx, batch: UploadBatch): Promise<Response> {
  try {
    const folder = await allocateAttachmentFolder(ctx)
    const paths: string[] = []
    for (const [index, part] of batch.parts.entries()) {
      const path = join(folder, batch.names[index] as string)
      await writeFile(path, new Uint8Array(await part.arrayBuffer()), { flag: "wx", mode: 0o600 })
      paths.push(path)
    }
    return reply({ ok: true, paths })
  } catch {
    return bad("Could not save these files on this computer. Try again.", 500)
  }
}

/** `POST /api/handoff-attachments`; the caller has matched the path. */
export async function handoffAttachmentsRoute(
  ctx: Ctx,
  guard: GuardConfig,
  request: Request,
): Promise<Response> {
  const refusal = refuse(request, guard, true)
  if (refusal !== null) return new Response(refusal.reason, { status: refusal.status })
  if (request.method !== "POST") return bad("Use POST to attach files.", 405)
  const form = await readUploadForm(request)
  if (form instanceof Response) return form
  const batch = validateUploadParts(form)
  if (batch instanceof Response) return batch
  return saveUploadBatch(ctx, batch)
}
