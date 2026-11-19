import { isDeepStrictEqual } from "node:util"
import type { Ctx } from "../../ctx.ts"
import type { Plan } from "./agent-settings.ts"

export const CLAUDE_CODE_MODE_ID = "claude-code:code-mode"
export const CLAUDE_CODE_MODE_ENV = "CLAUDE_CODE_EXPERIMENTAL_CODE_MODE"
export const CLAUDE_CODE_MODE_MIN_VERSION = "2.1.323"

export async function nativeConfigWritable(
  ctx: Ctx,
  file: string,
  text: string | null,
): Promise<boolean> {
  const entry = await ctx.fs.lstat?.(file)
  const exists = entry === undefined ? await ctx.fs.exists(file) : entry !== null
  if (exists && text === null) return false
  const mode = (await ctx.fs.stat?.(file))?.mode
  return mode === undefined || (mode & 0o222) !== 0
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

export function claudeNativeDefaults(file: string, text: string): Plan[] {
  let doc: Record<string, unknown> | null
  try {
    doc = object(JSON.parse(text || "{}"))
  } catch {
    return []
  }
  if (doc === null) return []
  const out: Plan[] = []
  for (const [id, key, label] of [
    ["claude-code:task-list", "CLAUDE_CODE_ENABLE_TODO_TOOLS", "Task tools on every model"],
    ["claude-code:task-format", "CLAUDE_CODE_ENABLE_TASKS", "Native task list"],
  ] as const) {
    const env = object(doc.env)
    const now = env?.[key]
    out.push({
      id,
      agent: "claude-code",
      label,
      file,
      why: "Claude Code can show and update its own task list while QualityLayer keeps the task cards.",
      change: `env.${key} = "1"`,
      state:
        now === "1" || now === "true"
          ? "applied"
          : now === undefined && (doc.env === undefined || env !== null)
            ? "available"
            : "kept",
      key: { format: "json", path: ["env", key], value: "1" },
      keptMessage: `${label}: your setting stays.`,
    })
  }
  const permissions = object(doc.permissions)
  const now = permissions?.defaultMode
  const allowed =
    doc.permissions === undefined ||
    (permissions !== null && permissions.disableBypassPermissionsMode !== "disable")
  out.push({
    id: "claude-code:permission-default",
    agent: "claude-code",
    label: "Native permission default",
    file,
    why: "New native sessions use Bypass when no permission default was chosen; explicit choices and policies stay.",
    change: 'permissions.defaultMode = "bypassPermissions"',
    state:
      now === "bypassPermissions" ? "applied" : now === undefined && allowed ? "available" : "kept",
    key: { format: "json", path: ["permissions", "defaultMode"], value: "bypassPermissions" },
    keptMessage: "Native permission default: your Claude Code permission settings stay.",
  })
  for (const setting of CLAUDE_PREFERENCES) out.push(preferencePlan(file, doc, setting, allowed))
  return out
}

function preferencePlan(
  file: string,
  doc: Record<string, unknown>,
  setting: Preference,
  bypassAllowed: boolean,
): Plan {
  const set = valueAt(doc, setting.path)
  const explicitAlias = setting.alias !== undefined && doc[setting.alias] !== undefined
  let state: Plan["state"] = "kept"
  if (set !== MISPLACED && isDeepStrictEqual(set, setting.value)) state = "applied"
  else if (set === undefined && !explicitAlias && (setting.bypass !== true || bypassAllowed))
    state = "available"
  return {
    id: setting.id,
    agent: "claude-code",
    label: setting.label,
    file,
    why: setting.why,
    change: `${setting.path.join(".")} = ${JSON.stringify(setting.value)}`,
    state,
    key: { format: "json", path: setting.path, value: setting.value },
    keptMessage: `${setting.label}: your setting stays.`,
  }
}

/** A parent along the path is not an object, so the key cannot be set without replacing it. */
const MISPLACED = Symbol("misplaced")

function valueAt(doc: Record<string, unknown>, path: string[]): unknown {
  let node: unknown = doc
  for (const part of path.slice(0, -1)) {
    const next = (node as Record<string, unknown>)[part]
    if (next === undefined) return undefined
    if (object(next) === null) return MISPLACED
    node = next
  }
  return (node as Record<string, unknown>)[path[path.length - 1] as string]
}

type Preference = {
  id: string
  path: string[]
  value: unknown
  label: string
  why: string
  /** Only while Bypass is allowed: a policy that disables it keeps these out too. */
  bypass?: true
  alias?: "tui" | "includeCoAuthoredBy"
}

/**
 * Claude Code defaults Max chose on 5 November 2026 (issue #235): each is set only when missing,
 * like every installer setting, so a person's own value stays and uninstall puts back only ours.
 */
const CLAUDE_PREFERENCES: Preference[] = [
  {
    id: "claude-code:bypass-confirmation",
    path: ["skipDangerousModePermissionPrompt"],
    value: true,
    label: "Bypass without a confirmation",
    why: "Sessions start in Bypass without stopping at Claude Code's confirmation screen.",
    bypass: true,
  },
  {
    id: "claude-code:attribution-commit",
    alias: "includeCoAuthoredBy",
    path: ["attribution", "commit"],
    value: "",
    label: "No attribution in commits",
    why: "Commits carry no Co-Authored-By trailer from Claude Code.",
  },
  {
    id: "claude-code:attribution-pr",
    alias: "includeCoAuthoredBy",
    path: ["attribution", "pr"],
    value: "",
    label: "No attribution in pull requests",
    why: "Pull request descriptions carry no Generated with Claude Code line.",
  },
  {
    id: "claude-code:git-instructions",
    path: ["includeGitInstructions"],
    value: false,
    label: "No built-in git instructions",
    why: "Claude Code leaves out its own commit and pull request instructions; your project's rules decide.",
  },
  {
    id: "claude-code:output-style",
    path: ["outputStyle"],
    value: "Concise",
    label: "Concise replies",
    why: "Claude Code answers in its built-in Concise style.",
  },
  {
    id: "claude-code:thinking-summaries",
    path: ["showThinkingSummaries"],
    value: true,
    label: "Thinking summaries",
    why: "You see a short summary of what the agent thought.",
  },
  {
    id: "claude-code:reduced-motion",
    path: ["prefersReducedMotion"],
    value: true,
    label: "Reduced motion",
    why: "Claude Code keeps animation in its terminal to a minimum.",
  },
  {
    id: "claude-code:auto-dream",
    path: ["autoDreamEnabled"],
    value: true,
    label: "Memory consolidation",
    why: "Claude Code consolidates its own memory where the native feature is available.",
  },
  {
    id: "claude-code:no-flicker",
    alias: "tui",
    path: ["env", "CLAUDE_CODE_NO_FLICKER"],
    value: "true",
    label: "Flicker-free display",
    why: "Claude Code redraws its screen without flicker.",
  },
  {
    id: "claude-code:tool-search",
    path: ["env", "ENABLE_TOOL_SEARCH"],
    value: "true",
    label: "Tool search",
    why: "Claude Code loads MCP tools when it needs them, which keeps context free.",
  },
  {
    id: "claude-code:task-reminders",
    path: ["env", "CLAUDE_CODE_TODO_REMINDER_MODE"],
    value: "baseline",
    label: "Task list reminders",
    why: "Claude Code uses its baseline reminders for its task list.",
  },
  {
    id: "claude-code:stop-hook-cap",
    path: ["env", "CLAUDE_CODE_STOP_HOOK_BLOCK_CAP"],
    value: "3",
    label: "Stop hook limit",
    why: "A Stop hook can keep a turn going at most 3 times in a row.",
  },
  {
    id: CLAUDE_CODE_MODE_ID,
    path: ["env", CLAUDE_CODE_MODE_ENV],
    value: "1",
    label: "Experimental Code Mode preference",
    why: "Claude Code checks whether the session supports Code Mode and asks before first use.",
  },
]

/** Every Claude Code native default: apply() checks each against the file again before writing. */
export const CLAUDE_NATIVE_IDS: ReadonlySet<string> = new Set([
  "claude-code:task-list",
  "claude-code:task-format",
  "claude-code:permission-default",
  ...CLAUDE_PREFERENCES.map((setting) => setting.id),
])

const POLICY_KEYS = [
  "approval_policy",
  "sandbox_mode",
  "default_permissions",
  "sandbox_workspace_write",
  "approvals_reviewer",
  "permissions",
  "profile",
]
export const CODEX_PERMISSION_IDS = new Set([
  "codex:permission-approval",
  "codex:permission-sandbox",
])

export function codexPermissionsMissing(text: string): boolean {
  try {
    const doc = object(Bun.TOML.parse(text))
    if (doc === null) return false
    return (
      !POLICY_KEYS.some((key) => doc[key] !== undefined) &&
      !Object.values(object(doc.profiles) ?? {}).some((profile) => {
        const values = object(profile)
        return values !== null && POLICY_KEYS.some((key) => values[key] !== undefined)
      })
    )
  } catch {
    return false
  }
}

export function codexPermissionDefaults(file: string, text: string): Plan[] {
  const missing = codexPermissionsMissing(text)
  let current: Record<string, unknown> = {}
  try {
    current = object(Bun.TOML.parse(text)) ?? {}
  } catch {
    /* Existing invalid TOML is left alone. */
  }
  return (
    [
      ["codex:permission-approval", "approval_policy", '"never"'],
      ["codex:permission-sandbox", "sandbox_mode", '"danger-full-access"'],
    ] as const
  ).map(([id, key, value]) => ({
    id,
    agent: "codex",
    label: "Native permission default",
    file,
    why: "New native sessions use Full access only when no native permission policy was chosen.",
    change: `${key} = ${value}`,
    state: current[key] === JSON.parse(value) ? "applied" : missing ? "available" : "kept",
    key: { format: "toml", table: null, key, value },
    keptMessage: "Native permission default: your Codex permission settings stay.",
  }))
}
