// `qualitylayer feedback "<text>" [--idea] [--image <file>]…`: the App's Report sheet, from the
// terminal. The same checks, the same outbox and the same endpoint; only the diagnostics differ in
// having no page. An agent runs it only when the user asks to send a report, after showing the text.

import { newReportId } from "../../core/feedback/outbox.ts"
import { PublicFeedbackFailure } from "../../core/feedback/public-client.ts"
import { confirmPublicReport, reviewPublicReport } from "../../core/feedback/public-outbox.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { privateFeedbackCmd } from "./feedback-private.ts"

const PUBLIC_USAGE =
  'usage: qualitylayer feedback preview "<description>" --title "<title>" [--idea]; qualitylayer feedback submit <id> --confirm <preview-digest>; use the App for public screenshots or add --private for private support'

function parsePreviewArgs(args: string[]): {
  description: string
  title: string
  kind: "bug" | "idea"
} {
  const words: string[] = []
  let title = ""
  let kind: "bug" | "idea" = "bug"
  for (let index = 1; index < args.length; index++) {
    const value = args[index] ?? ""
    if (value === "--title") {
      const next = args[++index]
      if (next === undefined)
        throw new PublicFeedbackFailure("refused", `${value} needs a value. ${PUBLIC_USAGE}`)
      title = next
    } else if (value === "--idea") kind = "idea"
    else if (value.startsWith("--"))
      throw new PublicFeedbackFailure(
        "refused",
        `Unsupported public report option ${value}. Minimal system details are always included. ${PUBLIC_USAGE}`,
      )
    else words.push(value)
  }
  return { description: words.join(" "), title, kind }
}

async function submitPublic(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  if (args.length !== 4 || args[2] !== "--confirm" || !/^[a-f0-9]{64}$/.test(args[3] ?? ""))
    throw new PublicFeedbackFailure(
      "refused",
      `Confirm the digest from the exact public preview. ${PUBLIC_USAGE}`,
    )
  const result = await confirmPublicReport(ctx, args[1] ?? "", args[3] ?? "")
  const printed =
    "message" in result ? result.message : `Public issue: ${result.issueUrl} (${result.reference})`
  return ok({ ...result, printed })
}

async function previewPublic(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const { description, title, kind } = parsePreviewArgs(args)
  const id = newReportId()
  const preview = await reviewPublicReport(ctx, { id, title, kind, description }, [])
  const command = `qualitylayer feedback submit ${id} --confirm ${preview.review.contentSha256}`
  return ok({
    status: "reviewed",
    preview,
    printed: `PUBLIC ISSUE PREVIEW · ${preview.issue.repository}\n\n${preview.issue.title}\n\n${preview.issue.body}\n\nLabels: ${preview.issue.labels.join(", ")}\n\nAnyone can read this. Check the text before publishing. Public screenshot reports use the App's visual preview.\nTo publish this exact version:\n${command}`,
  })
}

/** Public reporting has two deliberate commands; legacy reports require --private. */
export async function feedbackCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  if (args.includes("--private"))
    return privateFeedbackCmd(
      ctx,
      args.filter((arg) => arg !== "--private"),
    )
  try {
    if (args.some((arg) => arg === "--image" || arg.startsWith("--image=")))
      throw new PublicFeedbackFailure(
        "refused",
        "Public CLI reports are text-only. Use Bugs and ideas in the App to review the exact sanitized screenshots before publishing. Private support still accepts --private --image <file>.",
      )
    if (args[0] === "submit") return await submitPublic(ctx, args)
    if (args[0] === "preview") return await previewPublic(ctx, args)
    throw new PublicFeedbackFailure(
      "refused",
      `Public reports need a preview and explicit confirmation. ${PUBLIC_USAGE}`,
    )
  } catch (cause) {
    return err({
      code: "bad_args",
      message:
        cause instanceof PublicFeedbackFailure
          ? cause.message
          : "The report could not be prepared. No public confirmation was sent. Try again or use private support.",
    })
  }
}
