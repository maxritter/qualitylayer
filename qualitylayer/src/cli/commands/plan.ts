// plan draft · plan export --out <folder> · plan amend --by agent|user --note "<what changed and why>" [--for T<n>]...
// Thin parsing over core/gate: `draft` (core/gate/draft) validates a task's Plan and starts its
// review before the gate opens; `amend` (core/gate/amend): the build changes its approved Plan in
// place, and the note records who changed it and why. A card is the build's own: it is edited, never
// amended.

import { chatWorkflowRefusal } from "../../core/chat/task.ts"
import { amendPlan } from "../../core/gate/amend.ts"
import { draftPlan, draftWarningsAside } from "../../core/gate/draft.ts"
import { artifactCheckHelpers } from "../../core/next/plan.ts"
import { capturePlanAssets } from "../../core/plan-assets.ts"
import { withTaskComments } from "../../core/planning-comments.ts"
import { managedPlanningContext } from "../../core/run/bind.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { renderPlanFences } from "../../server/render.ts"
import { chromeRenderer, EXPORT_USAGE, exportCmd } from "./plan-export.ts"
import { parseArgs, requireTask } from "./shared.ts"

const USAGE =
  'usage: qualitylayer plan amend --by agent|user --note "<what changed and why>" [--for T<n>]... [--because "<why it is needed, and what it costs>"] (repeat --for, or give T<n>,T<m>; an agent\'s note is one plain sentence up to 200 characters, excluding generated task IDs and its prefix; keep longer reasoning in the Plan amendment record or linked task records; a finished task you untick is reopened by this command)'

/** Every task named by a --for, repeated or comma separated, in the order given. */
function tasksNamed(args: string[]): string[] {
  const named: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--for") continue
    const value = args[i + 1]
    if (value === undefined || value.startsWith("--")) continue
    named.push(
      ...value
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id !== ""),
    )
    i++
  }
  return named
}

const DRAFT_USAGE =
  "usage: qualitylayer plan draft (a task's Plan: validates it and starts its review)"

async function draftCmd(ctx: Ctx): Promise<Result<unknown>> {
  const task = await requireTask(ctx, true)
  if (!task.ok) return task
  ctx = await managedPlanningContext(ctx, task.data)
  await renderPlanFences(ctx, task.data)
  // A Plan's artifacts get their picture beside it (assets/, one per source revision), so
  // 01-plan.md reads outside QualityLayer; a computer without a browser keeps the text alone.
  const pictures = await capturePlanAssets(ctx, task.data, chromeRenderer(ctx)).catch(() => [])
  const drafted = await draftPlan(ctx, task.data)
  if (!drafted.ok) return drafted
  // The design check of each artifact runs beside the draft: one not handed out yet starts now and
  // its helpers ride along with the draft's reply.
  const due = drafted.data.warnings.some((w) => w.rule === "artifact-check-current")
  const checks = due ? await artifactCheckHelpers(ctx, task.data) : null
  const remainingWarnings = drafted.data.warnings.filter((w) => w.rule !== "artifact-check-current")
  const handedMessage =
    remainingWarnings.length === drafted.data.warnings.length
      ? drafted.data.message
      : drafted.data.message.replace(
          draftWarningsAside(drafted.data.warnings.length),
          remainingWarnings.length === 0
            ? ""
            : ` ${remainingWarnings.length} warning(s) are in \`warnings\`: fix what you agree with.`,
        )
  const handedOut =
    checks !== null && checks.on.length + checks.handles.length > 0
      ? {
          ...drafted.data,
          ...(checks.on.length === 1 ? { helper: checks.on[0] } : {}),
          ...(checks.on.length > 1 ? { helpers: checks.on } : {}),
          ...(checks.handles.length > 0 ? { artifact_checks: checks.handles } : {}),
          design_check: DESIGN_CHECK_LINE,
          // The check handed out in this reply no longer waits to be handed out.
          warnings: remainingWarnings,
          message: handedMessage,
        }
      : drafted.data
  const unpictured = pictures.filter((p) => p.status === "failed")
  const withPictures =
    unpictured.length > 0
      ? {
          ...handedOut,
          pictures_missing: unpictured.map((p) => ({ artifact: p.ref, reason: p.reason })),
        }
      : handedOut
  // A comment the person left while the Plan was written comes back with the draft's reply.
  return ok(await withTaskComments(ctx, task.data, withPictures))
}

const DESIGN_CHECK_LINE =
  "A fresh agent checks each artifact now: start the `artifact-check` helpers with exactly their briefs, go on meanwhile, write each report verbatim to its `report` file and answer each finding."

async function amendCmd(ctx: Ctx, rest: string[]): Promise<Result<unknown>> {
  const { flags } = parseArgs(rest, ["by", "note", "for", "because"])
  const by = flags.by
  const note = flags.note
  if ((by !== "agent" && by !== "user") || typeof note !== "string" || "add-file" in flags) {
    return err({ code: "bad_args", message: USAGE })
  }
  const task = await requireTask(ctx)
  if (!task.ok) return task
  return amendPlan(ctx, task.data, {
    by,
    note,
    taskIds: tasksNamed(rest),
    ...(typeof flags.because === "string" ? { because: flags.because } : {}),
  })
}

export async function planCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const selected = await requireTask(ctx)
  if (selected.ok && selected.data.type === "chat") return chatWorkflowRefusal()
  const [sub, ...rest] = args
  if (sub === "draft") return draftCmd(ctx)
  if (sub === "amend") return amendCmd(ctx, rest)
  if (sub === "export") return exportCmd(ctx, rest)
  return err({
    code: "bad_args",
    message: `${USAGE}\n${DRAFT_USAGE}\n${EXPORT_USAGE}`,
  })
}
