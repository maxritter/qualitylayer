import { useEffect, useRef, useState } from "react"
import type { CommandCatalog } from "../../../core/conversation/commands/types.ts"

type State = { key: string; catalog?: CommandCatalog; loading: boolean; error?: string }
type CacheEntry = { key: string; attempt: number; catalog?: CommandCatalog; error?: string }

function stateFromCache(key: string, before: CacheEntry): State {
  return {
    key,
    loading: false,
    ...(before.catalog ? { catalog: before.catalog } : {}),
    ...(before.error ? { error: before.error } : {}),
  }
}

function loadingStateFor(key: string, before: CacheEntry | undefined): State {
  return {
    key,
    loading: true,
    ...(before?.key === key && before.catalog ? { catalog: before.catalog } : {}),
  }
}

function fetchCatalog(options: {
  key: string
  attempt: number
  source: (refresh?: boolean) => Promise<CommandCatalog>
  cache: { current: CacheEntry | undefined }
  setState: (state: State) => void
}): () => void {
  const before = options.cache.current
  if (before?.key === options.key && before.attempt === options.attempt) {
    options.setState(stateFromCache(options.key, before))
    return () => {}
  }
  let current = true
  options.setState(loadingStateFor(options.key, before))
  void options.source(before?.key === options.key && options.attempt > before.attempt).then(
    (catalog) => {
      if (current) {
        options.cache.current = { key: options.key, attempt: options.attempt, catalog }
        options.setState({ key: options.key, catalog, loading: false })
      }
    },
    () => {
      if (current) {
        const error = "Could not read skills. Your draft is kept."
        options.cache.current = { key: options.key, attempt: options.attempt, error }
        options.setState({ key: options.key, loading: false, error })
      }
    },
  )
  return () => {
    current = false
  }
}

export function useCommandCatalog(
  open: boolean,
  key: string,
  load: ((refresh?: boolean) => Promise<CommandCatalog>) | undefined,
) {
  const [attempt, retry] = useState(0)
  const [state, setState] = useState<State>({ key, loading: false })
  const loader = useRef(load)
  loader.current = load
  const available = load !== undefined
  const cache = useRef<CacheEntry | undefined>(undefined)
  useEffect(() => {
    const source = loader.current
    if (!available || !open || !source) return
    return fetchCatalog({ key, attempt, source, cache, setState })
  }, [open, key, available, attempt])
  return {
    ...(state.key === key ? state : { key, loading: false }),
    refresh: () => retry((value) => value + 1),
  }
}
