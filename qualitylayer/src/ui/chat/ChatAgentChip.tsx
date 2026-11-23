import { cn } from "cn"
import {
  ArrowUpRightIcon,
  CircleStopIcon,
  CopyIcon,
  InfoIcon,
  PauseIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  SquareTerminalIcon,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { shellStatus } from "../../core/interaction-shell/status.ts"
import { agentName } from "../../core/live/liveness.ts"
import type { TaskAgentControls } from "../agent-window/task-controls.ts"
import type { TaskDetail } from "../api.ts"
import { useNow } from "../hooks.ts"
import { AgentMark } from "../kit/marks/index.ts"
import type { AgentTabTerminal } from "../run/AgentTab.tsx"
import { useTurnTask } from "../turn/projection.ts"
import { chatChipState } from "./chat-agent-state.ts"

function InterruptItem({ controls }: { controls: TaskAgentControls | undefined }) {
  if (controls?.interruptRequested === true) {
    return (
      <DropdownMenuItem disabled>
        <PauseIcon size={14} aria-hidden="true" />
        Interrupt requested…
      </DropdownMenuItem>
    )
  }
  if (!controls?.canInterrupt) return null
  return (
    <DropdownMenuItem disabled={controls.busy} onClick={() => void controls.interrupt()}>
      <PauseIcon size={14} aria-hidden="true" />
      Interrupt
      <kbd className="ml-auto text-(--ql-text-dim) [font:12px/1_var(--font-mono)]">Esc</kbd>
    </DropdownMenuItem>
  )
}

function SessionActionsGroup({
  controls,
  name,
}: {
  controls: TaskAgentControls | undefined
  name: string
}) {
  const hasInterrupt = controls?.interruptRequested === true || Boolean(controls?.canInterrupt)
  const hasStop = Boolean(controls?.canStop)
  const resume = controls?.session?.resume
  if (!hasInterrupt && !hasStop && !resume) return null
  return (
    <>
      <DropdownMenuSeparator />
      <InterruptItem controls={controls} />
      {controls?.canStop ? (
        <DropdownMenuItem
          disabled={controls.busy || controls.status === "stopping"}
          onClick={() => void controls.stop()}
        >
          <CircleStopIcon size={14} aria-hidden="true" />
          Stop session
          <span className="ml-auto pl-3 text-(--ql-text-dim) text-xs">
            Ends {name}; the Chat stays
          </span>
        </DropdownMenuItem>
      ) : null}
      {resume ? (
        <DropdownMenuItem onClick={resume}>
          <RotateCcwIcon size={14} aria-hidden="true" />
          Resume session
        </DropdownMenuItem>
      ) : null}
    </>
  )
}

function SessionRowsGroup({
  controls,
  onCopy,
}: {
  controls: TaskAgentControls | undefined
  onCopy(text: string, note: string): void
}) {
  const rows = controls?.session
  if (!rows) return null
  const hasElsewhere = Boolean(rows.move || rows.resumeLine)
  return (
    <>
      <DropdownMenuSeparator />
      {rows.configure ? (
        <DropdownMenuItem onClick={rows.configure}>
          <SlidersHorizontalIcon size={14} aria-hidden="true" />
          Model & effort…
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onClick={rows.appearance}>
        <SlidersHorizontalIcon size={14} aria-hidden="true" />
        Appearance…
      </DropdownMenuItem>
      <DropdownMenuItem onClick={rows.information}>
        <InfoIcon size={14} aria-hidden="true" />
        Session information
      </DropdownMenuItem>
      {hasElsewhere ? (
        <>
          <DropdownMenuSeparator />
          {rows.move ? (
            <DropdownMenuItem disabled={controls?.busy} onClick={rows.move}>
              <ArrowUpRightIcon size={14} aria-hidden="true" />
              Move to my own agent…
            </DropdownMenuItem>
          ) : null}
          {rows.resumeLine ? (
            <DropdownMenuItem
              onClick={() => onCopy(rows.resumeLine ?? "", "Copied the resume command")}
            >
              <CopyIcon size={14} aria-hidden="true" />
              Copy resume command
            </DropdownMenuItem>
          ) : null}
        </>
      ) : null}
    </>
  )
}

/**
 * The Chat's agent, quiet like the workflow header's, and the session's one menu: what it is doing,
 * Interrupt and Stop session, then how it runs and where else it can run. The window that holds
 * the live session reports what the menu may do (`controls`); the rows open that window's own panels.
 */
export function ChatAgentChip({
  task,
  controls,
  onCopy,
  plainTerminal,
  plainTerminalShown,
}: {
  task: TaskDetail
  controls: TaskAgentControls | undefined
  onCopy(text: string, note: string): void
  plainTerminal?: AgentTabTerminal
  plainTerminalShown?: boolean
}) {
  const projected = useTurnTask(task)
  const now = useNow(task.stage !== "shipped", 5000)
  const status = shellStatus(projected, now)
  const agent = controls?.agent ?? status.agent
  const name = agentName(agent)
  const { state, words } = chatChipState(status, controls, now)
  const named = words ? `${name} · ${words}` : name
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn("ir-agent-chip", state)}
            data-testid="interaction-agent-chip"
            data-state={state}
            aria-label={`Agent status · ${named}`}
            title={named}
          />
        }
      >
        <i aria-hidden="true" />
        <AgentMark agent={agent} size={14} />
        <b>{name}</b>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64 whitespace-nowrap">
        <DropdownMenuGroup className="q-chat-session-facts" aria-label="Session">
          <AgentMark agent={agent} size={16} />
          <span>
            <b>{named}</b>
            {controls?.session?.facts ? <small>{controls.session.facts}</small> : null}
          </span>
        </DropdownMenuGroup>
        <SessionActionsGroup controls={controls} name={name} />
        <SessionRowsGroup controls={controls} onCopy={onCopy} />
        {plainTerminal && !plainTerminalShown ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={plainTerminal.open}>
              <SquareTerminalIcon size={14} aria-hidden="true" />
              {plainTerminal.live ? "Return to plain terminal" : "Open a plain terminal"}
            </DropdownMenuItem>
          </>
        ) : null}
        {controls === undefined && !plainTerminalShown ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <SquareTerminalIcon size={14} aria-hidden="true" />
              No App session connected
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
