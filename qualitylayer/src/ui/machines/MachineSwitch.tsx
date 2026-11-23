// The machine switcher (App Model: machine-switch). With a machine added it stands where the product
// name stands, names the chosen machine, carries one mark for what waits elsewhere and opens a menu of
// this computer, every machine, Add machine and Machines. Every page draws it itself: this computer's
// page from its own list, a machine's framed page from the list this computer's page sends it, so the
// chosen machine's page, which fills the window, is never a dead end. Without a machine nothing of it
// renders and the sidebar's head is the product name as before.

import {
  CheckIcon,
  ChevronsUpDownIcon,
  LaptopIcon,
  LoaderCircleIcon,
  PlusIcon,
  ServerIcon,
  SettingsIcon,
  TriangleAlertIcon,
  WifiOffIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  addRequested,
  chosenName,
  clearAddRequest,
  isConnected,
  needsSignIn,
  requestMenu,
  resetFramedMachines,
  type SwitchView,
  switchActions,
  THIS,
  takeMenuRequest,
  useAddRequested,
  useFramedMachines,
  useHash,
  useHostTheme,
  useSwitcherShown,
  useSwitchView,
  viewOf,
  waitingElsewhere,
} from "./machine-switch-state.ts"
import type { RelayMachine } from "./relay.ts"
import "./machines.css"

export {
  addRequested,
  chosenName,
  clearAddRequest,
  needsSignIn,
  requestMenu,
  resetFramedMachines,
  type SwitchView,
  switchActions,
  THIS,
  useAddRequested,
  useFramedMachines,
  useHash,
  useHostTheme,
  useSwitcherShown,
  useSwitchView,
  viewOf,
  waitingElsewhere,
}

// ── The switcher ──

const SMALL = "size-3.5"

/** The count of what waits, or the mark that something needs the person. */
export function Count({ n, label }: { n: number; label: string }) {
  return (
    <span className="ms-n" data-mark="count" role="img" aria-label={label}>
      {n > 99 ? "99+" : n}
    </span>
  )
}

/** A machine's state in the menu when nothing waits there: the words under its name and a mark. */
function rowState(one: RelayMachine): { words: string | null; icon: ReactNode; warn: boolean } {
  switch (one.state) {
    case "connected":
      return { words: null, icon: null, warn: false }
    case "connecting":
      return {
        words: "Connecting…",
        icon: <LoaderCircleIcon className={`${SMALL} ms-spin`} aria-hidden="true" />,
        warn: false,
      }
    case "needs-you":
      return {
        words: "Key refused",
        icon: <TriangleAlertIcon className={SMALL} aria-hidden="true" />,
        warn: true,
      }
    case "unknown-host":
      return {
        words: "Host key changed",
        icon: <TriangleAlertIcon className={SMALL} aria-hidden="true" />,
        warn: true,
      }
    default:
      return {
        words: "Offline",
        icon: <WifiOffIcon className={SMALL} aria-hidden="true" />,
        warn: false,
      }
  }
}

function Row({
  one,
  chosen,
  onChoose,
}: {
  one: RelayMachine
  chosen: boolean
  onChoose: () => void
}) {
  const here = one.id === THIS
  const state = here ? { words: null, icon: null, warn: false } : rowState(one)
  return (
    <DropdownMenuItem
      role="menuitemradio"
      aria-checked={chosen}
      title={one.name}
      className={`ms-row${state.words !== null && !state.warn ? " off" : ""}`}
      data-machine-row={one.id}
      onClick={onChoose}
    >
      {here ? (
        <LaptopIcon className="ms-ico" aria-hidden="true" />
      ) : (
        <ServerIcon className="ms-ico" aria-hidden="true" />
      )}
      <span className="ms-what">
        <b>{one.name}</b>
        {state.words !== null ? (
          <small className={state.warn ? "ms-sub warn" : "ms-sub"}>{state.words}</small>
        ) : null}
      </span>
      {isConnected(one) && one.needsYou > 0 ? (
        <Count n={one.needsYou} label={`${one.needsYou} waiting`} />
      ) : state.icon !== null ? (
        <span className={`ms-state${state.warn ? " warn" : ""}`}>{state.icon}</span>
      ) : (
        <span />
      )}
      {chosen ? <CheckIcon aria-hidden="true" /> : <span className="ms-sp" />}
    </DropdownMenuItem>
  )
}

/**
 * Where it stands: `sidebar` fills the head's row and its menu lines up with the sidebar's gutter;
 * `corner` (the place of a machine that cannot be shown, Setup) and `bar` are as wide as their words.
 */
export type SwitchPlacement = "sidebar" | "corner" | "bar"

export function MachineSwitch({
  view,
  placement = "sidebar",
}: {
  view: SwitchView
  placement?: SwitchPlacement
}) {
  const [open, setOpen] = useState(takeMenuRequest)
  const act = switchActions()
  useSwitcherShown()
  const name = chosenName(view)
  const others = waitingElsewhere(view)
  const warn = others === 0 && needsSignIn(view)
  const label = [
    `Machines · ${name}`,
    others > 0 ? `${others} waiting on other machines` : warn ? "a machine needs you" : "",
  ]
    .filter((part) => part !== "")
    .join(", ")
  return (
    <div className={`ms ms-${placement}`} data-machine-switch={placement}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          type="button"
          className="ms-btn"
          title={name}
          aria-label={label}
          data-testid="machine-switch"
        >
          <span className="ms-name">{name}</span>
          <ChevronsUpDownIcon className="ms-chev size-3.5" aria-hidden="true" />
          {others > 0 ? (
            <span className="ms-end">
              <Count n={others} label={`${others} waiting on other machines`} />
            </span>
          ) : warn ? (
            <span className="ms-end">
              <span
                className="ms-warn"
                data-mark="warn"
                role="img"
                aria-label="A machine needs you"
              >
                <TriangleAlertIcon className={SMALL} aria-hidden="true" />
              </span>
            </span>
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          alignOffset={placement === "sidebar" ? -30 : 0}
          sideOffset={4}
          collisionPadding={8}
          className="ms-menu"
          aria-label="Machines"
        >
          {view.machines.map((one) => (
            <Row
              key={one.id}
              one={one}
              chosen={one.id === view.chosen}
              onChoose={() => act.choose(one.id)}
            />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="ms-row" onClick={act.add}>
            <PlusIcon className="ms-ico" aria-hidden="true" />
            <span className="ms-what">
              <b>Add machine</b>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem className="ms-row" onClick={act.openMachines}>
            <SettingsIcon className="ms-ico" aria-hidden="true" />
            <span className="ms-what">
              <b>Machines</b>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * The switcher in the corner of a page that has no sidebar (Setup), when there is a list. Such a page has
 * nothing waiting on it, and says so: that is what makes the page around it send the list.
 */
export function CornerSwitch() {
  const view = useSwitchView(0, true)
  return view === null ? null : (
    <div className="ms-corner-slot">
      <MachineSwitch view={view} placement="corner" />
    </div>
  )
}
