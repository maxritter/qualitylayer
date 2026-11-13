import type { Ctx } from "../../ctx.ts"

export function planPresentation(
  inApp: boolean,
  answers: "app" | "terminal" = "app",
  reviewPending = false,
) {
  return {
    surface: inApp ? ("app-terminal" as const) : ("external" as const),
    planHandoff:
      answers === "terminal"
        ? reviewPending
          ? "Read the Plan or give feedback in your agent's chat. Approval follows once the review is folded in."
          : "Your turn: approve the Plan or give feedback in your agent's chat."
        : reviewPending
          ? "Your turn: read the Plan in QualityLayer; Approve unlocks once the review is folded in."
          : inApp
            ? "Your turn: use Approve and build here, the arrow beside it for another way to build, or mark what should change in the Plan."
            : "Your turn: open QualityLayer and approve the Plan, or mark what should change in it.",
  }
}

/** Called inside the validated next wrapper. */
export function withPlanPresentation<T extends Record<string, unknown>>(
  ctx: Ctx,
  payload: T,
): T & { task?: unknown; presentation?: ReturnType<typeof planPresentation> } {
  if (payload.phase !== "plan" || typeof payload.task !== "string") return payload
  return {
    ...payload,
    presentation: planPresentation(
      ctx.managedRunPurpose !== undefined,
      payload.answers === "terminal" ? "terminal" : "app",
    ),
  }
}
