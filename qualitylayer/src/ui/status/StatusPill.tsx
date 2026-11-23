// The one live status of a task: a pill in the header, just before Cost, from Plan to Verify.
// Needs you takes the person where it is; every other state opens the panel behind it: which
// session works, its last sign of life and the three signals, what it is on now, the agents it
// started, and what to do. Done is plain words.

import { cn } from "cn"
import {
  ArrowRightIcon,
  ChevronDownIcon,
  HourglassIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
  UnplugIcon,
} from "lucide-react"
import { type ReactNode, useContext, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { agentName } from "../../core/live/liveness.ts"
import type { TaskDetail } from "../api.ts"
import { useNow } from "../hooks.ts"
import { WhoMark } from "../kit/WhoMark.tsx"
import { type Status, statusOf } from "../live-status.ts"
import { AgentChip } from "../shell/AgentChip.tsx"
import { ShellApiContext } from "../shell/context.ts"
import { StatusPanel } from "./StatusPanel.tsx"

export { StatusPanel }

const STATUS_ICONS: Partial<Record<Status["icon"], () => ReactNode>> = {
  spin: () => <span className="q-st-spin" aria-hidden="true" />,
  go: () => null,
  term: () => <SquareTerminalIcon className="ic" aria-hidden="true" />,
  hour: () => <HourglassIcon className="ic" aria-hidden="true" />,
  unplug: () => <UnplugIcon className="ic" aria-hidden="true" />,
  alert: () => <TriangleAlertIcon className="ic" aria-hidden="true" />,
  done: () => <WhoMark who="done" />,
}

function Icon({ icon }: { icon: Status["icon"] }) {
  const render = STATUS_ICONS[icon]
  return render ? render() : <i className="q-m q-m-quiet" aria-hidden="true" />
}

/** The words of the pill: the agent or the lead first, then what it says. */
function Words({ status, compact }: { status: Status; compact: boolean }) {
  if (compact) {
    if (status.lead !== null)
      return (
        <span className="tx">
          <span className="lead">{status.lead}</span>
          {status.short !== "" ? ` · ${status.short}` : ""}
        </span>
      )
    return <span className="tx">{status.short}</span>
  }
  if (status.agent !== null)
    return (
      <span className="tx">
        <b>{status.agent}</b> · {status.text}
      </span>
    )
  if (status.lead !== null)
    return (
      <span className="tx">
        <span className="lead">{status.lead}</span> · {status.text}
      </span>
    )
  return <span className="tx">{status.text}</span>
}

type Props = {
  task: TaskDetail
  /** The narrow header: the short words, without the agent's name. */
  compact?: boolean
  /** Needs you: take the person where it is. */
  onGo: () => void
  onCopy: (text: string, note: string) => void
  onOpen: (view: string) => void
}

export function StatusPill(props: Props) {
  const api = useContext(ShellApiContext)
  return api !== null ? (
    <AgentChip
      task={props.task}
      api={api}
      onCopy={props.onCopy}
      testId="status-pill"
      onGo={() => {
        window.dispatchEvent(new Event("qualitylayer:show-turn"))
        const now = document.querySelector<HTMLElement>('[data-testid="interaction-now"]')
        if (now?.childElementCount) {
          now.scrollIntoView({ block: "nearest" })
          now.querySelector<HTMLElement>("button,input,summary")?.focus()
        } else props.onGo()
      }}
    />
  ) : (
    <LegacyStatusPill {...props} />
  )
}
function LegacyStatusPill({ task, compact = false, onGo, onCopy, onOpen }: Props) {
  const [open, setOpen] = useState(false)
  // Its own clock: every few seconds for the minutes it counts, every second while the panel shows
  // its signals' ages. A closed task has nothing to count.
  const closed = task.stage === "shipped" || task.stage === "abandoned"
  const now = useNow(!closed, open ? 1_000 : 5_000)
  const status = statusOf(task, now)
  const meta = compact ? status.shortMeta : status.meta
  const body = (
    <>
      <Icon icon={status.icon} />
      <Words status={status} compact={compact} />
      {meta !== null && meta !== "" ? <span className="mt">{meta}</span> : null}
    </>
  )
  const shared = {
    className: cn("q-st", status.kind),
    "data-testid": "status-pill",
    "data-state": status.state,
    title: [status.lead, status.text, status.meta].filter(Boolean).join(" · "),
  }
  if (status.kind === "done")
    return (
      <span {...shared} role="status">
        {body}
      </span>
    )
  if (status.kind === "you")
    return (
      <button type="button" {...shared} onClick={onGo}>
        {body}
        {compact && meta !== null ? null : <ArrowRightIcon className="ic" aria-hidden="true" />}
      </button>
    )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<button type="button" {...shared} aria-haspopup="dialog" aria-expanded={open} />}
      >
        {body}
        {compact ? null : <ChevronDownIcon className="cv" aria-hidden="true" />}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        // The popover's own width, padding, gap and ring give way to the panel's (status.css).
        className="q-stp w-[420px] max-w-[calc(100vw-32px)] gap-0 rounded-xl p-0 ring-0"
        aria-label={`What ${agentName(task.session?.agent ?? null)} is doing`}
        data-testid="status-panel"
      >
        <StatusPanel
          task={task}
          status={status}
          now={now}
          onCopy={onCopy}
          onOpen={(view) => {
            setOpen(false)
            onOpen(view)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
