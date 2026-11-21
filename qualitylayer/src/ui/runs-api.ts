import type { CommandCatalog } from "../core/conversation/commands/types.ts"
import type {
  ConversationEvent,
  ConversationPage,
  ConversationSnapshot,
} from "../core/conversation/types.ts"
import type { Usage } from "../core/cost/usage.ts"
import type { Attachment } from "../core/interaction-docs/attachments.ts"
import type { AgentLimits } from "../core/limits/index.ts"
import type {
  ControlRequest,
  RunSummary,
  StartRequest,
  TerminalColors,
} from "../core/run/contracts.ts"
import { intentReasonText, runPermissionWaiting } from "../core/run/contracts.ts"
import { STARTUP_PROMPT_STATUS } from "../core/run/startup-prompt.ts"
import type { TurnChanges } from "../core/run/turn-snapshots.ts"
import { appearanceTheme } from "./agent-window/appearance.ts"
import {
  colorContrast,
  compositeColor,
  computedCssColor,
  rgbNumber,
} from "./agent-window/colors.ts"
import { createTerminalView } from "./agent-window/view.ts"
import { subscribeEventCount } from "./hooks.ts"
import { missingNativeSettings, NativeSettingsUnknown } from "./native-settings-error.ts"
import type { RunAdapter, RunWindow } from "./run-context.tsx"

export type RunSupport = {
  supported: boolean
  canStart?: boolean
  canConfigure?: boolean
  reason?: string
  appQuitFailure?: { at: number; reason: string; failures: { run: string; message: string }[] }
  /** New terminal's shell choices; only a session that may change them receives these. */
  loginShell?: string
  shells?: string[]
}
export function runTaskId(run: RunWindow): string | undefined {
  return (
    run.task ??
    (run.purpose.kind === "task"
      ? run.purpose.task
      : run.purpose.kind === "terminal" && run.purpose.context?.kind === "task"
        ? run.purpose.context.task
        : undefined)
  )
}
export function taskAgentRuns(runs: readonly RunWindow[], task: string): RunWindow[] {
  return runs
    .filter(
      (run) =>
        runTaskId(run) === task &&
        (run.purpose.kind === "new-task" ||
          (run.purpose.kind === "task" && run.purpose.task === task)),
    )
    .sort(
      (a, b) =>
        (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0) ||
        b.generation - a.generation ||
        b.id.localeCompare(a.id),
    )
}
/**
 * The task's live agent that waits on its own start-up question (trust this folder, …). The task
 * page, the Agent tab and the top bar's agent chip read the same one.
 */
export function startupRunFor(runs: readonly RunWindow[], task: string): RunWindow | undefined {
  return runs.find(
    (run) =>
      run.startupPrompt !== undefined &&
      run.agent !== "other" &&
      !["stopped", "failed"].includes(run.status) &&
      runTaskId(run) === task,
  )
}
export function buildRunForTask(run: RunWindow, task: string): boolean {
  return (
    run.purpose.kind === "task" &&
    run.purpose.phase !== "planning" &&
    runTaskId(run) === task &&
    run.status !== "failed" &&
    run.status !== "stopped"
  )
}
export function preferredBuildRun(
  runs: readonly RunWindow[],
  task?: string,
): RunWindow | undefined {
  return runs
    .filter((run) => run.purpose.kind === "task" && buildRunForTask(run, task ?? run.purpose.task))
    .sort(
      (a, b) =>
        (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0) ||
        b.generation - a.generation ||
        b.id.localeCompare(a.id),
    )[0]
}

/** Task actions change at build transitions, not when terminal output or timestamps update. */
export function buildRunsVersion(runs: readonly RunWindow[]): string {
  return JSON.stringify(
    runs
      .filter(
        (run) =>
          run.purpose.kind === "task" &&
          (buildRunForTask(run, run.purpose.task) || run.intent !== undefined),
      )
      .map((run) => [
        run.id,
        run.generation,
        runTaskId(run),
        run.status,
        run.firstPromptAt ?? "",
        run.nativeSession ?? "",
        run.intent?.state ?? "",
        run.intent?.reason ?? "",
        run.intent?.task ?? "",
        run.intent?.nativeSession ?? "",
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  )
}
export function runStatusText(run: RunWindow): string {
  if (run.status === "failed") return `Failed to start${run.error ? ` · ${run.error}` : ""}`
  if (run.status === "stopped") return "Stopped"
  if (run.status === "stopping") return "Stopping"
  if (run.terminalPrompt === "permission") return "Waiting for permission · open Terminal"
  if (runPermissionWaiting(run)) return "Waiting for permission · answer in Conversation"
  const intentReason = intentReasonText(run.intent)
  if (run.intent?.state !== "active" && intentReason) return intentReason
  if (run.startupPrompt) return STARTUP_PROMPT_STATUS[run.startupPrompt]
  if (!run.firstPromptAt && run.agent !== "other") return "Starting · answer here if it asks"
  if (run.attention === "waiting") return "Waits for you in its window"
  if (!runTaskId(run) && run.purpose.kind === "new-task") return "Running · task not created yet"
  if (run.purpose.kind === "terminal") return "Open in the App"
  return "Running in the App"
}
export function parseSourceSupported(value: unknown): RunSupport | undefined {
  if (!value || typeof value !== "object") return undefined
  const source = value as {
    supported?: unknown
    platform?: unknown
    reason?: unknown
    canStart?: unknown
    canConfigure?: unknown
    appQuitFailure?: RunSupport["appQuitFailure"]
    loginShell?: unknown
    shells?: unknown
  }
  if (typeof source.supported !== "boolean" || typeof source.platform !== "string") return undefined
  const reason = typeof source.reason === "string" ? source.reason.trim() : ""
  return {
    supported: source.supported,
    ...(typeof source.canStart === "boolean" ? { canStart: source.canStart } : {}),
    ...(typeof source.canConfigure === "boolean" ? { canConfigure: source.canConfigure } : {}),
    ...(source.appQuitFailure ? { appQuitFailure: source.appQuitFailure } : {}),
    ...(typeof source.loginShell === "string" ? { loginShell: source.loginShell } : {}),
    ...(Array.isArray(source.shells)
      ? { shells: source.shells.filter((shell): shell is string => typeof shell === "string") }
      : {}),
    ...(!source.supported
      ? { reason: reason || "App agent sessions are unavailable on this computer." }
      : {}),
  }
}

/**
 * Save files on this computer for a prompt the person copies into an agent outside the App
 * (`POST /api/handoff-attachments`, multipart); answers their absolute paths, in order.
 */
export async function uploadHandoffAttachments(
  files: readonly File[],
  fetcher: FetchRun = (...args) => fetch(...args),
): Promise<string[]> {
  const form = new FormData()
  for (const file of files) form.append("file", file, file.name)
  const response = await fetcher("/api/handoff-attachments", { method: "POST", body: form })
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // Keep the plain message below.
  }
  const body = (payload ?? {}) as { paths?: unknown; error?: { message?: unknown } | string }
  if (
    !response.ok ||
    !Array.isArray(body.paths) ||
    body.paths.length !== files.length ||
    !body.paths.every((path) => typeof path === "string")
  ) {
    const reason = typeof body.error === "string" ? body.error : body.error?.message
    throw new Error(
      typeof reason === "string" && reason
        ? reason
        : "Could not save these files on this computer. Try again.",
    )
  }
  return body.paths as string[]
}

/** Agent palette queries use the same current tokens as the mounted window. */
export function runColors(root: HTMLElement = document.documentElement): TerminalColors {
  const style = getComputedStyle(root)
  const theme = appearanceTheme({
    foreground: style.getPropertyValue("--ql-text").trim(),
    background: style.getPropertyValue("--ql-bg-sunken").trim(),
    cursor: style.getPropertyValue("--ql-accent").trim(),
  })
  const underlay = computedCssColor(getComputedStyle(document.body).backgroundColor, document.body)
  const base = underlay?.[3] === 1 ? underlay : [250, 250, 250]
  const bg = compositeColor(computedCssColor(theme.background, root) ?? [250, 250, 250, 1], base)
  const black = [0, 0, 0],
    white = [255, 255, 255]
  const readable = colorContrast(black, bg) >= colorContrast(white, bg) ? black : white
  let fg = compositeColor(
    computedCssColor(theme.foreground, root) ??
      ([...readable, 1] as [number, number, number, number]),
    bg,
  )
  // The host keeps these colours for native palette replies; an independent fallback can make
  // its foreground and background indistinguishable until that native session is restarted.
  if (colorContrast(fg, bg) < 4.5) fg = readable as [number, number, number]
  const cursor = compositeColor(
    computedCssColor(theme.cursor, root) ?? ([...fg, 1] as [number, number, number, number]),
    bg,
  )
  return {
    fg: rgbNumber(fg),
    bg: rgbNumber(bg),
    cursor: rgbNumber(cursor),
  }
}

type FetchRun = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** How many of the newest turns the Conversation asks the changes of. */
const CHANGES_TURNS = 30
/** One read of a session's record: undefined when the server has none, `problem` when the read fails. */
async function readRecord<T>(fetcher: FetchRun, path: string, problem: string, init?: RequestInit) {
  const response = await fetcher(path, init)
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(problem)
  return (await response.json()) as T
}
export function createRunAdapter(fetcher: FetchRun = (...args) => fetch(...args)): RunAdapter {
  let support: RunSupport | undefined
  async function call<T>(path: string, request?: unknown, files?: readonly File[]): Promise<T> {
    let upload: FormData | undefined
    if (files?.length) {
      upload = new FormData()
      upload.set("request", JSON.stringify(request))
      for (const file of files) upload.append("file", file, file.name)
    }
    const response = await fetcher(
      path,
      request === undefined
        ? undefined
        : {
            method: "POST",
            ...(upload ? {} : { headers: { "content-type": "application/json" } }),
            body: upload ?? JSON.stringify(request),
          },
    )
    const text = await response.text()
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
    if (!response.ok) {
      const missing = missingNativeSettings(payload)
      if (missing) throw new NativeSettingsUnknown(missing)
      const reason =
        payload && typeof payload === "object" && "error" in payload ? payload.error : text
      throw new Error(
        typeof reason === "string" && reason ? reason : "The agent run could not be loaded.",
      )
    }
    if (payload === null) throw new Error("The App returned an unreadable agent run.")
    return payload as T
  }
  return {
    list: () =>
      call<{ runs: RunSummary[]; supported?: boolean; platform?: string }>("/api/agent-runs").then(
        (reply) => {
          support = parseSourceSupported(reply)
          return reply.runs
        },
      ),
    handoffWorkflow: async (run, type, proof, retry = false, fromSavedPlan = false) => {
      const task = runTaskId(run)
      if (!task || !run.nativeSession || !/^[a-f0-9]{64}$/.test(proof))
        throw new Error("Take control of the current agent window before starting the Plan")
      const response = await fetcher(`/api/tasks/${encodeURIComponent(task)}/chat/promote`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qualitylayer-picker-proof": proof },
        body: JSON.stringify({
          type,
          retry,
          ...(fromSavedPlan ? { fromSavedPlan: true } : {}),
          native: { run: run.id, generation: run.generation, nativeSession: run.nativeSession },
        }),
      })
      const result = (await response.json()) as {
        handoff?: unknown
        error?: unknown
      }
      if (
        !response.ok ||
        !["sent", "already_sent", "pending", "uncertain"].includes(String(result.handoff))
      )
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "The Plan request could not be confirmed",
        )
      return {
        handoff: result.handoff as "sent" | "already_sent" | "pending" | "uncertain",
      }
    },
    start: (request: StartRequest, files?: readonly File[]) =>
      call<RunSummary>("/api/agent-runs", request, files),
    control: (id: string, request: ControlRequest) =>
      call<RunSummary>(`/api/agent-runs/${encodeURIComponent(id)}/control`, request),
    attach: (run, options) =>
      createTerminalView({
        ...options,
        url: `/api/agent-runs/${encodeURIComponent(run.id)}/attach`,
      }),
    conversation: (run, after, pickerProof) =>
      readRecord<ConversationSnapshot>(
        fetcher,
        `/api/agent-runs/${encodeURIComponent(run.id)}/conversation${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        "The conversation could not be read.",
        pickerProof ? { headers: { "x-qualitylayer-picker-proof": pickerProof } } : undefined,
      ),
    conversationEarlier: (run, before) =>
      readRecord<ConversationPage>(
        fetcher,
        `/api/agent-runs/${encodeURIComponent(run.id)}/conversation?${new URLSearchParams({ before })}`,
        "Earlier messages could not be read.",
      ),
    conversationEvent: async (run, id) =>
      (
        await readRecord<{ event: ConversationEvent }>(
          fetcher,
          `/api/agent-runs/${encodeURIComponent(run.id)}/conversation?${new URLSearchParams({ event: id })}`,
          "The full message could not be read.",
        )
      )?.event,
    turnChanges: async (run) =>
      (
        await readRecord<{ turns: TurnChanges[] }>(
          fetcher,
          `/api/agent-runs/${encodeURIComponent(run.id)}/changes?limit=${CHANGES_TURNS}`,
          "The changes of each turn could not be read.",
        )
      )?.turns,
    limits: async (refresh = false) =>
      (
        await readRecord<{ limits: AgentLimits[] }>(
          fetcher,
          refresh ? "/api/limits?refresh=1" : "/api/limits",
          "The plan limits could not be read.",
        )
      )?.limits,
    usage: async (period) => {
      const usage = await readRecord<Usage>(
        fetcher,
        `/api/usage?period=${period}`,
        "The usage could not be read.",
      )
      // An answer that is not a usage count (an old server, a proxy's page) is no usage.
      return Array.isArray(usage?.agents) ? usage : undefined
    },
    commandCatalog: async (run, refresh) => {
      const query = new URLSearchParams({
        generation: String(run.generation),
        ...(refresh ? { refresh: "1" } : {}),
      })
      const response = await fetcher(
        `/api/agent-runs/${encodeURIComponent(run.id)}/conversation/catalog?${query}`,
      )
      if (!response.ok) throw new Error("Could not read this agent’s skills.")
      return (await response.json()) as CommandCatalog
    },
    conversationClosed: async (run) => {
      try {
        await fetcher(`/api/agent-runs/${encodeURIComponent(run.id)}/conversation/closed`, {
          method: "POST",
          keepalive: true,
        })
      } catch {
        // The server also notices when the window's connection ends.
      }
    },
    conversationWorker: (run, worker, after) =>
      readRecord<ConversationSnapshot>(
        fetcher,
        `/api/agent-runs/${encodeURIComponent(run.id)}/conversation?${new URLSearchParams({ worker, ...(after ? { after } : {}) })}`,
        "The subagent conversation could not be read.",
      ),
    attachFiles: async (run, draft, files) => {
      const form = new FormData()
      form.set("draft", draft)
      form.set("generation", String(run.generation))
      for (const file of files) form.append("file", file, file.name)
      const response = await fetcher(
        `/api/agent-runs/${encodeURIComponent(run.id)}/message-files`,
        {
          method: "POST",
          body: form,
        },
      )
      const payload = (await response.json()) as { files?: Attachment[]; error?: string }
      if (!response.ok || !Array.isArray(payload.files))
        throw new Error(payload.error || "Could not attach these files. Your draft is kept.")
      return payload.files
    },
    answerApproval: async (run, approval, answer) => {
      const response = await fetcher(
        `/api/agent-runs/${encodeURIComponent(run.id)}/approvals/${encodeURIComponent(approval)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(answer),
        },
      )
      if (response.ok) return
      let message = "The answer could not be sent."
      try {
        const body = (await response.json()) as { error?: unknown }
        if (typeof body.error === "string") message = body.error
      } catch {
        // Keep the plain message.
      }
      throw new Error(message)
    },
    answerPicker: async (run, answer, proof, upload) => {
      if (!/^[a-f0-9]{64}$/.test(proof)) throw new Error("Take control to answer this question.")
      const payloadBody = { ...answer, generation: run.generation }
      const form = upload ? new FormData() : undefined
      if (form && upload) {
        form.set("answer", JSON.stringify(payloadBody))
        form.set("draft", upload.draft)
        for (const file of upload.files) form.append("file", file, file.name)
      }
      const response = await fetcher(`/api/agent-runs/${encodeURIComponent(run.id)}/picker`, {
        method: "POST",
        headers: {
          ...(form ? {} : { "content-type": "application/json" }),
          "x-qualitylayer-picker-proof": proof,
        },
        body: form ?? JSON.stringify(payloadBody),
      })
      const payload = (await response.json()) as {
        status?: unknown
        message?: unknown
        error?: unknown
      }
      if (
        !response.ok ||
        !["submitted", "confirmed", "expired", "refused"].includes(String(payload.status))
      )
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "The answer could not be sent. Take control and try again.",
        )
      return {
        status: payload.status as "submitted" | "confirmed" | "expired" | "refused",
        ...(typeof payload.message === "string" ? { message: payload.message } : {}),
      }
    },
    support: () => support,
    subscribe: (changed) => subscribeEventCount("runs", changed),
  }
}

export const runsApi = createRunAdapter()

/**
 * Cancel the resume QualityLayer planned for a run stopped on its plan limit (server/limits.ts):
 * whether one was cancelled. The task then waits for the person to continue it.
 */
export async function cancelLimitResume(
  run: string,
  fetcher: FetchRun = (...args) => fetch(...args),
): Promise<boolean> {
  const response = await fetcher("/api/limits/resume/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run }),
  })
  if (response.status === 403)
    throw new Error("Only the App and browsers it opened may cancel a resume.")
  if (!response.ok) throw new Error("The resume could not be cancelled.")
  return ((await response.json()) as { cancelled?: unknown }).cancelled === true
}
