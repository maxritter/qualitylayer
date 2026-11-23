// Add machine (App Model: machine-add, machine-add-key, machine-add-password, machine-add-progress,
// machine-add-done, machine-add-container, machine-add-confirm).

import {
  CircleCheckIcon,
  ContainerIcon,
  LaptopIcon,
  ServerIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Segmented } from "../Segmented.tsx"
import { ComputerTargetPick, ContainerList, PairingProgressView } from "./AddMachinePick.tsx"
import { PairingSheet } from "./AddMachineSheet.tsx"
import { answerPairing, type Pairing } from "./machines-api.ts"
import {
  useAddMachineDiscovery,
  usePairingActions,
  usePairingPolling,
} from "./useAddMachineState.ts"
import "./machines.css"

const ICON = "size-[15px]"

function addMachineTitleIcon(pairing: Pairing | null, tab: "computer" | "container") {
  if (pairing?.state === "done") return <CircleCheckIcon className={ICON} aria-hidden="true" />
  if (pairing?.kind === "container" || (pairing === null && tab === "container")) {
    return <ContainerIcon className={ICON} aria-hidden="true" />
  }
  return <ServerIcon className={ICON} aria-hidden="true" />
}

function addMachineTitle(pairing: Pairing | null) {
  if (pairing === null) return "Add machine"
  return pairing.state === "done" ? `${pairing.name} is paired` : pairing.name
}

export function AddMachine({
  onClose,
  onAdded,
  resume,
}: {
  onClose: () => void
  /** A machine was stored: the list is read again. */
  onAdded: (name: string) => void
  /** A pairing already under way (Settings' Show, Pair again): the dialog opens on its progress. */
  resume?: Pairing
}) {
  const [tab, setTab] = useState<"computer" | "container">(
    resume?.kind === "container" ? "container" : "computer",
  )
  const [typed, setTyped] = useState("")
  const [pairing, setPairing] = useState<Pairing | null>(resume ?? null)
  const [problem, setProblem] = useState<string | null>(null)
  const alive = useRef(true)

  const { hosts, near, containers, look } = useAddMachineDiscovery(tab, alive)
  usePairingPolling(pairing, alive, setPairing, onAdded)
  const actions = usePairingActions({ pairing, resume, alive, setPairing, setProblem, onClose })
  const sheet = pairing?.state === "waiting" && pairing.waiting !== undefined

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !sheet) actions.hide()
      }}
    >
      <DialogContent
        className="ma-dialog top-[16vh] translate-y-0 sm:max-w-[480px]"
        aria-label="Add machine"
        aria-describedby={undefined}
        showCloseButton={!sheet}
      >
        <DialogHeader className={sheet ? "ma-under" : undefined}>
          <DialogTitle className="flex min-w-0 items-center gap-2" data-testid="add-machine-title">
            {addMachineTitleIcon(pairing, tab)}
            <span className="truncate">{addMachineTitle(pairing)}</span>
          </DialogTitle>
        </DialogHeader>
        <div className={sheet ? "ma-body under" : "ma-body"} inert={sheet || undefined}>
          {pairing === null ? (
            <>
              <Segmented
                label="What to add"
                size="md"
                value={tab}
                onChange={(next) => {
                  setTab(next)
                  setProblem(null)
                }}
                options={[
                  { id: "computer", label: "Computer", icon: <LaptopIcon aria-hidden="true" /> },
                  {
                    id: "container",
                    label: "Dev container",
                    icon: <ContainerIcon aria-hidden="true" />,
                  },
                ]}
              />
              {tab === "computer" ? (
                <ComputerTargetPick
                  typed={typed}
                  starting={actions.starting}
                  near={near}
                  hosts={hosts}
                  onTyped={setTyped}
                  onStart={(target) => void actions.start({ target })}
                />
              ) : (
                <ContainerList
                  listed={containers}
                  onLook={look}
                  onAdd={(name) => void actions.start({ container: name })}
                />
              )}
              {problem !== null ? (
                <p className="ma-bad" role="alert">
                  <TriangleAlertIcon className={ICON} aria-hidden="true" />
                  <span>{problem}</span>
                </p>
              ) : null}
            </>
          ) : (
            <PairingProgressView
              pairing={pairing}
              trying={actions.trying}
              onAgain={() => void actions.again()}
              onClose={onClose}
              onOpen={actions.open}
              onBack={actions.back}
              onHide={actions.hide}
            />
          )}
        </div>
        {sheet && pairing !== null ? (
          <PairingSheet
            pairing={pairing}
            onAnswer={async (text) => {
              const next = await answerPairing(pairing.id, text)
              if (alive.current) setPairing(next)
            }}
            onCancel={actions.back}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
