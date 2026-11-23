import { cn } from "cn"
import { ChevronDownIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  agentIdOf,
  asksInChat,
  backgroundAgents,
  shellStatus,
} from "../../core/interaction-shell/status.ts"
import { agentName, agoShort } from "../../core/live/liveness.ts"
import { runPermissionWaiting } from "../../core/run/contracts.ts"
import type { AgentStatus, ShellSnapshot } from "../../interaction/contracts.ts"
import { type Api, api as defaultApi, interactionApi, type TaskDetail } from "../api.ts"
import { useEventCount, useNow, useQuery } from "../hooks.ts"
import { AgentMark } from "../kit/marks/index.ts"
import { type RunWindow, useOptionalRuns } from "../run-context.tsx"
import { runTaskId, startupRunFor } from "../runs-api.ts"
import { useTurnSnapshot, useTurnTask } from "../turn/projection.ts"
import { StatusPanel } from "./StatusPanel.tsx"

type ObservedRun = Pick<
  RunWindow,
  | "id"
  | "generation"
  | "nativeSession"
  | "agent"
  | "status"
  | "attention"
  | "terminalPrompt"
  | "waitSince"
>

function isSameActiveRun(status: AgentStatus, run: ObservedRun) {
  const same =
    !!run.nativeSession &&
    status.agent === run.agent &&
    status.signals?.sessionId === run.nativeSession
  if (!same || run.status !== "running" || status.state === "step-done") return false
  return run.attention !== "waiting" && run.terminalPrompt !== "permission"
}

function observedStatus(
  status: AgentStatus,
  run: ObservedRun | undefined,
  verifying: boolean,
): AgentStatus {
  if (!run) return status
  if (verifying && run.status === "running" && !runPermissionWaiting(run)) return status
  if (isSameActiveRun(status, run)) return status
  const stopped = run.status === "stopped" || run.status === "failed"
  const waiting = run.attention === "waiting" || runPermissionWaiting(run)
  const words = {
    validated: "Starting",
    starting: "Starting",
    running: "Running in the App",
    stopping: "Stopping…",
    stopped: "Stopped",
    failed: "Could not start",
  }[run.status]
  return {
    ...status,
    agent: run.agent,
    state: stopped ? "stopped" : waiting ? "waits-for-you" : "working",
    doing:
      waiting && !stopped
        ? runPermissionWaiting(run)
          ? "Waiting for permission"
          : "Waiting for you"
        : words,
    signals: null,
    since: null,
    lastActivity: null,
    blocked: waiting && !stopped,
    resume: null,
  }
}

function chipAriaWords(status: AgentStatus, now: number) {
  if (
    status.state === "quiet" &&
    status.doing !== "No active turn" &&
    status.signals?.limit == null
  ) {
    const age = status.lastActivity === null ? null : agoShort(now - status.lastActivity)
    return `quiet ${age ?? ""}`
  }
  if (status.state === "stopped") {
    return status.signals?.stoppedAt == null
      ? "stopped"
      : `stopped at ${new Date(status.signals.stoppedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
  }
  return status.doing
}

function resolveChipStatus({
  projected,
  task,
  startupPrompt,
  observedCount,
  hasTurn,
  openNeeds,
  run,
  now,
}: {
  projected: TaskDetail
  task: TaskDetail
  startupPrompt: Parameters<typeof shellStatus>[0]["startupPrompt"]
  observedCount: number | undefined
  hasTurn: boolean
  openNeeds: number
  run: ObservedRun | undefined
  now: number
}): AgentStatus {
  const openItems =
    observedCount === undefined || hasTurn
      ? projected.openItems
      : Math.max(0, observedCount - openNeeds)
  const reported = observedStatus(
    shellStatus(
      {
        ...projected,
        ...(startupPrompt !== undefined ? { startupPrompt } : {}),
        openItems,
      },
      now,
    ),
    run,
    task.stage === "verify",
  )
  // The build's lead ended its turn in its own chat with nothing running: the person's move, as
  // the sidebar row and Home say ("Open <agent>"), so the chip wears the amber mark, not the spinner.
  if ((reported.state === "working" || reported.state === "quiet") && asksInChat(projected, now)) {
    return {
      ...reported,
      state: "waits-for-you",
      blocked: true,
      doing: `open ${agentName(agentIdOf(projected))}`,
    }
  }
  return reported
}

export function AgentChip({
  task,
  api = defaultApi,
  onCopy,
  testId = "interaction-agent-chip",
  observedRun,
}: {
  task: TaskDetail
  api?: Api
  onCopy: (text: string, note: string) => void
  /** Cost is the header's own button; the panel carries no link to it (callers may still pass one). */
  testId?: string
  onGo?: () => void
  observedRun?: ObservedRun
}) {
  const [open, setOpen] = useState(false)
  const turn = useTurnSnapshot(task.id)
  const projected = useTurnTask(task)
  const now = useNow(task.stage !== "shipped", open ? 1000 : 5000)
  // The agent waits on its own start-up question (trust this folder, …): the same signal as the
  // card on the task page and in the Agent tab.
  const runs = useOptionalRuns()
  const startupPrompt = runs ? startupRunFor(runs.runs, task.id)?.startupPrompt : undefined
  const waitingRun = runs?.runs.find(
    (run) => runTaskId(run) === task.id && runPermissionWaiting(run),
  )
  // The server's count of what waits adds up what the page already holds: the task's open items, the
  // agent's open needs and its question, and the question batch on disk, which a file
  // event moves. A sign of life changes none of them, so it does not read the count again, and
  // while files keep changing it is read at the calm pace.
  const files = useEventCount("slow")
  const openNeeds = task.live?.needs.filter((n) => n.state === "open").length ?? 0
  const observed = useQuery(
    () =>
      api === defaultApi
        ? interactionApi
            .taskRoute<{ shell: ShellSnapshot }>(task.id, "shell", "status")
            .then((reply) => ({ ...reply, taskId: task.id }))
        : Promise.resolve(null),
    [api, task.id, task.openItems, openNeeds, task.live?.question?.number ?? 0, files],
  )
  const observedCount =
    observed.data?.taskId === task.id ? observed.data.shell.status?.openItems : undefined
  const status = resolveChipStatus({
    projected,
    task,
    startupPrompt,
    observedCount,
    hasTurn: turn !== null,
    openNeeds,
    run: waitingRun ?? observedRun,
    now,
  })
  const words = chipAriaWords(status, now)
  // biome-ignore lint/correctness/useExhaustiveDependencies: moving to another task closes its old status panel
  useEffect(() => {
    setOpen(false)
  }, [task.id])
  // A phone's bar names the agent by its first word ("Claude", "Codex"), so the title keeps room.
  const [first = "", ...rest] = agentName(status.agent).split(" ")
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn("ir-agent-chip", status.state)}
            data-testid={testId}
            data-state={status.state}
            aria-label={`Agent status · ${agentName(status.agent)} · ${words}`}
          />
        }
      >
        <i aria-hidden="true" />
        <AgentMark agent={status.agent} size={14} />
        <b>
          {first}
          {rest.length > 0 ? <span className="ir-agent-rest"> {rest.join(" ")}</span> : null}
        </b>
        <ChevronDownIcon className="ir-agent-chevron" size={12} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        className="ir-status-popover"
        align="end"
        collisionPadding={12}
        aria-label="Agent status"
        data-testid="interaction-status-panel"
      >
        <StatusPanel
          task={task}
          shell={{
            status,
            signals: status.signals,
            agents: backgroundAgents(task, now),
            steps: [],
            nextForYou: null,
          }}
          now={now}
          onClose={() => setOpen(false)}
          onCopy={onCopy}
          observedRun={observedRun}
        />
      </PopoverContent>
    </Popover>
  )
}
