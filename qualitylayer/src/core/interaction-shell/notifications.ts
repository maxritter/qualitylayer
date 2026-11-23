import type { Notification, QuestionBatch } from "../../interaction/contracts.ts"
import type { TaskSummary } from "../../server/api.ts"
import { isNotifiableTask, taskNotifications } from "./notification-items.ts"

export function notificationsOf(
  tasks: TaskSummary[],
  now = Date.now(),
  batches: Record<string, QuestionBatch | null> = {},
): Notification[] {
  return tasks
    .filter(isNotifiableTask)
    .flatMap<Notification>((task) => taskNotifications(task, now, batches[task.id]))
    .sort((a, b) => a.at - b.at)
}
export function settleNotifications(
  previous: Notification[],
  current: Notification[],
  now: number,
): Notification[] {
  const ids = new Set(current.map((n) => n.id))
  return [
    ...current,
    ...previous
      .filter((n) => !ids.has(n.id))
      .map((n) =>
        n.state === "settled" ? n : { ...n, state: "settled" as const, settledAt: now },
      ),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 200)
}

/** On first open learn existing batches; only a new batch warrants a system notice. */
export function batchNotices(rows: Notification[], seen: Set<string> | null): Notification[] {
  if (seen === null) return []
  const batches = new Map<string, Notification>()
  for (const row of rows)
    if (
      row.state === "open" &&
      row.batch !== null &&
      !row.target.itemId.startsWith("question:") &&
      !seen.has(row.batch)
    )
      batches.set(row.batch, batches.get(row.batch) ?? row)
  return [...batches.values()]
}
