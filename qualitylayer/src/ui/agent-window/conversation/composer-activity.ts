// What the composer says about the agent between Attach and Interrupt/Send, worked out from state the
// Conversation already derives (its record's working/idle, the run's permission wait, loading, retrying).
// Pure and poll-free. A live process is never "working": only the record's own state is.

import type { ConversationEvent } from "../../../core/conversation/types.ts"

export type ComposerActivity = {
  kind: "working" | "waiting" | "connecting" | "ready"
  /** The visible words. */
  text: string
  /** The accessible name: always the full words. */
  label: string
}

/** The newest tool call the record shows without a result: what the agent is doing now, when it says. */
export function currentTool(events: readonly ConversationEvent[]): string | undefined {
  const done = new Set<string>()
  for (let at = events.length - 1; at >= 0; at--) {
    const event = events[at]
    if (event?.kind === "tool-result") done.add(event.callId)
    else if (event?.kind === "user") return undefined
    else if (event?.kind === "tool" && !done.has(event.callId) && event.tool !== "subagent")
      return event.target ? `${event.name} ${event.target}` : event.name
  }
  return undefined
}

type ComposerActivityInput = {
  active: boolean
  readOnly: boolean
  /** The run or the record waits for a permission (including the terminal-only permission dialog). */
  waiting: boolean
  permission?: boolean
  helpers?: number
  /** The agent's own start-up question waits in its terminal. */
  startup: boolean
  started: boolean
  /** The record has been read once. */
  loaded: boolean
  /** The record cannot be read: nothing is claimed. */
  unavailable: boolean
  loading: boolean
  failing: boolean
  working: boolean
  tool?: string | undefined
  /** Terminal WebSocket health: prevents claiming Ready while reconnecting or disconnected. */
  transportStatus?: "live" | "reconnecting" | "disconnected" | undefined
}

function waitingActivity(input: ComposerActivityInput): ComposerActivity | undefined {
  // Waiting wins over working: the agent is stopped on the person.
  if (input.waiting) {
    return input.permission === false
      ? { kind: "waiting", text: "Waiting for you", label: "Waiting for your answer" }
      : { kind: "waiting", text: "Waiting for permission", label: "Waiting for your permission" }
  }
  if (input.startup) {
    return {
      kind: "waiting",
      text: "Waiting in terminal",
      label: "Waiting for you in its terminal",
    }
  }
  return undefined
}

const TRANSPORT_CONNECTING: Record<"reconnecting" | "disconnected", ComposerActivity> = {
  reconnecting: {
    kind: "connecting",
    text: "Reconnecting…",
    label: "Reconnecting to the agent window",
  },
  disconnected: {
    kind: "connecting",
    text: "Disconnected",
    label: "The agent window disconnected",
  },
}

function connectingActivity(input: ComposerActivityInput): ComposerActivity | undefined {
  if (input.transportStatus === "reconnecting" || input.transportStatus === "disconnected") {
    return TRANSPORT_CONNECTING[input.transportStatus]
  }
  if (input.failing) {
    return { kind: "connecting", text: "Retrying", label: "Retrying to read the conversation" }
  }
  if (!input.started || (!input.loaded && !input.unavailable)) {
    return { kind: "connecting", text: "Connecting", label: "Connecting to the agent" }
  }
  return input.loading
    ? { kind: "connecting", text: "Loading", label: "Loading the conversation" }
    : undefined
}

function workingOrReadyActivity(input: ComposerActivityInput): ComposerActivity | undefined {
  if (input.helpers && input.helpers > 0) {
    const text = `${input.helpers} background ${input.helpers === 1 ? "helper" : "helpers"} working`
    return { kind: "working", text, label: text }
  }
  if (input.working) {
    const tool = input.tool?.trim()
    const short = tool && tool.length > 40 ? `${tool.slice(0, 39)}…` : tool
    return {
      kind: "working",
      text: short ? `Working · ${short}` : "Working",
      label: tool ? `Working, running ${tool}` : "Working",
    }
  }
  return input.unavailable
    ? undefined
    : { kind: "ready", text: "Ready", label: "Ready for your message" }
}

export function composerActivity(input: ComposerActivityInput): ComposerActivity | undefined {
  if (!input.active || input.readOnly) return undefined
  return waitingActivity(input) ?? connectingActivity(input) ?? workingOrReadyActivity(input)
}
