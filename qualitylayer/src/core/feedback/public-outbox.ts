import { createHash } from "node:crypto"
import type { Ctx } from "../../ctx.ts"
import { VERSION } from "../version.ts"
import { realFacts, type SystemFacts } from "./diagnostics.ts"
import {
  PublicFeedbackFailure,
  preparePublicImages,
  previewPublicReport,
  publicIdentity,
} from "./public-client.ts"
import {
  PUBLIC_DESTINATION,
  type PublicDelivery,
  type PublicDraft,
  type PublicImage,
  type PublicInput,
  type PublicPreview,
  type PublicSystem,
} from "./public-contract.ts"
import { deliverPublicReport, retryWaitingPublicReports } from "./public-outbox-deliver.ts"
import {
  assertPublicCaller,
  PUBLIC_MAX_AGE,
  publicImagesOf,
  publicOutboxDir,
  publicReportLock,
  publicReportPath,
  readPublicReport,
  type StoredPublicReport,
  savePublicReport,
} from "./public-outbox-store.ts"

export { publicOutboxDir }

const retryingHomes = new Set<string>()

export async function minimalPublicSystem(facts?: SystemFacts): Promise<PublicSystem> {
  const known = facts ?? (await realFacts())
  const match = /^(macOS|Windows|Linux) ([0-9.]+)/.exec(known.os)
  if (!match)
    throw new PublicFeedbackFailure(
      "refused",
      "This system is not supported for public reports. Use private support.",
    )
  return {
    appVersion: VERSION,
    os: { family: match[1] as PublicSystem["os"]["family"], version: match[2] ?? "0" },
    architecture: known.arch,
  }
}

function isValidPublicInput(input: PublicInput): boolean {
  if (input.kind !== "bug" && input.kind !== "idea") return false
  if (!input.title.trim() || input.title.length > 120) return false
  return Boolean(input.description.trim()) && input.description.length <= 5000
}

export async function reviewPublicReport(
  ctx: Ctx,
  input: PublicInput,
  images: PublicImage[],
  system?: PublicSystem,
): Promise<PublicPreview> {
  publicReportPath(ctx, input.id)
  if (!isValidPublicInput(input))
    throw new PublicFeedbackFailure(
      "refused",
      "Add a title up to 120 characters and a description up to 5,000 characters.",
    )
  const identity = await publicIdentity(ctx)
  await ctx.fs.mkdir(publicOutboxDir(ctx), { mode: 0o700 })
  return ctx.fs.withLock(publicReportLock(ctx, input.id), async () => {
    if (await ctx.fs.exists(publicReportPath(ctx, input.id))) {
      const held = await readPublicReport(ctx, input.id)
      assertPublicCaller(held, identity)
      if (held.state !== "reviewed")
        throw new PublicFeedbackFailure(
          "refused",
          "Stop queued delivery before editing. A submitted or uncertain report cannot be replaced.",
        )
    }
    const preparation = await preparePublicImages(ctx, identity, input.id, images)
    const draft: PublicDraft = {
      version: 1,
      destination: PUBLIC_DESTINATION,
      id: input.id,
      content: {
        kind: input.kind,
        title: input.title,
        description: input.description,
        system: system ?? (await minimalPublicSystem()),
        screenshots: preparation?.screenshots ?? [],
      },
    }
    const preview = await previewPublicReport(ctx, identity, draft, preparation?.preparationId)
    const entry: StoredPublicReport = {
      version: 1,
      destination: PUBLIC_DESTINATION,
      caller: identity.binding,
      at: ctx.clock.now(),
      state: "reviewed",
      draft: { ...draft, content: preview.content },
      preview,
      preparation: preparation
        ? { id: preparation.preparationId, expiresAt: preparation.expiresAt }
        : null,
      images: (preparation?.images ?? []).map((image) =>
        Buffer.from(image.bytes).toString("base64"),
      ),
    }
    await savePublicReport(ctx, entry)
    return preview
  })
}

export async function confirmPublicReport(
  ctx: Ctx,
  id: string,
  digest: string,
): Promise<PublicDelivery> {
  const identity = await publicIdentity(ctx)
  return ctx.fs.withLock(publicReportLock(ctx, id), async () => {
    const entry = await readPublicReport(ctx, id)
    assertPublicCaller(entry, identity)
    if (digest !== entry.preview.review.contentSha256)
      throw new PublicFeedbackFailure(
        "refused",
        "The reviewed content changed. Preview the report again.",
      )
    if (entry.createdReceipt && (entry.state === "submitted" || entry.state === "uncertain"))
      return entry.createdReceipt
    if (entry.receipt && (entry.state === "submitted" || entry.state === "uncertain"))
      return entry.receipt
    if (entry.state !== "reviewed" && entry.state !== "queued")
      throw new PublicFeedbackFailure("refused", "Preview the report before submitting.")
    entry.state = "queued"
    await savePublicReport(ctx, entry)
    return deliverPublicReport(ctx, identity, entry)
  })
}

export async function publicReportImage(ctx: Ctx, id: string, index: number): Promise<Uint8Array> {
  return ctx.fs.withLock(publicReportLock(ctx, id), async () => {
    const entry = await readPublicReport(ctx, id)
    assertPublicCaller(entry, await publicIdentity(ctx))
    const image = publicImagesOf(entry)[index]
    const descriptor = entry.preview.content.screenshots[index]
    if (
      !image ||
      !descriptor ||
      createHash("sha256").update(image.bytes).digest("hex") !== descriptor.sha256
    )
      throw new PublicFeedbackFailure(
        "refused",
        "The screenshot is no longer available. Preview the report again.",
      )
    return image.bytes
  })
}

/** Read the owner's retained outcome without submitting, renewing a lease or changing consent. */
export async function publicReportStatus(ctx: Ctx, id: string): Promise<PublicDelivery | null> {
  const identity = await publicIdentity(ctx)
  if (!(await ctx.fs.exists(publicReportPath(ctx, id)))) return null
  return ctx.fs.withLock(
    publicReportLock(ctx, id),
    async () => {
      const entry = await readPublicReport(ctx, id, false)
      assertPublicCaller(entry, identity)
      if (ctx.clock.now() - entry.at > PUBLIC_MAX_AGE || entry.state === "reviewed") return null
      if (entry.createdReceipt) return entry.createdReceipt
      if (entry.receipt) return entry.receipt
      return {
        status: entry.state === "queued" ? "queued" : "uncertain",
        id,
        message:
          entry.state === "queued"
            ? "The exact reviewed report is queued on this computer."
            : "The report outcome is uncertain. Automatic retry is paused.",
      }
    },
    { createParent: false },
  )
}

export async function cancelPublicReport(ctx: Ctx, id: string): Promise<void> {
  const identity = await publicIdentity(ctx)
  await ctx.fs.withLock(publicReportLock(ctx, id), async () => {
    const entry = await readPublicReport(ctx, id)
    assertPublicCaller(entry, identity)
    if (entry.createdReceipt)
      throw new PublicFeedbackFailure(
        "refused",
        "The GitHub issue is already created. Follow its actual issue link to update it.",
      )
    if (entry.state !== "reviewed" && entry.state !== "queued")
      throw new PublicFeedbackFailure(
        "refused",
        "The report may already be public. Its delivery cannot be undone here.",
      )
    entry.state = "reviewed"
    delete entry.receipt
    await savePublicReport(ctx, entry)
  })
}

export async function retryPublicOutbox(ctx: Ctx): Promise<void> {
  if (retryingHomes.has(ctx.home)) return
  retryingHomes.add(ctx.home)
  try {
    await retryWaitingPublicReports(ctx)
  } finally {
    retryingHomes.delete(ctx.home)
  }
}
