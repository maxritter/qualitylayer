import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { NativeAgent } from "../agents/ids.ts"
import { resolveRepo } from "../paths.ts"
import { keyOf } from "./binding.ts"
import { observedTarget } from "./bound-target.ts"
import { formattedQuestions } from "./chat-questions-format.ts"
import type { Question } from "./question.ts"
import { inAgent } from "./sides.ts"
import { loadTask, type Task } from "./store.ts"

export { PLAN_APPROVAL_QUESTION_ID } from "./chat-questions-format.ts"

export type ChatQuestions = {
  agent: NativeAgent | "other"
  /** The agent's own question tool that takes each call as its input. */
  tool?: string
  calls: unknown[]
  ids: string[][]
  fallback?: { agent: "other"; calls: string[]; ids: string[][] }
}

export const TERMINAL_YOUR_TURN = "🔔 Your turn: answer in your agent's chat."

async function fallbackTerminalTask(ctx: Ctx, session: string): Promise<Task | null> {
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return null
  try {
    const binding = JSON.parse(
      await ctx.fs.readFile(
        join(ctx.home, "projects", repo.data.id, "sessions", `${keyOf(session)}.json`),
      ),
    )
    if (binding.source !== "workflow" || typeof binding.slug !== "string") return null
    const task = await loadTask(ctx, repo.data, binding.slug)
    // Bound when either side is asked in the agent; each recorder checks its own side.
    return task && inAgent(task) ? task : null
  } catch {
    return null
  }
}

export async function terminalTaskFor(ctx: Ctx, session: string): Promise<Task | null> {
  if (!session) return null
  const target = await observedTarget(ctx, keyOf(session))
  if (target.kind === "blocked") return null
  if (target.kind === "bound") {
    const task = await loadTask(ctx, target.repo, target.slug)
    return task && inAgent(task) ? task : null
  }
  return fallbackTerminalTask(ctx, session)
}

export async function matchesChatQuestion(
  ctx: Ctx,
  q: Question,
  text: string,
  agent: string,
): Promise<boolean> {
  const same = (value: string) => value.trim().toLowerCase() === text.trim().toLowerCase()
  if (same(q.question)) return true
  const matches = (adapted: ChatQuestions) =>
    adapted.calls.some(
      (call) =>
        typeof call === "object" &&
        call !== null &&
        ((call as { questions?: { question: string }[] }).questions ?? []).some((entry) =>
          same(entry.question),
        ),
    )
  if (matches(await chatQuestions(ctx, [q], { agent }))) return true
  return matches(await formattedQuestions(ctx, [q], { agent }, "v7"))
}

/** Ready native inputs, or a numbered turn when the current agent has no available picker. */
export async function chatQuestions(
  ctx: Ctx,
  questions: readonly Question[],
  options: { agent?: string; nativeAvailable?: boolean } = {},
): Promise<ChatQuestions> {
  return formattedQuestions(ctx, questions, options, "current")
}
