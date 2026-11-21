import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { withoutRecommendationMarker } from "../../interaction/question-recommendations.ts"
import { detectAgent } from "../agents/detect.ts"
import { isNativeAgent, type NativeAgent } from "../agents/ids.ts"
import { folderDoc } from "../docs/names.ts"
import { resolveRepo } from "../paths.ts"
import { homeVariable } from "../platform.ts"
import { AGENT_CAPABILITIES } from "../run/launch-spec.ts"
import { renderTerminal } from "../terminal/render.ts"
import { keyOf } from "./binding.ts"
import { observedTarget } from "./bound-target.ts"
import type { Question } from "./question.ts"
import { inAgent } from "./sides.ts"
import { loadTask, type Task } from "./store.ts"

export type ChatQuestions = {
  agent: NativeAgent | "other"
  /** The agent's own question tool that takes each call as its input. */
  tool?: string
  calls: unknown[]
  ids: string[][]
  fallback?: { agent: "other"; calls: string[]; ids: string[][] }
}

/** Each picker agent's question tool, as its session record names it. */
const PICKER_TOOLS: Partial<Record<NativeAgent, string>> = {
  "claude-code": "AskUserQuestion",
  codex: "request_user_input",
  pi: "ql_ask",
  opencode: "question",
  antigravity: "ask_question",
  grok: "ask_user_question",
  copilot: "ask_user",
}

export const PLAN_APPROVAL_QUESTION_ID = "review-approve-plan"

export const TERMINAL_YOUR_TURN = "🔔 Your turn: answer in your agent's chat."

export async function terminalTaskFor(ctx: Ctx, session: string): Promise<Task | null> {
  if (!session) return null
  const target = await observedTarget(ctx, keyOf(session))
  if (target.kind === "blocked") return null
  if (target.kind === "bound") {
    const task = await loadTask(ctx, target.repo, target.slug)
    return task && inAgent(task) ? task : null
  }
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
        ((call as { questions?: { question: string }[] }).questions ?? []).some((q) =>
          same(q.question),
        ),
    )
  if (matches(await chatQuestions(ctx, [q], { agent }))) return true
  return matches(await formattedQuestions(ctx, [q], { agent }, "v7"))
}

async function codexDisabled(ctx: Ctx): Promise<boolean> {
  const home = homeVariable(ctx.env)
  const root = ctx.env.get("CODEX_HOME") || (home ? join(home, ".codex") : null)
  if (!root) return false
  try {
    const config = Bun.TOML.parse(await ctx.fs.readFile(join(root, "config.toml"))) as Record<
      string,
      unknown
    >
    const features = config.features as Record<string, unknown> | undefined
    return features?.default_mode_request_user_input === false
  } catch {
    return false
  }
}

/** Ready native inputs, or a numbered turn when the current agent has no available picker. */
export async function chatQuestions(
  ctx: Ctx,
  questions: readonly Question[],
  options: { agent?: string; nativeAvailable?: boolean } = {},
): Promise<ChatQuestions> {
  return formattedQuestions(ctx, questions, options, "current")
}

async function formattedQuestions(
  ctx: Ctx,
  questions: readonly Question[],
  options: { agent?: string; nativeAvailable?: boolean },
  format: "current" | "v7",
): Promise<ChatQuestions> {
  const detected = options.agent ?? detectAgent(ctx.env)
  const agent =
    isNativeAgent(detected) &&
    AGENT_CAPABILITIES[detected].picker &&
    options.nativeAvailable !== false &&
    !(detected === "codex" && (await codexDisabled(ctx)))
      ? detected
      : "other"
  const maximum = agent === "claude-code" ? 4 : agent === "codex" ? 3 : Infinity
  const largestChoiceCount = Math.max(0, ...questions.map((question) => question.choices.length))
  const escapeChoices =
    format === "v7"
      ? ["Tell me more", "Not sure"]
      : [
          ...(largestChoiceCount < maximum ? ["Tell me more"] : []),
          ...(largestChoiceCount + 1 < maximum &&
          questions.every((question) => !question.gate && question.ownerRequest?.kind !== "budget")
            ? ["Not sure"]
            : []),
        ]
  const native: Record<string, unknown>[] = []
  const numbered: string[] = []
  for (const q of questions) {
    const recommended =
      q.ownerRequest?.kind === "budget" ? [] : (q.recommendedChoices ?? [q.recommended])
    const choices = await Promise.all(
      q.choices.map(async (choice, index) => ({
        label: recommended.includes(index)
          ? `${withoutRecommendationMarker(choice.label)} (Recommended)`
          : choice.label,
        description:
          [choice.detail, ...(choice.facts ?? []), ...(format === "v7" ? [q.why] : [])]
            .filter(Boolean)
            .join(" ") || "Choose this option.",
        ...(choice.diagram
          ? {
              preview: await renderTerminal(`\`\`\`mermaid\n${choice.diagram}\n\`\`\``, {
                width: 80,
                lead: false,
              }),
            }
          : {}),
      })),
    )
    const limit = agent === "claude-code" ? 4 : agent === "codex" ? 3 : Infinity
    const offered = [...choices]
    for (const label of escapeChoices) {
      if (offered.length < limit)
        offered.push({
          label,
          description:
            label === "Tell me more"
              ? "Explain the context before I choose."
              : "Use the recommendation and record my uncertainty.",
        })
    }
    const list = choices
      .map(
        (choice, index) =>
          `${index + 1}. ${choice.label}: ${choice.description}${choice.preview ? `\n${choice.preview}` : ""}`,
      )
      .join("\n")
    const multi =
      q.multi && (agent === "codex" || agent === "other")
        ? "For multiple choices, type the numbers, for example 1, 3."
        : ""
    const escapeHint =
      format === "v7"
        ? offered.some((choice) => choice.label === "Not sure")
          ? ""
          : "Type more or not sure in Other"
        : q.gate || q.ownerRequest?.kind === "budget"
          ? "Type more in Other"
          : "Type more or not sure in Other"
    // Claude Code's and Grok's options carry a description and preview; the others show the list.
    const rich = agent === "claude-code" || agent === "grok"
    const question = [
      q.question,
      q.why,
      q.found?.text,
      // Codex has no preview field; its text also exposes options beyond the native ceiling.
      !rich || choices.length > limit ? list : "",
      multi,
      escapeHint,
    ]
      .filter(Boolean)
      .join("\n\n")
    numbered.push(
      [
        `Question ${q.id}: ${q.question}`,
        q.why,
        q.found?.text,
        list,
        q.multi
          ? "For multiple choices, type the numbers, for example 1, 3."
          : "Type the choice number or your own answer.",
        format !== "v7" && q.gate
          ? "Tell me more: type more."
          : "Tell me more: type more. Not sure: type not sure.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    )
    const nativeOptions = offered.slice(0, limit).map(({ preview, ...choice }) =>
      // Grok shows a preview on a single-choice question only.
      preview && (agent === "claude-code" || (agent === "grok" && !q.multi))
        ? { ...choice, preview }
        : choice,
    )
    const labels = nativeOptions.map((choice) => choice.label)
    const several = q.multi === true
    const planApproval =
      q.gate === folderDoc("plan") &&
      (q.id === PLAN_APPROVAL_QUESTION_ID || q.id === `${PLAN_APPROVAL_QUESTION_ID}-${q.gateId}`)
    native.push(
      agent === "antigravity"
        ? { question, options: labels, is_multi_select: several }
        : agent === "grok"
          ? { question, options: nativeOptions, multi_select: several }
          : agent === "copilot"
            ? {
                type: several ? "array" : "string",
                title: q.question,
                ...(several ? { items: { type: "string", enum: labels } } : { enum: labels }),
                text: question,
              }
            : {
                ...(agent === "codex" || agent === "pi" ? { id: q.id } : {}),
                header: planApproval ? "Plan" : q.id.slice(0, 12),
                question,
                options: nativeOptions,
                ...(agent === "claude-code" ? { multiSelect: several } : {}),
                ...(agent === "opencode" ? { multiple: several } : {}),
                ...(agent === "pi" ? { multi: several } : {}),
              },
    )
  }
  if (agent === "other")
    return {
      agent,
      calls: questions.length ? [numbered.join("\n\n")] : [],
      ids: questions.length ? [questions.map((q) => q.id)] : [],
    }
  const calls: unknown[] = []
  const ids: string[][] = []
  if (agent === "copilot" && questions.length) {
    // Copilot asks one form: the message shows every question, each field takes one answer.
    calls.push({
      message: native.map((field) => field.text).join("\n\n"),
      requestedSchema: {
        type: "object",
        properties: Object.fromEntries(
          native.map(({ text: _text, ...field }, n) => [questions[n]?.id, field]),
        ),
        required: questions.map((q) => q.id),
      },
    })
    ids.push(questions.map((q) => q.id))
  } else
    for (let offset = 0; offset < native.length; offset += maximum) {
      calls.push({ questions: native.slice(offset, offset + maximum) })
      ids.push(questions.slice(offset, offset + maximum).map((q) => q.id))
    }
  return {
    agent,
    ...(PICKER_TOOLS[agent] ? { tool: PICKER_TOOLS[agent] } : {}),
    calls,
    ids,
    fallback: {
      agent: "other",
      calls: questions.length ? [numbered.join("\n\n")] : [],
      ids: questions.length ? [questions.map((q) => q.id)] : [],
    },
  }
}
