import { createHash } from "node:crypto"
import { lstat } from "node:fs/promises"
import { basename, dirname, relative, resolve } from "node:path"
import {
  attachmentPathTokens,
  type PathToken,
  withoutAttachmentPaths,
} from "../core/conversation/attachment-paths.ts"
import type { NativeRun } from "../core/conversation/service.ts"
import type { ConversationAttachment, ConversationEvent } from "../core/conversation/types.ts"
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  messageAttachmentType,
} from "../core/interaction-docs/attachments.ts"
import { runDir } from "../core/run/registry.ts"
import type { Ctx } from "../ctx.ts"

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const descriptors = new Map<string, { signature: string; file: ConversationAttachment }>()

function isSafeAttachmentToken(value: string): boolean {
  if (value.length > 4096 || /[\r\n\0]/.test(value) || /(^|[/\\])\.\.([/\\]|$)/.test(value))
    return false
  return !(/^[a-z]+:/i.test(value) && !/^[A-Za-z]:[/\\]/.test(value))
}

function isValidReceiptHash(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

function isValidReceiptGeneration(value: unknown, maxGeneration: number): boolean {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maxGeneration
  )
}

async function hasValidMessageReceipt(
  ctx: Ctx,
  dir: string,
  maxGeneration: number,
): Promise<boolean> {
  const bytes = await ctx.fs.readRegularFile?.(resolve(dir, "receipt.json"), 1024)
  if (!bytes) return false
  const receipt = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
    hash?: unknown
    generation?: unknown
  }
  return (
    isValidReceiptHash(receipt.hash) && isValidReceiptGeneration(receipt.generation, maxGeneration)
  )
}

function ownedPathTarget(ctx: Ctx, run: NativeRun, value: string) {
  if (!isSafeAttachmentToken(value)) return
  const path = resolve(run.cwd, value)
  const root = runDir(ctx.home, run.id)
  const launch = run.launchFiles?.find((file) => file.path === path && !file.missing)
  if (launch) {
    return path === resolve(root, "launch-files", "files", launch.name)
      ? { path, isLaunch: true }
      : undefined
  }
  const inside = relative(resolve(root, "message-files"), path)
  const validMessageFile =
    /^[a-f0-9-]{36}[/\\][^/\\]+$/.test(inside) && basename(path) !== "receipt.json"
  return validMessageFile ? { path, isLaunch: false } : undefined
}

/** Ownership is established before any file read; a transcript path alone grants no access. */
async function ownedFile(ctx: Ctx, run: NativeRun, value: string) {
  const target = ownedPathTarget(ctx, run, value)
  if (!target) return
  await ctx.fs.assertSafeDirectory?.(dirname(target.path))
  if (
    !target.isLaunch &&
    !(await hasValidMessageReceipt(ctx, dirname(target.path), run.generation))
  )
    return
  const info = await lstat(target.path)
  const validSize = info.size > 0 && info.size <= MAX_ATTACHMENT_BYTES
  if (!info.isFile() || info.isSymbolicLink() || !validSize) return
  return {
    path: target.path,
    signature: `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`,
  }
}

export async function runAttachmentBytes(
  ctx: Ctx,
  run: NativeRun,
  value: string,
): Promise<Uint8Array | undefined> {
  const owned = await ownedFile(ctx, run, value)
  return owned ? ctx.fs.readRegularFile?.(owned.path, MAX_ATTACHMENT_BYTES) : undefined
}

async function describeFile(
  ctx: Ctx,
  run: NativeRun,
  path: string,
): Promise<ConversationAttachment | undefined> {
  try {
    const owned = await ownedFile(ctx, run, path)
    if (!owned) return
    const key = JSON.stringify([ctx.home, run.id, run.generation, run.nativeSession, owned.path])
    const previous = descriptors.get(key)
    if (previous?.signature === owned.signature) return previous.file
    const bytes = await ctx.fs.readRegularFile?.(owned.path, MAX_ATTACHMENT_BYTES)
    const type = bytes && messageAttachmentType(basename(owned.path), bytes)
    if (!bytes || !type) return
    const file: ConversationAttachment = {
      name: basename(owned.path),
      type,
      size: bytes.length,
      source: { kind: "file", path: owned.path, digest: digest(bytes) },
    }
    descriptors.set(key, { signature: owned.signature, file })
    while (descriptors.size > 256) {
      const oldest = descriptors.keys().next().value
      if (oldest === undefined) break
      descriptors.delete(oldest)
    }
    return file
  } catch {
    return
  }
}

/** Recover cards only from bytes validated in this run's private upload/launch folders. */
export async function prepareAttachmentEvents(
  ctx: Ctx,
  run: NativeRun,
  events: ConversationEvent[],
): Promise<ConversationEvent[]> {
  const prepared: ConversationEvent[] = []
  for (const event of events) prepared.push(await prepareEvent(ctx, run, event))
  return prepared
}

async function prepareEvent(
  ctx: Ctx,
  run: NativeRun,
  event: ConversationEvent,
): Promise<ConversationEvent> {
  if (event.kind !== "user") return event
  const attachments = await structuredFiles(ctx, run, event.attachments ?? [])
  const parsed = attachmentPathTokens(event.text)
  const removed = await pastedFiles(ctx, run, parsed.tokens, attachments)
  return {
    ...event,
    text: withoutAttachmentPaths(event.text, parsed, removed),
    ...(attachments.length ? { attachments } : {}),
  }
}

async function pastedFiles(
  ctx: Ctx,
  run: NativeRun,
  tokens: PathToken[],
  attachments: ConversationAttachment[],
): Promise<PathToken[]> {
  const paths = new Set(
    attachments.flatMap((file) => (file.source?.kind === "file" ? [file.source.path] : [])),
  )
  const removed: PathToken[] = []
  for (const token of tokens) {
    if (attachments.length >= MAX_ATTACHMENTS && !paths.has(token.path)) break
    const file = await describeFile(ctx, run, token.path)
    if (file?.source?.kind !== "file") continue
    if (!paths.has(file.source.path)) attachments.push(file)
    paths.add(file.source.path)
    removed.push(token)
  }
  return removed
}

async function structuredFiles(
  ctx: Ctx,
  run: NativeRun,
  files: ConversationAttachment[],
): Promise<ConversationAttachment[]> {
  const attachments: ConversationAttachment[] = []
  for (const file of files.slice(0, MAX_ATTACHMENTS)) {
    if (file.source?.kind !== "file") {
      attachments.push(file)
      continue
    }
    const described = await describeFile(ctx, run, file.source.path)
    attachments.push(described ?? { name: file.name, type: file.type, size: file.size })
  }
  return attachments
}
