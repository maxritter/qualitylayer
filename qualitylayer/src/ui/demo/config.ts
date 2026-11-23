import { NATIVE_AGENTS, type NativeAgent } from "../../core/agents/ids.ts"
import type { Api, Config } from "../api.ts"

/** The names the address uses for the agents (`claude` is Claude Code); any other is its own id. */
const ADDRESS_AGENT: Record<string, NativeAgent> = { claude: "claude-code" }
const asAgent = (name: string): NativeAgent | undefined =>
  ADDRESS_AGENT[name] ?? NATIVE_AGENTS.find((agent) => agent === name)

/**
 * What the address fixes for what the App reads, without storing anything, so a link looks the same on
 * every computer and a visit never changes the next one:
 *  - `?theme=dark` (or `light`);
 *  - `?notifications=on`: the notification, its sound and the rest as a person who turned them on has them;
 *  - `?answers=terminal`: every task runs its agent outside the App, so its questions, stops and items
 *    are decided there and the App shows them read-only with "Decide in your own agent";
 *  - `?agents=claude,pi`: only those coding agents are on the computer (Settings › Second opinion needs two);
 *  - `?second=on`: Settings › Second opinion is Automatic;
 *  - `?scans=off`: Settings › Security scans is Off, so Verify's Security scans lane says so.
 * With none of them in the address, or any other value, the API is returned as it is. Demo only.
 */
export function withDemoConfig(api: Api, search: string): Api {
  const params = new URLSearchParams(search)
  const theme = params.get("theme")
  const asked: Partial<Config> = {
    ...(theme === "dark" || theme === "light" ? { theme } : {}),
  }
  const notified = params.get("notifications") === "on"
  const terminal = params.get("answers") === "terminal"
  const second = params.get("second") === "on"
  const scansOff = params.get("scans") === "off"
  const present = params.get("agents")
  const installed =
    present === null
      ? null
      : new Set(present.split(",").flatMap((name) => asAgent(name.trim()) ?? []))
  const hasFlags = notified || terminal || second || scansOff
  if (Object.keys(asked).length === 0 && !hasFlags && installed === null) return api
  const apply = (config: Config): Config => ({
    ...config,
    ...asked,
    ...(second ? { secondOpinion: { ...config.secondOpinion, enabled: true } } : {}),
    ...(scansOff ? { securityScans: { ...config.securityScans, enabled: false } } : {}),
    ...(notified
      ? {
          notifications: {
            ...config.notifications,
            gateOpened: true,
            taskFinished: true,
            sound: true,
          },
        }
      : {}),
  })
  return {
    ...api,
    config: async () => apply(await api.config()),
    putConfig: async (patch) => api.putConfig(patch).then(apply),
    ...(installed !== null
      ? {
          subagents: async () =>
            (await api.subagents()).map((entry) => ({
              ...entry,
              runnable: entry.runnable && installed.has(entry.agent),
            })),
        }
      : {}),
    ...(terminal
      ? {
          task: async (id, signal) => ({
            ...(await api.task(id, signal)),
            answers: "terminal" as const,
          }),
        }
      : {}),
  }
}
