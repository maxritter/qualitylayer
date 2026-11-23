// The place of a machine that cannot be shown (App Model: machine-offline): why, in one line, and the
// one move that fixes it. Offline (no answer, or its ssh port closed) is tried again by itself and says
// when; a refused key is paired again (the password sheet); a changed host key shows the new fingerprint
// and Trust new key. The switcher stands top left, so this computer is one choice away meanwhile.

import {
  KeyRoundIcon,
  LoaderCircleIcon,
  RotateCwIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  WifiOffIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { MachineSwitch, type SwitchView } from "./MachineSwitch.tsx"
import {
  type Machine,
  readHostKey,
  showPairing,
  startPairing,
  trustHostKey,
} from "./machines-api.ts"
import "./machines.css"

const ICON = "size-5"

/** "10:02": the clock time a machine went offline. */
export const clockOf = (at: number): string => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

/** An offline machine whose ssh port refuses: Remote Login (the ssh server) is off there. */
export const refusesSsh = (machine: Machine): boolean =>
  machine.state === "offline" &&
  // A port that refuses, or one that closes before ssh's greeting (Docker's published port with no
  // ssh server behind it).
  /connection refused|port \d+ is closed|connection closed by|kex_exchange_identification/i.test(
    machine.reason ?? "",
  )

/** "0:24": how long until the next try by itself. */
function countdown(until: number, now: number): string {
  const seconds = Math.max(0, Math.round((until - now) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

type Words = { icon: ReactNode; title: string; why: string | null }

function wordsOf(machine: Machine): Words {
  const name = machine.name
  switch (machine.state) {
    case "needs-you":
      return {
        icon: <KeyRoundIcon className={ICON} aria-hidden="true" />,
        title: `${name} refused its key`,
        why: "Its authorized_keys lost QualityLayer's key",
      }
    case "unknown-host":
      return {
        icon: <ShieldCheckIcon className={ICON} aria-hidden="true" />,
        title: `${name}’s host key changed`,
        why: "Reinstalled? Trust the new key. Otherwise, stop here.",
      }
    case "connecting":
      return {
        icon: <LoaderCircleIcon className={`${ICON} ms-spin`} aria-hidden="true" />,
        title: `Connecting to ${name}…`,
        why: null,
      }
    default:
      return refusesSsh(machine)
        ? {
            icon: <WifiOffIcon className={ICON} aria-hidden="true" />,
            title: `${name} refuses ssh`,
            why: machine.container ? "Its ssh server is not running" : "Remote Login is off there",
          }
        : {
            icon: <WifiOffIcon className={ICON} aria-hidden="true" />,
            title: `${name} is offline`,
            why: `No answer since ${clockOf(machine.since)} · asleep or off the network`,
          }
  }
}

function useMachineDownEffects(machine: Machine, onError: (message: string) => void) {
  const [fingerprint, setFingerprint] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const retryAt = machine.state === "offline" ? machine.retryAt : undefined
  useEffect(() => {
    if (retryAt === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [retryAt])
  useEffect(() => {
    if (machine.state !== "unknown-host") return
    setFingerprint(null)
    void readHostKey(machine.id).then(
      (read) => alive.current && setFingerprint(read.fingerprint),
      (cause) => alive.current && onError(cause instanceof Error ? cause.message : String(cause)),
    )
  }, [machine.id, machine.state, onError])
  return { fingerprint, now, retryAt, alive }
}

function MachineDownPrimaryButton({
  state,
  busy,
  fingerprint,
  onPair,
  onTrust,
  onTry,
}: {
  state: Machine["state"]
  busy: boolean
  fingerprint: string | null
  onPair: () => void
  onTrust: () => void
  onTry: () => void
}) {
  if (state === "needs-you") {
    return (
      <Button type="button" disabled={busy} onClick={onPair}>
        <KeyRoundIcon aria-hidden="true" />
        Pair again
      </Button>
    )
  }
  if (state === "unknown-host") {
    return (
      <Button type="button" disabled={busy || fingerprint === null} onClick={onTrust}>
        <ShieldCheckIcon aria-hidden="true" />
        Trust new key
      </Button>
    )
  }
  return (
    <Button type="button" disabled={busy} onClick={onTry}>
      <RotateCwIcon aria-hidden="true" />
      {busy ? "Trying…" : "Try now"}
    </Button>
  )
}

function useMachineDownAction(alive: React.RefObject<boolean>) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const act = async (what: () => Promise<void>) => {
    setBusy(true)
    setProblem(null)
    try {
      await what()
    } catch (cause) {
      if (alive.current) setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return { busy, problem, setProblem, act }
}

export function MachineDown({
  machine,
  view,
  onTry,
}: {
  machine: Machine
  /** The switcher's list; the place always carries the switcher, so there is a way back. */
  view: SwitchView | null
  /** Ask this computer's server to connect the machine now. */
  onTry: () => Promise<void>
}) {
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const { busy, problem, setProblem, act } = useMachineDownAction(alive)
  const { fingerprint, now, retryAt } = useMachineDownEffects(machine, setProblem)
  const words = wordsOf(machine)
  const pair = () => act(async () => showPairing(await startPairing({ machine: machine.id })))
  const trust = () =>
    act(async () => {
      if (fingerprint === null) return
      await trustHostKey(machine.id, fingerprint)
      toast.success(`Trusted the new host key of ${machine.name}`)
    })

  return (
    <section
      className="md"
      data-testid="machine-down"
      data-machine={machine.id}
      data-state={machine.state}
      aria-live="polite"
    >
      {view !== null ? (
        <div className="ms-corner-slot">
          <MachineSwitch view={view} placement="corner" />
        </div>
      ) : null}
      <div className="md-in">
        <span className="md-ic">
          {busy ? (
            <LoaderCircleIcon className={`${ICON} ms-spin`} aria-hidden="true" />
          ) : (
            words.icon
          )}
        </span>
        <h2 title={machine.name}>{words.title}</h2>
        {words.why !== null ? <p>{words.why}</p> : null}
        {retryAt !== undefined ? (
          <p className="md-next">
            <RotateCwIcon className="size-3" aria-hidden="true" />
            Next try in {countdown(retryAt, now)} · agents there keep working
          </p>
        ) : null}
        {machine.state === "unknown-host" && fingerprint !== null ? (
          <code className="mc-code md-fp">{fingerprint}</code>
        ) : null}
        {machine.state === "connecting" ? null : (
          <div className="md-acts">
            <MachineDownPrimaryButton
              state={machine.state}
              busy={busy}
              fingerprint={fingerprint}
              onPair={() => void pair()}
              onTrust={() => void trust()}
              onTry={() => void act(onTry)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                window.location.hash = "#/settings/machines"
              }}
            >
              Machines
            </Button>
          </div>
        )}
        {problem !== null ? (
          <p role="alert" className="md-problem">
            <TriangleAlertIcon className="size-3.5" aria-hidden="true" />
            {problem}
          </p>
        ) : null}
      </div>
    </section>
  )
}
