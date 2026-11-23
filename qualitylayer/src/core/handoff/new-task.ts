// New task's command, as plain values so the App page imports it: what the person copies to start a
// task in their coding agent from what they typed and the planning picks. The prompt is quoted so a
// shell hands the agent exactly the text: Claude Code's command in double quotes, Codex's in single
// quotes (its `$ql` must not expand). In this session the prompt is one message, never quoted.

import type { DefaultsAgent, DefaultsEffort, DefaultsWhere } from "../config-values.ts"
import { agentInvocation, resolvePermission } from "../run/launch-spec.ts"
import { branchPrefix, worktreeName, worktreePlan } from "../run/worktree-plan.ts"
import { shellQuote } from "../shell.ts"

export { doubleQuoted, singleQuoted, worktreeName } from "../run/launch-spec.ts"

export type NewTaskChoice = {
  answers?: "app" | "terminal"
  agent: DefaultsAgent
  /** The planning model; ignored for another agent. */
  model: string
  effort: DefaultsEffort
  fastMode?: boolean
  where: DefaultsWhere
  perm?: "own" | "fewer" | "bypass"
  /** The explicit task kind determines the startup words and branch prefix. */
  type?: "feature" | "bugfix" | "chat"
  /** The project's checkout, so a worktree line names its real folder. */
  checkout?: string
  /** The worktree's name; otherwise a slug of the request. */
  worktreeName?: string
  /** Absolute paths of attached files, listed under the request. */
  files?: readonly string[]
  /**
   * The absolute path of the person's existing plan, saved on this computer: the task starts from it
   * (`qualitylayer task start --from-plan`), and `files` are context beside it.
   */
  fromPlan?: string
  /**
   * A feature's extra planners as `task start --planners` takes them, `agent:model[:effort]` each: the
   * prompt asks the agent to start the task with them.
   */
  planners?: readonly string[]
}

export type NewTaskCommand = {
  /** In this session: the lines to type first, each a message of its own. */
  first: string[]
  /** What Copy takes: the whole command, this session's message, or another agent's prompt. */
  command: string
  /** Codex's /model opens its menu: what to pick there. */
  hint?: string
}

function hasInvalidAgentArgs(choice: NewTaskChoice): boolean {
  if (choice.agent === "other") return false
  if (choice.model.includes("\0")) return true
  const checksEffort = choice.agent !== "opencode" || Boolean(choice.model)
  return checksEffort && choice.effort.includes("\0")
}

/** The command for a prompt and the planning picks. */
export function newTaskCommand(choice: NewTaskChoice, typed: string): NewTaskCommand {
  // Throws for a permission override the agent does not support.
  resolvePermission(choice.agent, choice.perm)
  if (hasInvalidAgentArgs(choice)) throw new Error("Invalid agent program or arguments")
  const type = choice.type ?? "feature"
  const request = typed.trim()
  // An existing plan is handed over as its file, kept exactly as given: the agent starts the task with
  // `task start --from-plan` and maps the plan instead of planning it again.
  const prompt =
    choice.fromPlan !== undefined
      ? `${agentInvocation(choice.agent, choice.answers)} implement my existing plan in ${JSON.stringify(choice.fromPlan)}. Start the task with: qualitylayer task start --from-plan ${shellQuote(choice.fromPlan)}${type === "bugfix" ? " --type bug" : ""}`
      : `${agentInvocation(choice.agent, choice.answers)} start ${type === "chat" ? "chat" : type === "bugfix" ? "bug" : "feature"}: ${request}`
  const files = choice.files?.length
    ? `\n\nAttached files:\n${choice.files.map((path) => `- ${path}`).join("\n")}`
    : ""
  const answers =
    choice.answers === "app" ? "\nAnswer in QualityLayer; start this task with --app." : ""
  let workspace = ""
  if (choice.where === "worktree") {
    const name = choice.worktreeName ?? worktreeName(typed)
    // Without a checkout the folder is described relative to the project the agent starts in.
    const plan = worktreePlan(choice.checkout ?? "../<project folder>", name, branchPrefix(type))
    workspace = `\nUse a new worktree at ${plan.folder} with branch ${plan.branch}; preserve existing work.`
  }
  const planners =
    choice.planners?.length && type === "feature" && choice.fromPlan === undefined
      ? `\nStart this task with --planners ${choice.planners.join(",")}.`
      : ""
  return { first: [], command: `${prompt}${files}${answers}${planners}${workspace}` }
}

/** A long command drawn short: its first line, and how many lines follow. */
export function previewOf(command: string): { first: string; more: number } {
  const lines = command.split("\n")
  return { first: lines[0] ?? "", more: lines.length - 1 }
}
