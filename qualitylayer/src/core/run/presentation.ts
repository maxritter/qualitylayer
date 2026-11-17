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
          : "Your turn: read the Plan or give feedback in your agent's chat."
        : reviewPending
          ? "Your turn: read the Plan in QualityLayer; Approve unlocks once the review is folded in."
          : inApp
            ? "Your turn: read the Plan here, or mark what should change."
            : "Your turn: open QualityLayer to read the Plan, or mark what should change.",
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
