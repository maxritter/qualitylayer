import { isNativeAgent, validModelId } from "../core/agents/ids.ts"
import { AGENT_OWN } from "../core/agents/model-values.ts"
import { type ExtraPlanner, validatePlanners } from "../core/review/planners.ts"
import {
  isRunPurpose,
  type RunPurpose,
  type RunSettings,
  type StartRequest,
} from "../core/run/contracts.ts"
import { AGENT_CAPABILITIES, permissionChoice } from "../core/run/launch-spec.ts"
import { validSize } from "../core/run/protocol.ts"
import { START_SETTINGS, validateRunSettings } from "../core/run/settings-check.ts"

const BODY_BYTES = 64 * 1024
export async function readRunBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > BODY_BYTES)
    throw new Error("Run request is too large")
  const reader = request.body?.getReader()
  if (!reader) throw new Error("Expected a run request")
  let size = 0
  const pieces: Uint8Array[] = []
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > BODY_BYTES) {
        await reader.cancel()
        throw new Error("Run request is too large")
      }
      pieces.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return JSON.parse(Buffer.concat(pieces).toString("utf8"))
}
export function parseSettings(input: unknown): Partial<RunSettings> {
  if (input === undefined) return {}
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid run settings")
  validateRunSettings(input, START_SETTINGS)
  return input as Partial<RunSettings>
}
function startEnvelope(input: unknown): StartRequest {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Expected a run start")
  const v = input as StartRequest
  const invalid = "Invalid agent, purpose or idempotency key"
  if (!isNativeAgent(v.agent) && v.agent !== "other") throw new Error(invalid)
  if (!isRunPurpose(v.purpose)) throw new Error(invalid)
  if (typeof v.idempotencyKey !== "string" || !v.idempotencyKey || v.idempotencyKey.length > 256)
    throw new Error(invalid)
  if (
    Array.from(v.idempotencyKey).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    throw new Error(invalid)
  const allowed = new Set([
    "agent",
    "purpose",
    "cwd",
    "idempotencyKey",
    "allocateTask",
    "planners",
    "settings",
    "works",
    "mode",
    "branch",
    "worktreePath",
    "cols",
    "rows",
    "colors",
    "confirmBypass",
    "startAnyway",
    "workers",
    "resumeNative",
  ])
  if (Object.keys(v).some((key) => !allowed.has(key))) throw new Error("Unknown run start choice")
  return v
}

function validateAllocation(v: StartRequest): void {
  if (
    v.allocateTask !== undefined &&
    (typeof v.allocateTask !== "boolean" ||
      v.purpose.kind !== "new-task" ||
      !isNativeAgent(v.agent))
  )
    throw new Error("Task allocation is only available for a new native planning run")
}

function validateStartSettings(v: StartRequest): void {
  permissionChoice(v.agent, parseSettings(v.settings))
  if (isNativeAgent(v.agent) && v.settings?.model && !validModelId(v.agent, v.settings.model))
    throw new Error(`Invalid model for ${v.agent}`)
}

function validateCheckout(v: StartRequest): void {
  if (v.cwd !== undefined && (typeof v.cwd !== "string" || !v.cwd || v.cwd.includes("\0")))
    throw new Error("Invalid checkout")
  if (v.worktreePath === undefined) return
  if (v.works !== "worktree") throw new Error("Invalid worktree path")
  if (
    typeof v.worktreePath !== "string" ||
    !v.worktreePath ||
    /[\0\r\n]/.test(v.worktreePath) ||
    v.worktreePath.length > 4096
  )
    throw new Error("Invalid worktree path")
}

function validateResume(v: StartRequest): void {
  if (v.purpose.kind === "task" && v.purpose.phase !== undefined && v.purpose.phase !== "planning")
    throw new Error("Invalid task launch phase")
  if (v.resumeNative === undefined) return
  const invalid = "Only a task's native agent session can be resumed here"
  if (
    v.purpose.kind !== "task" ||
    !isNativeAgent(v.agent) ||
    AGENT_CAPABILITIES[v.agent].resume === null
  )
    throw new Error(invalid)
  if (typeof v.resumeNative !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v.resumeNative))
    throw new Error(invalid)
}

function validateLaunchChoices(v: StartRequest): void {
  if (v.works !== undefined && !["checkout", "branch", "worktree"].includes(v.works))
    throw new Error("Invalid works choice")
  if (v.mode !== undefined && !["goal", "plain"].includes(v.mode))
    throw new Error("Invalid run mode")
  for (const key of ["confirmBypass", "startAnyway"] as const)
    if (v[key] !== undefined && typeof v[key] !== "boolean") throw new Error(`Invalid ${key}`)
}

function validateAppearance(v: StartRequest): void {
  if (!validSize(v.cols ?? 80, v.rows ?? 24)) throw new Error("Invalid terminal size")
  if (
    v.colors !== undefined &&
    (!v.colors ||
      [v.colors.fg, v.colors.bg, v.colors.cursor].some(
        (n) => !Number.isInteger(n) || n < 0 || n > 0xffffff,
      ))
  )
    throw new Error("Invalid terminal colors")
}

function validateWorkers(v: StartRequest): void {
  if (v.workers === undefined) return
  if (typeof v.workers !== "string") throw new Error("Invalid workers model")
  if (
    isNativeAgent(v.agent)
      ? v.workers !== AGENT_OWN && !validModelId(v.agent, v.workers)
      : !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(v.workers)
  )
    throw new Error("Invalid workers model")
}

function validateNewTask(v: StartRequest): void {
  if (v.purpose.kind !== "new-task") return
  if (
    v.purpose.title !== undefined &&
    (typeof v.purpose.title !== "string" ||
      v.purpose.title.length > 200 ||
      v.purpose.title.includes("\0"))
  )
    throw new Error("Invalid new task title")
  if (
    v.purpose.type !== undefined &&
    v.purpose.type !== "feature" &&
    v.purpose.type !== "bugfix" &&
    v.purpose.type !== "chat"
  )
    throw new Error("The task type must be feature or bugfix or chat")
  if (v.purpose.fromPlan === undefined) return
  const invalid = "A task from an existing plan names one attached Markdown or text file"
  if (v.purpose.type === "chat") throw new Error(invalid)
  if (
    typeof v.purpose.fromPlan !== "string" ||
    v.purpose.fromPlan === "" ||
    v.purpose.fromPlan.length > 255 ||
    /[/\\\0]/.test(v.purpose.fromPlan)
  )
    throw new Error(invalid)
}
const PURPOSE_FIELDS: Record<RunPurpose["kind"], readonly string[]> = {
  task: ["kind", "task", "phase"],
  terminal: ["kind", "shell", "context"],
  artifact: ["kind", "scope", "id", "file", "revision", "request"],
  "new-task": ["kind", "request", "title", "type", "fromPlan"],
}

function purposeOf(purpose: RunPurpose): RunPurpose {
  switch (purpose.kind) {
    case "task":
      return {
        kind: "task",
        task: purpose.task,
        ...(purpose.phase ? { phase: purpose.phase } : {}),
      }
    case "terminal":
      return {
        kind: "terminal",
        ...(purpose.shell ? { shell: true as const } : {}),
        ...(purpose.context ? { context: purpose.context } : {}),
      }
    case "artifact":
      return {
        kind: "artifact",
        scope: purpose.scope,
        id: purpose.id,
        file: purpose.file,
        revision: purpose.revision,
        request: purpose.request,
      }
    case "new-task":
      return {
        kind: "new-task",
        request: purpose.request,
        ...(purpose.title !== undefined ? { title: purpose.title } : {}),
        ...(purpose.type !== undefined ? { type: purpose.type } : {}),
        ...(purpose.fromPlan !== undefined ? { fromPlan: purpose.fromPlan } : {}),
      }
  }
}

export function parseRunStart(input: unknown): StartRequest {
  const v = startEnvelope(input)
  validateAllocation(v)
  const planners = v.planners === undefined ? undefined : parsePlannersChoice(v)
  validateStartSettings(v)
  validateCheckout(v)
  validateResume(v)
  validateLaunchChoices(v)
  validateAppearance(v)
  validateWorkers(v)
  validateNewTask(v)
  const purpose = purposeOf(v.purpose)
  if (v.purpose.kind === "terminal" && v.purpose.shell === true && v.agent !== "other")
    throw new Error("A shell terminal starts as another program")
  if (Object.keys(v.purpose).some((key) => !PURPOSE_FIELDS[v.purpose.kind].includes(key)))
    throw new Error("Unknown run purpose field")
  const { planners: _sent, ...rest } = v
  return {
    ...rest,
    purpose,
    ...(planners !== undefined && planners.length > 0 ? { planners } : {}),
  }
}

/**
 * A start's extra planners, checked as `task start --planners` checks them: a feature task's
 * planning only, at most two, each agent once and not the run's own, at an effort it takes.
 * Whether each can run on this computer is checked when the run starts.
 */
function parsePlannersChoice(v: StartRequest): ExtraPlanner[] {
  const planning =
    (v.purpose.kind === "new-task" && v.allocateTask === true) ||
    (v.purpose.kind === "task" && v.purpose.phase === "planning")
  if (!planning || !isNativeAgent(v.agent))
    throw new Error("Extra planners start with a native planning run for a new or waiting task")
  if (v.purpose.kind === "new-task" && v.purpose.type !== undefined && v.purpose.type !== "feature")
    throw new Error(
      `Extra planners are for feature tasks, not a ${v.purpose.type === "bugfix" ? "bug fix" : "Chat"}`,
    )
  const planners = validatePlanners(v.planners, v.agent)
  if (typeof planners === "string") throw new Error(planners)
  return planners
}
