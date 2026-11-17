// The machines' pages inside this computer's page. Every connected machine's page stays loaded in
// a frame, so what happens there can notify without the machine being chosen and switching is
// instant; the chosen one covers the whole window. In a machine's own framed page the same
// component is the sending side: it tells the page around it what waits here.
//
// This computer's page also hands every frame the machine list (each frame draws the switcher from it),
// carries out what a frame's switcher asks (switch, add, open Machines), draws the switcher itself in a
// slim bar above a chosen frame that does not confirm its own, and fills the window with the place of
// a chosen machine that cannot be shown.

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { pageOf } from "../Handover.tsx"
import { useEventCount } from "../hooks.ts"
import { inDesktopApp } from "../kit/command-keys.ts"
import { machineNoticeOf, noticeOptions, type ToldNotice, tellShell } from "../live-notify.ts"
import { AddMachine } from "./AddMachine.tsx"
import { machineFrame } from "./framed.ts"
import { MachineDown } from "./MachineDown.tsx"
import {
  clearAddRequest,
  MachineSwitch,
  switchActions,
  THIS,
  useAddRequested,
  useFramedMachines,
  useHash,
  viewOf,
} from "./MachineSwitch.tsx"
import {
  clearShownPairing,
  type Machine,
  machineHash,
  machineRouteOf,
  readMachines,
  retryMachine,
  setMachines,
  setNeedsYou,
  useMachines,
  useShownPairing,
} from "./machines-api.ts"
import {
  answerTo,
  type FromFrame,
  fromFrame,
  fromParent,
  listenForGo,
  type RelayNotice,
  type Theme,
  toFrame,
  toParent,
} from "./relay.ts"

/** The count in the page's title, `(3) Needs you · QualityLayer`: what the Dock badge shows. */
const badgeOf = (title: string): number => Number(/^\((\d{1,5})\) /.exec(title)?.[1] ?? 0)

/** A framed machine's page says what waits on it, whenever that changes. */
function useReportWaiting(needsYou: number, framed: boolean): void {
  const [badge, setBadge] = useState(() => badgeOf(document.title))
  useEffect(() => {
    if (!framed) return
    const title = document.querySelector("title")
    if (title === null) return
    const read = () => setBadge(badgeOf(document.title))
    const observer = new MutationObserver(read)
    observer.observe(title, { childList: true, characterData: true, subtree: true })
    read()
    return () => observer.disconnect()
  }, [framed])
  useEffect(() => {
    if (framed) toParent({ ql: 1, type: "waiting", needsYou, badge })
  }, [framed, needsYou, badge])
  // The word above is posted once, when the page mounts and when the counts change. The page around
  // asks with the list (`answerTo` in the relay): a frame that hears it says what waits again, so a
  // word that did not arrive is made good. It answers the list only, never what it says itself: no
  // timer, and no round of lists.
  const now = useRef({ needsYou, badge })
  now.current = { needsYou, badge }
  useEffect(() => {
    const frame = framed ? machineFrame() : null
    if (frame === null) return
    const heard = (event: MessageEvent) => {
      const answer = answerTo(fromParent(event, frame.parent), now.current)
      if (answer !== null) toParent(answer)
    }
    window.addEventListener("message", heard)
    return () => window.removeEventListener("message", heard)
  }, [framed])
}

/**
 * Where a machine's page is served: this computer's port for it. The demo, which has no server,
 * hands its own page in another world (`MachinePage`).
 */
export type MachinePage = (machine: Machine) => string
const servedPage: MachinePage = (machine) => `http://127.0.0.1:${machine.port}/`
/** A machine's page as this computer serves it. The frame's address never changes once it is loaded. */
const frameOrigin = (machine: Machine, page: MachinePage): string => new URL(page(machine)).origin
/** `host` is this page's mode, so the framed page's native chords work where this page's do. */
const frameAddress = (machine: Machine, place: string, page: MachinePage): string => {
  const base = page(machine)
  return `${base}${base.includes("?") ? "&" : "?"}in=machine&parent=${encodeURIComponent(window.location.origin)}&host=${inDesktopApp() ? "app" : "browser"}#/${place}`
}

/**
 * What a machine's page may do inside its frame, and no more. It runs its own scripts at its own origin
 * (`allow-scripts allow-same-origin`: its session, its storage and its requests to its own server),
 * submits its forms (the question composer, the dialogs), downloads what it offers (an attachment) and
 * opens web links in a new window the shell hands to the system browser (`allow-popups`; a window that
 * inherited the sandbox would break the site it opens: `allow-popups-to-escape-sandbox`). It has no
 * `allow-top-navigation` and no `allow-top-navigation-by-user-activation`: whatever answers on a machine's
 * loopback port must not be able to send this computer's own window anywhere. It has no `allow-modals`:
 * the App draws every dialog itself. Notifications go through the relay, never through the page's own
 * permission.
 */
const FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"

/** Its Copy buttons write to this computer's clipboard; nothing reads it. */
const FRAME_ALLOW = "clipboard-write"

/** The moments told already, newest last: a machine's notice is told once. */
const TOLD_MOST = 512
function firstTime(told: Set<string>, key: string): boolean {
  if (told.has(key)) return false
  told.add(key)
  if (told.size > TOLD_MOST) told.delete(told.values().next().value as string)
  return true
}

/**
 * What this computer's page does with notices a machine's page sent: it tells them with the machine's name
 * in front and a route on that machine. The machine in front, while this window has the person's eyes,
 * is only recorded (as a local moment on screen is); another machine's moment shows as a toast; with the
 * window behind, the shell (or the browser) notifies.
 */
function tellMachineNotices(
  machine: { id: string; name: string },
  notices: readonly RelayNotice[],
  chosen: boolean,
  told: Set<string>,
): void {
  const inApp = pageOf().inApp
  const foreground = document.visibilityState === "visible" && document.hasFocus()
  const now = Date.now()
  const forShell: ToldNotice[] = []
  for (const sent of notices) {
    const notice = machineNoticeOf(machine, sent, now)
    if (sent.key !== undefined && !firstTime(told, notice.key)) continue
    // Whether the person looks at that machine is decided here, not by its page: a frame that is
    // out of sight can still believe it has the focus, and would hush a moment nobody saw.
    if (chosen && foreground) {
      forShell.push({ ...notice, silent: true })
    } else if (foreground) {
      toast(notice.title, {
        id: notice.key,
        description: notice.body,
        action: {
          label: /question\||batch\|/.test(notice.key) ? "Answer" : "Open",
          onClick: () => {
            window.location.hash = notice.route
          },
        },
      })
      forShell.push({ ...notice, silent: true })
    } else if (inApp) {
      forShell.push(notice)
    } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const shown = new Notification(notice.title, noticeOptions(notice.body))
      shown.onclick = () => {
        window.focus()
        window.location.hash = notice.route
      }
    }
  }
  if (inApp) tellShell(forShell)
}

type Elements = Map<string, { frame: HTMLIFrameElement; origin: string }>

/** The server's list, read at the start and whenever the server says it moved. */
function useMachineList(read: ReadMachines | null): void {
  const changed = useEventCount("machines")
  // biome-ignore lint/correctness/useExhaustiveDependencies: `changed` is the server saying the list moved
  useEffect(() => {
    // A page without a server of its own (the demo) has no machines and asks nobody.
    if (read === null) return
    const stop = new AbortController()
    read(stop.signal).then(setMachines, () => {})
    return () => stop.abort()
  }, [changed, read])
}

/** How the page reads its server's machines. */
export type ReadMachines = (signal?: AbortSignal) => Promise<Machine[]>

/**
 * How long a chosen frame has to say its switcher is drawn before this computer's page draws one above
 * it. `after` is the page's clock: a test hands its own.
 */
export const SWITCHER_WAIT_MS = 3000
export type Clock = { after: (run: () => void, ms: number) => () => void }
const realClock: Clock = {
  after: (run, ms) => {
    const id = setTimeout(run, ms)
    return () => clearTimeout(id)
  },
}

/**
 * How far the two pages came with each other, written on the frame's element for whoever reads the
 * page's elements (the App's self-test reports them when a machine's page stays silent): `loaded`
 * counts the frame's load events, `asked` the lists it was asked with, `heard` the messages its window
 * sent, and `refused` the ones of those that were no message of a machine's page, with the origin the
 * last one came from. A count that is missing is zero.
 */
type Mark = "loaded" | "asked" | "heard"
function count(frame: HTMLIFrameElement | undefined, mark: Mark): void {
  if (frame !== undefined) frame.dataset[mark] = String(Number(frame.dataset[mark] ?? 0) + 1)
}
function countRefused(frame: HTMLIFrameElement, origin: string): void {
  const before = Number((frame.dataset.refused ?? "0").split(" ")[0])
  frame.dataset.refused = `${before + 1} ${origin}`
}

/** What the frames say. A frame's window is looked up when it speaks: it is not there before it loaded. */
function useFrameReports(
  elements: { current: Elements },
  on: (id: string, message: FromFrame) => void,
): void {
  const latest = useRef(on)
  latest.current = on
  useEffect(() => {
    const heard = (event: MessageEvent) => {
      const windows = new Map<unknown, { id: string; origin: string }>()
      for (const [id, { frame, origin }] of elements.current)
        if (frame.contentWindow !== null) windows.set(frame.contentWindow, { id, origin })
      const from = event.source === null ? undefined : windows.get(event.source)
      const said = fromFrame(event, windows)
      if (from !== undefined) {
        const frame = elements.current.get(from.id)?.frame
        count(frame, "heard")
        if (said === null && frame !== undefined) countRefused(frame, event.origin)
      }
      if (said !== null) latest.current(said.id, said.message)
    }
    window.addEventListener("message", heard)
    return () => window.removeEventListener("message", heard)
  }, [elements])
}

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
  elements: { current: Elements }
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

function Frames({
  read,
  needsYou: here,
  clock,
  page,
  theme,
  onTheme,
}: {
  read: ReadMachines | null
  /** What this computer's Home lists under Needs you. */
  needsYou: number
  clock: Clock
  page: MachinePage
  theme: Theme | undefined
  onTheme: ((theme: Theme) => void) | undefined
}) {
  const { machines, needsYou } = useMachines()
  const chosen = machineRouteOf(useHash())
  const elements = useRef<Elements>(new Map())
  const addresses = useRef(new Map<string, string>())
  /** The list each frame was last sent, so it is sent again only when it changed or the frame loaded anew. */
  const told = useRef(new Map<string, string>())
  const adding = useAddRequested()
  const resume = useShownPairing()
  /** Which frame said its switcher is drawn. */
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  /** The frame the bar was raised for, once it was silent for the wait. */
  const [late, setLate] = useState<string | null>(null)
  /** Moves on the frame's load and on every list sent: the wait for a confirmation starts again. */
  const [round, setRound] = useState(0)
  /** The windows of frames whose page has spoken: it is running, so it can be sent somewhere. */
  const alive = useRef(new WeakSet<object>())
  /** The place a link named on a machine, kept until that machine's page can take it. */
  const pending = useRef(new Map<string, string>())
  /** The moments of machines told already. */
  const toldNotices = useRef(new Set<string>())
  useMachineList(read)

  const listed = machines ?? []
  const connected = listed.filter(
    (machine) => machine.state === "connected" && machine.port !== undefined,
  )
  const shown = connected.find((machine) => machine.id === chosen?.id)
  const down = shown === undefined ? listed.find((machine) => machine.id === chosen?.id) : undefined
  const view = viewOf({ machines, needsYou }, shown?.id ?? down?.id ?? null, here)
  // The theme goes with the list: a machine's page shows as this one does.
  const message =
    view === null
      ? null
      : ({ ql: 1, type: "machines", ...view, ...(theme ? { theme } : {}) } as const)
  const payload = message === null ? "" : JSON.stringify(message)

  /** Hand the list to one frame, or to every frame, when it has not got this one. */
  const send = useCallback(
    (only?: string) => {
      if (message === null) return
      for (const [id, { frame, origin }] of elements.current) {
        if (only !== undefined && only !== id) continue
        if (frame.contentWindow === null || told.current.get(id) === payload) continue
        told.current.set(id, payload)
        toFrame(frame.contentWindow, origin, message)
      }
    },
    [message, payload],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: `payload` is what changed
  useEffect(() => {
    send()
    setRound((was) => was + 1)
  }, [payload])
  /**
   * Ask one frame's page what waits on it: the list, sent whatever it was sent before. A list that was
   * sent is not a list that was heard: the page may not have been listening yet, or not have been
   * there. Its page answers with what waits (`answerTo` in the relay).
   */
  const ask = useCallback(
    (id: string) => {
      const at = elements.current.get(id)
      if (message === null || at === undefined || at.frame.contentWindow === null) return
      told.current.delete(id)
      count(at.frame, "asked")
      send(id)
    },
    [message, send],
  )

  /** Send a machine's page to the place a link named, once its page is running. */
  const flushGo = useCallback((id: string) => {
    const route = pending.current.get(id)
    const at = elements.current.get(id)
    const page = at?.frame.contentWindow
    if (route === undefined || at === undefined || page == null || !alive.current.has(page)) return
    pending.current.delete(id)
    toFrame(page, at.origin, { ql: 1, type: "go", route })
  }, [])
  // A link to `#/machine/<id>/<place>` chooses the machine (the route does that) and sends its page to
  // the place. The address then names the machine alone, so the same link works again. Only a machine
  // of the list is sent anywhere.
  const known = useRef(new Set<string>())
  known.current = new Set(listed.map((machine) => machine.id))
  useEffect(() => {
    const on = () => {
      pending.current.clear()
      const to = machineRouteOf(window.location.hash)
      if (to === null || to.place === "" || !known.current.has(to.id)) return
      pending.current.set(to.id, `#/${to.place}`)
      window.history.replaceState(window.history.state, "", machineHash(to.id))
      flushGo(to.id)
    }
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [flushGo])

  useFrameReports(elements, (id, said) => {
    if (said.type === "waiting") {
      setNeedsYou(id, said.needsYou)
      const page = elements.current.get(id)?.frame.contentWindow
      const first = page != null && !alive.current.has(page)
      if (page != null) alive.current.add(page)
      flushGo(id)
      // A page that just drew has nothing yet: its first word is the moment to answer with the list,
      // whatever was sent to its window before it listened. Every later word gets the list only when
      // that changed, so its answer to the list starts no round of lists.
      if (first) ask(id)
      else send(id)
    } else if (said.type === "notices") {
      const machine = listed.find((one) => one.id === id)
      if (machine !== undefined)
        tellMachineNotices(machine, said.notices, id === shown?.id, toldNotices.current)
    } else if (said.type === "switcher") {
      setConfirmed((was) => ({ ...was, [id]: said.shown }))
      if (!said.shown) setRound((was) => was + 1)
    } else if (id === shown?.id) {
      // Only the machine in front can ask: its switcher is the one the person is using.
      const act = switchActions()
      if (said.type === "switch")
        window.location.hash =
          said.to === THIS
            ? "#/"
            : listed.some((one) => one.id === said.to)
              ? machineHash(said.to)
              : window.location.hash
      else if (said.type === "add") act.add()
      else if (said.type === "open-machines") act.openMachines()
      else if (said.type === "theme") onTheme?.(said.theme)
    }
  })

  const loaded = (id: string) => {
    const at = elements.current.get(id)
    count(at?.frame, "loaded")
    // The page in the frame is a new one: whatever spoke from this window before is gone.
    if (at?.frame.contentWindow != null) alive.current.delete(at.frame.contentWindow)
    ask(id)
    setConfirmed((was) => ({ ...was, [id]: false }))
    setRound((was) => was + 1)
  }

  // A chosen frame that has not said its switcher is drawn within the wait gets the bar; one that says
  // it takes the bar away. Only the frame in front is timed.
  const shownId = shown?.id
  const drawn = shownId !== undefined && confirmed[shownId] === true
  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` is the wait starting again
  useEffect(() => {
    if (shownId === undefined || drawn) return
    return clock.after(() => setLate(shownId), SWITCHER_WAIT_MS)
  }, [shownId, drawn, round, clock])
  useEffect(() => {
    if (drawn || shownId === undefined) setLate(null)
  }, [drawn, shownId])
  const bar = view !== null && late !== null && late === shownId && !drawn

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

  // Machines that have no page to show yet leave a mark that draws nothing: what each one's state
  // is, for the App's self-test and for anyone reading the page's elements.
  const waiting =
    connected.length === 0 && listed.length > 0 ? (
      <span
        hidden
        data-testid="machines-waiting"
        data-states={listed
          .map((machine) => `${machine.id}:${machine.state}:${machine.reason ?? ""}`)
          .join("|")}
      />
    ) : null
  const place =
    down !== undefined ? (
      <div className="fixed inset-0 z-[60] bg-background" data-testid="machine-place">
        <MachineDown key={down.id} machine={down} view={view} onTry={() => tryNow(down.id)} />
      </div>
    ) : null
  if (connected.length === 0)
    return waiting === null && place === null && dialogs === null ? null : (
      <>
        {waiting}
        {place}
        {dialogs}
      </>
    )

  const keyOf = (machine: Machine) => `${machine.id}:${machine.port}`
  // A frame keeps the address it was first given: a new one would load the machine's page again.
  const live = new Set(connected.map(keyOf))
  for (const key of addresses.current.keys()) if (!live.has(key)) addresses.current.delete(key)
  const addressOf = (machine: Machine): string => {
    const at = machine === shown ? (chosen?.place ?? "") : ""
    const address = addresses.current.get(keyOf(machine)) ?? frameAddress(machine, at, page)
    addresses.current.set(keyOf(machine), address)
    return address
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
              key={keyOf(machine)}
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
  /** This computer's theme as it shows; the machines' pages take it. */
  theme?: Theme
  /** A machine's page in front asks to switch this computer's theme. */
  onTheme?: (theme: Theme) => void
  /** The server's list; null where the page has no server of its own. */
  read?: ReadMachines | null
  /** The page's clock for the switcher's wait; a test hands its own. */
  clock?: Clock
  /** Where a machine's page is served; the demo hands its own. */
  page?: MachinePage | undefined
}) {
  const [framed] = useState(() => machineFrame() !== null)
  useReportWaiting(needsYou, framed)
  // The page that frames this one can send it to a place: a route of this page, nothing else.
  useEffect(
    () =>
      framed
        ? listenForGo((route) => {
            window.location.hash = route
          })
        : undefined,
    [framed],
  )
  // The list this computer's page sends, kept for every switcher of the page.
  useFramedMachines()
  // A machine does not reach further machines: its own page frames nothing.
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
