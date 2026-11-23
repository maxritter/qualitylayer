// Settings › Sessions: the agents running on this computer with their memory and Stop idle, then the
// rules for them: when idle agents stop, who can type in a session, what quitting the App does
// (App Model: settings-sessions). The list is read when the page opens, and again after a stop.

import {
  AppWindowIcon,
  CirclePlayIcon,
  CircleStopIcon,
  GlobeIcon,
  KeyboardIcon,
  LogOutIcon,
  TimerIcon,
} from "lucide-react"
import { useState } from "react"
import { Popover, PopoverContent, PopoverHeader, PopoverTrigger } from "@/components/ui/popover"
import type { SessionRow, SessionsView } from "../../core/run/sessions-view.ts"
import type { Api, Config } from "../api.ts"
import { AgentMark } from "../kit/marks/index.ts"
import { type Who, WhoMark } from "../kit/WhoMark.tsx"
import { DEFAULT_NOTE } from "../ModelPick.tsx"
import { ProjectOrigin, useProjectLooks } from "../sidebar/look-context.tsx"
import { projectFacts } from "../sidebar/project-model.ts"
import { ListPages, PAGE_SIZE } from "./ListPages.tsx"
import { Pick as Picker, SettingRow, SettingsGroup } from "./Rows.tsx"
import { clause, lastTurnText, memoryText } from "./usage-model.ts"
import { type Reading, type StopResult, useSessions } from "./use-readings.ts"
import "./usage.css"

const MARK_FOR: Record<SessionRow["state"], Who> = {
  working: "agent",
  "needs-you": "you",
  idle: "quiet",
}

/** What a row says of a session that was stopped during this visit. */
const STOPPED = "Stopped"

/**
 * The row's step word and its place: "Implement 6/11" while a build works, otherwise the step the
 * task stands at ("Verify") when it is known, else the state's own words.
 */
const SLICE_WORDS = /^Working · slice (\d+) of (\d+)$/
const stateWords = (row: SessionRow): string => {
  const slice = SLICE_WORDS.exec(row.words)
  if (slice !== null) return `${row.step ?? "Implement"} ${slice[1]}/${slice[2]}`
  return row.step !== null && row.keptOpen === null ? row.step : row.words
}

function SessionLine({
  row,
  now,
  stopped,
  onOpen,
}: {
  row: SessionRow
  now: number
  stopped: boolean
  onOpen: ((row: SessionRow) => void) | undefined
}) {
  const looks = useProjectLooks()
  const project = row.project === null ? null : projectFacts(row.project, looks)
  const state = stopped ? "stopped" : row.state
  const open = () => onOpen?.(row)
  return (
    <li className="q-se-row" data-testid="session-row" data-state={state} data-idle={row.idle}>
      <AgentMark agent={row.agent} size={15} />
      <span className="q-se-what">
        <b title={row.task}>
          {onOpen !== undefined ? (
            <button type="button" className="q-se-open" onClick={open}>
              {row.task}
            </button>
          ) : (
            row.task
          )}
        </b>
        <span className="q-se-where">
          {project !== null ? <ProjectOrigin project={project} /> : null}
          <span>
            {project !== null ? "· " : ""}last turn {lastTurnText(row.lastTurnAt, now)}
          </span>
        </span>
      </span>
      <span
        className="q-se-state"
        data-state={state}
        title={stopped ? undefined : (row.keptOpen ?? row.words)}
      >
        <WhoMark who={stopped ? "quiet" : MARK_FOR[row.state]} running={state === "working"} />
        <span>{stopped ? STOPPED : stateWords(row)}</span>
      </span>
      {stopped ? (
        <button type="button" className="q-link q-se-mb" onClick={open} disabled={!onOpen}>
          Open
        </button>
      ) : (
        <span className="q-se-mb">{memoryText(row.memoryBytes)}</span>
      )}
    </li>
  )
}

/** What the last Stop idle did, in a line: how many stopped, and why any stayed. */
function stopWords(result: StopResult): string {
  const { failure } = result
  if (failure?.forbidden) return "Only the App and browsers it opened may stop agents."
  if (failure) {
    const them = result.asked === 1 ? "it" : "them"
    return `Could not stop ${them}${failure.message === "" ? "" : `: ${clause(failure.message)}`}. Try again.`
  }
  if (result.stopped === 0 && result.refused.length === 0) return "No agent was idle any more."
  const stopped =
    result.stopped === 0
      ? ""
      : `Stopped ${result.stopped} idle ${result.stopped === 1 ? "agent. Its conversation is kept." : "agents. Their conversations are kept."}`
  const refused =
    result.refused.length > 0
      ? ` ${result.refused.length} could not be stopped: ${clause(result.refused[0] ?? "")}.`
      : ""
  return `${stopped}${refused}`.trim()
}

/** "4 running · 1.4 GB": what is up, and the memory its processes hold when it could be read. */
function summary(view: SessionsView): string {
  const known = view.sessions.some((row) => row.memoryBytes !== null)
  const count = `${view.sessions.length} running`
  return known ? `${count} · ${memoryText(view.totalBytes)}` : count
}

/** The list of running agents, or the line that says why there is none yet. */
function SessionsBody({
  reading,
  stoppedRows,
  reload,
  now,
  onOpen,
}: {
  reading: Reading<SessionsView>
  /** Sessions stopped during this visit: they stay in the list, dimmed, to be opened. */
  stoppedRows: readonly SessionRow[]
  reload: () => void
  now: number
  onOpen: ((row: SessionRow) => void) | undefined
}) {
  const [page, setPage] = useState(0)
  if (reading.status === "loading")
    return (
      <p className="q-us-note" role="status">
        Reading the running agents…
      </p>
    )
  if (reading.status === "failed")
    return (
      <p className="q-us-note" role="status">
        The running agents could not be read.{" "}
        <button type="button" className="q-link" onClick={reload}>
          Try again
        </button>
      </p>
    )
  const stopped = new Set(stoppedRows.map((row) => row.run))
  const rows = [...reading.data.sessions.filter((row) => !stopped.has(row.run)), ...stoppedRows]
  if (rows.length === 0)
    return (
      <p className="q-us-note" role="status">
        No agent is running.
      </p>
    )
  // A short page of 10; the pager appears only once the list outgrows it (DESIGN.md › Settings and Team).
  const at = Math.min(page, Math.ceil(rows.length / PAGE_SIZE) - 1)
  return (
    <>
      <ul className="q-se-list" aria-label="Running agents">
        {rows.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE).map((row) => (
          <SessionLine
            key={`${row.run}/${row.generation}`}
            row={row}
            now={now}
            stopped={stopped.has(row.run)}
            onOpen={onOpen}
          />
        ))}
      </ul>
      {rows.length > PAGE_SIZE ? (
        <ListPages
          page={at}
          total={rows.length}
          matched={rows.length}
          change={setPage}
          noun="session"
        />
      ) : null}
    </>
  )
}

/**
 * The group's status: how many run, and the one action, a counted button: "Stop 3 idle" with the stop mark.
 * One idle agent stops at once; several ask first, since each conversation is kept but each process ends.
 */
function RunningStatus({
  view,
  stoppable,
  stopping,
  onStop,
}: {
  view: SessionsView
  stoppable: boolean
  stopping: boolean
  onStop: () => void
}) {
  const [asking, setAsking] = useState(false)
  const count = view.idleCount
  const label = stopping ? "Stopping…" : stoppable ? `Stop ${count} idle` : "Stop idle"
  const button = (
    <button
      type="button"
      className="q-btn sm"
      disabled={!stoppable || stopping}
      title={stoppable ? undefined : "No idle agent can be stopped now"}
      onClick={count > 1 ? undefined : onStop}
    >
      <CircleStopIcon className="size-[13px]" aria-hidden="true" />
      {label}
    </button>
  )
  return (
    <span className="q-se-stop">
      <span data-testid="sessions-summary">{summary(view)}</span>
      {count > 1 && stoppable && !stopping ? (
        <Popover open={asking} onOpenChange={setAsking}>
          <PopoverTrigger render={button} />
          <PopoverContent
            align="end"
            collisionPadding={8}
            className="w-72"
            aria-label={`Stop ${count} idle agents?`}
          >
            <PopoverHeader>
              <h4 className="m-0 text-[13.5px] font-semibold">Stop {count} idle agents?</h4>
              <p className="m-0 text-[12.5px] text-muted-foreground">
                Their conversations are kept. Continue resumes them.
              </p>
            </PopoverHeader>
            <div className="flex justify-end gap-2">
              <button type="button" className="q-btn sm" onClick={() => setAsking(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="q-btn sm primary"
                onClick={() => {
                  setAsking(false)
                  onStop()
                }}
              >
                Stop {count}
              </button>
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        button
      )}
    </span>
  )
}

function RunningNow({
  api,
  onOpen,
}: {
  api?: Pick<Api, "agentSessions" | "stopIdle">
  onOpen: ((row: SessionRow) => void) | undefined
}) {
  const { reading, reload, stopping, result, stop, stoppedRows } = useSessions(
    api?.agentSessions,
    api?.stopIdle,
  )
  const view = reading.status === "ready" ? reading.data : null
  const stoppable = view !== null && view.idleCount > 0 && api?.stopIdle !== undefined
  return (
    <SettingsGroup
      title="Running now"
      testId="running-now"
      end={
        view !== null ? (
          <RunningStatus
            view={view}
            stoppable={stoppable}
            stopping={stopping}
            onStop={() => void stop()}
          />
        ) : undefined
      }
    >
      <SessionsBody
        reading={reading}
        stoppedRows={stoppedRows}
        reload={reload}
        now={Date.now()}
        onOpen={onOpen}
      />
      {result !== null ? (
        <p className="q-us-note" role="status" data-testid="stop-result">
          {stopWords(result)}
        </p>
      ) : null}
    </SettingsGroup>
  )
}

const SESSION_RULE_OPTIONS = {
  idleStop: [
    { id: "never", name: "Never" },
    { id: "2h", name: "After 2 hours" },
    { id: "8h", name: "After 8 hours", note: DEFAULT_NOTE },
    { id: "24h", name: "After a day" },
  ],
  typeFrom: [
    {
      id: "keyPaired",
      name: "The App and its browsers",
      note: DEFAULT_NOTE,
      icon: <AppWindowIcon className="size-3.5" />,
    },
    {
      id: "anyPaired",
      name: "Also other paired browsers",
      icon: <GlobeIcon className="size-3.5" />,
    },
  ],
  onQuit: [
    {
      id: "keep",
      name: "Agents keep running",
      note: DEFAULT_NOTE,
      icon: <CirclePlayIcon className="size-3.5" />,
    },
    { id: "stop", name: "Stop agents", icon: <CircleStopIcon className="size-3.5" /> },
  ],
}

export function SessionsTab({
  config,
  onChange,
  api,
  onOpen,
}: {
  config: Config
  onChange: (patch: unknown) => void
  api?: Pick<Api, "agentSessions" | "stopIdle">
  /** Opens a session's task, or its agent window when it has no task. */
  onOpen?: (row: SessionRow) => void
}) {
  const rules = [
    {
      label: "Stop agents that sit idle",
      hint: "A stopped agent keeps its conversation; Continue resumes it. Never while a question, approval, turn or helper is open.",
      icon: <TimerIcon className="size-[15px]" />,
      value: config.sessions.idleStop,
      options: SESSION_RULE_OPTIONS.idleStop,
      onPick: (idleStop: string) => onChange({ sessions: { idleStop } }),
    },
    {
      label: "Who can type in a session",
      hint: "Every paired browser can stop a run. Typing and starting stay with the App unless you allow more.",
      icon: <KeyboardIcon className="size-[15px]" />,
      value: config.typeFrom,
      options: SESSION_RULE_OPTIONS.typeFrom,
      onPick: (typeFrom: string) => onChange({ typeFrom }),
    },
    {
      label: "When you quit the App",
      hint: "What happens to agents that are running.",
      icon: <LogOutIcon className="size-[15px]" />,
      value: config.onQuit,
      options: SESSION_RULE_OPTIONS.onQuit,
      onPick: (onQuit: string) => onChange({ onQuit }),
    },
  ]
  return (
    <div className="q-sgs">
      <RunningNow api={api} onOpen={onOpen} />
      <SettingsGroup title="Session rules" testId="session-rules">
        {rules.map((rule) => (
          <SettingRow key={rule.label} label={rule.label} hint={rule.hint} icon={rule.icon}>
            <Picker
              label={rule.label}
              value={rule.value}
              options={rule.options}
              onChange={rule.onPick}
            />
          </SettingRow>
        ))}
      </SettingsGroup>
    </div>
  )
}
