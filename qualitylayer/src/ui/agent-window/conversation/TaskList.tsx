import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CircleIcon, ListChecksIcon } from "lucide-react"
import { useId, useState } from "react"
import type { ConversationChecklist } from "../../../core/conversation/types.ts"
import { WhoMark } from "../../kit/WhoMark.tsx"
import "./task-list.css"

type ChecklistItem = ConversationChecklist["items"][number]

function statusIcon(status: ChecklistItem["status"]) {
  if (status === "completed") return <CheckIcon size={13} />
  if (status === "in_progress") return <WhoMark who="agent" />
  return <CircleIcon size={10} />
}

const STATUS_LABEL: Record<ChecklistItem["status"], string> = {
  completed: "Done",
  in_progress: "Running",
  pending: "Pending",
}

function TaskItem({ item }: { item: ChecklistItem }) {
  return (
    <li data-status={item.status}>
      <span aria-hidden="true">{statusIcon(item.status)}</span>
      <span>{item.text}</span>
      <small>{STATUS_LABEL[item.status]}</small>
    </li>
  )
}

export function TaskList({ checklist }: { checklist: ConversationChecklist | null | undefined }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  if (!checklist?.items.length) return null
  const done = checklist.items.filter((item) => item.status === "completed").length
  const current =
    checklist.items.find((item) => item.status === "in_progress") ??
    checklist.items.find((item) => item.status === "pending")
  const hasCoverageGap = checklist.coverage !== "snapshot" && checklist.coverage !== "observed"
  return (
    <section className="cv-tasks" aria-label="The agent’s task list">
      <button
        type="button"
        className="cv-tasks-bar"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <ListChecksIcon size={14} aria-hidden="true" />
        <b>Tasks</b>
        <span className="cv-tasks-now">{current?.text ?? "All done"}</span>
        <span>
          {done} of {checklist.items.length}
        </span>
        {open ? (
          <ChevronDownIcon size={13} aria-hidden="true" />
        ) : (
          <ChevronUpIcon size={13} aria-hidden="true" />
        )}
      </button>
      {open ? (
        <div id={id}>
          <ol className="cv-tasks-list">
            {checklist.items.map((item) => (
              <TaskItem key={item.id} item={item} />
            ))}
          </ol>
          {/* Only a gap is worth a line: how the list was read (snapshot or updates) is not. */}
          {hasCoverageGap ? <p className="cv-note">Some task updates are unavailable</p> : null}
        </div>
      ) : null}
    </section>
  )
}
