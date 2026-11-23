// One projection for Verify, Review and the interaction API. Only recorded facts become proof.
import type { PointProof } from "../../interaction/contracts.ts"
import type { TaskDetail } from "../../server/api.ts"
import type { CheckRow } from "../checklist.ts"
import { stepsOfPoint } from "../docs/proof-list.ts"
import { proofOfPlan } from "../docs/proof-of-plan.ts"
import { flattenItems } from "../items.ts"
import { pointFiles } from "./point-files.ts"

type FlatItem = ReturnType<typeof flattenItems>[number]

/** A Done means leaf keeps its number inside the Plan's item group. */
export function donePointNumber(id: string): number | null {
  const number = /(?:^|:)done[:-](?:\d+:)?(\d+)$/.exec(id)?.[1]
  return number === undefined ? null : Number(number)
}

function proofSourceRows(task: TaskDetail, items: FlatItem[]): CheckRow[] {
  const rows = task.checklist?.groups.find((group) => group.id === "done")?.rows
  if (rows !== undefined) return rows
  const reviewed = task.review?.doneMeans ?? []
  if (reviewed.length > 0) {
    return reviewed.map((point) => ({
      id: `done:${point.n}`,
      label: [point.head, point.text].filter(Boolean).join(" "),
      state: point.proven ? "passed" : point.proof !== "" ? "failed" : "waiting",
      ...(point.proof !== "" ? { text: point.proof } : {}),
    }))
  }
  return items
    .filter((item) => item.kind === "done" && item.children === undefined)
    .flatMap((item) => {
      const n = donePointNumber(item.id)
      return n ? [{ id: `done:${n}`, label: item.what, state: "waiting" as const }] : []
    })
}

function isFixing(task: TaskDetail, row: CheckRow): boolean {
  if (row.state !== "failed" || task.stage !== "verify") return false
  return (
    task.verifyMode === "fixing" ||
    task.checklist?.now.some((entry) => entry.who === "Fixing") === true ||
    task.session?.phase === "fix"
  )
}

function pointState(
  task: TaskDetail,
  row: CheckRow,
  own: FlatItem | undefined,
): PointProof["state"] {
  if (row.state === "user" || own?.kind === "confirm") return "waiting"
  if (isFixing(task, row)) return "fixing"
  return row.state === "running" ? "checking" : row.state
}

function pointFailures(task: TaskDetail, point: number, steps: Set<string>): string[] {
  return task.verification.flatMap((round) =>
    round.verdicts
      .filter((verdict) => {
        if (verdict.verdict !== "FAIL" && verdict.verdict !== "MISSING") return false
        return verdict.kind === "done"
          ? Number(verdict.subject) === point
          : verdict.kind === "acceptance" && steps.has(verdict.subject.toUpperCase())
      })
      .map((verdict) => `Check ${round.n}: ${verdict.text}`),
  )
}

function pointConfirmation(own: FlatItem | undefined) {
  if (own?.state !== "settled" || own.answer?.kind !== "confirm") return {}
  return {
    confirmation: {
      at: own.answer.at,
      by: own.answer.by ?? "you",
      text: own.answer.note ?? own.what,
    },
  }
}

export function pointProof(task: TaskDetail): PointProof[] {
  const items = flattenItems(task.items ?? [])
  const reviewed = task.review?.doneMeans ?? []
  const source = proofSourceRows(task, items)
  const list = proofOfPlan(task.pages?.find((page) => page.step === "plan")?.body ?? "")
  // Later [!ADDED] entries can revise a numbered point. Keep its latest recorded wording once.
  const unique = new Map(source.map((row) => [row.id, row]))
  const allFiles = [...new Set(task.changedFiles ?? [])].sort()
  return [...unique.values()].flatMap((row) => {
    const point = Number(/^done:(\d+)$/.exec(row.id)?.[1])
    if (!Number.isInteger(point) || point < 1) return []
    const review = reviewed.find((entry) => entry.n === point)
    const own = items.find(
      (item) =>
        item.id === `verify:confirm:done:${point}` ||
        (item.kind === "confirm" && item.id.endsWith(`done:${point}`)),
    )
    // A point's failures are those of the steps under it.
    const steps = new Set(stepsOfPoint(list, point).map((step) => step.id))
    return [
      {
        point,
        text: row.label,
        state: pointState(task, row, own),
        expected: row.label,
        happened: row.text ?? (review?.proof || null),
        tried: pointFailures(task, point, steps),
        evidence: [
          ...new Set([
            ...(row.evidence !== undefined ? [row.evidence] : []),
            ...(review?.evidence ?? []),
          ]),
        ],
        ...pointFiles(task, row, point, allFiles),
        ...pointConfirmation(own),
      },
    ]
  })
}
