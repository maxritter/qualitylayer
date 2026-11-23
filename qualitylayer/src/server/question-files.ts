import { basename, dirname, join } from "node:path"
import {
  type Attachment,
  attachmentProblem,
  type Incoming,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
} from "../core/interaction-docs/attachments.ts"
import type { AnsweredQuestion } from "../core/task/question.ts"
import { type Ctx, err, ok } from "../ctx.ts"

const bad = (message: string) => err({ code: "bad_args", message })

async function readUploadParts(parts: FormDataEntryValue[]) {
  if (parts.length > MAX_ATTACHMENTS)
    return bad(`Attach at most ${MAX_ATTACHMENTS} files to an answer.`)
  const files: Incoming[] = []
  for (const part of parts) {
    if (typeof part === "string") return bad("Each attachment must be a file.")
    if (part.size > MAX_ATTACHMENT_BYTES) return bad(`${part.name} is larger than 10 MB.`)
    files.push({ name: part.name, bytes: new Uint8Array(await part.arrayBuffer()) })
  }
  const problem = attachmentProblem(files)
  return problem ? bad(problem.replace("to a comment", "to an answer")) : ok(files)
}

async function parseMultipartAnswer(request: Request) {
  const length = Number(request.headers.get("content-length"))
  if (length > MAX_ATTACHMENTS * MAX_ATTACHMENT_BYTES + 100_000)
    return bad("The answer is too large.")
  const form = await request.formData()
  const answer = form.get("answer")
  if (typeof answer !== "string") return bad("The answer part is missing.")
  const files = await readUploadParts(form.getAll("file"))
  if (!files.ok) return files
  return ok({ raw: answer, files: files.data })
}

function parseAnswerPayload(raw: string, files: Incoming[]) {
  if (raw.length > 100_000) return bad("The answer is too large.")
  const body = JSON.parse(raw)
  if (!body || typeof body !== "object" || Array.isArray(body))
    return bad("Expected an answer object.")
  if (body.files !== undefined) return bad("Attach files using the file picker, paste or drop.")
  if (files.length && body.more !== undefined)
    return bad("Send files with an answer, rather than a Tell me more request.")
  return ok({ body: body as Record<string, unknown>, files })
}

/** Upload bytes never become trusted answer fields or caller-supplied filesystem paths. */
export async function readAnswerRequest(request: Request) {
  try {
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const parsed = await parseMultipartAnswer(request)
      if (!parsed.ok) return parsed
      return parseAnswerPayload(parsed.data.raw, parsed.data.files)
    }
    return parseAnswerPayload(await request.text(), [])
  } catch {
    return bad("Could not read the answer. Your words and files are kept; try again.")
  }
}

function isSafeAnswerFile(
  ctx: Ctx,
  host: { runtimeDir: string },
  file: Attachment | undefined,
): file is Attachment {
  if (!file || !ctx.fs.forPublication) return false
  const folder = dirname(file.path)
  if (dirname(folder) !== join(host.runtimeDir, "attachments")) return false
  return /^answer-[\w-]+$/.test(basename(folder)) && file.path === join(folder, file.name)
}

/** Only a file recorded on this exact answer, inside its private upload folder, is readable. */
export async function answerFileResponse(
  ctx: Ctx,
  host: { runtimeDir: string },
  answers: readonly (AnsweredQuestion & { files?: Attachment[] })[],
  request: Request,
) {
  const query = new URL(request.url).searchParams
  const answer = answers.find((a) => a.id === query.get("id") && String(a.at) === query.get("at"))
  const file = answer?.files?.find((f) => f.name === query.get("name"))
  const absent = () => new Response("This file is no longer attached.", { status: 404 })
  if (!isSafeAnswerFile(ctx, host, file)) return absent()
  const folder = dirname(file.path)
  try {
    const fs = ctx.fs.forPublication?.(host.runtimeDir, folder)
    if (!fs?.readBytes) return absent()
    const bytes = await fs.readBytes(file.path)
    return new Response(new Blob([new Uint8Array(bytes)]), {
      headers: {
        "content-type": file.type === "text/plain" ? "text/plain; charset=utf-8" : file.type,
        "content-disposition": `${file.type.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "private, no-store",
      },
    })
  } catch {
    return absent()
  }
}
