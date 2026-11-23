import { useEffect, useRef, useState, useSyncExternalStore } from "react"

export {
  INITIAL_EVENT_WAIT_MS,
  QUERY_READ_MS,
  type Query,
  useQuery,
} from "./hooks-query.ts"
export {
  parseRoute,
  type Route,
  routeHash,
} from "./hooks-route.ts"
export {
  RestoredRouteContext,
  useMissingRestoredFallback,
  useRoute,
  useScrollMemory,
} from "./hooks-scroll.ts"
export {
  type OutsideConversationInterest,
  OutsideConversationInterestContext,
  SLOW_EVENT_MS,
  serverReplaced,
  subscribeEventCount,
  topicsOf,
  useEventCount,
  useEventStream,
} from "./hooks-stream.ts"

/** A value that components far apart in the tree share: `set` it anywhere, and every `use` of it renders again. */
export function sharedValue<T>(initial: T) {
  let value = initial
  const watchers = new Set<() => void>()
  const subscribe = (watcher: () => void) => {
    watchers.add(watcher)
    return () => {
      watchers.delete(watcher)
    }
  }
  return {
    get: () => value,
    set: (next: T) => {
      value = next
      for (const watcher of watchers) watcher()
    },
    subscribe,
    use: () => useSyncExternalStore(subscribe, () => value),
  }
}

/** The viewport of this app, including when the website embeds it in a frame. */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  )
  const seen = useRef(width)
  useEffect(() => {
    const onResize = () => {
      const next = window.innerWidth
      if (next === seen.current) return
      seen.current = next
      document.documentElement.dataset.windowResizing = ""
      setWidth(next)
    }
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      delete document.documentElement.dataset.windowResizing
    }
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the effect runs after each committed width and reads nothing from it
  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => delete document.documentElement.dataset.windowResizing)
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [width])
  return width
}

/** The time now, moving every second while `active`, so a clock between two polls keeps counting. */
export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  const wasActive = useRef(active)
  useEffect(() => {
    if (!active) {
      wasActive.current = false
      return
    }
    if (!wasActive.current) setNow(Date.now())
    wasActive.current = true
    let timer: ReturnType<typeof setInterval> | undefined
    const resume = () => {
      clearInterval(timer)
      timer = undefined
      if (typeof document === "undefined" || document.visibilityState !== "hidden")
        timer = setInterval(() => setNow(Date.now()), everyMs)
    }
    const visible = () => {
      if (document.visibilityState !== "hidden") setNow(Date.now())
      resume()
    }
    resume()
    document.addEventListener("visibilitychange", visible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", visible)
    }
  }, [active, everyMs])
  return now
}

export function ago(ms: number | null | undefined, now = Date.now()): string {
  if (ms === null || ms === undefined || ms === 0) return ""
  const minutes = Math.max(0, Math.round((now - ms) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.round(hours / 24)} d`
}

/** How long ago, as words in a sentence: "just now", or "5 min ago". */
export function agoPhrase(ms: number | null | undefined, now = Date.now()): string {
  const since = ago(ms, now)
  return since === "just now" || since === "" ? since : `${since} ago`
}
