// The machines' pages inside this computer's page. Every connected machine's page stays loaded in
// a frame, so what happens there can notify without the machine being chosen and switching is
// instant; the chosen one covers the whole window. In a machine's own framed page the same
// component is the sending side: it tells the page around it what waits here.

import { useEffect, useRef, useState } from "react"
import { AddMachine } from "./AddMachine.tsx"
import { machineFrame } from "./framed.ts"
import { MachineDown } from "./MachineDown.tsx"
import {
  clearAddRequest,
  MachineSwitch,
  useAddRequested,
  useFramedMachines,
  useHash,
  viewOf,
} from "./MachineSwitch.tsx"
import {
  type Clock,
  FRAME_ALLOW,
  FRAME_SANDBOX,
  type FrameElements,
  frameAddress,
  frameOrigin,
  type MachinePage,
  type ReadMachines,
  realClock,
  SWITCHER_WAIT_MS,
  servedPage,
  useMachineList,
  useReportWaiting,
} from "./machine-frames-relay.ts"
import {
  clearShownPairing,
  type Machine,
  machineRouteOf,
  readMachines,
  retryMachine,
  setMachines,
  useMachines,
  useShownPairing,
} from "./machines-api.ts"
import { listenForGo, type Theme } from "./relay.ts"
import { useMachineFramesRelay } from "./useMachineFramesState.ts"

export { type Clock, type MachinePage, type ReadMachines, SWITCHER_WAIT_MS }

/** One machine's page. It stays loaded while the machine is connected and shows when it is chosen. */
function MachineFrame({
  machine,
  address,
  visible,
  needsYou,
  elements,
  onLoad,
  page,
}: {
  machine: Machine
  address: string
  visible: boolean
  needsYou: number | undefined
  elements: { current: FrameElements }
  onLoad: (id: string) => void
  page: MachinePage
}) {
  return (
    <iframe
      ref={(frame) => {
        if (frame === null) elements.current.delete(machine.id)
        else elements.current.set(machine.id, { frame, origin: frameOrigin(machine, page) })
      }}
      title={machine.name}
      src={address}
      sandbox={FRAME_SANDBOX}
      allow={FRAME_ALLOW}
      data-machine={machine.id}
      data-needs-you={needsYou}
      aria-hidden={visible ? undefined : true}
      tabIndex={visible ? undefined : -1}
      onLoad={() => onLoad(machine.id)}
      className={`absolute inset-0 size-full border-0${visible ? "" : " invisible"}`}
    />
  )
}

function useStableAddresses(
  connected: Machine[],
  shown: Machine | undefined,
  place: string | undefined,
  page: MachinePage,
) {
  const addresses = useRef(new Map<string, string>())
  const keyOf = (machine: Machine) => `${machine.id}:${machine.port}`
  const live = new Set(connected.map(keyOf))
  for (const key of addresses.current.keys()) if (!live.has(key)) addresses.current.delete(key)
  return (machine: Machine): string => {
    const key = keyOf(machine)
    const at = machine === shown ? (place ?? "") : ""
    const address = addresses.current.get(key) ?? frameAddress(machine, at, page)
    addresses.current.set(key, address)
    return address
  }
}

function DisconnectedFrames({
  listed,
  place,
  dialogs,
}: {
  listed: Machine[]
  place: React.ReactNode
  dialogs: React.ReactNode
}) {
  const waiting =
    listed.length > 0 ? (
      <span
        hidden
        data-testid="machines-waiting"
        data-states={listed
          .map((machine) => `${machine.id}:${machine.state}:${machine.reason ?? ""}`)
          .join("|")}
      />
    ) : null
  if (waiting === null && place === null && dialogs === null) return null
  return (
    <>
      {waiting}
      {place}
      {dialogs}
    </>
  )
}

function Frames({
  read,
  needsYou: here,
  clock,
  page,
  theme,
  onTheme,
}: {
  read: ReadMachines | null
  needsYou: number
  clock: Clock
  page: MachinePage
  theme: Theme | undefined
  onTheme: ((theme: Theme) => void) | undefined
}) {
  const { machines, needsYou } = useMachines()
  const chosen = machineRouteOf(useHash())
  const adding = useAddRequested()
  const resume = useShownPairing()
  useMachineList(read)

  const listed = machines ?? []
  const connected = listed.filter(
    (machine) => machine.state === "connected" && machine.port !== undefined,
  )
  const shown = connected.find((machine) => machine.id === chosen?.id)
  const down = shown === undefined ? listed.find((machine) => machine.id === chosen?.id) : undefined
  const view = viewOf({ machines, needsYou }, shown?.id ?? down?.id ?? null, here)
  const { elements, loaded, bar } = useMachineFramesRelay({
    listed,
    shown,
    view,
    theme,
    clock,
    onTheme,
  })
  const addressOf = useStableAddresses(connected, shown, chosen?.place, page)

  const tryNow = async (id: string) => {
    await retryMachine(id)
    if (read !== null) setMachines(await read())
  }
  const dialogs =
    adding || resume !== null ? (
      <AddMachine
        key={resume?.id ?? "new"}
        resume={resume ?? undefined}
        onClose={() => {
          clearAddRequest()
          clearShownPairing()
        }}
        onAdded={() => {
          if (read !== null) void read().then(setMachines, () => {})
        }}
      />
    ) : null
  const place =
    down !== undefined ? (
      <div className="fixed inset-0 z-[60] bg-background" data-testid="machine-place">
        <MachineDown key={down.id} machine={down} view={view} onTry={() => tryNow(down.id)} />
      </div>
    ) : null
  if (connected.length === 0) {
    return <DisconnectedFrames listed={listed} place={place} dialogs={dialogs} />
  }
  return (
    <>
      <div
        data-testid="machine-frames"
        data-chosen={shown?.id}
        className={
          shown
            ? "fixed inset-0 z-[60] flex flex-col bg-background"
            : "pointer-events-none invisible fixed inset-0"
        }
      >
        {bar && view !== null ? (
          <div className="mf" data-testid="machine-switch-bar">
            <MachineSwitch view={view} placement="bar" />
          </div>
        ) : null}
        <div className="relative min-h-0 flex-1">
          {connected.map((machine) => (
            <MachineFrame
              key={`${machine.id}:${machine.port}`}
              machine={machine}
              address={addressOf(machine)}
              visible={machine === shown}
              needsYou={needsYou[machine.id]}
              elements={elements}
              onLoad={loaded}
              page={page}
            />
          ))}
        </div>
      </div>
      {place}
      {dialogs}
    </>
  )
}

/**
 * Mounted once by the App. `needsYou` is what this page's Home lists under Needs you: a framed
 * machine's page reports it to the page around it; this computer's own page renders the frames.
 */
export function MachineLayer({
  needsYou,
  read = readMachines,
  clock = realClock,
  page = servedPage,
  theme,
  onTheme,
}: {
  needsYou: number
  theme?: Theme
  onTheme?: (theme: Theme) => void
  read?: ReadMachines | null
  clock?: Clock
  page?: MachinePage | undefined
}) {
  const [framed] = useState(() => machineFrame() !== null)
  useReportWaiting(needsYou, framed)
  useEffect(
    () =>
      framed
        ? listenForGo((route) => {
            window.location.hash = route
          })
        : undefined,
    [framed],
  )
  useFramedMachines()
  return framed ? null : (
    <Frames
      read={read}
      needsYou={needsYou}
      clock={clock}
      page={page}
      theme={theme}
      onTheme={onTheme}
    />
  )
}
