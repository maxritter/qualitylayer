import type { Fact } from "../../step-page/bands/FactRow.tsx"
import { type GistProps, metaLine } from "../../step-page/bands/Gist.tsx"
import { type BoardStage, spanWords, type verifyView, whenWords } from "./progress.ts"

type VerifyView = ReturnType<typeof verifyView>

/** A stopped live session keeps its recorded results, but no lane still reads as running. */
export function verifyBoardStages(view: VerifyView, working: boolean): BoardStage[] {
  if (working) return view.stages
  return view.stages.map((stage) => ({
    ...stage,
    state: stage.state === "running" ? "waiting" : stage.state,
    checks: stage.checks.map((check) =>
      check.state === "running" ? { ...check, state: "waiting" } : check,
    ),
    segments: stage.segments.map((segment) => (segment === "w" ? "" : segment)),
  }))
}

function verifyMeta(view: VerifyView): string {
  if (view.phase === "decision") return "fix rounds done · one decision for you, then your review"
  if (view.phase === "verified") {
    const { started, ended } = view
    if (started === null || ended === null) return "verified"
    return metaLine(
      `verified ${whenWords(started)} to ${whenWords(ended)}`,
      spanWords(ended - started),
      undefined,
    )
  }
  return metaLine(
    view.started !== null ? `started ${whenWords(view.started)}` : undefined,
    view.elapsed !== null ? `${view.elapsed} so far` : undefined,
    undefined,
  )
}

function verifyFacts(view: VerifyView): Fact[] {
  const { phase, points, byPoint } = view
  if (phase === "decision" || points.total === 0) return []
  // Point-based Plans count proven Done means; numbered acceptance steps count judged points.
  const counted = byPoint || phase !== "checking" ? points.passed : points.judged
  return [
    {
      value: `${counted} of ${points.total}`,
      label: byPoint ? "Done means proven" : phase === "checking" ? "points judged" : "points pass",
      bar: { done: counted, total: points.total },
      ...(view.roundWords !== "" ? { sub: view.roundWords } : {}),
    },
  ]
}

/** The header projects only the board's current view; document actions stay with the page. */
export function verifyBoardHeader(view: VerifyView): Pick<GistProps, "meta" | "facts" | "now"> {
  const current = view.now
  return {
    meta: verifyMeta(view),
    facts: verifyFacts(view),
    ...(current !== null && view.phase !== "decision" && view.phase !== "verified"
      ? {
          now: {
            id: current.stage,
            label:
              current.line.length <= 56 ? current.line : `${current.line.slice(0, 55).trimEnd()}…`,
            target: `vb-lane-${current.lane}`,
          },
        }
      : {}),
  }
}
