// The parts of New task's behaviour that stand on their own: the folder's branch, why the App cannot
// run an agent, and saving attached files once.

import { useEffect, useRef, useState } from "react"
import type { HistorySession } from "../core/agents/history-sessions.ts"
import type { NativeAgent } from "../core/agents/ids.ts"
import type { DefaultsAgent, PlanningDefaults } from "../core/config-values.ts"
import type { AgentHistoryApi } from "./agent-history-api.ts"
import type { Project, SubagentModels } from "./api.ts"
import type { ProjectFolderApi, ProjectTarget } from "./ProjectPicker.tsx"
import { type AgentLaunchValue, availableLaunchAgents } from "./run/AgentLaunchFields.tsx"
import type { LaunchBranchResolved, LaunchBranchState } from "./run/LaunchBranch.tsx"
import { NO_AGENT, NO_RUNS } from "./run/launch-copy.ts"
import type { RunSupport } from "./runs-api.ts"

/**
 * The checked-out branch of the chosen folder, read once per folder. `known` is the branch the App
 * already has for it; when the App passes one (even none), that wins.
 */
export function useFolderBranch(
  readFolder: ProjectFolderApi["projectFolder"] | undefined,
  path: string | null,
  known: string | null | undefined,
): string | null {
  const [read, setRead] = useState<{ path: string; branch: string } | null>(null)
  useEffect(() => {
    if (!readFolder || path === null) return
    let current = true
    void readFolder(path).then(
      (folder) => {
        if (current) setRead(folder.branch ? { path, branch: folder.branch } : null)
      },
      () => {
        if (current) setRead(null)
      },
    )
    return () => {
      current = false
    }
  }, [readFolder, path])
  if (known !== undefined) return known
  return read?.path === path ? read.branch : null
}

/**
 * Why the App cannot run an agent here, or null when it can: the server must be able to, and a
 * native agent must be installed.
 */
export function appUnavailable(
  runSupport: RunSupport | undefined,
  hasRuns: boolean,
  installed: SubagentModels[] | null | undefined,
): string | null {
  if (runSupport?.supported !== true || !hasRuns) return runSupport?.reason?.trim() || NO_RUNS
  return installed != null && availableLaunchAgents(installed).length === 0 ? NO_AGENT : null
}

/** Saves the attached files where an agent outside the App can read them, once for the same files. */
export function useSavedPaths(files: File[], save: (files: File[]) => Promise<string[]>) {
  const saved = useRef<{ files: File[]; paths: string[] } | null>(null)
  return async (): Promise<string[]> => {
    if (files.length === 0) return []
    const again = saved.current
    if (again && again.files.length === files.length && again.files.every((f, i) => f === files[i]))
      return again.paths
    const paths = await save(files)
    saved.current = { files: [...files], paths }
    return paths
  }
}

/** The requested project keeps its selected checkout, even before the catalog has refreshed. */
export function firstTarget(
  projects: Project[],
  named: string | undefined,
  selected: ProjectTarget | null | undefined,
): ProjectTarget | null {
  if (named === undefined) return selected ?? null
  if (selected?.project.id === named) return selected
  const project = projects.find((p) => p.id === named)
  return project?.paths[0] ? { project, path: project.paths[0] } : null
}

type Picks = Partial<Record<DefaultsAgent, Partial<PlanningDefaults>>>
export type NewTaskDraft = {
  request: string
  where: "app" | "terminal"
  kind: "feature" | "bugfix" | "chat"
  /** How a Feature or Bugfix starts: planned here, or from the person's existing plan. Kept only with unfinished work. */
  start?: "plan" | "existing"
  files: File[]
  agent: DefaultsAgent | null
  picks: Picks
  branch: LaunchBranchState
}

/** Only authored work retains a launch choice; an empty previous chooser is a fresh launch. */
export function unfinishedNewTaskDraft(
  prompt: string,
  draft: NewTaskDraft | null | undefined,
): NewTaskDraft | null {
  return draft && draft.request === prompt && (prompt.trim() !== "" || draft.files.length > 0)
    ? draft
    : null
}

/** What the card starts with: the planning defaults of the agent, over the picks changed here. */
export function launchValues(
  agent: NativeAgent | null,
  defaults: Record<NativeAgent, PlanningDefaults>,
  picks: Picks,
): PlanningDefaults {
  const fixed = { terminalSession: "new", planningWorks: "checkout" } as const
  if (agent === null) return { model: "", effort: "high", ...fixed }
  return { ...defaults[agent], ...fixed, ...picks[agent] }
}

/** A pick in the agent line, kept per agent; a model only counts for the agent it was picked for. */
export function withPick(
  picks: Picks,
  agent: DefaultsAgent,
  patch: Partial<AgentLaunchValue>,
  changedAgent: boolean,
): Picks {
  return {
    ...picks,
    [agent]: {
      ...picks[agent],
      ...(!changedAgent && patch.model !== undefined ? { model: patch.model } : {}),
      ...(!changedAgent && patch.effort !== undefined ? { effort: patch.effort } : {}),
    },
  }
}

/**
 * The request's text: the App's kept draft for a task, a text of its own for New chat (which starts
 * empty and leaves the task draft alone).
 */
export function useRequestText(
  chat: boolean,
  kept: string,
  keep: (text: string) => void,
): [string, (text: string) => void] {
  const [own, setOwn] = useState("")
  return [chat ? own : kept, chat ? setOwn : keep]
}

type SessionList = { total: number; sessions: HistorySession[] }

/**
 * The sessions an agent already has in the chosen project, read once per folder while `enabled`.
 * `null` is "not known": still reading, not asked, or the read failed (the card says nothing then,
 * rather than claiming there are none).
 */
export function useFolderSessions(
  api: AgentHistoryApi,
  path: string | null,
  enabled: boolean,
): SessionList | null {
  const [read, setRead] = useState<{ path: string; list: SessionList } | null>(null)
  useEffect(() => {
    if (!enabled || path === null) return
    const stop = new AbortController()
    void api.sessions(path, stop.signal).then(
      (list) => {
        if (!stop.signal.aborted) setRead({ path, list })
      },
      () => {
        if (!stop.signal.aborted) setRead(null)
      },
    )
    return () => stop.abort()
  }, [api, path, enabled])
  return enabled && read?.path === path ? read.list : null
}

/** How long ago a session was last written, in the resume list's words: "2 h", "Yesterday", "3 d". */
export function sessionAge(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes} min`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h`
  const days = Math.floor(minutes / (24 * 60))
  return days < 2 ? "Yesterday" : `${days} d`
}

/** "14 messages"; a record longer than the read counts "14+ messages", never a guessed exact number. */
export function messageCount(session: Pick<HistorySession, "messages" | "approximate">): string {
  const n = `${session.messages}${session.approximate ? "+" : ""}`
  return session.messages === 1 && !session.approximate ? "1 message" : `${n} messages`
}

/**
 * What the App's server is asked to start to resume a session as a Chat: the Chat task the history
 * route made, run in the folder the session ran in, with the agent's own conversation resumed.
 */
export function resumeRequest(task: string, session: { agent: string; id: string }, cwd: string) {
  return {
    agent: session.agent as "claude-code" | "codex",
    purpose: { kind: "task" as const, task },
    cwd,
    works: "checkout" as const,
    mode: "plain" as const,
    settings: { answers: "app" as const },
    resumeNative: session.id,
    idempotencyKey: `resume:${task}:${session.id}`,
  }
}

/** A plan pasted into New task travels under this name; the server reads it as pasted text (task/adoption.ts). */
export const PASTED_PLAN_FILE = "pasted-plan.md"
/** The files that can be an original plan: one Markdown or text document. Pictures and PDFs stay context. */
export const PLAN_FILE = /\.(md|txt)$/i

/** What the App's server is asked to start for a new task. */
export function startRequest(choice: {
  agent: DefaultsAgent
  prompt: string
  kind: "feature" | "bugfix" | "chat"
  cwd: string
  resolved: LaunchBranchResolved
  values: PlanningDefaults
  /** The launch file holding the person's existing plan; the server adopts it as the original. */
  fromPlan?: string
  /** A feature's extra planners, kept with the task the server makes (review/planners.ts). */
  planners?: readonly { agent: NativeAgent; model: string; effort: string }[]
}) {
  const { resolved, values } = choice
  return {
    agent: choice.agent,
    ...(choice.planners?.length
      ? {
          planners: choice.planners.map((p) => ({
            agent: p.agent,
            model: p.model,
            ...(p.effort !== "" ? { effort: p.effort } : {}),
          })),
        }
      : {}),
    purpose: {
      kind: "new-task" as const,
      request: choice.prompt,
      type: choice.kind,
      ...(choice.fromPlan !== undefined ? { fromPlan: choice.fromPlan } : {}),
    },
    allocateTask: true,
    cwd: choice.cwd,
    works: resolved.works,
    ...(resolved.works !== "checkout" ? { branch: resolved.branch } : {}),
    ...(resolved.plan ? { worktreePath: resolved.plan.folder } : {}),
    settings: {
      answers: "app" as const,
      model: values.model,
      effort: values.effort,
    },
  }
}
