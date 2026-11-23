// Done means agreements belong to the words the person saw, independently of the section or
// its numbering. Keep the old words when a point changes so asking again explains the change.
import { createHash } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { folderDoc } from "../docs/names.ts"
import type { Comment, CommentInput } from "../gate/comments.ts"
import { type Item, pointText } from "../items.ts"
import {
  ANNOTATION_RECORD_BYTES,
  fields,
  jsonBytes,
  object,
  type RecordOwner,
} from "../records/contract.ts"
import { readOptionalRecordBytes, recordFileIO, writeRecordText } from "../records/files.ts"
import { currentTaskRecordOwner, refuseLegacyAnnotationWrite } from "./answer-migration.ts"

type Agreement = { item: string; text: string; at: number; active: boolean }
type Agreements = Record<string, Agreement>
const point = (id: string | undefined) => /^plan:done:1:\d+$/.test(id ?? "")
const key = (text: string) =>
  createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16)
const path = (task: { runtimeDir: string }) => join(task.runtimeDir, "point-confirmations.json")

async function writePointHistory(ctx: Ctx, owner: RecordOwner, stored: Agreements) {
  const raw = await readOptionalRecordBytes(
    ctx,
    owner,
    "point-confirmations.json",
    ANNOTATION_RECORD_BYTES,
  )
  const original = raw
    ? (JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(raw)) as unknown)
    : {}
  if (!object(original)) throw new Error("Invalid point history; originals were kept")
  const output = jsonBytes({ ...original, ...stored })
  if (Buffer.byteLength(output) > ANNOTATION_RECORD_BYTES) throw new Error("Point history is full")
  await writeRecordText(ctx, owner, "point-confirmations.json", output)
}

/** Change one agreement, keeping every other point's normalized wording and audit record. */
export async function recordPointAgreement(
  ctx: Ctx,
  task: { runtimeDir: string },
  item: Item,
  input: { agree: boolean; comments: readonly Comment[]; acceptedAt?: number },
): Promise<void> {
  const { agree, comments, acceptedAt } = input
  if (!point(item.id)) return
  const owner = await currentTaskRecordOwner(ctx, task)
  const write = async () => {
    const stored = await pointAgreements(ctx, task, comments)
    const text = pointText(item)
    const previous = stored[key(text)]
    if (!agree && previous === undefined) return
    stored[key(text)] = {
      ...previous,
      item: item.id,
      text,
      at: agree ? (acceptedAt ?? ctx.clock.now()) : (previous?.at ?? acceptedAt ?? ctx.clock.now()),
      active: agree,
    }
    if (owner) await writePointHistory(ctx, owner, stored)
    else await ctx.fs.atomicWrite(path(task), `${JSON.stringify(stored, null, 2)}\n`)
  }
  if (owner) await (await recordFileIO(ctx, owner)).lock("point-confirmations", write)
  else await write()
}

function parseAgreements(raw: unknown): Agreements {
  const stored: Agreements = {}
  if (!object(raw)) throw new Error("Invalid point history; originals were kept")
  for (const [hash, value] of Object.entries(raw))
    if (
      fields(value, {
        text: (word) => typeof word === "string",
        item: (id) => typeof id === "string",
        at: Number.isFinite,
        active: (active) => typeof active === "boolean",
      })
    )
      stored[hash] = value as Agreement
  return stored
}

async function storedAgreements(ctx: Ctx, task: { runtimeDir: string }) {
  const owner = await currentTaskRecordOwner(ctx, task)
  if (owner) {
    const raw = await readOptionalRecordBytes(
      ctx,
      owner,
      "point-confirmations.json",
      ANNOTATION_RECORD_BYTES,
    )
    return raw
      ? parseAgreements(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(raw)))
      : {}
  }
  try {
    return parseAgreements(JSON.parse(await ctx.fs.readFile(path(task))))
  } catch {
    return {}
  }
}

function commentAgreement(c: Comment) {
  if (c.kind !== "agree" || c.quote.trim() === "" || c.authorityDigest === "historical")
    return false
  return point(c.item)
}

export async function pointAgreements(
  ctx: Ctx,
  task: { runtimeDir: string },
  comments: readonly Comment[],
): Promise<Agreements> {
  const out = { ...(await storedAgreements(ctx, task)) }
  for (const c of comments)
    if (commentAgreement(c)) {
      out[key(c.quote)] ??= { item: c.item as string, text: c.quote, at: c.created, active: true }
    }
  return out
}

function hasImmediateAgreement(comments: readonly Comment[], hash: string): boolean {
  return comments.some((c) => c.immediate && c.kind === "agree" && key(c.quote) === hash)
}

export async function savePointAgreements(
  ctx: Ctx,
  task: { runtimeDir: string },
  doc: string,
  comments: readonly Comment[],
  drafts: readonly CommentInput[],
): Promise<void> {
  if (doc !== folderDoc("plan")) return
  await refuseLegacyAnnotationWrite(ctx, task)
  const stored = await pointAgreements(ctx, task, comments)
  const agreed = drafts.filter(
    (d) => point(d.item) && d.kind === "agree" && (d.quote ?? "").trim() !== "",
  )
  for (const [hash, entry] of Object.entries(stored)) {
    const inDrafts = agreed.some((d) => key(d.quote ?? "") === hash)
    const keptImmediate = entry.active && hasImmediateAgreement(comments, hash)
    stored[hash] = { ...entry, active: inDrafts || keptImmediate }
  }
  for (const d of agreed) {
    const text = d.quote ?? ""
    stored[key(text)] = {
      item: d.item as string,
      text,
      at: stored[key(text)]?.at ?? ctx.clock.now(),
      active: true,
    }
  }
  if (Object.keys(stored).length > 0)
    await ctx.fs.atomicWrite(path(task), `${JSON.stringify(stored, null, 2)}\n`)
}

function groupAgreement(item: Item, agreements: Agreements): Item {
  const children = applyPointAgreements(item.children ?? [], agreements)
  const reopen =
    item.id === "plan:done:1" &&
    item.state === "settled" &&
    Object.keys(agreements).length > 0 &&
    children.some((child) => child.state === "open")
  if (!reopen) return { ...item, children }
  const { answer: _answer, ...group } = item
  return { ...group, children, state: "open", changedSinceReview: true }
}

function previousWords(agreements: Agreements, item: Item, text: string) {
  return Object.values(agreements)
    .filter((entry) => entry.item === item.id && key(entry.text) !== key(text))
    .sort((left, right) => right.at - left.at)[0]
}

function leafAgreement(item: Item, agreements: Agreements): Item {
  if (!point(item.id)) return item
  const currentChange =
    item.answer?.kind === "change" && (item.state === "chosen" || item.state === "sent")
  if (currentChange && !item.updated) return item
  const text = pointText(item)
  const exact = agreements[key(text)]
  const { answer: _answer, updated: _updated, changedSinceReview: _changed, ...plain } = item
  if (exact?.active) return { ...plain, state: "chosen", answer: { kind: "agree", at: exact.at } }
  const previous = previousWords(agreements, item, text)
  if (previous !== undefined)
    return { ...plain, state: "open", changedSinceReview: true, changedFrom: previous.text }
  return exact === undefined ? item : { ...plain, state: "open" }
}

export function applyPointAgreements(items: Item[], agreements: Agreements): Item[] {
  return items.map((item) =>
    item.children === undefined
      ? leafAgreement(item, agreements)
      : groupAgreement(item, agreements),
  )
}
