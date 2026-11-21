// The models an agent lists for itself (OpenCode's `opencode models`), as the server read them, and the
// ids the person added: the agent list and the settings bring them, and every model picker lists them
// after the catalog's. They live in
// `core/agents/model-values.ts`, which the pickers already read; this file feeds and watches them.

import { useEffect, useRef, useSyncExternalStore } from "react"
import { isNativeAgent, NATIVE_AGENTS } from "../core/agents/ids.ts"
import {
  knownModelsVersion,
  persistAddedModels,
  type StepAgent,
  setAddedModels,
  setKnownModels,
  setStartModel,
  takesAddedModels,
  watchKnownModels,
} from "../core/agents/model-values.ts"
import type { Config, SubagentModels } from "./api.ts"

/** Re-renders its component whenever the known models change, so a picker built in it lists the new ones. */
export function useKnownModels(): number {
  return useSyncExternalStore(watchKnownModels, knownModelsVersion)
}

/**
 * Hands every picker what the server read (each agent's own list), the ids the person added and the
 * model each agent starts on, and saves an id added in any menu in the settings.
 */
export function useFeedKnownModels(
  agents: readonly SubagentModels[] | null | undefined,
  config: Config | null | undefined,
  save: (patch: unknown) => unknown,
): void {
  const saver = useRef(save)
  saver.current = save
  useEffect(() => {
    for (const entry of agents ?? [])
      if (entry.listed !== undefined)
        setKnownModels(entry.agent as StepAgent, {
          listed: entry.listed.models,
          own: entry.listed.own,
          ...(entry.listed.labels ? { labels: entry.listed.labels } : {}),
        })
  }, [agents])
  useEffect(() => {
    for (const agent of NATIVE_AGENTS) {
      setAddedModels(agent, config?.addedModels?.[agent] ?? [])
      setStartModel(agent, config?.planning.defaults[agent].model)
    }
  }, [config])
  useEffect(() => {
    persistAddedModels((agent, ids) => void saver.current({ addedModels: { [agent]: ids } }))
    return () => persistAddedModels(null)
  }, [])
}

/** The agent when its model menu also takes a typed provider/model id (it lists its own models); else nothing. */
export function customModelAgent(agent: string): StepAgent | undefined {
  return isNativeAgent(agent) && takesAddedModels(agent) ? agent : undefined
}
