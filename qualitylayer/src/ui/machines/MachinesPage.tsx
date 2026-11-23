// Settings › Machines: this computer, then one row per machine with how ssh reaches it, its state and
// what waits there, Try now / Try again, rename in place and a menu (App Model: settings-machines).
// The list is this computer's server's; what waits on a machine is what its framed page last said.
// A page without a server of its own (the demo) asks nobody and offers no Add machine.

import {
  CircleCheckIcon,
  KeyRoundIcon,
  LaptopIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { routeHash } from "../hooks.ts"
import { SettingRow, SettingsGroup } from "../settings/Rows.tsx"
import { AddMachine } from "./AddMachine.tsx"
import { MachineRow, PairingRow } from "./MachineRow.tsx"
import { COMPUTERS_PER_KEY, type Machine } from "./machines-api.ts"
import { RemoveMachine } from "./RemoveMachine.tsx"
import {
  type MachinesReader,
  targetVersionFor,
  useMachinesTabState,
} from "./useMachinesTabState.ts"
import "./machines.css"

const ICON = "size-[15px]"
const SMALL = "size-3.5"

function MachinesEmptyFoot({
  hasReader,
  machines,
  failed,
  listedCount,
  pairingsCount,
  onReload,
}: {
  hasReader: boolean
  machines: Machine[] | null
  failed: boolean
  listedCount: number
  pairingsCount: number
  onReload: () => void
}) {
  if (hasReader && machines === null) {
    if (failed) {
      return (
        <p role="status" className="q-sg-foot">
          The machines could not be read.{" "}
          <button type="button" className="q-link" onClick={onReload}>
            Try again
          </button>
        </p>
      )
    }
    return (
      <p role="status" className="q-sg-foot">
        Reading your machines…
      </p>
    )
  }
  if (listedCount === 0 && pairingsCount === 0) {
    return <p className="q-sg-foot">No other machines yet.</p>
  }
  return null
}

function MachinesHeaderAction({
  hasReader,
  noSsh,
  onAdd,
}: {
  hasReader: boolean
  noSsh: boolean
  onAdd: () => void
}) {
  if (!hasReader) return undefined
  if (noSsh) {
    return (
      <span className="mc-state warn">
        <TriangleAlertIcon className={SMALL} aria-hidden="true" />
        ssh was not found on this computer
      </span>
    )
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={onAdd}>
      <PlusIcon aria-hidden="true" />
      Add machine
    </Button>
  )
}

export function MachinesTab({
  api,
  version,
}: {
  /** This page's server; without `machines` the page has no server of its own. */
  api?: { machines?: MachinesReader }
  /** This computer's release, for its row; empty when it is not known. */
  version: string
}) {
  const read = api?.machines
  const state = useMachinesTabState(read, version)
  const addEnd = MachinesHeaderAction({
    hasReader: read !== undefined,
    noSsh: state.noSsh,
    onAdd: () => state.setAdding("new"),
  })
  const activePairings = state.pairings.filter(
    (one) => !state.listed.some((machine) => machine.id === one.machine?.id),
  )
  const inUse = Math.min(
    1 + state.listed.filter((one) => one.activated === true).length,
    COMPUTERS_PER_KEY,
  )

  return (
    <div className="q-sgs">
      <SettingsGroup title="Machines" testId="machines-list" end={addEnd}>
        <SettingRow
          icon={<LaptopIcon className={ICON} />}
          label="This computer"
          hint={version === "" ? undefined : `QualityLayer ${version}`}
        >
          <span className="mc-state">
            <CircleCheckIcon className={SMALL} aria-hidden="true" />
            Connected
          </span>
        </SettingRow>
        {state.listed.map((machine) => (
          <MachineRow
            key={machine.id}
            machine={machine}
            waiting={state.needsYou[machine.id] ?? 0}
            renaming={state.renaming}
            field={state.field}
            updateTo={targetVersionFor(machine, version)}
            onTry={() => state.retry(machine.id)}
            onPair={() => void state.pairAgainOf(machine)}
            onRename={() =>
              state.setRenaming({ id: machine.id, value: machine.name, problem: null })
            }
            onUpdate={() => state.update(machine)}
            onRemove={() => state.setRemoving(machine)}
            onValue={(value) =>
              state.setRenaming((was) => (was === null ? was : { ...was, value, problem: null }))
            }
            onSave={() => void state.saveRename()}
            onCancel={() => state.setRenaming(null)}
          />
        ))}
        {activePairings.map((one) => (
          <PairingRow key={one.id} pairing={one} onShow={() => state.setAdding(one)} />
        ))}
        <MachinesEmptyFoot
          hasReader={read !== undefined}
          machines={state.machines}
          failed={state.failed}
          listedCount={state.listed.length}
          pairingsCount={state.pairings.length}
          onReload={() => void state.load()}
        />
      </SettingsGroup>
      {read !== undefined && state.machines !== null ? (
        <SettingsGroup title="Licence">
          <SettingRow
            icon={<KeyRoundIcon className={ICON} />}
            label="Computers on your licence"
            hint={`Each machine uses one of ${COMPUTERS_PER_KEY}.`}
          >
            <span className="mc-acts">
              <span className="mc-state">
                {inUse} of {COMPUTERS_PER_KEY} in use
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  window.location.hash = routeHash({ view: "settings", tab: "licence" })
                }}
              >
                Open Licence
              </Button>
            </span>
          </SettingRow>
        </SettingsGroup>
      ) : null}
      {state.adding !== null ? (
        <AddMachine
          key={state.adding === "new" ? "new" : state.adding.id}
          resume={state.adding === "new" ? undefined : state.adding}
          onClose={() => {
            state.setAdding(null)
            void state.load()
          }}
          onAdded={() => void state.load()}
        />
      ) : null}
      {state.removing !== null ? (
        <RemoveMachine
          machine={state.removing}
          onClose={() => state.setRemoving(null)}
          onRemoved={() => void state.load()}
        />
      ) : null}
    </div>
  )
}
