import { useEffect, useState } from "react"

export type FragmentsModule = typeof import("./fragments-entry.ts")

/**
 * The Cockpit fetches the fragment parsers as a file of their own (fragments-entry.ts), so the
 * page's script stays small; the address is made at run time, so the bundler leaves it out of
 * app.js. It is fetched the first time a view needs it (a wireframe, a team copy, a shared
 * artboard), once, and kept.
 */
let load = (): Promise<FragmentsModule> =>
  import(
    /* @vite-ignore */ new URL("/fragments.js", window.location.href).href
  ) as Promise<FragmentsModule>
let loaded: FragmentsModule | null = null
let pending: Promise<FragmentsModule> | null = null
const waiting = new Set<(module: FragmentsModule) => void>()

/** Where the parsers come from on a page that is not the Cockpit (the demo and the website bundle them). */
export function loadFragmentsFrom(from: () => Promise<FragmentsModule>): void {
  load = from
  pending = null
}

/** The parsers already at hand (tests and bundling pages), so the first drawing needs no wait; null forgets them. */
export function provideFragments(module: FragmentsModule | null): void {
  loaded = module
  pending = null
  if (module === null) return
  for (const done of waiting) done(module)
  waiting.clear()
}

export function fragmentsReady(): Promise<FragmentsModule> {
  if (loaded !== null) return Promise.resolve(loaded)
  pending ??= load().then(
    (module) => {
      provideFragments(module)
      return module
    },
    (error: unknown) => {
      pending = null
      throw error
    },
  )
  return pending
}

/**
 * The parsers, null until they have arrived (the component draws again when they do), or why they
 * could not be fetched. A failed fetch is not kept: the next component that asks fetches again.
 */
export function useFragments(): { fragments: FragmentsModule | null; error: string | null } {
  const [module, setModule] = useState<FragmentsModule | null>(loaded)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (module !== null) return
    let live = true
    const done = (next: FragmentsModule) => {
      if (live) setModule(next)
    }
    if (loaded !== null) done(loaded)
    else {
      waiting.add(done)
      fragmentsReady().catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause))
      })
    }
    return () => {
      live = false
      waiting.delete(done)
    }
  }, [module])
  return { fragments: module, error: module === null ? error : null }
}
