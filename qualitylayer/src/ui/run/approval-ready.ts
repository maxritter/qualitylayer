import { NAMES } from "../../core/docs/names.ts"
import { flattenItems } from "../../core/items.ts"
import type { TaskDetail } from "../api.ts"

function isPendingOpenGate(
  task: TaskDetail,
): task is TaskDetail & { gate: NonNullable<TaskDetail["gate"]> } {
  const gate = task.gate
  if (task.archived || task.original?.intact === false) return false
  return gate?.decision === "pending" && !gate.settled && !gate.locked
}

function blocksGateQuestion(
  question: TaskDetail["question"],
  gate: NonNullable<TaskDetail["gate"]>,
) {
  if (!question) return false
  if (question.gate !== gate.target || question.item !== undefined) return true
  return question.gateId !== undefined && question.gateId !== (gate.id ?? String(gate.opened))
}

/** Presentation only; the owner gate API still validates the decision and its evidence. */
export function taskApprovalReady(task: TaskDetail): "Plan" | "Verify" | null {
  if (!isPendingOpenGate(task)) return null
  const gate = task.gate
  const step =
    task.stage === "plan" && gate.target === NAMES.plan
      ? "Plan"
      : task.stage === "verify" && gate.target === "final"
        ? "Verify"
        : null
  if (!step || blocksGateQuestion(task.question, gate)) return null
  const required = flattenItems(task.items ?? []).some(
    (item) => !item.children && item.blocking && (item.state === "open" || item.updated),
  )
  return required ? null : step
}
