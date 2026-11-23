// Metadata-only discovery for the exact managed run. No skill body, extension or command is executed.
import { realpath } from "node:fs/promises"
import { dirname } from "node:path"
import type { Ctx } from "../../../ctx.ts"
import type { NativeAgent } from "../../agents/ids.ts"
import { roots } from "../../install/agent-settings.ts"
import { homeVariable } from "../../platform.ts"
import type { RunRecord } from "../../run/contracts.ts"
import { readLaunch } from "../../run/registry.ts"
import {
  type CollectorContext,
  type CollectorState,
  collectClaudeCode,
  collectCodex,
  collectFolderAgent,
  collectOpencode,
  collectPi,
  filterDiscoveredSkills,
} from "./catalog-agents.ts"
import { isUnder, SkillDiscovery } from "./catalog-discovery.ts"
import { type CommandCatalog, CATALOG_LIMITS as MAX } from "./types.ts"

const COLLECTORS: Record<NativeAgent, (c: CollectorContext) => Promise<void>> = {
  "claude-code": collectClaudeCode,
  codex: collectCodex,
  pi: collectPi,
  opencode: collectOpencode,
  cursor: (c) => collectFolderAgent(c, "cursor"),
  grok: (c) => collectFolderAgent(c, "grok"),
  antigravity: (c) => collectFolderAgent(c, "antigravity"),
  copilot: (c) => collectFolderAgent(c, "copilot"),
}

function buildDirectoryChain(cwd: string, top: string): string[] {
  const chain: string[] = []
  for (let at = cwd; isUnder(at, top) && chain.length < 16; at = dirname(at)) {
    chain.push(at)
    if (at === top || dirname(at) === at) break
  }
  return chain
}

async function applyExclusions(d: SkillDiscovery, state: CollectorState): Promise<void> {
  for (const path of [...state.excluded].slice(0, MAX.skills)) {
    try {
      d.excluded.add(await realpath(path))
    } catch {
      d.excluded.add(path)
    }
  }
  for (const pattern of state.patterns.slice(0, MAX.skills)) {
    try {
      d.patterns.push(new Bun.Glob(pattern))
    } catch {
      d.issues.add("configuration")
    }
  }
  if (
    state.excluded.size > MAX.skills ||
    state.patterns.length > MAX.skills ||
    state.sources.length > MAX.skills
  )
    d.issues.add("limit")
}

/** Trusted server configuration chooses these roots; the HTTP caller supplies neither paths nor agent IDs. */
export async function discoverSkills(
  ctx: Ctx,
  run: Pick<RunRecord, "id" | "agent" | "cwd" | "generation">,
  options: { managedDirectory?: string } = {},
): Promise<CommandCatalog> {
  if (run.agent === "other") throw new Error("This agent has no native skill catalog")
  const agent = run.agent
  const d = new SkillDiscovery(agent, agent !== "opencode")
  const launch = readLaunch(ctx.home, run.id)
  const env = { ...ctx.env, get: (name: string) => launch?.env[name] ?? ctx.env.get(name) }
  const dirs = roots({ ...ctx, env })
  const home = homeVariable(env)
  if (!dirs || !home) return { agent, skills: [], complete: false, issues: ["configuration"] }
  const top = (await ctx.git.topLevel(run.cwd)) ?? run.cwd
  const chain = buildDirectoryChain(run.cwd, top)
  if (chain.at(-1) !== top) d.issues.add("limit")
  const state: CollectorState = {
    sources: [],
    excluded: new Set(),
    patterns: [],
    overrides: {},
    policies: [],
  }
  await COLLECTORS[agent]({
    d,
    env,
    dirs,
    home,
    cwd: run.cwd,
    chain,
    managedDirectory: options.managedDirectory,
    state,
  })
  if (state.disabled) return { agent, skills: [], complete: false, issues: ["native-state"] }
  await applyExclusions(d, state)
  for (const source of state.sources.slice(0, MAX.skills)) await d.scan(source)
  if (d.issues.has("configuration"))
    return { agent, skills: [], complete: false, issues: [...d.issues] }
  // The PTY can hold live extension/remote state which this metadata reader cannot prove complete.
  return {
    agent,
    skills: filterDiscoveredSkills(agent, d.found, state),
    complete: false,
    issues: [...d.issues],
  }
}
