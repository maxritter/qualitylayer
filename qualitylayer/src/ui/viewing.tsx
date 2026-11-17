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
import { headingSlug } from "../core/docs/anchor.ts"
import { trimmedLineTail } from "../core/text-boundaries.ts"
import type { Viewing } from "../core/viewing.ts"
import type { Api } from "./api.ts"

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
    (location: Viewing) => {
      setDetail((old) =>
        old?.key === key && JSON.stringify(old.location) === JSON.stringify(location)
          ? old
          : { key, location },
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
  const identity = JSON.stringify(current)
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
  useEffect(
    () => () => {
      send(api, task, { clear: true })
    },
    [api, task],
  )
  return <ViewingContext.Provider value={report}>{children}</ViewingContext.Provider>
}

export function useArtifactViewing(file: string | null) {
  const report = useContext(ViewingContext)
  useEffect(() => {
    if (file) report?.(artifactViewing(file))
  }, [report, file])
}

/** How far below the page's top edge a heading still counts as where a jump landed, in px. */
const LANDING_BAND = 160

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
    const headings = () =>
      [...page.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,[data-block-key$="-heading"]')]
        .filter(
          (heading) =>
            !heading.matches('[data-block-key$="-heading"]') ||
            !heading.querySelector("h1,h2,h3,h4,h5,h6"),
        )
        .map((element) => {
          const raw =
            element.closest<HTMLElement>("[data-comment-source]")?.dataset.commentSource ?? ""
          const mark = /^#{1,6}/.exec(raw)?.[0]
          const source = mark === undefined ? null : trimmedLineTail(raw, mark.length, 1)
          const text = source ?? element.textContent ?? ""
          return { element, slug: headingSlug(text) }
        })
    const update = () => {
      const area = root?.getBoundingClientRect()
      const line = (area?.top ?? 0) + 96
      const all = headings()
      let active =
        all.filter((heading) => heading.element.getBoundingClientRect().top <= line).at(-1) ??
        all[0]
      // A jump lands its heading a little below the top edge (the block's own spacing sits above the words),
      // and a page that ends early cannot bring it higher: while that heading is in the top band of the page,
      // it is the section being read.
      const asked = at ? all.find((heading) => heading.slug === at) : undefined
      if (
        asked !== undefined &&
        area !== undefined &&
        all.indexOf(asked) > all.indexOf(active ?? asked)
      ) {
        const top = asked.element.getBoundingClientRect().top
        if (top >= area.top && top < area.top + LANDING_BAND) active = asked
      }
      report(active ? { section: active.slug } : {})
    }
    const target = at ? headings().find((heading) => heading.slug === at) : undefined
    if (target) report({ section: at })
    else update()
    root?.addEventListener("scroll", update, { passive: true })
    return () => root?.removeEventListener("scroll", update)
  }, [report, host, markdown, at])
}
