// Whole-page previews fit the reading column; a named section fits its width and height, never
// below 0.6, and otherwise shows its focus area. ArtifactHost supplies the authorized page read and
// the full-size destination; the card opens from the preview and carries Open full size. Without a
// host, a caller can supply its own read while the card remains local to this document.
// A preview reads and draws its page only near the viewport, and keeps its height before and after.

import { CircleAlertIcon, LoaderCircleIcon, ScanIcon } from "lucide-react"
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { type Artifact, artifactMeta } from "../../core/artifact/format.ts"
import { parseArtifactReference } from "../../core/artifact/reference.ts"
import type { Api } from "../api.ts"
import { agoPhrase, useQuery } from "../hooks.ts"
import { useActionSlot } from "../kit/action-slot.ts"
import { DEFAULT_WIDTH } from "./ArtifactPage.tsx"
import { type ArtifactLayout, ArtifactPageFrame } from "./ArtifactPageFrame.tsx"
import { ArtifactPreviewDialog } from "./ArtifactPreviewDialog.tsx"
import { PreviewActions, PreviewHeader, PreviewScrollHint, UpdatedAgo } from "./PreviewControls.tsx"
import type { PreviewCache } from "./preview-cache.ts"
import { previewAtEnd, previewWindow, SECTION_CAP, sectionPreview } from "./preview-layout.ts"

export type ArtifactHostValue = {
  /** The task's artifacts, for the name and the counts. */
  artifacts: Artifact[]
  /** The page for the frame: `artifacts/<name>.html`. */
  load: (file: string) => Promise<string>
  /** Open it full size. */
  open: (file: string, section?: string) => void
  version?: number
  identity?: string
  cache?: PreviewCache
  theme?: "light" | "dark"
  /** The visible Plan gallery can ask for its choice images through the existing thumbnail reader. */
  galleryThumbnails?: () => Promise<ReadonlyMap<string, string>>
}

const ArtifactHost = createContext<ArtifactHostValue | null>(null)

/** Page pixels kept around a section's drawing when the preview fits it. */
const INK_AIR = 16
/** A fitted section is never narrower than this share of its box (a lone label is not a stamp). */
const INK_FLOOR = 0.4

/**
 * The part narrowed to what it draws side to side, with a little air, inside its own box and never
 * below INK_FLOOR of it (widened evenly). A span the page reports outside its box is ignored.
 */
export function fitToInk<
  T extends { left: number; width: number; ink?: { left: number; width: number } },
>(part: T): T {
  const ink = part.ink
  const end = part.left + part.width
  if (ink === undefined || part.width <= 0) return part
  let left = Math.max(part.left, ink.left - INK_AIR)
  let right = Math.min(end, ink.left + ink.width + INK_AIR)
  if (right - left <= 0) return part
  const least = Math.min(part.width, Math.ceil(part.width * INK_FLOOR))
  if (right - left < least) {
    const grow = (least - (right - left)) / 2
    left = Math.max(part.left, left - grow)
    right = Math.min(end, left + least)
    left = Math.max(part.left, right - least)
  }
  return { ...part, left, width: right - left }
}

export function ArtifactHostProvider({
  value,
  children,
}: {
  value: ArtifactHostValue | null
  children: ReactNode
}) {
  return <ArtifactHost.Provider value={value}>{children}</ArtifactHost.Provider>
}

/** The title the task's artifacts give a file, when a host around the caller knows it. */
export function useArtifactTitle(file: string): string | undefined {
  const host = useContext(ArtifactHost)
  return host?.artifacts.find((d) => d.file === file || d.pages?.some((p) => p.file === file))
    ?.title
}

/** The fence's path as an artifact's file: `artifacts/x.html` as it is, a bare name under artifacts/. */
export const artifactFileOf = (path: string): string =>
  parseArtifactReference(path)?.file ?? (path.startsWith("artifacts/") ? path : `artifacts/${path}`)

/** The element the page scrolls in: the App's marked scroll root, else the nearest scrolling ancestor. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  const marked = el.closest<HTMLElement>("[data-scroll-root]")
  if (marked !== null) return marked
  for (let parent = el.parentElement; parent !== null; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY
    if (overflow === "auto" || overflow === "scroll") return parent
  }
  return null
}

/** Within one screen of the scroller's visible part, above or below. */
function nearNow(el: HTMLElement, root: HTMLElement | null): boolean {
  const box = el.getBoundingClientRect()
  const view = root?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight }
  const reach = root?.clientHeight || window.innerHeight
  return box.bottom >= view.top - reach && box.top <= view.bottom + reach
}

/**
 * Whether the element is within a screen of the viewport. A preview holds its page and draws its
 * frame only near it, so a Plan with many artifacts keeps the few in view and lets the rest go
 * (their boxes keep their height). The first answer is measured at once, so nothing waits for the
 * observer's first report.
 */
function useNearViewport(ref: RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const root = scrollParent(el)
    const set = setNear
    set(nearNow(el, root))
    if (typeof IntersectionObserver === "undefined") {
      set(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1]
        if (last !== undefined) set(last.isIntersecting)
      },
      { root, rootMargin: "100% 0px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return near
}

export function useGalleryThumbnails(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const host = useContext(ArtifactHost)
  const near = useNearViewport(ref)
  return useQuery(
    () =>
      enabled && near && host?.galleryThumbnails ? host.galleryThumbnails() : Promise.resolve(null),
    [enabled, near, host?.identity, host?.version],
  ).data
}

export type ArtifactPreviewProps = {
  /** The artifact's name, as the Plan's `ql:artifact <name>` gives it: `artifacts/<name>.html`. */
  name?: string
  /** Or its path: `artifacts/<name>.html`. */
  path?: string
  /** The task it belongs to, and the App's API to read the page by (when no host is around it). */
  task?: { id: string; api: Pick<Api, "artifactPage"> }
  /** Open full size; without it, the host's Open (or none). */
  onOpen?: () => void
  /** Without a host or a task: how the page is read (raw; drawn at the default width). */
  load?: (name: string) => Promise<string>
  /** The caller's stable standalone read context; ignored when a host or task owns the read. */
  loadScope?: (name: string) => Promise<string>
  /** The name to show when no host knows the artifact. */
  title?: string
  /** The artifact's facts when the caller has them (its name, update, comments). */
  artifact?: Artifact | null
}

export function ArtifactPreview({
  name: named,
  path: given,
  task,
  onOpen,
  load,
  loadScope,
  title,
  artifact: known = null,
}: ArtifactPreviewProps) {
  const host = useContext(ArtifactHost)
  // In a row that names the screen (a gallery's tabs), the facts and Open in card go to its end.
  const slot = useActionSlot()
  const scope = host === null && task === undefined ? loadScope : undefined
  const path = given ?? `artifacts/${named ?? ""}.html`
  const reference = parseArtifactReference(path)
  const section = reference?.section
  const file = artifactFileOf(path)
  const artifact =
    known ??
    host?.artifacts.find((d) => d.file === file || d.pages?.some((page) => page.file === file)) ??
    null
  const identity = host?.identity ?? task?.id ?? "standalone"
  const warm = useRef(host?.cache?.read(file))
  const [html, setHtml] = useState<{
    file: string
    identity: string
    at: number
    text: string
    scope: typeof scope
  } | null>(() => (warm.current ? { file, identity, at: 0, text: warm.current.text, scope } : null))
  const [error, setError] = useState<string | null>(null)
  // The geometry may outlive the page's text in the cache: it reserves the box before the page is read.
  const [layout, setLayout] = useState<ArtifactLayout | null>(
    () => warm.current?.layout ?? host?.cache?.shape(file) ?? null,
  )
  const [reportedFor, setReportedFor] = useState<string | null>(null)
  const [room, setRoom] = useState(0)
  const [atEnd, setAtEnd] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const near = useNearViewport(root)
  const viewport = useRef<HTMLDivElement | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const updated = artifact?.updated ?? 0
  const loader =
    host?.load ??
    (task !== undefined
      ? (f: string) => task.api.artifactPage({ scope: "task", id: task.id }, f)
      : load !== undefined
        ? (f: string) => load(f.replace(/^artifacts\//, ""))
        : null)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  // The page is read, with the person's access checked, when the preview comes near the viewport: a
  // mount always asks, and a new version asks again. The version is the artifact's own update and
  // revision (a dependency edit moves the revision), or the task's version for a live project
  // artifact the task does not list. Scrolling away and back within one mount at one version takes
  // the page from the cache (or reads it again if the cache let it go) and does not ask again.
  const signal =
    artifact !== null ? `${updated}:${artifact.revision ?? ""}` : `v${host?.version ?? ""}`
  const checked = useRef<{
    file: string
    identity: string
    signal: string
    listed: boolean
    scope: typeof scope
  } | null>(null)
  const held = useRef(html)
  held.current = html
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependency-only edits invalidate the packed preview even when its newest timestamp is unchanged
  useEffect(() => {
    const read = loaderRef.current
    if (read === null || !near) return
    const was = checked.current
    // The list of the task's artifacts arriving after the first read is not a new version.
    if (
      was !== null &&
      was.file === file &&
      was.identity === identity &&
      was.scope === scope &&
      (was.signal === signal || (!was.listed && artifact !== null))
    ) {
      checked.current = { file, identity, signal, listed: artifact !== null, scope }
      if (
        held.current?.file === file &&
        held.current.identity === identity &&
        held.current.scope === scope
      )
        return
      const page = host?.cache?.read(file)
      if (page) {
        setHtml({ file, identity, at: updated, text: page.text, scope })
        return
      }
    }
    let live = true
    setError(null)
    read(file)
      .then((text) => {
        if (!live) return
        checked.current = { file, identity, signal, listed: artifact !== null, scope }
        setHtml((cur) =>
          cur?.file === file &&
          cur.identity === identity &&
          cur.text === text &&
          cur.scope === scope
            ? cur
            : { file, identity, at: updated, text, scope },
        )
      })
      .catch((cause: Error) => {
        if (!live) return
        checked.current = null
        setError(cause.message)
      })
    return () => {
      live = false
    }
  }, [
    near,
    file,
    identity,
    scope,
    updated,
    artifact?.revision,
    artifact === null ? host?.version : 0,
  ])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new source page invalidates the previous page's crop coordinates
  useLayoutEffect(
    () => setLayout(host?.cache?.read(file)?.layout ?? host?.cache?.shape(file) ?? null),
    [file, identity, scope, host?.cache],
  )

  // Far from the viewport the frame and the page text go, bounding what a long Plan holds; the box keeps
  // its height from the geometry. A frame drawn again reports its parts again, and the placeholder holds
  // the box until then. A card that is open keeps the page it shows.
  const wasNear = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the preview leaving the viewport lets its page go
  useEffect(() => {
    if (near) {
      wasNear.current = true
      return
    }
    if (!wasNear.current) return
    wasNear.current = false
    setReportedFor(null)
    if (!expanded) setHtml(null)
  }, [near])

  // The room is what the viewport leaves after its own scrollbar; the window's height sets how tall it may grow.
  useLayoutEffect(() => {
    const el = viewport.current
    if (el === null) return
    const measure = () => {
      setRoom(el.clientWidth)
    }
    measure()
    window.addEventListener("resize", measure)
    if (typeof ResizeObserver === "undefined")
      return () => window.removeEventListener("resize", measure)
    const watcher = new ResizeObserver(measure)
    watcher.observe(el)
    return () => {
      window.removeEventListener("resize", measure)
      watcher.disconnect()
    }
  }, [])

  const currentHtml =
    html?.file === file && html.identity === identity && html.scope === scope ? html : null
  // The frame is drawn while the preview is near and its page is read; its first report says where
  // the parts are. Until then a placeholder holds the box at the height the picture will have.
  const mounted = near && currentHtml !== null
  const reported = currentHtml !== null && reportedFor === currentHtml.text
  const matches = section && layout ? layout.parts.filter((part) => part.id === section) : []
  const focused =
    matches.length === 1 && matches[0] && matches[0].width > 0 && matches[0].height > 0
      ? matches[0]
      : null
  const sectionProblem =
    section && layout && reported && !focused
      ? matches.length > 1
        ? `More than one section has id “${section}”. Use a unique section id.`
        : `Section “${section}” is unavailable on this page. Open the artifact to inspect it.`
      : null
  const name =
    focused?.label ||
    artifact?.title ||
    title ||
    (currentHtml ? artifactMeta(currentHtml.text).title : "") ||
    path.replace(/^.*\//, "").replace(/\.html.*$/, "")
  const width = Math.max(artifact?.width ?? DEFAULT_WIDTH, layout?.width ?? 0)
  // A section, and a whole page referenced without one, fits the column and the cap and never
  // scrolls at rest (Plan decision d14): a page too tall for the floor shows its top; the card
  // opens the rest.
  const page =
    layout !== null && layout !== undefined
      ? { top: 0, left: 0, width, height: layout.contentHeight ?? layout.height }
      : null
  // A section is fitted to what it draws side to side (with a little air), so a section box that runs
  // empty to the page's edge does not shrink its drawing into one half of the preview.
  const drawnPart = focused === null ? null : fitToInk(focused)
  const sized = sectionPreview({
    section: section ? drawnPart : page,
    focus: section ? (focused?.focus ?? null) : null,
    room,
    cap: SECTION_CAP,
    unavailable: section ? sectionProblem !== null : false,
  })
  const { scale, inset, region, pictureHeight, pictureWidth, shownHeight } = sized
  const scrolls = !section && pictureHeight > shownHeight + 1
  const drawn = mounted && (!section || reported)
  const meta = [
    reference?.scope === "project" ? "Live project artifact" : null,
    artifact !== null && artifact.updated > 0 ? (
      <UpdatedAgo key="updated" ago={agoPhrase(artifact.updated)} />
    ) : null,
    artifact !== null && artifact.comments > 0
      ? `${artifact.comments} ${artifact.comments === 1 ? "comment" : "comments"}`
      : null,
  ].filter((part) => part !== null)
  const open =
    onOpen ??
    (host !== null && (artifact !== null || reference?.scope === "project")
      ? () => (section ? host.open(file, section) : host.open(file))
      : null)
  const canEnlarge = error === null && currentHtml !== null && (!section || focused !== null)
  const enlarge = (event: MouseEvent<HTMLButtonElement>) => {
    returnFocus.current = event.currentTarget
    setExpanded(true)
  }
  // A page that cannot be read has no card to open; the button then goes on to the artifact itself.
  const toCard = error === null ? enlarge : open === null ? null : () => open()

  return (
    <div
      ref={root}
      className="dg-prv"
      data-testid="artifact-preview"
      data-file={file}
      data-focus-section={section}
      data-focus-resolved={focused ? "true" : section ? "false" : undefined}
      data-mode={error !== null ? "failed" : sized.mode}
    >
      {slot === null ? (
        <PreviewHeader
          name={name}
          meta={meta}
          onCard={toCard}
          cardDisabled={error === null && !canEnlarge}
        />
      ) : slot.shown && slot.element !== null ? (
        createPortal(
          <PreviewActions
            name={title ?? name}
            meta={meta}
            onCard={toCard}
            cardDisabled={error === null && !canEnlarge}
          />,
          slot.element,
        )
      ) : null}
      {error !== null ? (
        <p className="dg-prv-failed" role="status" title={error}>
          <CircleAlertIcon className="shrink-0" size={14} aria-hidden="true" />
          Preview unavailable{open !== null ? " · Open in card" : ""}
          <span className="sr-only">. </span>
          <span className="sr-only">{error}</span>
        </p>
      ) : (
        <div className="dg-prv-box">
          <div
            ref={viewport}
            className="dg-prv-view"
            data-testid="artifact-preview-viewport"
            data-scrolls={scrolls ? "true" : undefined}
            style={{ height: shownHeight }}
            onScroll={(event) => setAtEnd(previewAtEnd(event.currentTarget, false))}
            {...(scrolls
              ? {
                  tabIndex: 0,
                  role: "group",
                  "aria-label": `${name}, a preview that scrolls`,
                }
              : {})}
          >
            <button
              type="button"
              className="shot"
              aria-label={`Enlarge ${name}`}
              disabled={!canEnlarge}
              onClick={enlarge}
              style={{
                height: pictureHeight,
                ...(section ? { width: pictureWidth, marginInline: "auto" } : {}),
              }}
              data-focused={section ? "true" : undefined}
            >
              {near && currentHtml !== null ? (
                <span
                  className="dg-prv-focus-window"
                  style={{
                    ...previewWindow(region, scale, inset),
                    ...(drawn && !sectionProblem ? {} : { visibility: "hidden" }),
                  }}
                >
                  <span
                    className="dg-prv-crop"
                    inert
                    style={{
                      left: region ? -region.left * scale : 0,
                      top: region ? -region.top * scale : 0,
                    }}
                  >
                    <ArtifactPageFrame
                      still
                      html={currentHtml.text}
                      title={`${name}, a preview`}
                      width={width}
                      height={Math.max(900, layout?.height ?? 900)}
                      scale={scale}
                      theme={host?.theme}
                      onLayout={(next) => {
                        // A frame whose tab is being hidden can still report its section at 0 x 0; that
                        // would replace the layout the preview already has (its name and focus).
                        if (root.current?.closest("[hidden]")) return
                        setLayout(next)
                        setReportedFor(currentHtml.text)
                        host?.cache?.layout(file, currentHtml.text, next)
                      }}
                    />
                  </span>
                </span>
              ) : null}
              {sized.mode === "focus" && drawn ? (
                <span className="dg-prv-tag">
                  <ScanIcon size={12} aria-hidden="true" />
                  Focus area
                </span>
              ) : null}
              {sectionProblem ? (
                <span className="dg-prv-problem" role="status">
                  {sectionProblem}
                </span>
              ) : null}
            </button>
          </div>
          {drawn || sectionProblem ? null : (
            <span
              className="dg-prv-wait"
              data-loading={near ? "true" : undefined}
              {...(near ? { role: "status" } : { "aria-hidden": true })}
            >
              {near ? (
                <span>
                  <LoaderCircleIcon size={13} aria-hidden="true" />
                  Loading preview
                </span>
              ) : null}
            </span>
          )}
          <PreviewScrollHint vertical={scrolls} atEnd={atEnd} />
        </div>
      )}
      {canEnlarge && currentHtml ? (
        <ArtifactPreviewDialog
          open={expanded}
          close={() => setExpanded(false)}
          name={name}
          html={currentHtml.text}
          width={width}
          layout={layout}
          section={section}
          theme={host?.theme}
          onOpen={open}
          returnFocus={returnFocus}
        />
      ) : null}
    </div>
  )
}
