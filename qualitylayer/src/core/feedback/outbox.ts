// Sending a report: it is written to <QualityLayer home>/feedback-outbox/ first, then handed to
// qualitylayer.dev. A report the network could not carry stays there and goes out by itself when
// the server finds the network again; one the site refused is dropped with its reason.

import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import {
  deliverFeedback,
  feedbackIdentity,
  type QueuedWhy,
  type Verdict,
} from "./outbox-deliver.ts"
import {
  type FeedbackKind,
  type ImageType,
  problemWith,
  type Report,
  type Sender,
  sniffImage,
} from "./report.ts"
import type { Diagnostics } from "./words.ts"

export type { QueuedWhy } from "./outbox-deliver.ts"

export const outboxDir = (ctx: Ctx) => join(ctx.home, "feedback-outbox")

type Stored = {
  id: string
  at: number
  kind: FeedbackKind
  text: string
  sender: Sender | null
  diagnostics: Diagnostics | null
  images: { name: string; type: ImageType; data: string }[]
  attempts: number
  /** Not before this time (ms): the site asked for a pause. */
  notBefore?: number
}

export type Delivery =
  | { status: "sent"; reference: string }
  | { status: "queued"; id: string; why: QueuedWhy; message?: string }

/** A queued report is dropped after this long: the machine had no licence or trial, or the site never took it. */
export const OUTBOX_MAX_AGE_MS = 30 * 24 * 3_600_000

/** Reports being delivered right now, by the interactive send or a retry; neither touches the other's. */
const inFlight = new Set<string>()

const toStored = (report: Report, at: number): Stored => ({
  id: report.id,
  at,
  kind: report.kind,
  text: report.text,
  sender: report.sender,
  diagnostics: report.diagnostics,
  images: report.images.map((image) => ({
    name: image.name,
    type: image.type,
    data: Buffer.from(image.bytes).toString("base64"),
  })),
  attempts: 0,
})

const toReport = (entry: Stored): Report => ({
  id: entry.id,
  kind: entry.kind,
  text: entry.text,
  sender: entry.sender,
  diagnostics: entry.diagnostics,
  images: entry.images.map((image) => ({
    name: image.name,
    type: image.type,
    bytes: new Uint8Array(Buffer.from(image.data, "base64")),
  })),
})

/** A report's id: letters, digits, dash and underscore only, as the site accepts it. */
export const newReportId = (): string => randomUUID()

async function write(ctx: Ctx, entry: Stored): Promise<void> {
  await ctx.fs.mkdir(outboxDir(ctx), { mode: 0o700 })
  // Temp file, then rename: a crash mid-write never leaves a half entry that stored() skips forever.
  await ctx.fs.atomicWrite(join(outboxDir(ctx), `${entry.id}.json`), JSON.stringify(entry))
}

const drop = (ctx: Ctx, id: string) => ctx.fs.remove(join(outboxDir(ctx), `${id}.json`))

async function preflightSend(ctx: Ctx, report: Report, trial: boolean): Promise<string | null> {
  const problem = problemWith(report, trial)
  if (problem !== null) return problem
  if ((await feedbackIdentity(ctx)) === null) {
    return "There is no licence or trial on this computer, so the report cannot be sent."
  }
  return null
}

async function finishSend(ctx: Ctx, entry: Stored, verdict: Verdict): Promise<Result<Delivery>> {
  if (verdict.kind === "sent") {
    await drop(ctx, entry.id)
    return ok({ status: "sent", reference: verdict.reference })
  }
  if (verdict.kind === "refused") {
    await drop(ctx, entry.id)
    return err({ code: "bad_args", message: verdict.message })
  }
  if (verdict.notBefore !== undefined) await write(ctx, { ...entry, notBefore: verdict.notBefore })
  return ok({
    status: "queued",
    id: entry.id,
    why: verdict.reason,
    ...(verdict.message !== undefined ? { message: verdict.message } : {}),
  })
}

/** Check, save and send a report. `queued` means the network could not carry it: it waits in the outbox. */
export async function sendFeedback(
  ctx: Ctx,
  report: Report,
  options: { trial: boolean },
): Promise<Result<Delivery>> {
  const problem = await preflightSend(ctx, report, options.trial)
  if (problem !== null) return err({ code: "bad_args", message: problem })
  // The same report already on its way (a second Send of one draft): it waits for that delivery.
  if (inFlight.has(report.id)) return ok({ status: "queued", id: report.id, why: "busy" })
  inFlight.add(report.id)
  try {
    const entry = toStored(report, ctx.clock.now())
    await write(ctx, entry)
    return await finishSend(ctx, entry, await deliverFeedback(ctx, report))
  } finally {
    inFlight.delete(report.id)
  }
}

async function stored(ctx: Ctx): Promise<Stored[]> {
  let names: string[]
  try {
    names = await ctx.fs.readdir(outboxDir(ctx))
  } catch {
    return []
  }
  const found: Stored[] = []
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    try {
      const entry = JSON.parse(await ctx.fs.readFile(join(outboxDir(ctx), name))) as Stored
      if (typeof entry.id === "string" && typeof entry.text === "string") found.push(entry)
    } catch {
      // a half-written or foreign file stays where it is
    }
  }
  return found
}

/** How many reports wait for the network. */
export async function waiting(ctx: Ctx): Promise<number> {
  return (await stored(ctx)).length
}

async function deliverStoredEntry(
  ctx: Ctx,
  entry: Stored,
): Promise<"sent" | "dropped" | "waiting"> {
  const report = toReport(entry)
  // An image that is not one any more is not sent.
  report.images = report.images.filter((image) => sniffImage(image.bytes) !== null)
  const verdict = await deliverFeedback(ctx, report)
  if (verdict.kind === "sent") {
    await drop(ctx, entry.id)
    return "sent"
  }
  if (verdict.kind === "refused") {
    await drop(ctx, entry.id)
    return "dropped"
  }
  // Only while the file is still there: it may have been sent and dropped meanwhile.
  if (await ctx.fs.exists(join(outboxDir(ctx), `${entry.id}.json`))) {
    await write(ctx, {
      ...entry,
      attempts: entry.attempts + 1,
      ...(verdict.notBefore !== undefined ? { notBefore: verdict.notBefore } : {}),
    })
  }
  return "waiting"
}

async function retryEntry(
  ctx: Ctx,
  entry: Stored,
  now: number,
): Promise<"sent" | "dropped" | "waiting"> {
  if (inFlight.has(entry.id)) return "waiting"
  if (typeof entry.at === "number" && now - entry.at > OUTBOX_MAX_AGE_MS) {
    await drop(ctx, entry.id)
    return "dropped"
  }
  if (typeof entry.notBefore === "number" && entry.notBefore > now) return "waiting"
  inFlight.add(entry.id)
  try {
    return await deliverStoredEntry(ctx, entry)
  } finally {
    inFlight.delete(entry.id)
  }
}

/** Send what waits in the outbox; reports the site accepts or refuses leave it, the rest stay for the next try. */
export async function retryOutbox(ctx: Ctx): Promise<{ sent: number; waiting: number }> {
  let sent = 0
  let left = 0
  const now = ctx.clock.now()
  for (const entry of await stored(ctx)) {
    const outcome = await retryEntry(ctx, entry, now)
    if (outcome === "sent") sent++
    else if (outcome === "waiting") left++
  }
  return { sent, waiting: left }
}
