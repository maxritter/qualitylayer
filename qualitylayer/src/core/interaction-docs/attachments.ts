// Files a person attaches to a comment: images, PDFs and text files the agent reads. They are kept
// beside the task's comments, one folder per comment, and the comment names each by its path.

import { writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { sniffImage } from "../feedback/report.ts"
import type { Task } from "../task/store.ts"

import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, TEXT_EXTENSIONS } from "./attachment-rules.ts"

export { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "./attachment-rules.ts"

export type AttachmentType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "application/pdf"
  | "text/plain"
  | "application/octet-stream"

/** One attached file as the comment records it: the agent opens `path`. */
export type Attachment = {
  name: string
  type: AttachmentType
  size: number
  path: string
  /** A teammate's file that could not be fetched (yet): `path` is empty and nothing is on disk. */
  missing?: true
}

/** A file on its way in, before it is checked. */
export type Incoming = { name: string; bytes: Uint8Array }

const at = (bytes: Uint8Array, offset: number, ...expected: number[]) =>
  expected.every((value, index) => bytes[offset + index] === value)

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

function sniffBinaryAttachment(bytes: Uint8Array): AttachmentType | null {
  const image = sniffImage(bytes)
  if (image !== null) return image
  if (at(bytes, 0, 0x47, 0x49, 0x46, 0x38)) return "image/gif"
  if (at(bytes, 0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf"
  return null
}

/** The type the file's own bytes name, or null: its name or the browser's type is not believed. */
export function attachmentType(name: string, bytes: Uint8Array): AttachmentType | null {
  const binary = sniffBinaryAttachment(bytes)
  if (binary !== null) return binary
  const hasTextExt = (TEXT_EXTENSIONS as readonly string[]).includes(extname(name).toLowerCase())
  return hasTextExt && isUtf8Text(bytes) ? "text/plain" : null
}

/** Local native-agent message files may be any format; unknown bytes remain inert downloads. */
export function messageAttachmentType(name: string, bytes: Uint8Array): AttachmentType {
  const known = attachmentType(name, bytes)
  if (known) return known
  return isUtf8Text(bytes) ? "text/plain" : "application/octet-stream"
}

/** A file name that stays one plain name in the comment's folder, whatever the person's file was called. */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ""
  const clean = base
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
    .replace(/^[.\s-]+/, "")
    .slice(-120)
  return clean === "" ? "file" : clean
}

/** Why these files cannot be attached, in a sentence for the person, or null. */
export function attachmentProblem(
  files: Incoming[],
  options: { allowAnyType?: boolean } = {},
): string | null {
  if (files.length > MAX_ATTACHMENTS) return `Attach at most ${MAX_ATTACHMENTS} files to a comment.`
  for (const file of files) {
    if (file.bytes.length > MAX_ATTACHMENT_BYTES)
      return `${safeName(file.name)} is larger than 10 MB.`
    if (file.bytes.length === 0) return `${safeName(file.name)} is empty.`
    if (!options.allowAnyType && attachmentType(file.name, file.bytes) === null)
      return `${safeName(file.name)} is not an image, a PDF or a text file (${TEXT_EXTENSIONS.join(" ")}).`
  }
  return null
}

export const attachmentDir = (task: Pick<Task, "runtimeDir">, comment: string) =>
  join(task.runtimeDir, "attachments", comment)

/** Saves the files of one comment; two files of one name each keep their own. */
export async function saveAttachments(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  comment: string,
  files: Incoming[],
): Promise<Attachment[]> {
  const problem = attachmentProblem(files)
  if (problem !== null) throw new Error(problem)
  if (files.length === 0) return []
  const dir = attachmentDir(task, comment)
  await ctx.fs.mkdir(dir)
  const taken = new Set<string>()
  const saved: Attachment[] = []
  for (const file of files) {
    let name = safeName(file.name)
    const ext = extname(name)
    for (let n = 2; taken.has(name.toLowerCase()); n++)
      name = `${safeName(file.name).slice(0, safeName(file.name).length - ext.length)} (${n})${ext}`
    taken.add(name.toLowerCase())
    const path = join(dir, name)
    await writeFile(path, file.bytes, { flag: "wx" })
    saved.push({
      name,
      type: attachmentType(file.name, file.bytes) as AttachmentType,
      size: file.bytes.length,
      path,
    })
  }
  return saved
}

/** How a comment's files read for the agent beside its words: " (attached: /…/a.png, /…/b.pdf)". */
export const attachmentLine = (files: Attachment[] | undefined): string =>
  files === undefined || !files.some((f) => f.missing !== true)
    ? ""
    : ` (attached: ${files
        .filter((f) => f.missing !== true)
        .map((f) => f.path)
        .join(", ")})`

/** What the agent is told once when comments carry files; nothing when none do. */
export const attachmentHint = (comments: readonly object[]) =>
  comments.some((c) => "files" in c && Array.isArray(c.files) && c.files.length > 0)
    ? {
        attachments:
          "Some comments carry files the person attached (`files`). Open every `path` before you act on " +
          "the comment: read images and PDFs with your file reader; where it cannot open a PDF, run " +
          "`pdftotext <path> -`. Text files read as they are.",
      }
    : {}
