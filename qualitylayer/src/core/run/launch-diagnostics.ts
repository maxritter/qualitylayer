import { AGENT_NAMES, NATIVE_AGENTS, type NativeAgent } from "../agents/ids.ts"

export const LOGIN_PROBE_OUTCOMES = [
  "not-recorded",
  "not-applicable",
  "success",
  "empty",
  "failed",
  "timed-out",
  "spawn-failed",
] as const
export const BINARY_SOURCES = [
  "not-recorded",
  "override",
  "path",
  "login-shell",
  "known-folder",
  "npm",
  "missing",
] as const
export const BINARY_CHECK_RESULTS = [
  "not-recorded",
  "incomplete",
  "not-found",
  "spawn-failed",
  "version-timeout",
  "version-exit",
  "identity-mismatch",
  "unsupported-version",
  "invalid-timeout",
  "passed",
] as const
export const START_PHASES = [
  "validated",
  "task-created",
  "branch-made",
  "launch-written",
  "host-started",
  "ready",
] as const
export type LoginProbeObservation = {
  outcome: (typeof LOGIN_PROBE_OUTCOMES)[number]
  inheritedEntries: number
  loginEntries: number
  pathEntries: number
}
export type DiscoveryObservation = {
  source: (typeof BINARY_SOURCES)[number]
  knownFoldersChecked: number
}
export type BinaryCheckObservation = DiscoveryObservation & {
  result: (typeof BINARY_CHECK_RESULTS)[number]
  nativeVersion?: string
}
export type LaunchDiagnostic = LoginProbeObservation &
  BinaryCheckObservation & {
    agent: NativeAgent
    phase: (typeof START_PHASES)[number]
    serverVersion: string
  }

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const count = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000
const version = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d+\.\d+\.\d+(?:\.\d+)?(?:-dev|-(?:beta|alpha|rc)\.\d+(?:\.\d+)?)?$/.test(v) &&
  v.length <= 40
const member = <T extends string>(v: unknown, values: readonly T[]): v is T =>
  typeof v === "string" && values.includes(v as T)

function hasValidDiagnosticCounts(value: Record<string, unknown>): boolean {
  return (
    count(value.inheritedEntries) &&
    count(value.loginEntries) &&
    count(value.pathEntries) &&
    count(value.knownFoldersChecked)
  )
}

function hasValidDiagnosticFields(value: Record<string, unknown>): boolean {
  const validIdentity = member(value.agent, NATIVE_AGENTS) && member(value.phase, START_PHASES)
  const validObservations =
    member(value.outcome, LOGIN_PROBE_OUTCOMES) &&
    member(value.source, BINARY_SOURCES) &&
    member(value.result, BINARY_CHECK_RESULTS)
  return validIdentity && validObservations && version(value.serverVersion)
}

/** Rebuild a saved observation without accepting paths, output or arbitrary error text. */
export function cleanLaunchDiagnostic(value: unknown): LaunchDiagnostic | null {
  if (!record(value) || !hasValidDiagnosticFields(value) || !hasValidDiagnosticCounts(value))
    return null
  return {
    agent: value.agent as LaunchDiagnostic["agent"],
    phase: value.phase as LaunchDiagnostic["phase"],
    outcome: value.outcome as LaunchDiagnostic["outcome"],
    source: value.source as LaunchDiagnostic["source"],
    result: value.result as LaunchDiagnostic["result"],
    serverVersion: value.serverVersion as string,
    inheritedEntries: value.inheritedEntries as number,
    loginEntries: value.loginEntries as number,
    pathEntries: value.pathEntries as number,
    knownFoldersChecked: value.knownFoldersChecked as number,
    ...(version(value.nativeVersion) ? { nativeVersion: value.nativeVersion } : {}),
  }
}

export function launchDiagnostic(agent: NativeAgent, serverVersion: string) {
  let login: LoginProbeObservation = {
    outcome: "not-recorded",
    inheritedEntries: 0,
    loginEntries: 0,
    pathEntries: 0,
  }
  let binary: BinaryCheckObservation = {
    source: "not-recorded",
    knownFoldersChecked: 0,
    result: "not-recorded",
  }
  return {
    login: (observation: LoginProbeObservation) => {
      login = observation
    },
    binary: (observation: BinaryCheckObservation) => {
      binary = observation
    },
    failed: (phase: LaunchDiagnostic["phase"]): LaunchDiagnostic => ({
      ...login,
      ...binary,
      agent,
      phase,
      serverVersion,
    }),
  }
}

const PHASE: Record<LaunchDiagnostic["phase"], string> = {
  validated: "before launch",
  "task-created": "task created",
  "branch-made": "workspace prepared",
  "launch-written": "launch prepared",
  "host-started": "terminal started",
  ready: "agent ready",
}
const RESULT: Record<LaunchDiagnostic["result"], string> = {
  "not-recorded": "not recorded",
  incomplete: "executable check incomplete",
  "not-found": "command not found",
  "spawn-failed": "version command could not start",
  "version-timeout": "version check timed out",
  "version-exit": "version command failed",
  "identity-mismatch": "command did not identify the selected agent",
  "unsupported-version": "agent version is not supported",
  "invalid-timeout": "invalid version timeout",
  passed: "executable check passed; later start failed",
}
const LOGIN: Record<LaunchDiagnostic["outcome"], string> = {
  "not-recorded": "Login PATH not recorded",
  "not-applicable": "Login PATH not applicable",
  success: "Login PATH checked",
  empty: "Login PATH empty",
  failed: "Login PATH check failed",
  "timed-out": "Login PATH check timed out",
  "spawn-failed": "Login shell could not start",
}
const SOURCE: Record<LaunchDiagnostic["source"], string> = {
  "not-recorded": "Physical command not recorded",
  override: "Physical command from configured override",
  path: "Physical command from launch PATH",
  "login-shell": "Physical command from login shell",
  "known-folder": "Physical command from known install location",
  npm: "Physical command from npm",
  missing: "Physical command not found",
}

export function launchDiagnosticRows(value: LaunchDiagnostic): { label: string; value: string }[] {
  const d = cleanLaunchDiagnostic(value)
  if (!d) return []
  return [
    {
      label: "Recent agent start",
      value: `${AGENT_NAMES[d.agent]} · ${PHASE[d.phase]} · ${RESULT[d.result]}`,
    },
    {
      label: "Command discovery",
      value: [
        LOGIN[d.outcome],
        ...(d.outcome !== "not-recorded"
          ? [
              `${d.inheritedEntries} inherited / ${d.loginEntries} login / ${d.pathEntries} launch PATH folders`,
            ]
          : []),
        ...(d.source !== "not-recorded"
          ? [`${d.knownFoldersChecked} known install locations checked`]
          : []),
        SOURCE[d.source],
        ...(d.nativeVersion ? [`Agent ${d.nativeVersion}`] : []),
        `Server ${d.serverVersion}`,
      ].join(" · "),
    },
  ]
}
