// What an agent's hook hands QualityLayer, read as Claude Code's hook payload. Every consumer of a
// hook (the run record, the live status, the prompt and stop hooks) reads Claude Code's names:
// snake_case fields and events such as `Stop` and `UserPromptSubmit`. Codex sends the same. Cursor
// sends its own event names, Grok both spellings, and Antigravity and Copilot camelCase fields with
// no event name at all, so the command that installs the hook passes the event as an argument. Reading them
// here keeps one set of rules for what ends a turn instead of one per agent; each agent's tool
// names and fields become the ones the shell, edit and live code read. What a hook prints back is
// in each agent's own shape too (`stopContinuation`, `toolRefusal`, `toolContext`).

import { asObject, asText, normalizeHookTools } from "./hook-tools.ts"

/** The spelling of each event once case, underscores and dashes are ignored. */
const EVENT_GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ["SessionStart", ["sessionstart"]],
  ["SessionEnd", ["sessionend"]],
  [
    "UserPromptSubmit",
    ["userpromptsubmit", "userpromptsubmitted", "beforesubmitprompt", "preinvocation"],
  ],
  ["PreToolUse", ["pretooluse"]],
  ["PostToolUse", ["posttooluse"]],
  ["PostToolUseFailure", ["posttoolusefailure"]],
  ["SubagentStart", ["subagentstart"]],
  ["SubagentStop", ["subagentstop"]],
  ["PermissionRequest", ["permissionrequest"]],
  ["Notification", ["notification"]],
  ["PreCompact", ["precompact"]],
  ["Stop", ["stop", "agentstop", "stopcancelled", "stopfailure"]],
]

const EVENTS: Readonly<Record<string, string>> = Object.fromEntries(
  EVENT_GROUPS.flatMap(([canonical, aliases]) => aliases.map((alias) => [alias, canonical])),
)

const INTERRUPTED_EVENT = /cancel/i
const INTERRUPTED_STATUS = /^(?:aborted|cancel+ed)$/i
const INTERRUPTED_TERMINATION = /cancel|interrupt/i

const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : undefined)

function isInterruptedStop(out: Record<string, unknown>, named: string): boolean {
  // Copilot names its reason `stop_reason`, in either spelling the other agents use.
  const statuses = [out.status, out.stop_reason].map(asText)
  const terminations = [out.termination_reason, out.stop_reason].map(asText)
  return (
    INTERRUPTED_EVENT.test(named) ||
    statuses.some((value) => INTERRUPTED_STATUS.test(value)) ||
    terminations.some((value) => INTERRUPTED_TERMINATION.test(value))
  )
}

/**
 * Claude Code's payload for a hook payload of any agent, or null when the hook marks no turn end
 * and no start: Grok's second Stop at shutdown, and an Antigravity Stop that ends one loop of a
 * turn that is not idle yet. `event` is the name the hook command passed, for a payload without one.
 */
export function normalizeHookPayload(raw: unknown, event?: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(asObject(raw))) {
    const normalized = snake(key)
    if (!(normalized in out)) out[normalized] = value
  }
  if (typeof out.session_id !== "string" && typeof out.conversation_id === "string") {
    out.session_id = out.conversation_id
  }
  // Cursor's Shell names an empty `cwd` for a command in the project: the project is the folder.
  const folder = [
    out.cwd,
    out.workspace_root,
    first(out.workspace_roots),
    first(out.workspace_paths),
  ].find((value) => typeof value === "string" && value !== "")
  if (typeof folder === "string") out.cwd = folder
  const named = asText(out.hook_event_name) || event || ""
  const canonical = EVENTS[named.toLowerCase().replace(/[_-]/g, "")]
  if (canonical) out.hook_event_name = canonical
  else if (named) out.hook_event_name = named
  normalizeHookTools(out)
  if (canonical !== "Stop") return out
  // Copilot runs agentStop inside a helper too, naming the helper's parent: that is a helper that
  // finished (Claude Code's SubagentStop), and the lead's turn goes on.
  if (asText(out.parent_agent_id) !== "") {
    out.hook_event_name = "SubagentStop"
    return out
  }
  if (out.reason === "shutdown" || out.fully_idle === false) return null
  if (isInterruptedStop(out, named)) out.reason = "interrupted"
  return out
}

/**
 * What a Stop hook prints to keep the agent going, in the shape the agent reads: Cursor takes the
 * next message as `followup_message`, Antigravity a `continue` decision, Copilot a `block` with the
 * reason alone, and every other agent (Grok too) Claude Code's `block`, which also carries a
 * message for the person.
 */
export function stopContinuation(
  agent: string,
  reason: string,
  systemMessage?: string | null,
): Record<string, unknown> {
  if (agent === "cursor") return { followup_message: reason }
  if (agent === "antigravity") return { decision: "continue", reason }
  if (agent === "copilot") return { decision: "block", reason }
  return { decision: "block", ...(systemMessage ? { systemMessage } : {}), reason }
}

/**
 * A PreToolUse refusal in the shape the agent reads: Copilot takes it bare, Cursor a `permission`
 * with the message its rejection carries (`user_message`, and `agent_message` on its server path),
 * Antigravity a `decision` with its reason, and the others (Codex and Grok too) Claude Code's.
 */
export function toolRefusal(
  agent: string,
  reason: string,
  context: string | null,
): Record<string, unknown> {
  if (agent === "copilot") return { permissionDecision: "deny", permissionDecisionReason: reason }
  if (agent === "cursor") {
    return {
      permission: "deny",
      user_message: reason,
      agent_message: reason,
      ...(context !== null ? { additional_context: context } : {}),
    }
  }
  if (agent === "antigravity") return { decision: "deny", reason }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
      ...(context !== null ? { additionalContext: context } : {}),
    },
  }
}

/**
 * Words a tool hook adds for the model, in the shape the agent reads, or null when its tool hooks
 * take none: Cursor's `additional_context`; Antigravity's tool hooks read a decision or nothing.
 */
export function toolContext(
  agent: string,
  event: string,
  words: string,
): Record<string, unknown> | null {
  if (agent === "antigravity") return null
  if (agent === "cursor") return { additional_context: words }
  return { hookSpecificOutput: { hookEventName: event, additionalContext: words } }
}
