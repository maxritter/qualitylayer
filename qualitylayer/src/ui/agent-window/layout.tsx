import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useViewportWidth } from "../hooks.ts"
import { store, stored } from "../prefs.ts"

export const TERMINAL_LAYOUT_KEY = "qualitylayer-terminal-layout"
export type TerminalPanel = "terminal" | "files" | "comments" | "activity" | "details"
type Preference = { width: number }
const defaults: Preference = { width: 520 }
export function terminalLayoutPreference(value: string): Preference {
  try {
    const parsed = JSON.parse(value) as Partial<Preference>
    return {
      width: Number.isFinite(parsed.width)
        ? Math.max(320, Math.min(760, parsed.width as number))
        : defaults.width,
    }
  } catch {
    return { ...defaults }
  }
}
type Rect = { left: number; top: number; width: number; height: number }
type Layout = {
  taskAgent: string | undefined
  setTaskAgent(task: string | undefined): void
  agentControls: HTMLElement | null
  controls(node: HTMLElement | null): void
  agentViews: HTMLElement | null
  views(node: HTMLElement | null): void
  rightActive: boolean
  width: number
  maxWidth: number
  panel: TerminalPanel
  sidebarRect: Rect | null
  sidebarSheetHost: HTMLElement | null
  sidebarTabId?: string
  setPanel(panel: TerminalPanel): void
  openRun(id: string): void
  setRunOpener(open: ((id: string) => void) | null): void
  rememberSidebar(panel: Exclude<TerminalPanel, "terminal">): void
  hideTerminal(): void
  resize(size: number): void
  reset(): void
  sidebarBody(node: HTMLElement | null): void
  workspace(node: HTMLElement | null): void
}
const TerminalLayout = createContext<Layout | null>(null)
export function useTerminalLayout() {
  return useContext(TerminalLayout)
}
function sameRect(a: Rect | null, b: Rect | null): boolean {
  return (
    a?.left === b?.left && a?.top === b?.top && a?.width === b?.width && a?.height === b?.height
  )
}

function measureRect(node: HTMLElement | null): Rect | null {
  const rect = node?.getBoundingClientRect()
  return rect && rect.width > 0 && rect.height > 0
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : null
}

function useLayoutPreference() {
  const [preference, setPreference] = useState(() =>
    terminalLayoutPreference(stored(TERMINAL_LAYOUT_KEY, "")),
  )
  const keep = useCallback((patch: Partial<Preference>) => {
    setPreference((before) => {
      const unchanged = Object.entries(patch).every(
        ([key, value]) => before[key as keyof Preference] === value,
      )
      if (unchanged) return before
      const next = { ...before, ...patch }
      store(TERMINAL_LAYOUT_KEY, JSON.stringify(next))
      return next
    })
  }, [])
  return { preference, keep }
}

function observeTargets(targets: readonly (HTMLElement | null)[], measure: () => void) {
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null
  for (const target of targets) {
    if (target) observer?.observe(target)
  }
  window.addEventListener("resize", measure)
  measure()
  return () => {
    observer?.disconnect()
    window.removeEventListener("resize", measure)
  }
}

function useMeasuredNodes(initialWidth: number) {
  const [available, setAvailable] = useState(initialWidth)
  const [sidebarRect, setRect] = useState<Rect | null>(null)
  const [sidebarTabId, setSidebarTabId] = useState<string>()
  const [sidebarSheetHost, setSidebarSheetHost] = useState<HTMLElement | null>(null)
  const sidebarNode = useRef<HTMLElement | null>(null)
  const workspaceNode = useRef<HTMLElement | null>(null)
  const [nodes, changedNodes] = useState(0)
  const sidebarBody = useCallback((node: HTMLElement | null) => {
    if (sidebarNode.current === node) return
    sidebarNode.current = node
    setSidebarSheetHost(node?.closest('[role="dialog"]') ? node.parentElement : null)
    setSidebarTabId(node?.dataset.terminalTab)
    changedNodes((n) => n + 1)
  }, [])
  const workspace = useCallback((node: HTMLElement | null) => {
    if (workspaceNode.current === node) return
    workspaceNode.current = node
    changedNodes((n) => n + 1)
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: nodes changes when a ref target changes; the observer must follow that target
  useLayoutEffect(() => {
    const measure = () => {
      setAvailable(workspaceNode.current?.clientWidth || window.innerWidth)
      const next = measureRect(sidebarSheetHost ?? sidebarNode.current)
      setRect((before) => (sameRect(before, next) ? before : next))
    }
    return observeTargets([sidebarNode.current, sidebarSheetHost, workspaceNode.current], measure)
  }, [nodes, sidebarSheetHost])
  return { available, sidebarRect, sidebarTabId, sidebarSheetHost, sidebarBody, workspace }
}

export function TerminalLayoutProvider({ children }: { children: ReactNode }) {
  const [taskAgent, setTaskAgent] = useState<string>()
  const [agentControls, setControls] = useState<WeakRef<HTMLElement> | null>(null)
  const controls = useCallback((node: HTMLElement | null) => {
    setControls(node === null ? null : new WeakRef(node))
  }, [])
  const [agentViews, setViews] = useState<WeakRef<HTMLElement> | null>(null)
  const views = useCallback((node: HTMLElement | null) => {
    setViews(node === null ? null : new WeakRef(node))
  }, [])
  const viewportWidth = useViewportWidth()
  const { preference, keep } = useLayoutPreference()
  const [panel, setPanel] = useState<TerminalPanel>("terminal")
  const runOpener = useRef<((id: string) => void) | null>(null)
  const setRunOpener = useCallback((open: ((id: string) => void) | null) => {
    runOpener.current = open
  }, [])
  const openRun = useCallback((id: string) => runOpener.current?.(id), [])
  const lastSidebar = useRef<Exclude<TerminalPanel, "terminal">>("files")
  const rememberSidebar = useCallback((next: Exclude<TerminalPanel, "terminal">) => {
    lastSidebar.current = next
  }, [])
  const measured = useMeasuredNodes(viewportWidth)
  const rightActive = taskAgent !== undefined
  const maxWidth = Math.max(320, Math.min(760, measured.available - 360))
  const width = Math.min(preference.width, maxWidth)
  const value = useMemo<Layout>(
    () => ({
      taskAgent,
      setTaskAgent,
      get agentControls() {
        return agentControls?.deref() ?? null
      },
      controls,
      get agentViews() {
        return agentViews?.deref() ?? null
      },
      views,
      rightActive,
      width,
      maxWidth,
      panel,
      sidebarRect: measured.sidebarRect,
      sidebarSheetHost: measured.sidebarSheetHost,
      sidebarTabId: measured.sidebarTabId,
      openRun,
      setRunOpener,
      setPanel(next) {
        if (next !== "terminal") lastSidebar.current = next
        setPanel(next)
      },
      rememberSidebar,
      hideTerminal() {
        setPanel(lastSidebar.current)
      },
      resize(size) {
        keep({ width: Math.max(320, Math.min(maxWidth, size)) })
      },
      reset() {
        keep({ width: defaults.width })
      },
      sidebarBody: measured.sidebarBody,
      workspace: measured.workspace,
    }),
    [
      rightActive,
      taskAgent,
      agentControls,
      controls,
      agentViews,
      views,
      width,
      maxWidth,
      panel,
      measured.sidebarRect,
      measured.sidebarSheetHost,
      measured.sidebarTabId,
      keep,
      measured.sidebarBody,
      measured.workspace,
      rememberSidebar,
      openRun,
      setRunOpener,
    ],
  )
  return <TerminalLayout.Provider value={value}>{children}</TerminalLayout.Provider>
}
