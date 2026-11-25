import { BINARIES, type NativeAgent } from "../agents/ids.ts"
import type { AgentKind, RunPurpose } from "./contracts.ts"
import {
  grantedFolders,
  modelArguments,
  opencodePermission,
  sessionArguments,
} from "./launch-args.ts"
import {
  AGENT_CAPABILITIES,
  type AgentCapabilities,
  bypassArgsIn,
  defaultPermissionChoice,
  holdsSequence,
  ownPermissionNote,
  ownPermissionOnly,
  PERMISSION_MODE_ID,
  type PermissionLevel,
  type PermissionMode,
  permissionChoice,
  permissionDescription,
  permissionFor,
  permissionModes,
  reportedPermission,
  resolvePermission,
  supportsPermission,
  type TurnRecordFormat,
  withPermission,
} from "./launch-permissions.ts"
import {
  agentInvocation,
  chosenNativeSession,
  doubleQuoted,
  launchAgent,
  launchCommand,
  launchPrompt,
  resumeLine,
  singleQuoted,
  stagePrompt,
  startBranchLine,
  taskLaunchPrompt,
  worktreeArguments,
} from "./launch-prompts.ts"
import { worktreeName } from "./worktree-plan.ts"

export {
  AGENT_CAPABILITIES,
  type AgentCapabilities,
  agentInvocation,
  bypassArgsIn,
  chosenNativeSession,
  defaultPermissionChoice,
  doubleQuoted,
  launchAgent,
  launchCommand,
  ownPermissionNote,
  ownPermissionOnly,
  PERMISSION_MODE_ID,
  type PermissionLevel,
  type PermissionMode,
  permissionChoice,
  permissionDescription,
  permissionFor,
  permissionModes,
  reportedPermission,
  resolvePermission,
  resumeLine,
  singleQuoted,
  stagePrompt,
  startBranchLine,
  supportsPermission,
  type TurnRecordFormat,
  taskLaunchPrompt,
  withPermission,
  worktreeName,
}

export type LaunchSpec = {
  agent: AgentKind
  program: string
  args: string[]
  env: Record<string, string>
  prompt: string
  capabilities: AgentCapabilities
  purpose: RunPurpose
}
export type LaunchSpecInput = {
  /** Validated server-owned paths, retained with the managed run for recovery. */
  launchFiles?: readonly { path: string }[]
  answers?: "app" | "terminal"
  agent: AgentKind
  purpose: RunPurpose
  managed?: boolean
  session?: string
  /** Resume an existing native session; otherwise a managed start gives the session id it chose. */
  resume?: boolean
  /** A task's current stage; omitted for a fresh Implement start. */
  stage?: string
  /** Open a resumed session without sending a continuation prompt. */
  continue?: boolean
  perm?: PermissionLevel
  /** A mode id from the agent's `permissionModes`; it fixes the level and the arguments. */
  permMode?: string
  model?: string
  effort?: string
  subagentModel?: string
  /** Accepted from legacy handoffs but never changes the agent's own speed preference. */
  fastMode?: boolean
  works?: "checkout" | "worktree" | "branch"
  mode?: "goal" | "plain"
  /** Server-derived generated inputs for a validated, bound task. Never a request choice. */
  taskBriefsDir?: string
  /**
   * The folder of QualityLayer's own command. Copilot refuses a command outside its granted folders,
   * and its skills run QualityLayer by that absolute path, so a managed Copilot start grants it.
   */
  toolsFolder?: string
  /** Server-derived inputs belonging to one managed planning run, including after binding. */
  runBriefsDir?: string
  otherAgent?: { program: string; args: string[] }
  /** `agents.<id>.args`: extra arguments added to every start, before QualityLayer's own flags. */
  agentArgs?: string[]
  /** Exact context resolved from the registered artifact and its current source witness. */
  artifactPrompt?: string
  /**
   * Managed folders already trusted by the person in QualityLayer (the chosen project checkout and
   * its granted brief directories). Antigravity CLI accepts them via session-only `--settings` so
   * managed starts never stall on its workspace-trust prompt.
   */
  trustedWorkspaces?: readonly string[]
  /**
   * What a managed App launch carries for its hooks (`launch-hooks.ts` `launchHooks`): arguments
   * before the prompt, and variables. Absent: the agent reports through its installed hooks.
   */
  hooks?: { args: readonly string[]; env: Readonly<Record<string, string>> }
}

function applyAgentSpecificPreArgs(
  input: LaunchSpecInput,
  agent: NativeAgent,
  args: string[],
  env: Record<string, string>,
): void {
  if (agent === "opencode" && input.model && !input.managed) args.unshift("mini")
  // Claude Code's rating prompt takes a typed 1, 2 or 3 while the input is empty: a person answering
  // a question with "1" in the App would rate the session instead. A QualityLayer window never shows it.
  if (agent === "claude-code") env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY = "1"
  if (agent === "claude-code" && input.subagentModel)
    env.CLAUDE_CODE_SUBAGENT_MODEL = input.subagentModel
  if (agent === "codex" && input.subagentModel)
    args.push("-c", `agents.default_subagent_model=${JSON.stringify(input.subagentModel)}`)
}

function mergeClaudeAdditionalDirs(
  hookArgs: readonly string[],
  folders: readonly string[],
): string[] {
  const out = [...hookArgs]
  const flagAt = out.lastIndexOf("--settings")
  if (flagAt < 0 || flagAt + 1 >= out.length) {
    out.push("--settings", JSON.stringify({ permissions: { additionalDirectories: folders } }))
    return out
  }
  const raw = out[flagAt + 1] ?? ""
  if (!raw.trimStart().startsWith("{")) return out
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const existingPerms =
      parsed.permissions && typeof parsed.permissions === "object"
        ? (parsed.permissions as Record<string, unknown>)
        : {}
    const existingDirs = Array.isArray(existingPerms.additionalDirectories)
      ? existingPerms.additionalDirectories.filter((d): d is string => typeof d === "string")
      : []
    const merged = [...new Set([...existingDirs, ...folders])]
    out[flagAt + 1] = JSON.stringify({
      ...parsed,
      permissions: { ...existingPerms, additionalDirectories: merged },
    })
  } catch {
    // Non-JSON --settings value (such as a file path) keeps its authored contents.
  }
  return out
}

function appendGrantedDirArgs(
  input: LaunchSpecInput,
  agent: NativeAgent,
  perm: PermissionLevel,
  mode: PermissionMode | undefined,
  args: string[],
): string[] {
  const flag = AGENT_CAPABILITIES[agent].addDirFlag
  const folders = grantedFolders(input)
  if (!flag || folders.length === 0) return []
  // Claude Code 2.1.332+ blocks interactive launches with a trust prompt for every `--add-dir` path.
  // Passing `permissions.additionalDirectories` in `--settings` grants the same folders with no prompt.
  if (agent === "claude-code") return folders
  const candidateArgs = mode?.args ?? input.agentArgs ?? []
  const readOnlyCodex =
    agent === "codex" &&
    (holdsSequence(candidateArgs, ["-s", "read-only"]) ||
      holdsSequence(candidateArgs, ["--sandbox", "read-only"]))
  const inheritedCodex = agent === "codex" && perm === "own" && !mode
  if (!readOnlyCodex && !inheritedCodex) for (const folder of folders) args.push(flag, folder)
  return []
}

function nativeArguments(
  input: LaunchSpecInput,
  agent: NativeAgent,
  prompt: string,
  args: string[],
  env: Record<string, string>,
) {
  const capabilities = AGENT_CAPABILITIES[agent]
  const { level: perm, mode } = resolvePermission(agent, input.perm, input.permMode)
  const nativeAssisted = agent === "copilot" && input.managed && mode?.id === "allow-tools"
  if (nativeAssisted && !input.resume && !input.hooks?.env.COPILOT_HOME)
    throw new Error(
      "Copilot's Assisted Permissions must be selected in its Terminal with /permissions. Use Agent settings or Allow All for a new App session, or continue in the native Terminal.",
    )
  applyAgentSpecificPreArgs(input, agent, args, env)
  sessionArguments(input, agent, capabilities, args, env)
  if (agent === "opencode") opencodePermission(input, perm, mode, args, env)
  else if (!nativeAssisted) args.push(...(mode?.args ?? []))
  Object.assign(
    env,
    nativeAssisted
      ? { COPILOT_ALLOW_ALL: "false", COPILOT_ASSISTED_APPROVAL: "false" }
      : (mode?.env ?? {}),
  )
  const claudeDirs = appendGrantedDirArgs(input, agent, perm, mode, args)
  if (agent === "antigravity" && input.managed && input.trustedWorkspaces?.length) {
    const trusted = [...new Set(input.trustedWorkspaces.filter((dir) => dir.trim() !== ""))]
    if (trusted.length > 0) args.push("--settings", JSON.stringify({ trustedWorkspaces: trusted }))
  }
  modelArguments(input, agent, capabilities, args, env)
  args.push(...worktreeArguments(input, capabilities))
  if (input.managed && input.hooks) {
    const hookArgs =
      claudeDirs.length > 0
        ? mergeClaudeAdditionalDirs(input.hooks.args, claudeDirs)
        : input.hooks.args
    args.push(...hookArgs)
    Object.assign(env, input.hooks.env)
  } else if (claudeDirs.length > 0) {
    args.push("--settings", JSON.stringify({ permissions: { additionalDirectories: claudeDirs } }))
  }
  if (prompt && (!input.resume || input.continue !== false))
    args.push(...(capabilities.promptFlag ? [capabilities.promptFlag, prompt] : [prompt]))
}

export function launchSpec(input: LaunchSpecInput): LaunchSpec {
  const { agent, purpose } = input
  const capabilities = AGENT_CAPABILITIES[agent]
  // Refuses a permission choice the agent does not have before anything launches.
  resolvePermission(agent, input.perm, input.permMode)
  if (purpose.kind === "task" && input.works === "worktree")
    throw new Error("Create the approved task's worktree before launching its agent")
  const prompt = launchPrompt(input, capabilities)
  const program = agent === "other" ? (input.otherAgent?.program ?? "") : BINARIES[agent]
  const args = [...((agent === "other" ? input.otherAgent?.args : input.agentArgs) ?? [])]
  const env: Record<string, string> = {}
  if (program.includes("\0") || args.some((arg) => arg.includes("\0")))
    throw new Error("Invalid agent program or arguments")
  if (agent !== "other") nativeArguments(input, agent, prompt, args, env)
  return { agent, program, args, env, prompt, capabilities, purpose }
}
