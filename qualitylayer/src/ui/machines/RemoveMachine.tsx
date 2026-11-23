// Remove a machine (App Model: machine-remove): the connection goes; the machine's tasks, agents and
// files stay where they are, and it can be added again. Releasing its licence activation is a choice,
// off until ticked, and ticking it says that tasks there then stop at their next step. A machine that
// cannot be reached now cannot have its activation released from here. QualityLayer's own key comes
// off the machine and its ssh config entry here goes, unless the person unticks it.

import { TriangleAlertIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  type CloseDetails,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  keepWhile,
} from "@/components/ui/dialog"
import { COMPUTERS_PER_KEY, type Machine, readRunning, removeMachine } from "./machines-api.ts"
import "./machines.css"

const ICON = "size-[15px]"

function useRunningTasks(machineId: string, reachable: boolean) {
  const [running, setRunning] = useState<number | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const stopReading = new AbortController()
    if (reachable) {
      void readRunning(machineId, stopReading.signal).then(
        (count) => alive.current && setRunning(count),
      )
    }
    return () => {
      alive.current = false
      stopReading.abort()
    }
  }, [machineId, reachable])
  return { running, alive }
}

function RemoveAlerts({
  name,
  releasing,
  running,
  problem,
}: {
  name: string
  releasing: boolean
  running: number | null
  problem: string | null
}) {
  const releaseWarning =
    running !== null && running > 0
      ? `${running === 1 ? "1 task" : `${running} tasks`} running there stop at their next step`
      : "Tasks there stop at their next step"
  return (
    <>
      {releasing ? (
        <p className="ma-bad" role="alert">
          <TriangleAlertIcon className={ICON} aria-hidden="true" />
          <span>{releaseWarning}</span>
        </p>
      ) : null}
      {problem !== null ? (
        <p className="ma-bad" role="alert">
          <TriangleAlertIcon className={ICON} aria-hidden="true" />
          <span>
            {problem} {name} was not removed.
          </span>
        </p>
      ) : null}
    </>
  )
}

async function performRemoveMachine({
  machineId,
  name,
  releasing,
  dropKey,
  working,
  alive,
  setBusy,
  setProblem,
  onRemoved,
  onClose,
}: {
  machineId: string
  name: string
  releasing: boolean
  dropKey: boolean
  working: React.RefObject<boolean>
  alive: React.RefObject<boolean>
  setBusy: (busy: boolean) => void
  setProblem: (problem: string | null) => void
  onRemoved: (name: string) => void
  onClose: () => void
}) {
  working.current = true
  setBusy(true)
  setProblem(null)
  try {
    await removeMachine(machineId, releasing, !dropKey)
  } catch (cause) {
    working.current = false
    if (alive.current) {
      setBusy(false)
      setProblem(cause instanceof Error ? cause.message : "The machine could not be removed.")
    }
    return
  }
  working.current = false
  toast.success(`${name} removed${releasing ? "; its activation is released" : ""}`)
  onRemoved(name)
  onClose()
}

export function RemoveMachine({
  machine,
  onClose,
  onRemoved,
}: {
  machine: Machine
  onClose: () => void
  /** The machine is gone from the list: it is read again. */
  onRemoved: (name: string) => void
}) {
  const { name } = machine
  const reachable = machine.state === "connected"
  const [release, setRelease] = useState(false)
  const [dropKey, setDropKey] = useState(true)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const { running, alive } = useRunningTasks(machine.id, reachable)
  const working = useRef(false)
  const cancel = useRef<HTMLButtonElement | null>(null)
  const releasing = reachable && release

  const remove = () =>
    performRemoveMachine({
      machineId: machine.id,
      name,
      releasing,
      dropKey,
      working,
      alive,
      setBusy,
      setProblem,
      onRemoved,
      onClose,
    })

  const close = (open: boolean, details: CloseDetails) =>
    keepWhile(working.current, open, details, (next) => {
      if (!next) onClose()
    })

  const confirmLabel = busy ? "Removing…" : releasing ? "Remove and release" : "Remove"

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent
        role="alertdialog"
        className="sm:max-w-[480px]"
        aria-label={`Remove ${name}?`}
        aria-describedby={undefined}
        showCloseButton={false}
        initialFocus={cancel}
      >
        <DialogHeader>
          <DialogTitle>Remove {name}?</DialogTitle>
        </DialogHeader>
        <div className="ma-body">
          <p className="ma-lead">Its tasks keep running there. Add it again any time.</p>
          <label className="ma-check">
            <input
              type="checkbox"
              checked={releasing}
              disabled={!reachable || busy}
              onChange={(event) => setRelease(event.target.checked)}
            />
            <span className="ma-what">
              Also release its licence
              <small className="ma-hint">
                {reachable
                  ? `Frees one of ${COMPUTERS_PER_KEY} computers`
                  : `${name} is offline · release it later under Licence`}
              </small>
            </span>
          </label>
          <label className="ma-check">
            <input
              type="checkbox"
              checked={dropKey}
              disabled={busy}
              onChange={(event) => setDropKey(event.target.checked)}
            />
            <span className="ma-what">
              Remove QualityLayer’s key from it
              <small className="ma-hint">And its ssh config entry here</small>
            </span>
          </label>
          <RemoveAlerts name={name} releasing={releasing} running={running} problem={problem} />
          <div className="flex justify-end gap-2">
            <Button ref={cancel} type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
