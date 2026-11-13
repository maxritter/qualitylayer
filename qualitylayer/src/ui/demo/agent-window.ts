import { IMAGE_TYPES, pickProblem } from "../../core/interaction-docs/attachment-rules.ts"
import type { AttachmentType } from "../../core/interaction-docs/attachments.ts"
import type { ViewerState } from "../../core/run/protocol.ts"
import {
  appearanceTheme,
  readTerminalAppearance,
  subscribeTerminalAppearance,
} from "../agent-window/appearance.ts"
import type { TerminalOptions, TerminalView } from "../agent-window/view.ts"
import { terminalTheme } from "../agent-window/view.ts"
import type { RunAdapter, RunControlRequest, RunStart, RunWindow } from "../run-context.tsx"
import { SYNTHETIC_AGENT_OUTPUT } from "./agent-window-fixture.ts"
import { renderClaudeTerminal } from "./claude-terminal.ts"
import {
  demoAnswered,
  demoConversation,
  demoEarlier,
  demoForgetAnswers,
  demoMessage,
  demoScene,
  demoSessionModel,
  demoTurnChanges,
  demoWorkerConversation,
} from "./conversation.ts"
import { DEMO_TASK_ID } from "./identity.ts"
import { demoLimits } from "./limits.ts"
import { nativeAgentFrom } from "./route.ts"
import { demoUsage, demoUsageFails, demoUsageScenario } from "./usage.ts"

export type RunDemoMoment =
  | "starting"
  | "asking"
  | "plan-ready"
  | "plan-asking"
  | "artifact-working"
  | "folded"
  | "running"
  | "settings"
  | "waiting"
  | "watching"
  | "stopped"
  | "other"
  | "truncated"
  | "error"
  | "renderer-error"
  | "attention"
export function runMomentFrom(search: string): RunDemoMoment | undefined {
  const moment = new URLSearchParams(search).get("run")
  return moment &&
    [
      "starting",
      "asking",
      "plan-ready",
      "plan-asking",
      "artifact-working",
      "folded",
      "running",
      "settings",
      "waiting",
      "watching",
      "stopped",
      "other",
      "truncated",
      "error",
      "renderer-error",
      "attention",
    ].includes(moment)
    ? (moment as RunDemoMoment)
    : undefined
}
const authority = (generation: number, watching: boolean): ViewerState => ({
  type: "viewer-state",
  generation,
  controller: !watching,
  canType: !watching,
  canStop: true,
  canResize: !watching,
  canTakeControl: !watching,
  ...(!watching ? { pickerProof: "a".repeat(64) } : {}),
})
export function demoRun(moment: RunDemoMoment, task = DEMO_TASK_ID): RunWindow {
  const galleryArtifact =
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("gallery") === "artifact"
  const watching = moment === "watching"
  const claude = ["plan-ready", "plan-asking", "artifact-working", "asking"].includes(moment)
  const artifact = moment === "artifact-working"
  return {
    id: "synthetic-run",
    agent: moment === "other" ? "other" : claude ? "claude-code" : "codex",
    cwd: "~/code/qualitylayer-demo",
    purpose: artifact
      ? {
          kind: "artifact",
          scope: "task",
          id: task,
          file: galleryArtifact ? "artifacts/queue-console.html" : "artifacts/queue-routing.html",
          revision: galleryArtifact ? "illustrative-queue-console" : "illustrative-queue-routing",
          request: galleryArtifact
            ? "Draw the queue migration console before we build it."
            : "Refine the queue-routing console.",
        }
      : { kind: "task", task },
    task,
    title: artifact
      ? galleryArtifact
        ? "Queue migration"
        : "Queue routing"
      : moment === "plan-asking"
        ? "Reliable webhook delivery"
        : "Usage-based billing",
    generation: 1,
    status:
      moment === "starting" || moment === "asking"
        ? "starting"
        : moment === "stopped"
          ? "stopped"
          : "running",
    startedAt: "2026-10-12T12:00:00Z",
    updatedAt: "2026-10-12T12:00:00Z",
    idempotencyKey: "synthetic-demo",
    startPhase: "ready",
    nativeSession: "synthetic-session",
    resumeLine: claude ? "claude --resume synthetic-session" : "codex resume synthetic-session",
    settings: {
      perm: "fewer",
      typeFrom: "keyPaired",
      windowMode: moment === "folded" ? "fold" : "open",
      onQuit: "keep",
      model: claude ? "opus" : "gpt-6.1-sol",
      effort: "high",
    },
    viewer: authority(1, watching),
    canConfigure: !watching,
    canResume: !watching,
    canRestart: false,
    settingsOpen: moment === "settings",
    firstPromptAt:
      moment === "starting" || moment === "asking" ? undefined : "2026-10-12T12:00:01Z",
    // The agent waits on its own first question (trust this folder) in its terminal.
    ...(moment === "asking" ? { startupPrompt: "trust" as const } : {}),
    attention: moment === "waiting" ? "waiting" : moment === "attention" ? "attention" : "clear",
    truncated: moment === "truncated",
    error: moment === "error" ? "The agent's window disconnected." : undefined,
    request: moment === "other" ? "Build the synthetic demonstration" : undefined,
    facts: `${claude ? "Opus 5.5" : "GPT-6.1 Sol"} · High effort · Fewer prompts · This checkout · session synthetic-session`,
  }
}

/** What the page's address asks the demonstration's Conversation to show. */
const scene = () => demoScene(typeof location === "undefined" ? "" : location.search)

/**
 * The agents running in terminals of their own while the App is shown with no window asked for: the four
 * sessions Settings › Sessions lists, which the Plan limits popover counts.
 */
function backgroundRuns(): RunWindow[] {
  const agents = ["codex", "claude-code", "codex", "claude-code"] as const
  return agents.map((agent, index) => ({
    id: `background-${index + 1}`,
    agent,
    cwd: "~/code/qualitylayer-demo",
    purpose: { kind: "terminal" as const },
    generation: 1,
    status: "running" as const,
    startedAt: "2026-10-12T12:00:00Z",
    updatedAt: "2026-10-12T12:00:00Z",
    idempotencyKey: `synthetic-background-${index + 1}`,
    startPhase: "ready" as const,
    title: "billing",
    resumeLine: "",
    viewer: authority(1, true),
    attention: "clear" as const,
  }))
}

/** The demo exercises dock controls with explicit synthetic data and never connects to /api. */
export function createDemoRunAdapter(
  initial?: RunDemoMoment,
  changed: () => void = () => {},
  task = DEMO_TASK_ID,
  allocateTask?: (request: RunStart) => string,
): RunAdapter & { reset(): void } {
  const sessionSettings =
    typeof location === "undefined"
      ? null
      : new URLSearchParams(location.search).get("session-settings")
  const settingsReady = sessionSettings === "ready"
  // A change already asked: waiting for the turn to end, or one that could not be applied.
  const queuedChange = (generation: number, nativeSession: string | undefined) => ({
    id: "illustrative-settings",
    generation,
    nativeSession: nativeSession ?? "illustrative-session",
    requestedAt: "2026-10-12T12:05:00Z",
    requestedStatus: "running" as const,
    authorityProof: "illustrative",
    settings: { effort: "medium" },
    ...(sessionSettings === "failed"
      ? { error: "The session stopped before this change; apply again when you want to resume" }
      : { waiting: "turn" as const }),
  })
  const initialRun = () => {
    if (!initial) return backgroundRuns()
    const demo = demoRun(initial, task)
    const run = {
      ...demo,
      ...(settingsReady ? { canRestart: true, canChangePermission: true } : {}),
      ...(sessionSettings === "pending" || sessionSettings === "failed"
        ? { pendingSettings: queuedChange(demo.generation, demo.nativeSession) }
        : {}),
    }
    const agent = nativeAgentFrom(typeof location === "undefined" ? "" : location.search)
    const model = agent ? demoSessionModel(agent) : ""
    return [
      agent
        ? {
            ...run,
            agent,
            ...(run.settings
              ? {
                  settings: {
                    ...run.settings,
                    model,
                    effort: agent === "cursor" ? undefined : "high",
                  },
                }
              : {}),
            facts: `${model} · High effort · This checkout · session synthetic-session`,
            resumeLine: `${agent === "claude-code" ? "claude --resume" : agent === "codex" ? "codex resume" : `${agent} --session`} synthetic-session`,
          }
        : run,
    ]
  }
  let runs = initialRun()
  const listeners = new Set<() => void>()
  const windows = new Map<string, Set<(run: RunWindow) => void>>()
  const notify = (run?: RunWindow) => {
    if (run) for (const listener of windows.get(run.id) ?? []) listener(run)
    for (const listener of listeners) listener()
    changed()
  }
  const update = (run: RunWindow) => {
    runs = [...runs.filter((item) => item.id !== run.id), run]
    notify(run)
    return structuredClone(run)
  }
  async function control(id: string, request: RunControlRequest) {
    const run = runs.find((item) => item.id === id)
    if (!run || run.generation !== request.generation)
      throw new Error("This agent window has changed. Open it again.")
    const viewer = run.viewer
    if (
      request.action === "stop"
        ? !viewer?.canStop
        : request.action === "take-control"
          ? !viewer?.canTakeControl
          : request.action === "resume"
            ? !run.canResume
            : !viewer?.canType
    )
      throw new Error("This browser can only watch this window.")
    switch (request.action) {
      case "configure":
        if (run.canRestart || run.status === "stopped" || run.status === "failed")
          return control(id, {
            ...request,
            action: run.status === "running" ? "restart" : "resume",
          })
        return update({
          ...run,
          pendingSettings: {
            id: "illustrative-settings",
            generation: run.generation,
            nativeSession: run.nativeSession ?? "illustrative-session",
            requestedAt: new Date().toISOString(),
            requestedStatus: "running",
            authorityProof: "illustrative",
            waiting: "turn",
            settings: request.settings ?? {},
            ...(request.confirmBypass ? { confirmBypass: true } : {}),
          },
        })
      case "stop":
      case "move":
        return update({ ...run, status: "stopped", attention: "clear" })
      case "interrupt":
        return update({ ...run, canRestart: false, attention: "clear" })
      case "take-control":
        return update({ ...run, viewer: authority(run.generation, false) })
      case "send-request":
        if (run.requestSent) throw new Error("The request was already sent.")
        return update({ ...run, requestSent: true })
      case "restart":
        if (!run.canRestart)
          throw new Error("The turn has not ended. Stop and Resume here instead.")
        return update({
          ...run,
          generation: run.generation + 1,
          status: settingsReady ? "running" : "starting",
          settings: { ...run.settings, ...request.settings } as RunWindow["settings"],
          pendingSettings: undefined,
          firstPromptAt: settingsReady ? run.firstPromptAt : undefined,
          viewer: authority(run.generation + 1, false),
        })
      case "resume":
        return update({
          ...run,
          generation: run.generation + 1,
          status: "starting",
          firstPromptAt: undefined,
          viewer: authority(run.generation + 1, false),
          settings: { ...run.settings, ...request.settings } as RunWindow["settings"],
        })
    }
  }
  return {
    list: async () => structuredClone(runs),
    start: async (request: RunStart) => {
      const existing = runs.find((run) => run.idempotencyKey === request.idempotencyKey)
      if (existing) return structuredClone(existing)
      const allocated =
        request.allocateTask && request.purpose.kind === "new-task"
          ? allocateTask?.(request)
          : undefined
      const run = demoRun(
        request.agent === "other" ? "other" : "starting",
        request.purpose.kind === "task" ? request.purpose.task : task,
      )
      return update({
        ...run,
        id: `synthetic-${request.idempotencyKey}`,
        agent: request.agent,
        purpose: request.purpose,
        ...(request.purpose.kind === "terminal"
          ? { request: undefined, requestSent: undefined }
          : {}),
        task: request.purpose.kind === "task" ? request.purpose.task : allocated,
        ...(allocated ? { allocatedTask: true } : {}),
        cwd: request.cwd ?? run.cwd,
        idempotencyKey: request.idempotencyKey,
        title:
          request.purpose.kind === "new-task"
            ? (request.purpose.title ?? request.purpose.request)
            : request.purpose.kind === "terminal"
              ? request.purpose.shell
                ? "zsh"
                : // A new terminal is named after its checkout, the example's billing project.
                  "billing"
              : run.title,
        settings: {
          ...run.settings,
          model: undefined,
          effort: undefined,
          perm: "own",
          ...request.settings,
        } as RunWindow["settings"],
        facts: [
          request.settings?.model,
          request.settings?.effort ? `${request.settings.effort} effort` : undefined,
          (request.settings?.perm ?? "own") === "own" ? "Your agent's own settings" : undefined,
          request.purpose.kind === "terminal" ? "This checkout" : "Your checkout",
        ]
          .filter(Boolean)
          .join(" · "),
        // The in-memory engine is ready immediately; no provider or process is started.
        status: "running",
        startPhase: "ready",
        firstPromptAt:
          request.purpose.kind === "terminal" || request.agent === "other"
            ? undefined
            : new Date().toISOString(),
      })
    },
    control,
    // `?conversation=connecting` holds the first read open: the Conversation stays in its loading moment
    // ("Reading <agent>'s conversation", "Connecting" in the footer), as session-loading shows.
    conversation: async (run, after) =>
      typeof location !== "undefined" &&
      new URLSearchParams(location.search).get("conversation") === "connecting"
        ? await new Promise<never>(() => {})
        : run.agent !== "other" && run.purpose.kind === "new-task" && run.purpose.type === "chat"
          ? {
              agent: run.agent,
              source: "transcript",
              cursor: "chat-start",
              ...(!after ? { reset: true as const } : {}),
              events: after
                ? []
                : [{ id: "initial-request", kind: "user", text: run.purpose.request }],
              truncated: false,
              state: "idle",
              question: null,
              checklist: null,
            }
          : // This opt-in story keeps the program alive at a completed turn boundary.
            demoConversation(settingsReady ? { ...run, status: "stopped" } : run, after, scene()),
    conversationEarlier: async (_run, before) => demoEarlier(scene().turns ?? 0, before),
    conversationEvent: async () => undefined,
    turnChanges: async (run) => demoTurnChanges(run, scene()),
    limits: async () => demoLimits(typeof location === "undefined" ? "" : location.search),
    usage: async (period) => {
      const search = typeof location === "undefined" ? "" : location.search
      if (demoUsageFails(search)) throw new Error("The usage could not be read")
      return demoUsage(period, demoUsageScenario(search))
    },
    conversationWorker: async (run, worker, after) => demoWorkerConversation(run, worker, after),
    attachFiles: async (run, draft, files) => {
      if (!runs.some((item) => item.id === run.id && item.generation === run.generation))
        throw new Error("This illustrative session is no longer current.")
      const problem = pickProblem(files)
      if (problem) throw new Error(problem)
      return files.map((file, index) => ({
        name: file.name,
        size: file.size,
        type: ((IMAGE_TYPES as readonly string[]).includes(file.type)
          ? file.type
          : file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
            ? "application/pdf"
            : "text/plain") as AttachmentType,
        path: `/illustrative/attachments/${encodeURIComponent(draft.slice(0, 128))}/${index}-${encodeURIComponent(file.name)}`,
      }))
    },
    // The demonstration's agent goes on once the illustrated request is answered.
    answerApproval: async (run) => {
      const found = runs.find((item) => item.id === run.id)
      demoAnswered(run.id)
      if (found) update({ ...found, attention: "clear" })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reset() {
      demoForgetAnswers()
      runs = initialRun()
      notify()
    },
    attach(run, options) {
      return syntheticView(run, options, windows, initial)
    },
  }
}
function syntheticView(
  run: RunWindow,
  options: TerminalOptions,
  windows: Map<string, Set<(run: RunWindow) => void>>,
  initial?: RunDemoMoment,
): TerminalView {
  let root: HTMLElement | undefined
  let output: HTMLDivElement | undefined
  let theme = options.theme
  let unsubscribeAppearance: (() => void) | undefined
  const appearance = () => {
    if (!root || !output) return
    const value = readTerminalAppearance()
    const colors = appearanceTheme(theme ?? terminalTheme(root), value)
    output.style.fontSize = `${value.fontSize}px`
    output.style.lineHeight = String(value.lineHeight)
    output.style.fontFamily = value.fontFamily
      ? `"${value.fontFamily}", "Geist Mono", monospace`
      : '"Geist Mono", monospace'
    output.style.fontWeight = value.fontWeight
    output.style.letterSpacing = `${value.letterSpacing}px`
    root.style.color = colors.foreground
    root.style.backgroundColor = colors.background
    const light = ["#fafafa", "#ffffff"].includes(colors.background.toLowerCase())
    const palette = light
      ? {
          muted: "#626262",
          you: "#9d6607",
          "you-bg": "#fff4dc",
          "prompt-bg": "#ededed",
          cyan: "#006a7c",
          yellow: "#806000",
          orange: "#925700",
          green: "#287433",
          blue: "#1766a6",
          purple: "#8b42a8",
        }
      : {
          muted: "#969696",
          you: "#f7b23b",
          "you-bg": "#2a2112",
          "prompt-bg": "#242424",
          cyan: "#56b6c2",
          yellow: "#d7ba7d",
          orange: "#e5a95c",
          green: "#79b87e",
          blue: "#61afef",
          purple: "#c678dd",
        }
    for (const [name, color] of Object.entries(palette))
      root.style.setProperty(`--cc-${name}`, color)
  }
  const inputs = new Set<(text: string) => void>()
  let canType = run.viewer?.canType === true
  const show = (next: RunWindow) => {
    canType = next.viewer?.canType === true
    options.onViewer?.(next.viewer ?? authority(next.generation, true))
    options.onEvent?.({ type: "status", status: next.status, cols: 100, rows: 24 })
    options.onEvent?.({ type: "attention", kind: next.attention ?? "clear" })
    if (output) {
      // The story's billing task at an Implement moment (`?moment=impl-…&story`) is building.
      const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search)
      const building = params.has("story") && /^(impl-|now$)/.test(params.get("moment") ?? "")
      const text =
        next.purpose.kind === "terminal" && next.purpose.shell
          ? "Synthetic project shell\n~/code/qualitylayer-demo\n\n$ "
          : next.agent === "other"
            ? SYNTHETIC_AGENT_OUTPUT.other
            : next.status === "starting"
              ? SYNTHETIC_AGENT_OUTPUT.starting
              : next.status === "stopped"
                ? SYNTHETIC_AGENT_OUTPUT.stopped
                : next.attention === "waiting"
                  ? SYNTHETIC_AGENT_OUTPUT.waiting
                  : initial === "plan-asking"
                    ? SYNTHETIC_AGENT_OUTPUT.questions
                    : initial === "artifact-working"
                      ? SYNTHETIC_AGENT_OUTPUT.artifact
                      : building
                        ? SYNTHETIC_AGENT_OUTPUT.implement
                        : SYNTHETIC_AGENT_OUTPUT.running
      const claude =
        next.agent === "claude-code" && next.status === "running" && next.attention !== "waiting"
      output.style.height = claude ? "100%" : "auto"
      output.style.whiteSpace = claude ? "normal" : "pre-wrap"
      if (claude)
        renderClaudeTerminal(
          output,
          text,
          initial === "plan-asking"
            ? "questions"
            : initial === "artifact-working"
              ? "artifact"
              : building
                ? "implement"
                : "plan",
        )
      else output.textContent = text
    }
  }
  let connected = false
  const sender = (action: "interrupt" | "stop" | "take-control") => {
    if (!connected || !run.viewer?.canTakeControl || action !== "take-control") return false
    options.onViewer?.(authority(run.generation, false))
    return true
  }
  return {
    async mount(target) {
      root = target
      root.dataset.synthetic = "true"
      root.setAttribute(
        "aria-description",
        "Illustrative output; this demonstration runs no agent.",
      )
      // WebGL failing never ends the session: the window keeps drawing without it.
      if (initial === "renderer-error") options.onRenderer?.("failed")
      output = document.createElement("div")
      root.replaceChildren(output)
      appearance()
      unsubscribeAppearance = subscribeTerminalAppearance(appearance)
      connected = true
      options.onControl?.(sender)
      show(run)
      const listeners = windows.get(run.id) ?? new Set()
      listeners.add(show)
      windows.set(run.id, listeners)
    },
    write(text) {
      if (output) output.textContent += text
    },
    onInput(listener) {
      inputs.add(listener)
      return () => {
        inputs.delete(listener)
      }
    },
    // What the Conversation view types: only a controlling window can, and the demo keeps the message.
    sendInput(text) {
      if (!connected || !canType) return false
      demoMessage(run.id, text)
      for (const listener of inputs) listener(text)
      return true
    },
    resize() {},
    focus() {},
    retryRenderer() {
      options.onRenderer?.("webgl")
    },
    setTheme(next) {
      theme = next
      appearance()
    },
    dispose() {
      unsubscribeAppearance?.()
      connected = false
      options.onControl?.(undefined)
      windows.get(run.id)?.delete(show)
      inputs.clear()
      root?.replaceChildren()
    },
  }
}
