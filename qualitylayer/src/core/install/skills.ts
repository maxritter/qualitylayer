// Where each agent reads user-level skills. Only an agent that is installed
// (its own root folder exists) gets the skills; an agent's root is never
// created. Any other agent is told which folder to copy.
//
// Skills expose the CLI's separate workflow, artifact, peer and management capabilities.

import { existsSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import {
  artifactSkillText,
  chatSkillText,
  manageSkillText,
  peersSkillText,
  qualitySkillText,
  skillText,
} from "#workflow"
import type { Env } from "../../ctx.ts"
import { AGENT_NAMES, type NativeAgent } from "../agents/ids.ts"
import { type HookFileAgent, hookFileMarkers } from "./agent-hooks.ts"
import { realDir } from "./manifest.ts"
import {
  ARTIFACT_NAME,
  CHAT_NAME,
  MANAGE_NAME,
  PEERS_NAME,
  QUALITY_NAME,
  QUALITYLAYER_SKILLS,
  SKILL_NAME,
} from "./skill-names.ts"

export { ARTIFACT_NAME, MANAGE_NAME, PEERS_NAME, QUALITY_NAME, SKILL_NAME } from "./skill-names.ts"

export type AgentTarget = {
  agent: NativeAgent
  label: string
  /** The agent's user-level skills folder: each skill is <skills>/<name>/SKILL.md. */
  skills: string
}

export type SkillFile = { name: string; path: string; text: string }

function configured(env: Env, name: string, fallback: string): string {
  const value = env.get(name)
  return realDir(value !== undefined && value !== "" && isAbsolute(value) ? value : fallback)
}

export function detectAgents(env: Env, home: string): AgentTarget[] {
  const targets: AgentTarget[] = []
  const claude = configured(env, "CLAUDE_CONFIG_DIR", join(home, ".claude"))
  if (existsSync(claude)) {
    targets.push({ agent: "claude-code", label: "Claude Code", skills: join(claude, "skills") })
  }
  // Codex reads user skills from ~/.agents/skills, next to (not inside) its own root.
  const codex = configured(env, "CODEX_HOME", join(home, ".codex"))
  if (existsSync(codex)) {
    targets.push({ agent: "codex", label: "Codex", skills: join(home, ".agents", "skills") })
  }
  const pi = configured(env, "PI_CODING_AGENT_DIR", join(home, ".pi", "agent"))
  if (existsSync(pi)) targets.push({ agent: "pi", label: "Pi", skills: join(pi, "skills") })
  const xdg = configured(env, "XDG_CONFIG_HOME", join(home, ".config"))
  const opencode = configured(env, "OPENCODE_CONFIG_DIR", join(xdg, "opencode"))
  if (existsSync(opencode))
    targets.push({ agent: "opencode", label: "OpenCode", skills: join(opencode, "skills") })
  targets.push(...agentsWithHookFile(env, home, targets))
  return targets
}

/**
 * Antigravity, Cursor, Grok and Copilot, for each that has been started once. Antigravity reads its own
 * folder. Cursor and Grok read the skill folders of Claude Code and Codex (in `found`) as their
 * own: they share one, since a second copy would show every skill twice.
 */
function agentsWithHookFile(env: Env, home: string, found: AgentTarget[]): AgentTarget[] {
  const targets: AgentTarget[] = []
  const gemini = realDir(join(home, ".gemini"))
  if (startedOnce("antigravity", gemini))
    targets.push({
      agent: "antigravity",
      label: AGENT_NAMES.antigravity,
      skills: join(gemini, "config", "skills"),
    })
  const readers: [keyof typeof READS_SKILLS_OF, string][] = [
    ["cursor", realDir(join(home, ".cursor"))],
    ["grok", configured(env, "GROK_HOME", join(home, ".grok"))],
    ["copilot", configured(env, "COPILOT_HOME", join(home, ".copilot"))],
  ]
  for (const [agent, root] of readers) {
    if (!startedOnce(agent, root)) continue
    const read = found.find((target) => READS_SKILLS_OF[agent].includes(target.agent))
    // Without Codex, Copilot uses its own folder: Cursor, Grok, Pi and OpenCode also read
    // `~/.agents/skills`, and a copy there beside Claude Code's would show every skill twice.
    const own = agent === "copilot" ? join(root, "skills") : join(home, ".agents", "skills")
    targets.push({ agent, label: AGENT_NAMES[agent], skills: read?.skills ?? own })
  }
  return targets
}

/**
 * The agents whose skill folders Cursor, Grok and Copilot read as their own. Cursor and Grok also
 * read `~/.agents/skills`; Copilot reads only Codex's (`~/.agents/skills`) and its own.
 */
const READS_SKILLS_OF: Record<"cursor" | "grok" | "copilot", readonly NativeAgent[]> = {
  cursor: ["claude-code", "codex"],
  grok: ["claude-code", "codex"],
  copilot: ["codex"],
}

/** Whether the agent has been started once: its folder, and any marker beside it. */
function startedOnce(agent: HookFileAgent, root: string): boolean {
  const markers = hookFileMarkers(agent)
  return (
    existsSync(root) && (markers.length === 0 || markers.some((m) => existsSync(join(root, m))))
  )
}

/** The skill, with the absolute path of the binary it drives. */
function renderText(text: string, binary: string, platform: string = process.platform): string {
  if (platform !== "win32") return text.replaceAll("{{QUALITYLAYER_BIN}}", binary)
  const invocation = `& '${binary.replaceAll("'", "''")}'`
  return text
    .replaceAll("{{QUALITYLAYER_BIN}}", invocation)
    .replace(`The binary: \`${invocation}\``, `The binary: \`${binary}\``)
    .replace(
      "\n---\n",
      "\n---\n\nOn native Windows, run the commands below in PowerShell. The `&` prefix invokes the quoted executable path. If your agent uses Bash, invoke these commands through its PowerShell tool.\n",
    )
}

/** The skill for an agent. */
export function renderSkill(binary: string, platform: string = process.platform): string {
  return renderText(skillText(), binary, platform)
}

/** Each capability is discoverable from the person's natural-language request. */
export function renderSkills(binary: string, agent: AgentTarget["agent"]): SkillFile[] {
  const files: SkillFile[] = [
    { name: SKILL_NAME, path: "SKILL.md", text: renderSkill(binary) },
    {
      name: PEERS_NAME,
      path: "SKILL.md",
      text: renderText(peersSkillText(), binary),
    },
    {
      name: ARTIFACT_NAME,
      path: "SKILL.md",
      text: renderText(artifactSkillText(), binary),
    },
    { name: MANAGE_NAME, path: "SKILL.md", text: renderText(manageSkillText(), binary) },
    { name: QUALITY_NAME, path: "SKILL.md", text: renderText(qualitySkillText(), binary) },
    { name: CHAT_NAME, path: "SKILL.md", text: renderText(chatSkillText(), binary) },
  ]
  if (agent === "codex")
    for (const name of QUALITYLAYER_SKILLS)
      files.push({
        name,
        path: "agents/openai.yaml",
        text: "policy:\n  allow_implicit_invocation: true\n",
      })
  if (agent === "pi") {
    const skill = files.find((file) => file.name === SKILL_NAME && file.path === "SKILL.md")
    if (skill)
      skill.text = skill.text.replace(
        "\n## Activation",
        "\nIn Pi, a natural-language QualityLayer request selects this skill. If Pi expands `/skill:ql-workflow`, the text after the closing `</skill>` is the person's request. Run fresh helpers with `ql_helper`, passing the returned `brief_file` path, model and effort.\n\n## Activation",
      )
  }
  return files
}
