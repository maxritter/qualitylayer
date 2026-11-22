import {
  BugIcon,
  FileTextIcon,
  GitBranchIcon,
  LightbulbIcon,
  MapIcon,
  MessageSquareIcon,
  ShapesIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Api, TaskDetail } from "../api.ts"
import { Segmented } from "../Segmented.tsx"

export function StartWorkflow({
  task,
  api,
  onClose,
  onPromoted,
  detail,
  onStart,
}: {
  task: string
  api: Api
  onClose(): void
  onPromoted(): void
  detail?: TaskDetail
  /** Start in this Chat's agent window; `fromSavedPlan` starts at the Plan from chat-plan.md. */
  onStart?: (type: "feature" | "bugfix", fromSavedPlan: boolean) => Promise<unknown>
}) {
  const [type, setType] = useState<"feature" | "bugfix">("feature")
  // As New task: planned with QualityLayer by default, or from the plan this Chat saved, kept as given.
  const [startMode, setStartMode] = useState<"plan" | "saved">("plan")
  const savedPlan = detail?.docs.some((doc) => doc.name === "chat-plan.md" && doc.exists) === true
  const fromSavedPlan = savedPlan && startMode === "saved"
  const hasSavedPlan = savedPlan
  const request = detail?.request ?? detail?.title ?? "The Chat request"
  const [availability, setAvailability] = useState<{ allowed: boolean; running: string[] }>()
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)
  const flight = useRef(false)
  const helperRevision = (detail?.helpers ?? [])
    .map((helper) => `${helper.id}:${helper.state}`)
    .join(";")
  // biome-ignore lint/correctness/useExhaustiveDependencies: helper updates trigger a fresh server authority check, without granting permission from browser state.
  useEffect(() => {
    let live = true
    void api.chatPromotion(task).then(
      (state) => {
        if (live) setAvailability(state)
      },
      (error) => {
        if (live)
          setProblem(
            error instanceof Error
              ? error.message
              : "Could not check helpers. Close and try again.",
          )
      },
    )
    return () => {
      live = false
    }
  }, [api, task, helperRevision])
  const start = async () => {
    if (flight.current || !availability?.allowed) return
    flight.current = true
    setBusy(true)
    setProblem(undefined)
    try {
      if (onStart) await onStart(type, fromSavedPlan)
      else await api.promoteChat(task, type, fromSavedPlan)
      onPromoted()
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Could not start the Plan. Your choice is kept.",
      )
    } finally {
      flight.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="grid-cols-1 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Convert to task</DialogTitle>
          <DialogDescription>
            The same agent session continues at the Plan. This conversation stays as history.
          </DialogDescription>
        </DialogHeader>
        <Segmented
          size="md"
          label="Convert to task: kind"
          value={type}
          options={[
            {
              id: "feature",
              label: "Feature",
              icon: <LightbulbIcon aria-hidden="true" />,
              disabled: busy,
            },
            { id: "bugfix", label: "Bugfix", icon: <BugIcon aria-hidden="true" />, disabled: busy },
          ]}
          onChange={setType}
        />
        <Segmented
          size="md"
          label="Convert to task: how it starts"
          value={startMode}
          options={[
            {
              id: "plan",
              label: "Plan with QualityLayer",
              note: "Default",
              icon: <MapIcon aria-hidden="true" />,
              disabled: busy,
            },
            {
              id: "saved",
              label: "Saved plan",
              icon: <FileTextIcon aria-hidden="true" />,
              disabled: busy || !savedPlan,
            },
          ]}
          onChange={setStartMode}
        />
        <p>
          {fromSavedPlan
            ? "The saved plan is kept word for word as original-plan.md. This session maps it onto what QualityLayer checks and asks only what it leaves open."
            : type === "feature"
              ? "Agree what done means, then plan the change."
              : "Confirm what goes wrong and what should happen, then plan the fix."}{" "}
          The Plan needs your approval before any more code.
        </p>
        <section className="q-chat-carry" aria-label="What the Plan starts from">
          <h3>The Plan starts from</h3>
          <p className="q-chat-request">
            <MessageSquareIcon size={14} aria-hidden="true" />
            <span title={request}>{request}</span>
          </p>
          <ul className="q-chat-chips" aria-label="Travels with the request">
            {detail === undefined || hasSavedPlan ? (
              <li title="The saved plan" data-chip="plan">
                <FileTextIcon size={13} aria-hidden="true" />
                {hasSavedPlan ? "chat-plan.md" : "Saved plan"}
              </li>
            ) : null}
            <li title="Artifacts already saved with this task" data-chip="artifacts">
              <ShapesIcon size={13} aria-hidden="true" />
              Artifacts
            </li>
            <li
              title={
                detail?.changedFiles
                  ? `${detail.changedFiles.length} files on the current branch`
                  : "Existing changes stay on the current branch"
              }
              data-chip="changes"
            >
              <GitBranchIcon size={13} aria-hidden="true" />
              Changes
            </li>
          </ul>
        </section>
        {availability && !availability.allowed ? (
          <p role="status">A slice is still building: let it finish or stop it first</p>
        ) : null}
        {!availability && !problem ? <p role="status">Checking running slices…</p> : null}
        {problem ? <p role="alert">{problem}</p> : null}
        <div className="q-chat-dialog-actions">
          <button type="button" className="q-btn sm" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="q-btn primary sm"
            disabled={busy || !availability?.allowed}
            onClick={() => void start()}
          >
            {busy ? "Starting…" : fromSavedPlan ? "Start at the Plan" : "Start the Plan"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
