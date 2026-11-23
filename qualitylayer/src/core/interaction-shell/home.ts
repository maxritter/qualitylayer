import type { HomeFacts, HomePeriod } from "../../interaction/contracts.ts"
import type { TaskSummary } from "../../server/api.ts"
import { FLOW_STEPS, type FlowStepId, flowStepOf } from "../flow.ts"

function parts(at: number, timezone: string) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(at)
  const read = (name: string) => Number(values.find((p) => p.type === name)?.value)
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  }
}
function midnight(year: number, month: number, day: number, timezone: string) {
  const desired = Date.UTC(year, month - 1, day)
  let at = desired
  for (let i = 0; i < 4; i++) {
    const p = parts(at, timezone)
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at
    const next = desired - offset
    if (next === at) break
    at = next
  }
  return at
}
export function calendarPeriods(
  now: number,
  timezone: string,
): Record<HomePeriod, { from: number; to: number }> {
  const p = parts(now, timezone)
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day))
  const monday = p.day - ((date.getUTCDay() + 6) % 7)
  return {
    today: {
      from: midnight(p.year, p.month, p.day, timezone),
      to: midnight(p.year, p.month, p.day + 1, timezone),
    },
    week: {
      from: midnight(p.year, p.month, monday, timezone),
      to: midnight(p.year, p.month, monday + 7, timezone),
    },
    month: {
      from: midnight(p.year, p.month, 1, timezone),
      to: midnight(p.year, p.month + 1, 1, timezone),
    },
  }
}
export function shippedAt(task: TaskSummary, timezone = "UTC"): number | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(task.closing?.shipped ?? "")
  if (day) return midnight(Number(day[1]), Number(day[2]), Number(day[3]), timezone)
  const at = Date.parse(task.closing?.shipped ?? "")
  return Number.isFinite(at) ? at : null
}
type HomeSpending = Partial<
  Record<HomePeriod, NonNullable<HomeFacts["periods"]["today"]["spending"]>>
>

type HomeFactsArgs = [
  tasks: TaskSummary[],
  now: number,
  timezone: string,
  costs: Record<string, number | null>,
  approvals?: Record<string, number | null>,
  spending?: HomeSpending,
]

function medianDuration(durations: number[]): number | null {
  if (durations.length === 0) return null
  const middle = Math.floor(durations.length / 2)
  if (durations.length % 2 === 1) return durations[middle] ?? null
  return ((durations[middle - 1] ?? 0) + (durations[middle] ?? 0)) / 2
}

function shippedInRange(params: {
  tasks: TaskSummary[]
  range: { from: number; to: number }
  now: number
  timezone: string
  costs: Record<string, number | null>
  approvals: Record<string, number | null>
}) {
  const { tasks, range, now, timezone, costs, approvals } = params
  const ceiling = Math.min(range.to, now + 1)
  // A task whose pull request is still open is not closed: it is in the open list (Running) until
  // the merge, as in the sidebar, and counts as shipped from then on.
  return tasks
    .filter((t) => t.stage === "shipped" && t.pullRequest?.state !== "open")
    .flatMap((t) => {
      const recorded =
        approvals[t.id] ?? (t.closing?.shipped?.includes("T") ? shippedAt(t, timezone) : null)
      const at = recorded ?? shippedAt(t, timezone)
      if (at === null || at < range.from || at >= ceiling) return []
      return [
        {
          taskId: t.id,
          at,
          costUsd: costs[t.id] ?? null,
          durationMs: recorded !== null && recorded >= t.created ? recorded - t.created : null,
        },
      ]
    })
    .sort((a, b) => b.at - a.at)
}

function buildPeriodFacts(params: {
  tasks: TaskSummary[]
  range: { from: number; to: number }
  now: number
  timezone: string
  costs: Record<string, number | null>
  approvals: Record<string, number | null>
  periodSpending: HomeFacts["periods"]["today"]["spending"] | undefined
}): HomeFacts["periods"]["today"] {
  const shipped = shippedInRange(params)
  const durations = shipped
    .map((t) => t.durationMs)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b)
  const allCostsKnown = shipped.length > 0 && shipped.every((t) => t.costUsd !== null)
  return {
    ...params.range,
    shipped,
    shippedCostUsd: allCostsKnown ? shipped.reduce((sum, t) => sum + (t.costUsd ?? 0), 0) : null,
    spentUsd: params.periodSpending?.usd ?? null,
    ...(params.periodSpending ? { spending: params.periodSpending } : {}),
    typicalDurationMs: medianDuration(durations),
    fastestDurationMs: durations[0] ?? null,
  }
}

function isActiveStepTask(task: TaskSummary, stepId: FlowStepId): boolean {
  if (task.archived || task.handedBack !== undefined) return false
  if (task.stage === "shipped" || task.stage === "abandoned") return false
  return flowStepOf(task.stage) === stepId
}

export function homeFacts(...args: HomeFactsArgs): HomeFacts {
  const [tasks, now, timezone, costs, approvals = {}, spending] = args
  const ranges = calendarPeriods(now, timezone)
  const periods = {} as HomeFacts["periods"]
  for (const period of ["today", "week", "month"] as const) {
    periods[period] = buildPeriodFacts({
      tasks,
      range: ranges[period],
      now,
      timezone,
      costs,
      approvals,
      periodSpending: spending?.[period],
    })
  }
  const steps = Object.fromEntries(
    FLOW_STEPS.map((s) => [s.id, tasks.filter((t) => isActiveStepTask(t, s.id)).map((t) => t.id)]),
  ) as Record<FlowStepId, string[]>
  return { timezone, periods, steps }
}
