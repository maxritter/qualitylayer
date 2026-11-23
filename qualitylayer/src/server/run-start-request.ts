import { isNativeAgent, validModelId } from "../core/agents/ids.ts"
import {
  isRunPurpose,
  type RunPurpose,
  type RunSettings,
  type StartRequest,
} from "../core/run/contracts.ts"
import { permissionChoice } from "../core/run/launch-spec.ts"
import { START_SETTINGS, validateRunSettings } from "../core/run/settings-check.ts"
import {
  parsePlannersChoice,
  validateAllocation,
  validateAppearance,
  validateCheckout,
  validateLaunchChoices,
  validateNewTask,
  validateResume,
  validateWorkers,
} from "./run-start-request-validate.ts"

export function parseSettings(input: unknown): Partial<RunSettings> {
  if (input === undefined) return {}
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid run settings")
  validateRunSettings(input, START_SETTINGS)
  return input as Partial<RunSettings>
}

function validateStartSettings(v: StartRequest): void {
  permissionChoice(v.agent, parseSettings(v.settings))
  if (isNativeAgent(v.agent) && v.settings?.model && !validModelId(v.agent, v.settings.model))
    throw new Error(`Invalid model for ${v.agent}`)
}

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

const ALLOWED_START_KEYS = new Set([
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
  if (Object.keys(v).some((key) => !ALLOWED_START_KEYS.has(key)))
    throw new Error("Unknown run start choice")
  return v
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
