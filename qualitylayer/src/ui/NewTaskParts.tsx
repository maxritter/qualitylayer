// The parts of New task that stand on their own: the request field, which grows with what is typed,
// and the App's choices in the order of the card: the project with its branch, then the agent.

import { BotIcon, HistoryIcon, NetworkIcon, WalletIcon } from "lucide-react"
import { type MouseEvent, useEffect, useRef, useState } from "react"
import { DialogTitle } from "@/components/ui/dialog"
import type { HistorySession } from "../core/agents/history-sessions.ts"
import { isNativeAgent } from "../core/agents/ids.ts"
import type { DefaultsAgent } from "../core/config-values.ts"
import type { Project, SubagentModels } from "./api.ts"
import { routeHash } from "./hooks.ts"
import { AgentMark } from "./kit/marks/index.ts"
import { messageCount, sessionAge } from "./new-task-state.ts"
import { type ProjectFolderApi, ProjectPicker, type ProjectTarget } from "./ProjectPicker.tsx"
import { AgentLaunchFields, type AgentLaunchValue } from "./run/AgentLaunchFields.tsx"
import { ExtraPlanners, type PlannerPick } from "./run/ExtraPlanners.tsx"
import {
  LaunchBranch,
  type LaunchBranchResolved,
  type LaunchBranchState,
} from "./run/LaunchBranch.tsx"

/** The field grows to about eight lines, then scrolls. */
const FIELD_MAX = 186

export function RequestField({
  id,
  label,
  value,
  placeholder,
  disabled,
  onChange,
  onFiles,
  onSubmit,
}: {
  id: string
  label: string
  value: string
  placeholder: string
  disabled: boolean
  onChange: (text: string) => void
  /** Files pasted or dropped on the field. */
  onFiles: (files: FileList) => void
  /** ⌘ or Ctrl + Enter. */
  onSubmit: () => void
}) {
  const field = useRef<HTMLTextAreaElement | null>(null)
  // The height follows the text, to about eight lines, then the field scrolls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height follows the text
  useEffect(() => {
    const el = field.current
    if (el === null) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight + 2, FIELD_MAX)}px`
  }, [value])
  useEffect(() => {
    field.current?.focus()
  }, [])
  return (
    <div className="q-nt-f">
      <label className="lb" htmlFor={id}>
        {label}
      </label>
      <textarea
        ref={field}
        id={id}
        className="q-nt-in"
        rows={2}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onPaste={(event) => {
          if (event.clipboardData.files.length) {
            event.preventDefault()
            onFiles(event.clipboardData.files)
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault()
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length) {
            event.preventDefault()
            onFiles(event.dataTransfer.files)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onSubmit()
          }
        }}
        data-testid="new-task-field"
      />
    </div>
  )
}

type StartFieldsProps = {
  permissions?: string
  projects: Project[]
  target: ProjectTarget | null
  onTarget: (target: ProjectTarget) => void
  folderApi: ProjectFolderApi | undefined
  canConfigure: boolean
  onChoosing: (busy: boolean) => void
  /** A Chat has no planning phase: its model is the plain "Model", not the Planner. */
  chat?: boolean
  branch: {
    state: LaunchBranchState
    resolved: LaunchBranchResolved
    current: string | null
    onChange: (patch: Partial<LaunchBranchState>) => void
  }
  agent: {
    value: AgentLaunchValue
    installed: SubagentModels[] | null | undefined
    supported: boolean
    defaultModel: string | undefined
    onChange: (patch: Partial<AgentLaunchValue> & { agent?: DefaultsAgent }) => void
  }
  /** A feature planned with QualityLayer may add extra planners; none for a bug fix, an existing plan or a Chat. */
  planners?: { value: readonly PlannerPick[]; onChange: (next: PlannerPick[]) => void }
  disabled: boolean
  /** A link to Settings was followed: the card closes, and Settings opens where the link points. */
  onLeave: () => void
}

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  if (event.button !== 0) return false
  if (event.metaKey || event.ctrlKey) return false
  return !event.shiftKey && !event.altKey
}

/**
 * A plain click on a link out of the card closes it. A click that opens the link elsewhere (a new
 * tab or window) leaves the card as it is.
 */
const leaving = (onLeave: () => void) => (event: MouseEvent<HTMLAnchorElement>) => {
  if (isPlainPrimaryClick(event)) onLeave()
}

/**
 * What the App needs to start: one project line with Choose folder…, the branch it works on, then
 * the agent row (agent · model · effort, all in view) under its role, and a feature's extra planners.
 */
export function StartFields({
  permissions,
  projects,
  target,
  onTarget,
  folderApi,
  canConfigure,
  onChoosing,
  chat = false,
  branch,
  agent,
  planners,
  disabled,
  onLeave,
}: StartFieldsProps) {
  const leave = leaving(onLeave)
  const modelAgent = agent.value.agent
  return (
    <div className="q-nt-app">
      <ProjectPicker
        projects={projects}
        value={target}
        onChange={onTarget}
        api={folderApi}
        canChoose={canConfigure}
        disabled={disabled}
        onBusy={onChoosing}
      />
      <LaunchBranch
        scope="New task"
        icons
        showPath={false}
        state={branch.state}
        resolved={branch.resolved}
        current={branch.current}
        checkout={target?.path ?? null}
        disabled={disabled || !canConfigure}
        onChange={branch.onChange}
      />
      <AgentLaunchFields
        scope="New task"
        modelRole={chat ? undefined : "Planner"}
        defaultModel={agent.defaultModel}
        installed={agent.installed}
        supported={agent.supported}
        disabled={disabled}
        canConfigure={!agent.supported || canConfigure}
        location={false}
        nativeOnly
        heading={
          chat
            ? { label: "Agent", icon: <BotIcon size={13} aria-hidden="true" /> }
            : { label: "Planner", icon: <NetworkIcon size={13} aria-hidden="true" /> }
        }
        value={agent.value}
        onChange={agent.onChange}
        afterModels={
          planners && !chat ? (
            <ExtraPlanners
              main={agent.value.agent}
              installed={agent.installed}
              value={planners.value}
              onChange={planners.onChange}
              disabled={disabled || !canConfigure}
            />
          ) : null
        }
      />
      {permissions ? (
        <p className="q-nt-hint">
          Permissions · {permissions} ·{" "}
          <a
            className="q-link"
            href={routeHash({ view: "settings", tab: "agents" })}
            onClick={leave}
          >
            Agent settings
          </a>{" "}
          ·{" "}
          <a
            className="q-link"
            href={routeHash({
              view: "settings",
              tab: "models",
              ...(isNativeAgent(modelAgent) ? { modelAgent } : {}),
            })}
            onClick={leave}
          >
            Model settings
          </a>
        </p>
      ) : null}
    </div>
  )
}

/** The dialog's title; its close button is the dialog's own, in the corner. */
export function NewTaskHeader({ title = "New task" }: { title?: string }) {
  return (
    <div className="q-nt-h">
      <DialogTitle className="m-0 text-[18px] leading-tight font-semibold">{title}</DialogTitle>
    </div>
  )
}

/** Sessions shown before "All n sessions". */
const RESUME_SHOWN = 4

/**
 * New chat's foot: the sessions an agent already has in this project, started outside QualityLayer.
 * Choosing one resumes it as a Chat. Nothing is drawn until the read has answered.
 */
export function ResumeList({
  label,
  path,
  list,
  busy,
  disabled,
  onResume,
}: {
  /** The project's name. */
  label: string
  path: string
  list: { total: number; sessions: HistorySession[] } | null
  /** The id of the session being resumed; every row waits while one does. */
  busy: string | null
  /** The App cannot start a session now, or the card is starting one. */
  disabled: boolean
  onResume: (session: HistorySession) => void
}) {
  const [all, setAll] = useState(false)
  // Nothing is drawn until the read has answered, and an empty answer that is not the whole history
  // (the read stopped early) is no claim that there are none.
  if (list === null || (list.sessions.length === 0 && list.total > 0)) return null
  const shown = all ? list.sessions : list.sessions.slice(0, RESUME_SHOWN)
  const listed = list.sessions.length
  // What is listed is only what was read: when the history holds more, the link says it is the newest.
  const newestOnly = list.total > listed
  const range = newestOnly ? `Newest ${listed} of ${list.total}` : `All ${listed} sessions`
  return (
    <section className="q-nt-resume" aria-labelledby="q-nt-resume-h">
      <h3 id="q-nt-resume-h">
        <HistoryIcon className="q-nt-resume-icon" aria-hidden="true" />
        Or resume a session in {label}
      </h3>
      {shown.length > 0 ? (
        <ul>
          {shown.map((session) => (
            <li key={`${session.agent}:${session.id}`}>
              <button
                type="button"
                title={session.title}
                disabled={disabled || busy !== null}
                aria-busy={busy === session.id}
                data-testid="resume-session"
                onClick={() => onResume(session)}
              >
                <AgentMark agent={session.agent} size={14} />
                <span className="t">{session.title}</span>
                <span className="m">
                  {messageCount(session)} · {sessionAge(session.at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="q-nt-resume-none">No earlier agent sessions in {path}.</p>
      )}
      {!all && listed > RESUME_SHOWN ? (
        <button type="button" className="q-nt-resume-all" onClick={() => setAll(true)}>
          {range}
        </button>
      ) : newestOnly ? (
        <p className="q-nt-resume-none">{range}</p>
      ) : null}
    </section>
  )
}

type Action = { blocked: boolean; busy: boolean; run: () => void }

/** The one reason something is stopped, and Start planning in the App (outside it, the prompt box copies). */
export function NewTaskFooter({
  reason,
  inApp,
  start,
  credits = null,
  startLabel = "Start planning",
}: {
  reason: string | null
  inApp: boolean
  start: Action
  /** "Weekly limit used · running on credits (balance N)" when the chosen agent's limit is used up. */
  credits?: string | null
  startLabel?: string
}) {
  return (
    <div className="q-nt-go">
      {reason ? (
        <p className="q-nt-note" role="status" data-testid="new-task-note">
          {reason}
        </p>
      ) : null}
      {credits !== null ? (
        <p className="q-nt-note q-nt-credit" role="status" data-testid="new-task-credits">
          <WalletIcon className="size-3" aria-hidden="true" />
          {credits}
        </p>
      ) : null}
      {/* Outside the App the prompt box's own Copy is the one button. */}
      {inApp ? (
        <button
          type="button"
          className="q-btn primary"
          disabled={start.blocked}
          onClick={start.run}
        >
          {start.busy ? "Starting…" : startLabel}
        </button>
      ) : null}
    </div>
  )
}
