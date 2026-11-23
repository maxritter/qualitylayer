import { PublicFeedbackFailure } from "../core/feedback/public-client.ts"
import type { PublicImage, PublicInput } from "../core/feedback/public-contract.ts"
import {
  cancelPublicReport,
  confirmPublicReport,
  minimalPublicSystem,
  publicReportImage,
  publicReportStatus,
  reviewPublicReport,
} from "../core/feedback/public-outbox.ts"
import { sniffImage } from "../core/feedback/report.ts"
import { type Ctx, err, ok, type Result } from "../ctx.ts"

const failure = (cause: unknown) =>
  err({
    code: "bad_args" as const,
    message:
      cause instanceof PublicFeedbackFailure
        ? cause.message
        : "The report could not be prepared. Your draft is kept. Try again.",
  })

export async function publicFeedbackSystem(): Promise<Result<unknown>> {
  try {
    return ok({ system: await minimalPublicSystem() })
  } catch (cause) {
    return failure(cause)
  }
}

const PUBLIC_INPUT_KEYS = new Set(["id", "kind", "title", "description"])

function isValidPublicInput(data: Record<string, unknown>): data is PublicInput {
  const hasStrings =
    typeof data.id === "string" &&
    typeof data.title === "string" &&
    typeof data.description === "string"
  if (!hasStrings) return false
  if (data.kind !== "bug" && data.kind !== "idea") return false
  return Object.keys(data).every((key) => PUBLIC_INPUT_KEYS.has(key))
}

export async function publicFeedbackReview(ctx: Ctx, request: Request): Promise<Result<unknown>> {
  try {
    const length = request.headers.get("content-length")
    if (length && Number(length) > 4.5 * 1024 * 1024)
      throw new PublicFeedbackFailure("refused", "Screenshots must be up to 4 MB together.")
    const form = await request.formData()
    const raw = form.get("report")
    if (typeof raw !== "string" || raw.length > 6000)
      throw new PublicFeedbackFailure("refused", "The report is incomplete.")
    const data = JSON.parse(raw) as Record<string, unknown>
    if (!isValidPublicInput(data))
      throw new PublicFeedbackFailure("refused", "Add the report title and description.")
    const files = form.getAll("image")
    if (files.length > 5)
      throw new PublicFeedbackFailure("refused", "Use at most five screenshots.")
    const images: PublicImage[] = []
    let total = 0
    for (const file of files) {
      if (file instanceof Blob) total += file.size
      if (!(file instanceof Blob) || total > 4 * 1024 * 1024)
        throw new PublicFeedbackFailure(
          "refused",
          "Screenshots must be PNG images up to 4 MB together.",
        )
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (sniffImage(bytes) !== "image/png")
        throw new PublicFeedbackFailure(
          "refused",
          "Public screenshots must be PNG images. Add JPEG or WebP images through the App so it can convert them.",
        )
      images.push({ bytes })
    }
    const preview = await reviewPublicReport(ctx, data as PublicInput, images)
    return ok({
      preview,
      images: preview.content.screenshots.map((_, index) => ({
        url: `/api/feedback/public/image/${preview.id}/${index}`,
        alt: `Screenshot ${index + 1}`,
      })),
    })
  } catch (cause) {
    return failure(cause)
  }
}

export async function publicFeedbackConfirm(
  ctx: Ctx,
  body: Record<string, unknown>,
): Promise<Result<unknown>> {
  try {
    if (typeof body.id !== "string" || typeof body.digest !== "string" || body.confirmed !== true)
      throw new PublicFeedbackFailure(
        "refused",
        "Confirm the exact public issue preview before sending.",
      )
    return ok(await confirmPublicReport(ctx, body.id, body.digest))
  } catch (cause) {
    return failure(cause)
  }
}

export async function publicFeedbackCancel(
  ctx: Ctx,
  body: Record<string, unknown>,
): Promise<Result<unknown>> {
  try {
    if (typeof body.id !== "string")
      throw new PublicFeedbackFailure("refused", "The report ID is missing.")
    await cancelPublicReport(ctx, body.id)
    return ok({ stopped: true })
  } catch (cause) {
    return failure(cause)
  }
}

export async function publicFeedbackImage(ctx: Ctx, id: string, index: number): Promise<Response> {
  try {
    const bytes = await publicReportImage(ctx, id, index)
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    })
  } catch {
    return new Response("Screenshot unavailable", {
      status: 404,
      headers: { "cache-control": "no-store" },
    })
  }
}

export async function publicFeedbackStatus(ctx: Ctx, id: string): Promise<Result<unknown>> {
  try {
    return ok({ delivery: await publicReportStatus(ctx, id) })
  } catch (cause) {
    return failure(cause)
  }
}
