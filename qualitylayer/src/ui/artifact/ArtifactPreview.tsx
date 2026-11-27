// Whole-page previews fit the reading column; a named section fits its width and height, never
// below 0.6, and otherwise shows its focus area. ArtifactHost supplies the authorized page read and
// the full-size destination; the card opens from the preview and carries Open full size. Without a
// host, a caller can supply its own read while the card remains local to this document.
// A preview reads and draws its page only near the viewport, and keeps its height before and after.

import { CircleAlertIcon } from "lucide-react"
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import type { Artifact } from "../../core/artifact/format.ts"
import { parseArtifactReference } from "../../core/artifact/reference.ts"
import type { Api } from "../api.ts"
import { agoPhrase, useQuery } from "../hooks.ts"
import { useActionSlot } from "../kit/action-slot.ts"
import type { StagedAnnotation } from "./ArtifactAnnotateTray.tsx"
import type { ArtifactLayout } from "./ArtifactPageFrame.tsx"
import { ArtifactPreviewBody } from "./ArtifactPreviewBody.tsx"
import { ArtifactPreviewDialog, type PreviewScreenEntry } from "./ArtifactPreviewDialog.tsx"
import { useNearViewport, usePreviewPageLoad, useViewportRoom } from "./artifact-preview-hooks.ts"
import { fitToInk, resolvePreviewMetrics } from "./artifact-preview-metrics.ts"
import { PreviewActions, PreviewHeader, UpdatedAgo } from "./PreviewControls.tsx"
import type { PreviewCache } from "./preview-cache.ts"

export { fitToInk }

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
  /** Submit batched multi-place element/area annotations directly to the planner (#268). */
  annotate?: (file: string, batchMarkdown: string, pins: StagedAnnotation[]) => Promise<void>
}

const ArtifactHost = createContext<ArtifactHostValue | null>(null)

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
  /** Optional sibling Plan Interface screens for `< k / N >` dialog paging. */
  screens?: readonly PreviewScreenEntry[]
}

function previewLoaderOf(
  host: ArtifactHostValue | null,
  task: ArtifactPreviewProps["task"],
  load: ArtifactPreviewProps["load"],
): ((file: string) => Promise<string>) | null {
  if (host?.load) return host.load
  if (task !== undefined)
    return (f: string) => task.api.artifactPage({ scope: "task", id: task.id }, f)
  if (load !== undefined) return (f: string) => load(f.replace(/^artifacts\//, ""))
  return null
}

function previewMetaItems(
  referenceScope: string | undefined,
  artifact: Artifact | null,
): ReactNode[] {
  const items: ReactNode[] = []
  if (referenceScope === "project") items.push("Live project artifact")
  if (artifact !== null && artifact.updated > 0) {
    items.push(<UpdatedAgo key="updated" ago={agoPhrase(artifact.updated)} />)
  }
  if (artifact !== null && artifact.comments > 0) {
    items.push(`${artifact.comments} ${artifact.comments === 1 ? "comment" : "comments"}`)
  }
  return items
}

function PreviewSlotHeader({
  slot,
  name,
  title,
  meta,
  toCard,
  toAnnotate,
  cardDisabled,
}: {
  slot: ReturnType<typeof useActionSlot>
  name: string
  title: string | undefined
  meta: ReactNode[]
  toCard: ((event: MouseEvent<HTMLButtonElement>) => void) | null
  toAnnotate: ((event: MouseEvent<HTMLButtonElement>) => void) | null
  cardDisabled: boolean
}) {
  if (slot === null) {
    return (
      <PreviewHeader
        name={name}
        meta={meta}
        onCard={toCard}
        onAnnotate={toAnnotate}
        cardDisabled={cardDisabled}
      />
    )
  }
  if (!slot.shown || slot.element === null) return null
  return createPortal(
    <PreviewActions
      name={title ?? name}
      meta={meta}
      onCard={toCard}
      onAnnotate={toAnnotate}
      cardDisabled={cardDisabled}
    />,
    slot.element,
  )
}

function previewOpenAction(args: {
  onOpen: (() => void) | undefined
  host: ArtifactHostValue | null
  artifact: Artifact | null
  referenceScope: string | undefined
  file: string
  section: string | undefined
}): (() => void) | null {
  if (args.onOpen !== undefined) return args.onOpen
  if (args.host === null) return null
  if (args.artifact === null && args.referenceScope !== "project") return null
  const { host, file, section } = args
  return () => (section ? host.open(file, section) : host.open(file))
}

function resolvePreviewTarget(
  props: Pick<ArtifactPreviewProps, "name" | "path" | "artifact" | "task" | "loadScope">,
  host: ArtifactHostValue | null,
) {
  const path = props.path ?? `artifacts/${props.name ?? ""}.html`
  const reference = parseArtifactReference(path)
  const file = artifactFileOf(path)
  const artifact =
    props.artifact ??
    host?.artifacts.find((d) => d.file === file || d.pages?.some((page) => page.file === file)) ??
    null
  const identity = host?.identity ?? props.task?.id ?? "standalone"
  const scope = host === null && props.task === undefined ? props.loadScope : undefined
  return { path, reference, section: reference?.section, file, artifact, identity, scope }
}

function PreviewFailedNotice({ error, hasOpen }: { error: string; hasOpen: boolean }) {
  return (
    <p className="dg-prv-failed" role="status" title={error}>
      <CircleAlertIcon className="shrink-0" size={14} aria-hidden="true" />
      Preview unavailable{hasOpen ? " · Open in card" : ""}
      <span className="sr-only">. </span>
      <span className="sr-only">{error}</span>
    </p>
  )
}

function previewCardAction(
  error: string | null,
  enlarge: (event: MouseEvent<HTMLButtonElement>) => void,
  open: (() => void) | null,
): ((event: MouseEvent<HTMLButtonElement>) => void) | null {
  if (error === null) return enlarge
  return open === null ? null : () => open()
}

function usePreviewDialogControls(
  error: string | null,
  hostAnnotate: ArtifactHostValue["annotate"],
) {
  const returnFocus = useRef<HTMLElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [openAnnotating, setOpenAnnotating] = useState(false)
  const enlarge = (event: MouseEvent<HTMLButtonElement>) => {
    returnFocus.current = event.currentTarget
    setOpenAnnotating(false)
    setExpanded(true)
  }
  const startAnnotate =
    hostAnnotate && error === null
      ? (event: MouseEvent<HTMLButtonElement>) => {
          returnFocus.current = event.currentTarget
          setOpenAnnotating(true)
          setExpanded(true)
        }
      : null
  const close = () => {
    setExpanded(false)
    setOpenAnnotating(false)
  }
  return { returnFocus, expanded, openAnnotating, enlarge, startAnnotate, close }
}

export function ArtifactPreview(props: ArtifactPreviewProps) {
  const { task, onOpen, load, title } = props
  const host = useContext(ArtifactHost)
  const slot = useActionSlot()
  const { path, reference, section, file, artifact, identity, scope } = resolvePreviewTarget(
    props,
    host,
  )
  const [reportedFor, setReportedFor] = useState<string | null>(null)
  const [atEnd, setAtEnd] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const near = useNearViewport(root)
  const viewport = useRef<HTMLDivElement | null>(null)
  const room = useViewportRoom(viewport)

  const { currentHtml, error, warmLayout } = usePreviewPageLoad({
    near,
    expanded: false,
    file,
    identity,
    scope,
    artifact,
    hostVersion: host?.version,
    cache: host?.cache,
    loader: previewLoaderOf(host, task, load),
    onLeaveViewport: () => setReportedFor(null),
  })
  const hostAnnotate = host?.annotate
  const dialog = usePreviewDialogControls(error, hostAnnotate)
  const { returnFocus, expanded, openAnnotating, enlarge, startAnnotate } = dialog
  const [layout, setLayout] = useState<ArtifactLayout | null>(
    () => warmLayout ?? host?.cache?.shape(file) ?? null,
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new source page invalidates the previous page's crop coordinates
  useLayoutEffect(
    () => setLayout(host?.cache?.read(file)?.layout ?? host?.cache?.shape(file) ?? null),
    [file, identity, scope, host?.cache],
  )

  const reported = currentHtml !== null && reportedFor === currentHtml.text
  const { focused, sectionProblem, name, width, sized } = resolvePreviewMetrics({
    section,
    layout,
    reported,
    artifact,
    title,
    htmlText: currentHtml?.text,
    path,
    room,
  })
  const scrolls = !section && sized.pictureHeight > sized.shownHeight + 1
  const drawn = near && currentHtml !== null && (!section || reported)
  const open = previewOpenAction({
    onOpen,
    host,
    artifact,
    referenceScope: reference?.scope,
    file,
    section,
  })
  const canEnlarge = error === null && currentHtml !== null && (!section || focused !== null)
  const handleLayout = (next: ArtifactLayout) => {
    if (root.current?.closest("[hidden]")) return
    setLayout(next)
    if (!currentHtml) return
    setReportedFor(currentHtml.text)
    host?.cache?.layout(file, currentHtml.text, next)
  }
  const focusResolved = focused ? "true" : section ? "false" : undefined

  return (
    <div
      ref={root}
      className="dg-prv"
      data-testid="artifact-preview"
      data-file={file}
      data-focus-section={section}
      data-focus-resolved={focusResolved}
      data-mode={error !== null ? "failed" : sized.mode}
    >
      <PreviewSlotHeader
        slot={slot}
        name={name}
        title={title}
        meta={previewMetaItems(reference?.scope, artifact)}
        toCard={previewCardAction(error, enlarge, open)}
        toAnnotate={startAnnotate}
        cardDisabled={error === null && !canEnlarge}
      />
      {error !== null ? (
        <PreviewFailedNotice error={error} hasOpen={open !== null} />
      ) : (
        <ArtifactPreviewBody
          viewport={viewport}
          name={name}
          section={section}
          width={width}
          layout={layout}
          sized={sized}
          scrolls={scrolls}
          atEnd={atEnd}
          onAtEnd={setAtEnd}
          canEnlarge={canEnlarge}
          onEnlarge={enlarge}
          near={near}
          htmlText={currentHtml?.text ?? null}
          drawn={drawn}
          sectionProblem={sectionProblem}
          theme={host?.theme}
          onLayout={handleLayout}
        />
      )}
      {canEnlarge && currentHtml ? (
        <ArtifactPreviewDialog
          open={expanded}
          close={dialog.close}
          name={name}
          file={file}
          html={currentHtml.text}
          width={width}
          layout={layout}
          section={section}
          screens={props.screens}
          loadScreenHtml={previewLoaderOf(host, task, load)}
          theme={host?.theme}
          onOpen={open}
          onAnnotate={
            hostAnnotate
              ? (markdown, pins, targetFile) => hostAnnotate(targetFile ?? file, markdown, pins)
              : null
          }
          initialAnnotate={openAnnotating}
          returnFocus={returnFocus}
        />
      ) : null}
    </div>
  )
}
