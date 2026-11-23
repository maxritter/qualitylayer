// Publication reads must never follow repository-authored links into private files.
import { constants } from "node:fs"
import { lstat, open, realpath } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import type { Ctx, Fs } from "./ctx.ts"
import { readAt } from "./files.ts"
import { boundedRegularFile, type FileIdentity } from "./regular-file.ts"

export type PublicationReadReason = "outside_task" | "symbolic_link" | "changed_file"

export class PublicationReadRefusal extends Error {
  readonly code = "unsafe_publication_read"

  constructor(
    readonly reason: PublicationReadReason,
    message: string,
  ) {
    super(message)
    this.name = "PublicationReadRefusal"
  }
}

/** `readAt` adds a path wrapper; retain the guarded read's type through that cause. */
export function publicationReadRefusal(cause: unknown): PublicationReadRefusal | null {
  for (let depth = 0; depth < 8 && cause instanceof Error; depth++) {
    if (cause instanceof PublicationReadRefusal) return cause
    cause = cause.cause
  }
  return null
}

const inside = (root: string, path: string) => {
  const rest = relative(root, path)
  return rest === "" || (!isAbsolute(rest) && rest !== ".." && !rest.startsWith(`..${sep}`))
}

async function checkedPublicationPath(root: string, scope: string, path: string): Promise<string> {
  const target = resolve(path)
  if (!inside(root, scope) || !inside(scope, target))
    throw new PublicationReadRefusal("outside_task", "Publication path escapes the task")
  const canonical = await realpath(root)
  let current = canonical
  for (const part of relative(root, target).split(sep).filter(Boolean)) {
    current = join(current, part)
    if ((await lstat(current)).isSymbolicLink())
      throw new PublicationReadRefusal("symbolic_link", `Cannot publish a symbolic link: ${path}`)
  }
  if (!inside(canonical, await realpath(target)))
    throw new PublicationReadRefusal("outside_task", `Publication path escapes its root: ${path}`)
  return current
}

async function verifyOpenFile(
  root: string,
  scope: string,
  path: string,
  opened: { isFile(): boolean; dev: number; ino: number },
): Promise<void> {
  const current = await lstat(await checkedPublicationPath(root, scope, path))
  if (!opened.isFile() || current.dev !== opened.dev || current.ino !== opened.ino)
    throw new PublicationReadRefusal(
      "changed_file",
      `Publication file changed while being read: ${path}`,
    )
}

async function readCheckedBytes(
  root: string,
  scope: string,
  path: string,
  maxBytes?: number,
  expected?: FileIdentity,
): Promise<Uint8Array> {
  const target = await checkedPublicationPath(root, scope, path)
  const handle = await open(
    target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  )
  try {
    const opened = await handle.stat()
    await verifyOpenFile(root, scope, path, opened)
    const result =
      maxBytes === undefined
        ? new Uint8Array(await handle.readFile())
        : await boundedRegularFile(handle, target, maxBytes, expected)
    await verifyOpenFile(root, scope, path, opened)
    return result
  } finally {
    await handle.close()
  }
}

async function readUnscopedBytes(fs: Fs, path: string): Promise<Uint8Array> {
  if (fs.readBytes !== undefined) return fs.readBytes(path)
  return new TextEncoder().encode(await fs.readFile(path))
}

async function checkedExists(root: string, scope: string, path: string): Promise<boolean> {
  try {
    await checkedPublicationPath(root, scope, path)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false
    throw cause
  }
}

async function readScopedRegularFile(
  root: string,
  scope: string,
  path: string,
  maxBytes: number,
  expected?: FileIdentity,
): Promise<Uint8Array> {
  if (!inside(scope, resolve(path)))
    throw new PublicationReadRefusal("outside_task", "Safe bounded source reads are unavailable")
  return readCheckedBytes(root, scope, path, maxBytes, expected)
}

async function readScopedEntries(
  fs: Fs,
  root: string,
  scope: string,
  path: string,
): ReturnType<Fs["entries"]> {
  if (!inside(scope, resolve(path))) return fs.entries(path)
  const entries = await fs.entries(await checkedPublicationPath(root, scope, path))
  for (const entry of entries) await checkedPublicationPath(root, scope, join(path, entry.name))
  return entries
}

async function readScopedText(fs: Fs, root: string, scope: string, path: string): Promise<string> {
  if (!inside(scope, resolve(path))) return fs.readFile(path)
  return new TextDecoder().decode(await readCheckedBytes(root, scope, path))
}

async function readScopedBytes(
  fs: Fs,
  root: string,
  scope: string,
  path: string,
): Promise<Uint8Array> {
  if (!inside(scope, resolve(path))) return readUnscopedBytes(fs, path)
  return readCheckedBytes(root, scope, path)
}

async function readScopedDir(fs: Fs, root: string, scope: string, path: string): Promise<string[]> {
  if (!inside(scope, resolve(path))) return fs.readdir(path)
  return fs.readdir(await checkedPublicationPath(root, scope, path))
}

export function publicationFs(fs: Fs, anchor: string, folder: string): Fs {
  const root = resolve(anchor)
  const scope = resolve(folder)
  return {
    ...fs,
    readRegularFile: (path, maxBytes, expected) =>
      readScopedRegularFile(root, scope, path, maxBytes, expected),
    readFile: (path) => readAt(path, () => readScopedText(fs, root, scope, path)),
    readBytes: (path) => readAt(path, () => readScopedBytes(fs, root, scope, path)),
    exists: (path) =>
      inside(scope, resolve(path)) ? checkedExists(root, scope, path) : fs.exists(path),
    readdir: (path) => readScopedDir(fs, root, scope, path),
    entries: (path) => readAt(path, () => readScopedEntries(fs, root, scope, path)),
  }
}

export function publicationContext(ctx: Ctx, task: { repoRoot: string; dir: string }): Ctx {
  if (ctx.fs.forPublication === undefined) throw new Error("Safe publication reads are unavailable")
  return { ...ctx, fs: ctx.fs.forPublication(task.repoRoot, task.dir) }
}
