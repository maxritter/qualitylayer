import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { folderArtifactOf } from "../core/artifact/format.ts"
import type { Viewing } from "../core/viewing.ts"
import type { Api } from "./api.ts"
import { activeSectionSlug, collectSectionHeadings } from "./viewing-helpers.ts"

const ViewingContext = createContext<((location: Viewing) => void) | null>(null)
const pending = new WeakMap<Api, Promise<unknown>>()

/** Navigation writes retain their order even when a task unmounts before the request finishes. */
function send(api: Api, task: string, location: Viewing | { clear: true }) {
  const next = (pending.get(api) ?? Promise.resolve())
    .catch(() => {})
    .then(() => api.viewing?.(task, location))
    .catch(() => {})
  pending.set(api, next)
}

export function artifactViewing(file: string): Viewing {
  const folder = folderArtifactOf(file)
  return folder
    ? { artifact: folder.name, page: folder.page }
    : {
        artifact: file.replace(/^.*\//, "").replace(/\.html$/, ""),
        page: file.replace(/^.*\//, ""),
      }
}

function useViewingReporter(api: Api, task: string, identity: string, eligible: boolean): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!eligible) return
    if (identity === "null") {
      send(api, task, { clear: true })
      return
    }
    timer.current = setTimeout(() => {
      timer.current = null
      send(api, task, JSON.parse(identity))
    }, 5_000)
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [api, task, identity, eligible])
  useEffect(() => {
    if (!eligible) send(api, task, { clear: true })
  }, [api, task, eligible])
  useEffect(() => {
    const clear = () => {
      if (timer.current !== null) clearTimeout(timer.current)
      void api.viewing?.(task, { clear: true }, true).catch(() => {})
    }
    window.addEventListener("pagehide", clear)
    return () => window.removeEventListener("pagehide", clear)
  }, [api, task])
  useEffect(() => () => send(api, task, { clear: true }), [api, task])
}

export function ViewingProvider({
  api,
  task,
  location,
  children,
  eligible = true,
}: {
  api: Api
  task: string
  location: Viewing | null
  children: ReactNode
  eligible?: boolean
}) {
  const key = JSON.stringify(location)
  const [detail, setDetail] = useState<{ key: string; location: Viewing } | null>(null)
  const report = useCallback(
    (next: Viewing) => {
      setDetail((old) =>
        old?.key === key && JSON.stringify(old.location) === JSON.stringify(next)
          ? old
          : { key, location: next },
      )
    },
    [key],
  )
  const current = useMemo(
    () =>
      key === "null"
        ? null
        : ({ ...JSON.parse(key), ...(detail?.key === key ? detail.location : {}) } as Viewing),
    [key, detail],
  )
  useViewingReporter(api, task, JSON.stringify(current), eligible)
  return <ViewingContext.Provider value={report}>{children}</ViewingContext.Provider>
}

export function useArtifactViewing(file: string | null) {
  const report = useContext(ViewingContext)
  useEffect(() => {
    if (file) report?.(artifactViewing(file))
  }, [report, file])
}

export function useSectionViewing(
  host: RefObject<HTMLDivElement | null> | HTMLDivElement | null,
  markdown: string,
  at?: string,
) {
  const report = useContext(ViewingContext)
  useEffect(() => {
    const page = host && "current" in host ? host.current : host
    if (!page || !report || !markdown) return
    const root = page.closest<HTMLElement>("[data-scroll-root]") ?? page.parentElement
    const update = () => {
      const slug = activeSectionSlug(page, root, at)
      report(slug ? { section: slug } : {})
    }
    const target = at
      ? collectSectionHeadings(page).find((heading) => heading.slug === at)
      : undefined
    if (target) report({ section: at })
    else update()
    root?.addEventListener("scroll", update, { passive: true })
    return () => root?.removeEventListener("scroll", update)
  }, [report, host, markdown, at])
}
