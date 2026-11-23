// The task list an agent keeps, as its hooks show it, for the live row. A list is recorded only from
// the shapes an agent really reports; an agent that reports none never gets one:
//
//   Claude Code  PostToolUse of TodoWrite (the whole list) and TaskCreate / TaskUpdate (one change
//                each)
//   Codex        PostToolUse of update_plan, whose tool_input carries the plan and whose tool_response
//                says "Plan updated" (the same receipt the Conversation uses)
//   OpenCode     PostToolUse of todowrite, whose input carries `todos`
//
// The parsing is the Conversation's (conversation/checklist.ts); this file keeps the result between
// hooks, in live/<session>/todo.json, and turns it into done / now / next for the App.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import {
  checklistCall,
  checklistResult,
  checklistState,
  checklistToolOk,
} from "../conversation/checklist.ts"
import { nativePlanReceipt } from "../conversation/native-plan.ts"
import type { ConversationChecklist } from "../conversation/types.ts"
import type { LiveSignals } from "./liveness.ts"

/** What a session leaves of its list: when it last changed, and the parsed list with the calls seen. */
export type TodoRow = {
  at: number
  revision: number
  seen: string[]
  value: ConversationChecklist
}

const str = (value: unknown): string => (typeof value === "string" ? value : "")
const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const CLAUDE_TOOLS = new Set(["TodoWrite", "TaskCreate", "TaskUpdate"])
const TEXT_MAX = 200
/** A hook waits this long for a parallel call of its session to finish writing. */
const LOCK_WAIT_MS = 3000

/** The Conversation's name for the call, and its input, when this hook reports a task list. */
function sourceOf(
  agent: string | null,
  event: string,
  payload: Record<string, unknown>,
): { name: string; input: Record<string, unknown> } | null {
  const tool = str(payload.tool_name)
  const input = asObject(payload.tool_input)
  // A subagent's own list is not the session's.
  if (str(payload.agent_id) !== "") return null
  const done = event === "PostToolUse" && payload.is_error !== true
  if (agent === "claude-code") return done && CLAUDE_TOOLS.has(tool) ? { name: tool, input } : null
  if (agent === "codex")
    return nativePlanReceipt(payload, event) ? { name: "update_plan", input } : null
  if (agent === "opencode" && done && tool === "todowrite" && Array.isArray(input.todos))
    // Dropped items are not to do.
    return {
      name: "TodoWrite",
      input: { todos: input.todos.filter((row) => asObject(row).status !== "cancelled") },
    }
  return null
}

async function readRow(ctx: Ctx, path: string): Promise<TodoRow | null> {
  try {
    const row = JSON.parse(await ctx.fs.readFile(path)) as TodoRow
    return Array.isArray(row.seen) && Array.isArray(row.value?.items) ? row : null
  } catch {
    return null
  }
}

const writeRow = (ctx: Ctx, path: string, row: TodoRow) =>
  ctx.fs.atomicWrite(path, `${JSON.stringify(row)}\n`)

type RecordTodoArgs = [
  ctx: Ctx,
  dir: string,
  now: number,
  agent: string | null,
  event: string,
  payload: Record<string, unknown>,
]

/**
 * Keep the list a hook reports. Only for an agent and a call that carry one; the rest returns at
 * once. Parallel tool calls of one session take turns; a call that could not take its turn leaves
 * the list incomplete, which shows nothing, rather than a list that silently lacks it. Never throws.
 */
export async function recordTodo(...args: RecordTodoArgs): Promise<void> {
  const [ctx, dir, now, agent, event, payload] = args
  const source = sourceOf(agent, event, payload)
  if (source === null) return
  const path = join(dir, "todo.json")
  try {
    await ctx.fs.withLock(
      join(dir, "todo.lock"),
      async () => {
        const before = await readRow(ctx, path)
        const state = checklistState()
        if (before !== null) {
          state.value = before.value
          state.seen = [...before.seen]
          state.revision = before.revision
        }
        const prior = state.value
        const call = str(payload.tool_use_id)
        if (checklistCall(state, call, source.name, source.input)) {
          const response = payload.tool_response
          const text = typeof response === "string" ? response : ""
          const result = asObject(response)
          checklistResult(state, call, checklistToolOk(false, text, result), text, result)
        }
        if (state.value === null || state.value === prior) return
        await writeRow(ctx, path, {
          at: now,
          revision: state.revision,
          seen: state.seen,
          value: state.value,
        })
      },
      { waitMs: LOCK_WAIT_MS },
    )
  } catch {
    // The agent's tool call goes on. This call did not make it into the list, so the list is
    // incomplete until the agent writes a whole one again.
    try {
      const row = (await readRow(ctx, path)) ?? {
        at: now,
        revision: 0,
        seen: [],
        value: { scope: "session", revision: "0", coverage: "incomplete" as const, items: [] },
      }
      await writeRow(ctx, path, {
        ...row,
        at: now,
        value: { ...row.value, coverage: "incomplete" },
      })
    } catch {
      // Nothing more can be done for the list.
    }
  }
}

/**
 * The list for the live row: done, the current one, and what is next. The current item is the one the
 * agent marked in progress; with none marked, the first that is not done. A list that is missing items
 * the agent changed (coverage incomplete) and an empty list show nothing: a partial list would lie.
 */
export async function readTodo(
  ctx: Ctx,
  dir: string,
): Promise<NonNullable<LiveSignals["todo"]> | null> {
  const row = await readRow(ctx, join(dir, "todo.json"))
  if (row === null || row.value.coverage === "incomplete" || row.value.items.length === 0)
    return null
  const items = row.value.items
  const marked = items.some((item) => item.status === "in_progress")
  const first = items.findIndex((item) => item.status !== "completed")
  return {
    at: row.at,
    items: items.map((item, index) => ({
      text: item.text.length > TEXT_MAX ? `${item.text.slice(0, TEXT_MAX - 1)}…` : item.text,
      state:
        item.status === "completed"
          ? "done"
          : marked
            ? item.status === "in_progress"
              ? "now"
              : "next"
            : index === first
              ? "now"
              : "next",
    })),
  }
}
