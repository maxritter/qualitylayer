import { createHash } from "node:crypto"
import type { Ctx } from "../../ctx.ts"
import { loadIdentity as loadState } from "../licence/identity-access.ts"
import { machineFingerprint } from "../licence/trial.ts"
import { HTTP_TIMEOUT_MS, siteUrl } from "../licensing-client/endpoints.ts"
import {
  isValidPrepareReceipt,
  isValidPublicPreview,
  isValidScreenshotPart,
  type PrepareReceipt,
  parseSubmitReceipt,
} from "./public-client-validate.ts"
import {
  PUBLIC_DESTINATION,
  type PublicDraft,
  type PublicImage,
  type PublicPreparation,
  type PublicPreview,
  type PublicReceipt,
} from "./public-contract.ts"

export type PublicIdentity = { binding: string; headers: Record<string, string> }
export class PublicFeedbackFailure extends Error {
  constructor(
    public readonly code:
      | "offline"
      | "retry"
      | "uncertain"
      | "refused"
      | "expired"
      | "private_copy_pending",
    message: string,
    public readonly receipt?: PublicReceipt,
  ) {
    super(message)
  }
}

export async function publicIdentity(ctx: Ctx): Promise<PublicIdentity> {
  const { state } = await loadState(ctx)
  if (!state)
    throw new PublicFeedbackFailure("refused", "Activate a licence or trial before reporting.")
  const headers: Record<string, string> =
    state.tier === "trial"
      ? { "x-trial-fingerprint": await machineFingerprint(ctx), "x-trial-token": state.key }
      : { "x-licence-key": state.key }
  const binding = createHash("sha256").update(JSON.stringify(headers)).digest("hex")
  return { binding, headers }
}

async function request(
  ctx: Ctx,
  identity: PublicIdentity,
  path: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await ctx.http.fetch(siteUrl(ctx.env, `/api/feedback/public/${path}`), {
      ...init,
      headers: { ...identity.headers, ...init.headers },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
  } catch {
    throw new PublicFeedbackFailure(
      "offline",
      "The connection did not answer. Your report is kept on this computer.",
    )
  }
}

async function jsonReply(response: Response): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {}
  try {
    body = (await response.json()) as Record<string, unknown>
  } catch {
    /* A gateway may answer without JSON. */
  }
  if (!response.ok || body.ok !== true) {
    if (body.error === "preparation_expired")
      throw new PublicFeedbackFailure(
        "expired",
        "The screenshot preparation expired. The exact reviewed images need renewal.",
      )
    if (body.error === "private_copy_pending") throw pendingCopyFailure(body)
    if (body.error === "submission_uncertain" || body.code === "submission_uncertain")
      throw new PublicFeedbackFailure(
        "uncertain",
        "GitHub may have received your report. Automatic retry is paused. Check the issue tracker before sending again.",
      )
    if (response.status === 429 || response.status >= 500)
      throw new PublicFeedbackFailure(
        "retry",
        "The report service is busy. Your reviewed report is kept.",
      )
    throw new PublicFeedbackFailure(
      "refused",
      "The report could not be accepted. Your draft is kept; review it and try again.",
    )
  }
  return body
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

function pendingCopyFailure(body: Record<string, unknown>): PublicFeedbackFailure {
  const reference =
    typeof body.reference === "string" && /^maxritter\/qualitylayer#[1-9]\d*$/.test(body.reference)
      ? body.reference
      : null
  const issueUrl = reference
    ? `https://github.com/maxritter/qualitylayer/issues/${reference.split("#")[1]}`
    : null
  if (!reference || !issueUrl || body.issueUrl !== issueUrl)
    return new PublicFeedbackFailure(
      "uncertain",
      "The service could not confirm the issue reference. Your report is kept and automatic retry is paused.",
    )
  return new PublicFeedbackFailure(
    "private_copy_pending",
    "Your GitHub issue is created. The private support copy is pending; the App will retry this same report.",
    { status: "submitted", reference, issueUrl },
  )
}

export async function preparePublicImages(
  ctx: Ctx,
  identity: PublicIdentity,
  id: string,
  images: PublicImage[],
): Promise<PublicPreparation | null> {
  if (images.length === 0) return null
  if (images.length > 5 || images.reduce((n, image) => n + image.bytes.length, 0) > 4 * 1024 * 1024)
    throw new PublicFeedbackFailure(
      "refused",
      "Use at most five PNG screenshots, up to 4 MB together.",
    )
  const form = new FormData()
  form.set("report", JSON.stringify({ version: 1, destination: PUBLIC_DESTINATION, id }))
  images.forEach((image, index) => {
    form.append(
      "images",
      new Blob([new Uint8Array(image.bytes)], { type: "image/png" }),
      `screenshot-${index + 1}.png`,
    )
  })
  const response = await request(ctx, identity, "prepare", { method: "POST", body: form })
  if (!response.ok) {
    await jsonReply(response)
    throw new PublicFeedbackFailure("refused", "Screenshots could not be prepared.")
  }
  const parts = await response.formData()
  const raw = parts.get("report")
  if (typeof raw !== "string")
    throw new PublicFeedbackFailure(
      "refused",
      "The screenshot preview was incomplete. Please try again.",
    )
  const receipt = JSON.parse(raw) as PrepareReceipt
  if (!isValidPrepareReceipt(receipt, id, images.length, ctx.clock.now()))
    throw new PublicFeedbackFailure(
      "refused",
      "The screenshot preview was incomplete. Please try again.",
    )
  const sanitized: PublicImage[] = []
  for (let index = 0; index < receipt.screenshots.length; index++) {
    const descriptor = receipt.screenshots[index]
    const part = parts.get(`image-${index + 1}`)
    if (!descriptor || !isValidScreenshotPart(descriptor, part))
      throw new PublicFeedbackFailure("refused", "The sanitized screenshot preview is missing.")
    const bytes = new Uint8Array(await part.arrayBuffer())
    if (sha256(bytes) !== descriptor.sha256)
      throw new PublicFeedbackFailure("refused", "The screenshot preview changed. Review it again.")
    sanitized.push({ bytes })
  }
  return {
    preparationId: receipt.preparationId,
    expiresAt: receipt.expiresAt,
    screenshots: receipt.screenshots,
    images: sanitized,
  }
}

export async function previewPublicReport(
  ctx: Ctx,
  identity: PublicIdentity,
  draft: PublicDraft,
  preparationId?: string,
): Promise<PublicPreview> {
  const body = await jsonReply(
    await request(ctx, identity, "preview", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(preparationId ? { "X-Feedback-Preparation": preparationId } : {}),
      },
      body: JSON.stringify(draft),
    }),
  )
  const preview = body.preview as PublicPreview | undefined
  if (!isValidPublicPreview(preview, draft.id))
    throw new PublicFeedbackFailure(
      "refused",
      "The public preview was incomplete. Nothing was sent.",
    )
  return preview
}

export async function submitPublicReport(
  ctx: Ctx,
  identity: PublicIdentity,
  draft: PublicDraft,
  digest: string,
  preparationId?: string,
): Promise<PublicReceipt> {
  const body = await jsonReply(
    await request(ctx, identity, "submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(preparationId ? { "X-Feedback-Preparation": preparationId } : {}),
      },
      body: JSON.stringify({
        ...draft,
        review: { version: 1, confirmed: true, contentSha256: digest },
      }),
    }),
  )
  const receipt = parseSubmitReceipt(body)
  if (!receipt)
    throw new PublicFeedbackFailure(
      "uncertain",
      "The service answered without a valid issue receipt. Your report is kept and automatic retry is paused.",
    )
  return receipt
}
