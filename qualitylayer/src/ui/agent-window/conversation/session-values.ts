import type { NativeAgent } from "../../../core/agents/ids.ts"
import { modelName } from "../../../core/agents/model-values.ts"

/** Match only aliases whose currently catalogued version is the observed native version. */
export function sessionModelId(agent: NativeAgent | undefined, value: string | undefined) {
  if (agent === "claude-code") {
    if (value === "claude-opus-5-5" && modelName(agent, "opus") === "Opus 5.5") return "opus"
    if (value === "claude-sonnet-5-5" && modelName(agent, "sonnet") === "Sonnet 5.5")
      return "sonnet"
    if (value === "claude-haiku-5-5" && modelName(agent, "haiku") === "Haiku 5.5") return "haiku"
  }
  return value
}
export type SessionEffortInput = {
  agent: NativeAgent | undefined
  observedModel: string | undefined
  launchModel: string | undefined
  observedEffort: string | undefined
  launchEffort: string | undefined
  unknown?: readonly ("model" | "effort")[]
}

export function sessionEffort(input: SessionEffortInput) {
  const unknown = input.unknown ?? []
  if (unknown.includes("effort")) return undefined
  const same =
    !unknown.includes("model") &&
    (!input.observedModel ||
      sessionModelId(input.agent, input.observedModel) ===
        sessionModelId(input.agent, input.launchModel))
  return (input.observedEffort ?? (same ? input.launchEffort : undefined))?.toLowerCase()
}
