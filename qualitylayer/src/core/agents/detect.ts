// Agent identity from the environment, for session.json only — never for
// keying state. The ids are the ones v11 already resolved (session.py).

import { join } from "node:path"
import type { Ctx, Env } from "../../ctx.ts"
import { roots } from "../install/agent-settings.ts"
import { userHome } from "../install/manifest.ts"
import { AGENT_CAPABILITIES } from "../run/launch-spec.ts"
import { runnableFile } from "./binary.ts"
import {
  type NearestAgent,
  nearestAgentInfo,
  nearestAgentProcess,
  nearestWindowsAgent,
} from "./detect-process.ts"
import { isNativeAgent, NATIVE_AGENTS, type NativeAgent } from "./ids.ts"

export { nearestWindowsAgent }

export type AgentId = NativeAgent | "unknown"

/** The variables that name an agent when they are set in the commands and hooks it runs. */
const identityVariables = (agent: NativeAgent): readonly string[] =>
  AGENT_CAPABILITIES[agent].identityEnv
/**
 * Where each agent hands a command its session id (`sessionIdEnv` in `agents.json`), then the
 * variable a managed start sets as `sessionEnv`: Grok sets its own only for hooks.
 */
export const sessionVariables = (agent: NativeAgent): readonly string[] => [
  ...AGENT_CAPABILITIES[agent].sessionIdEnv,
  ...(AGENT_CAPABILITIES[agent].sessionEnv ? [AGENT_CAPABILITIES[agent].sessionEnv as string] : []),
]
/** When several agents' variables are set and no parent process settles it, the first of these wins. */
const TIE_ORDER: readonly NativeAgent[] = [
  "codex",
  "pi",
  "opencode",
  "cursor",
  "grok",
  "antigravity",
  "copilot",
  "claude-code",
]

export function detectAgent(
  env: Pick<Env, "get">,
  nearest: () => Exclude<AgentId, "unknown"> | null = nearestAgentProcess,
): AgentId {
  const native = env.get("QUALITYLAYER_AGENT")
  const candidates = new Set<NativeAgent>([
    ...(isNativeAgent(native) ? [native] : []),
    ...NATIVE_AGENTS.filter((agent) =>
      identityVariables(agent).some((name) => Boolean(env.get(name)?.trim())),
    ),
  ])
  if (candidates.size > 1)
    return (nearest() ??
      (isNativeAgent(native)
        ? native
        : TIE_ORDER.find((agent) => candidates.has(agent)))) as AgentId
  if (candidates.size === 1) return [...candidates][0] as NativeAgent
  return "unknown"
}

export function sessionIdentity(
  env: Pick<Env, "get">,
  nearest?: () => NativeAgent | null,
): { agent: NativeAgent; id: string } | null {
  const agent = detectAgent(env, nearest)
  if (agent === "unknown") return null
  const id = sessionVariables(agent)
    .map((name) => env.get(name)?.trim())
    .find(Boolean)
  return id ? { agent, id } : null
}

/**
 * The id the agent running this command reports for its session, or null when it reports none:
 * its own variable, the `session_id` its hooks get (Codex's thread, Cursor's and Antigravity's
 * conversation), else a session variable that names no agent by itself (an older Codex's).
 */
export function agentSession(env: Pick<Env, "get">): string | null {
  const own = sessionIdentity(env)
  if (own) return own.id
  return env.get("CODEX_SESSION_ID")?.trim() || null
}

/**
 * The executable of the agent session that runs this command: the nearest parent process that is
 * the agent the environment names, when it is a file that can run. A wrapper launcher or guard on
 * PATH must not stand in for it (the review of a Plan starts the agent the session itself runs).
 * `QUALITYLAYER_SESSION_BINARY=off` ignores the parents, for tests that must never find a real agent.
 */
export function sessionAgentBinary(
  env: Env,
  nearest: () => NearestAgent | null = nearestAgentInfo,
): { agent: Exclude<AgentId, "unknown">; path: string } | null {
  if (env.get("QUALITYLAYER_SESSION_BINARY") === "off") return null
  const agent = detectAgent(env, () => nearest()?.agent ?? null)
  if (agent === "unknown") return null
  const found = nearest()
  if (found === null || found.agent !== agent || found.path === null) return null
  return runnableFile(found.path) ? { agent, path: found.path } : null
}

/**
 * Where each agent reads skills: `own` is a folder under its configuration root (`root` names it in
 * `roots()`), `shared` the `.agents/skills` folders in the home and the project that several agents
 * read, `project` its own folder in the repository.
 */
const SKILL_FOLDERS: Record<
  NativeAgent,
  {
    root: keyof NonNullable<ReturnType<typeof roots>>
    own: string | null
    shared: boolean
    project: string | null
  }
> = {
  "claude-code": { root: "claude", own: "skills", shared: false, project: ".claude/skills" },
  codex: { root: "codex", own: null, shared: true, project: null },
  pi: { root: "pi", own: "skills", shared: true, project: ".pi/skills" },
  opencode: { root: "opencode", own: "skills", shared: true, project: ".opencode/skills" },
  cursor: { root: "cursor", own: "skills", shared: true, project: ".cursor/skills" },
  grok: { root: "grok", own: "skills", shared: false, project: ".grok/skills" },
  antigravity: {
    root: "antigravity",
    own: "config/skills",
    shared: false,
    project: ".agents/skills",
  },
  copilot: { root: "copilot", own: "skills", shared: true, project: ".github/skills" },
}

function skillFolders(ctx: Ctx, agent: NativeAgent, repoRoot: string): string[] {
  const home = userHome(ctx)
  const dirs = roots(ctx)
  if (dirs === null || !home.ok) return []
  const where = SKILL_FOLDERS[agent]
  return [
    ...(where.own === null ? [] : [join(dirs[where.root], ...where.own.split("/"))]),
    ...(where.shared ? [join(home.home, ".agents", "skills")] : []),
    ...(where.shared ? [join(repoRoot, ".agents", "skills")] : []),
    ...(where.project === null ? [] : [join(repoRoot, ...where.project.split("/"))]),
  ]
}

/** The artifact skills an artifact or a visible change is better with: used when installed, never required. */
export const ARTIFACT_TOOLS = ["impeccable", "ql-artifact"] as const

/**
 * The artifact tools installed as skills for this agent, in the user's skills
 * folder or the project's. Nothing is installed or asked for here; an agent
 * the CLI cannot name, or one with neither tool, gets none.
 */
export async function artifactTools(ctx: Ctx, agent: AgentId, repoRoot: string): Promise<string[]> {
  const folders = agent === "unknown" ? [] : skillFolders(ctx, agent, repoRoot)
  const found: string[] = []
  for (const tool of ARTIFACT_TOOLS) {
    for (const folder of folders) {
      if (await ctx.fs.exists(join(folder, tool, "SKILL.md"))) {
        found.push(tool)
        break
      }
    }
  }
  return found
}
