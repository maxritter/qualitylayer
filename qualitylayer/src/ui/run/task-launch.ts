import type { Config, DefaultsAgent } from "../../core/config-values.ts"
import { startDefaults } from "../../core/handoff/start-values.ts"
import type { StartRequest } from "../../core/run/contracts.ts"
import type { TaskDetail } from "../api.ts"
import type { AgentLaunchValue } from "./AgentLaunchFields.tsx"

export function taskPlanningLaunch(task: Pick<TaskDetail, "stage" | "gate">): boolean {
  return task.stage === "plan" && task.gate?.decision !== "approved"
}

export function taskAgentDefaults(task: TaskDetail, config: Config, agent: DefaultsAgent) {
  if (agent === "other") return { model: "", effort: "high" as const }
  return {
    model: taskPlanningLaunch(task)
      ? config.planning.defaults[agent].model
      : startDefaults(config, agent, task.flow?.light === true, agent).model,
    effort: taskPlanningLaunch(task)
      ? config.planning.defaults[agent].effort
      : config.implement.defaults[agent].effort,
  }
}

export function taskAgentRequest(
  task: TaskDetail,
  value: AgentLaunchValue,
): Omit<StartRequest, "idempotencyKey"> {
  if (value.agent === "other") throw new Error("Choose an installed native agent.")
  return {
    agent: value.agent,
    purpose: {
      kind: "task",
      task: task.id,
      ...(taskPlanningLaunch(task) ? { phase: "planning" as const } : {}),
    },
    ...(task.checkout ? { cwd: task.checkout } : {}),
    works: "checkout",
    mode: "plain",
    settings: { answers: "app", model: value.model, effort: value.effort },
  }
}
