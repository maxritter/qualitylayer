// The App's side of "Send feedback": POST /api/feedback takes the sheet's multipart form, checks it,
// saves it in the outbox and hands it to qualitylayer.dev. The diagnostics are built here from what
// the page names (its kind of page, its error counts) and this machine; the page never sends a
// version or a system of its own, and never a free-form page.

import { buildDiagnostics } from "../core/feedback/diagnostics.ts"
import { type Delivery, newReportId, retryOutbox, sendFeedback } from "../core/feedback/outbox.ts"
import { retryPublicOutbox } from "../core/feedback/public-outbox.ts"
import {
  type FeedbackImage,
  type FeedbackKind,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  type Report,
  sniffImage,
} from "../core/feedback/report.ts"
import type { Diagnostics } from "../core/feedback/words.ts"
import { loadState } from "../core/licence/cache.ts"
import { personName } from "../core/profile/name.ts"
import { type Ctx, err, ok, type Result } from "../ctx.ts"

const bad = (message: string) => err({ code: "bad_args" as const, message })

/** What the sheet needs to know before it draws: the sender line, from the licence, never a form. */
export type FeedbackWho =
  | { kind: "licence"; tier: "solo" | "team"; name: string; email: string }
  | { kind: "trial" }
  | { kind: "none" }

export async function feedbackWho(ctx: Ctx): Promise<FeedbackWho> {
  const { state } = await loadState(ctx)
  if (state === null) return { kind: "none" }
  if (state.tier === "trial") return { kind: "trial" }
  const named = await personName(ctx)
  return { kind: "licence", tier: state.tier, name: named, email: state.email }
}

/** The diagnostics as they would be sent, for "Show what is sent". */
export async function diagnosticsPreview(
  ctx: Ctx,
  body: Record<string, unknown>,
): Promise<Result<{ diagnostics: Diagnostics }>> {
  return ok({ diagnostics: await buildDiagnostics(ctx, body) })
}

type Incoming = {
  kind?: unknown
  text?: unknown
  id?: unknown
  includeDiagnostics?: unknown
  page?: unknown
  errors?: unknown
  sender?: unknown
}

type ParsedIncoming = {
  incoming: Incoming
  kind: FeedbackKind
  text: string
}

function parseReportPart(form: FormData): Result<ParsedIncoming> {
  const raw = form.get("report")
  if (typeof raw !== "string") return bad("The report part is missing.")
  let incoming: Incoming
  try {
    incoming = JSON.parse(raw) as Incoming
  } catch {
    return bad("The report is not valid JSON.")
  }
  const kind: FeedbackKind | null =
    incoming.kind === "bug" || incoming.kind === "idea" ? incoming.kind : null
  if (kind === null) return bad("The kind of report is missing.")
  if (typeof incoming.text !== "string") return bad("Write what happened or what you would like.")
  return ok({ incoming, kind, text: incoming.text })
}

async function readFeedbackImages(form: FormData): Promise<Result<FeedbackImage[]>> {
  const files = form.getAll("image")
  if (files.length > MAX_IMAGES) return bad(`At most ${MAX_IMAGES} screenshots can be sent.`)
  const images: FeedbackImage[] = []
  for (const file of files) {
    if (typeof file === "string") return bad("Each screenshot must be a file.")
    if (file.size > MAX_IMAGE_BYTES) return bad("A screenshot can be at most 5 MB.")
    const bytes = new Uint8Array(await file.arrayBuffer())
    const type = sniffImage(bytes)
    if (type === null) return bad("Screenshots must be PNG, JPEG or WebP images.")
    images.push({ name: file.name, type, bytes })
  }
  return ok(images)
}

/** Read the sheet's form into a report; the sender comes from the form only for a trial. */
export async function readForm(
  ctx: Ctx,
  form: FormData,
): Promise<Result<{ report: Report; trial: boolean }>> {
  const parsed = parseReportPart(form)
  if (!parsed.ok) return parsed
  const images = await readFeedbackImages(form)
  if (!images.ok) return images
  const { incoming, kind, text } = parsed.data
  const trial = (await loadState(ctx)).state?.tier === "trial"
  const given = incoming.sender as { name?: unknown; email?: unknown } | undefined
  const sender =
    trial && typeof given?.name === "string" && typeof given.email === "string"
      ? { name: given.name, email: given.email }
      : null
  const id =
    typeof incoming.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(incoming.id)
      ? incoming.id
      : newReportId()
  const diagnostics =
    incoming.includeDiagnostics === false ? null : await buildDiagnostics(ctx, incoming)
  return ok({
    trial,
    report: { id, kind, text, sender, diagnostics, images: images.data },
  })
}

export async function postFeedback(ctx: Ctx, request: Request): Promise<Result<Delivery>> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return bad("Send the report as multipart form data.")
  }
  const read = await readForm(ctx, form)
  if (!read.ok) return read
  return sendFeedback(ctx, read.data.report, { trial: read.data.trial })
}

/** Every few minutes: send what waited for the network. Stops with the server. */
export function startOutboxRetry(ctx: Ctx, everyMs = 2 * 60_000): () => void {
  const run = () => {
    retryOutbox(ctx).catch(() => {})
    retryPublicOutbox(ctx).catch(() => {})
  }
  run()
  const timer = setInterval(run, everyMs)
  return () => clearInterval(timer)
}
