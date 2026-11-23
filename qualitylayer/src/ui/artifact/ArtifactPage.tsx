// The canvas owns pages and zoom. Plain clicks, drags and selections use the artifact; feedback is
// deliberate (`onMark`): the Feedback button arms one spot or area mark, and selected words offer a
// Feedback chip; the quick field opens there. A standalone viewer portals only its toolbar and
// navigation above the canvas/sidebar grid, so changing the chrome never replaces the iframe.

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { type Artifact, artifactMeta } from "../../core/artifact/format.ts"
import { agoPhrase, useRoute } from "../hooks.ts"
import { useCommandKeys } from "../kit/command-keys.ts"
import { ArtifactCanvas } from "./ArtifactCanvas.tsx"
import type { ArtifactManager } from "./ArtifactManage.tsx"
import { ArtifactPageCanvas } from "./ArtifactPageCanvas.tsx"
import {
  type ArtifactLayout,
  type ArtifactMark,
  CANVAS_PAD,
  fitRoom,
} from "./ArtifactPageFrame.tsx"
import { ArtifactPageToolbar } from "./ArtifactPageToolbar.tsx"
import { useFolderPageState } from "./artifact-folder-page.ts"
import {
  artifactSectionTargets,
  useCanvasMeasurements,
  useFocusedSectionJump,
  useScaleScrollSync,
  useToolbarFold,
} from "./artifact-page-hooks.ts"
import { nextZoomStep, useArtifactPageKeys } from "./artifact-page-keys.ts"

export { artifactSectionTargets }

/** The width an artifact is drawn at when it names none. */
export const DEFAULT_WIDTH = 1280

/** A mark on the page being shown: its file (a folder artifact's page), its page name and source. */
export type ArtifactPageMark = ArtifactMark & {
  file: string | null
  page?: string
  /** The page as it was drawn when marked; its hash is the revision the agent is told. */
  html: string
}

type Props = {
  title: string
  artifact: Artifact | null
  /** The page with the App's bridge in it; null while it loads. */
  html: string | null
  error?: string | null
  /** A spot or area marked with Feedback, or words marked from their chip; absent when read-only. */
  onMark?: (mark: ArtifactPageMark) => void
  /** `labelled`: a task's artifact leads its bar with the words "Back to the Plan", not only the arrow. */
  back: { label: string; onClick: () => void; labelled?: boolean }
  /** After the title: what a task's draft builds on (its Draft mark and the Library artifact), once. */
  relation?: ReactNode
  /** The compact status pill; Home's artifacts have none. */
  status?: ReactNode
  /** The artifact's agent: the chip that opens its conversation. */
  agent?: ReactNode
  /** The Share control after the agent: Share, Shared, or Shared with newer edits waiting. */
  share?: ReactNode
  onOpenBrowser: (location: { file?: string; section?: string }) => void
  /** The right sidebar's button in the bar; a task's artifact has the shell header's instead. */
  rail?: { open: boolean; onToggle: () => void; what?: string }
  fullScreen: boolean
  onFullScreen: (on: boolean) => void
  /** The left sidebar is hidden: the bar brings it back (Menu in a narrow window). */
  menu?: { compact: boolean; onOpen: () => void } | null
  /** A narrow window: the bar wraps onto two rows. */
  compact?: boolean
  readOnly?: boolean
  collection?: {
    artifacts: Artifact[]
    load: (file: string) => Promise<string>
    onOpen: (artifact: Artifact) => void
  }
  manager?: ArtifactManager
  /**
   * The page of a folder artifact (its file as `artifact.pages` names it), as the bridge-ready HTML. A
   * artifact with more than one page shows the page picker and switches on a link inside the artifact.
   */
  loadPage?: (file: string) => Promise<string>
  /** A lasting artifact's identity, within the shared toolbar. */
  header?: ReactNode
  /** The Artifacts shell owns this stable slot above both canvas and sidebar. */
  toolbarHost?: HTMLElement | null
  /** Combine Library management and the viewer's tools in one menu. */
  actions?: (tools: ReactNode) => ReactNode
  notice?: ReactNode
  /** A mark after a page's title in the page picker, by the page's file name (`settings.html`): a task changes it. */
  pageMarks?: Record<string, ReactNode>
  /** Items at the top of the ⋯ menu. */
  moreItems?: ReactNode
  /** Read the entry page again after it failed to load. */
  onRetry?: () => void
  /** The page (as `artifact.pages` names its file) the artifact opens on; the entry when absent. */
  initialPage?: string
  /** Exact id or data-screen-label requested by an agent's link. */
  section?: string
  /** The actual selected page, including navigation inside the preview. */
  onPageChange?: (file: string) => void
}

function initialThemeMode(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark")
    ? "dark"
    : "light"
}

function computeCanvasMetrics(args: {
  viewport: "desktop" | "phone"
  declaredWidth: number | null
  artifactWidth: number | null | undefined
  layout: ArtifactLayout | null
  room: number
  zoom: "fit" | number
}) {
  const { viewport, declaredWidth, artifactWidth, layout, room, zoom } = args
  const base = viewport === "phone" ? 390 : (declaredWidth ?? artifactWidth ?? DEFAULT_WIDTH)
  const width = viewport === "phone" ? base : Math.max(base, Math.min(layout?.width ?? 0, 8_000))
  const height = layout?.height ?? 900
  const fit =
    room > 0
      ? viewport === "phone"
        ? Math.min(1, fitRoom(room) / width)
        : fitRoom(room) / width
      : 1
  return { width, height, scale: zoom === "fit" ? fit : zoom }
}

function useFullScreenSync(
  fullScreen: boolean,
  toolbar: RefObject<HTMLDivElement | null>,
  onFullScreen: (on: boolean) => void,
  onFitZoom: () => void,
) {
  const focusFullScreen = useRef(false)
  const expanded = useRef(fullScreen)
  // biome-ignore lint/correctness/useExhaustiveDependencies: leaving full screen is what moves the focus
  useLayoutEffect(() => {
    if (focusFullScreen.current) {
      focusFullScreen.current = false
      const action = toolbar.current?.querySelector<HTMLElement>(
        '[aria-label="More artifact tools"], [aria-label="Artifact actions"]',
      )
      action?.focus({ preventScroll: true })
    }
    if (expanded.current !== fullScreen) {
      expanded.current = fullScreen
      onFitZoom()
    }
  }, [fullScreen, toolbar])
  return (on: boolean) => {
    focusFullScreen.current = true
    onFullScreen(on)
  }
}

function makeMarkHandler(args: {
  onMark: Props["onMark"]
  readOnly: boolean
  pageHtml: string | null
  shownFile: string | null
  paged: boolean
  onEntry: boolean
  currentPage: string | undefined
}): ((said: ArtifactMark) => void) | undefined {
  const { onMark, readOnly, pageHtml, shownFile, paged, onEntry, currentPage } = args
  if (onMark === undefined || readOnly || pageHtml === null) return undefined
  return (said) =>
    onMark({
      ...said,
      file: shownFile,
      html: pageHtml,
      ...(paged && !onEntry && currentPage !== undefined ? { page: currentPage } : {}),
    })
}

export function ArtifactPage({
  title,
  artifact,
  html,
  error = null,
  onMark,
  back,
  relation,
  status,
  agent,
  share,
  onOpenBrowser,
  rail,
  fullScreen,
  onFullScreen,
  menu = null,
  compact = false,
  readOnly = false,
  collection,
  manager,
  loadPage,
  header,
  toolbarHost,
  actions,
  notice,
  pageMarks,
  moreItems,
  initialPage,
  onRetry,
  section,
  onPageChange,
}: Props) {
  const [route] = useRoute()
  const viewQuery = route.view === "artifact" || route.view === "task" ? route.query : undefined
  const [overview, setOverview] = useState(false)
  const [managing, setManaging] = useState(false)
  const canvas = useRef<HTMLElement | null>(null)
  const toolbar = useRef<HTMLDivElement | null>(null)
  const [layout, setLayout] = useState<ArtifactLayout | null>(null)
  const [zoom, setZoom] = useState<"fit" | number>("fit")
  const fragment = useRef<{ x: number; y: number } | null>(null)
  const requestFullScreen = useFullScreenSync(fullScreen, toolbar, onFullScreen, () =>
    setZoom("fit"),
  )
  const [theme, setTheme] = useState<"light" | "dark">(initialThemeMode)
  const [viewport, setViewport] = useState<"desktop" | "phone">("desktop")
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [armed, setArmed] = useState(false)
  const [selection, setSelection] = useState<ArtifactMark | null>(null)
  const feedbackButton = useRef<HTMLButtonElement | null>(null)
  const disarm = useCallback((returnFocus: boolean) => {
    setArmed(false)
    if (returnFocus) feedbackButton.current?.focus({ preventScroll: true })
  }, [])
  const resetLayout = useCallback(() => setLayout(null), [])

  const folder = useFolderPageState({
    artifact,
    html,
    error,
    initialPage,
    viewQuery,
    loadPage,
    onRetry,
    onPageChange,
    manager,
    onResetLayout: resetLayout,
  })
  // biome-ignore lint/correctness/useExhaustiveDependencies: another page, source revision or query releases the earlier fragment before paint
  useLayoutEffect(() => {
    fragment.current = null
  }, [folder.artifactFile, folder.current?.file, folder.pageHtml, artifact?.revision, viewQuery])
  // biome-ignore lint/correctness/useExhaustiveDependencies: corrected source or another page clears its previous runtime failure
  useEffect(() => {
    setRuntimeError(null)
  }, [folder.pageHtml])

  const { room, toolbarRoom } = useCanvasMeasurements({
    canvas,
    toolbar,
    overview,
    toolbarHost,
    fullScreen,
  })
  const declaredWidth = useMemo(
    () => (folder.pageHtml === null ? null : artifactMeta(folder.pageHtml).width),
    [folder.pageHtml],
  )
  const { width, height, scale } = computeCanvasMetrics({
    viewport,
    declaredWidth,
    artifactWidth: artifact?.width,
    layout,
    room,
    zoom,
  })
  useScaleScrollSync(canvas, fragment, zoom, scale)

  const focusedSection =
    folder.linkedSection?.file === folder.shownFile ? folder.linkedSection.section : section
  const sectionProblem = useFocusedSectionJump({
    canvas,
    fragment,
    artifactFile: folder.artifactFile,
    currentFile: folder.current?.file,
    focusedSection,
    layout,
    pageHtml: folder.pageHtml,
    scale,
  })
  const openInBrowser = () => {
    const top = Math.max(0, (canvas.current?.scrollTop ?? 0) - CANVAS_PAD) / scale
    const part = layout?.parts
      .filter((entry) => entry.top <= top + 16)
      .sort((a, b) => b.top - a.top)[0]
    onOpenBrowser({ file: folder.shownFile ?? undefined, section: part?.id ?? focusedSection })
  }
  const step = (by: 1 | -1) => {
    fragment.current = null
    setZoom(nextZoomStep(scale, by))
  }
  const resetZoom = () => {
    fragment.current = null
    setZoom("fit")
  }
  const key = useArtifactPageKeys({
    canvas,
    fragment,
    fullScreen,
    onFullScreen,
    step,
    onResetZoom: resetZoom,
    armed,
    disarm,
  })
  useCommandKeys({ sidebar: fullScreen ? undefined : rail?.onToggle })

  const mark = makeMarkHandler({
    onMark,
    readOnly,
    pageHtml: folder.pageHtml,
    shownFile: folder.shownFile,
    paged: folder.paged,
    onEntry: folder.onEntry,
    currentPage: folder.current?.page,
  })
  const marks = mark !== undefined
  // biome-ignore lint/correctness/useExhaustiveDependencies: these changes are what reset it
  useEffect(() => {
    setArmed(false)
    setSelection(null)
  }, [folder.shownFile, reload, marks])

  const updated =
    artifact !== null && artifact.updated > 0 ? `Updated ${agoPhrase(artifact.updated)}` : ""
  const barRoom = toolbarRoom || room
  const narrow = compact || (barRoom > 0 && barRoom < 1100)
  const foldKey = `${toolbarRoom}|${title}|${folder.current?.file ?? ""}|${fullScreen}|${narrow}|${Boolean(share)}|${Boolean(agent)}`
  const fold = useToolbarFold(toolbar, barRoom, foldKey)

  if (collection && overview) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="artifact-page">
        <ArtifactCanvas
          artifacts={collection.artifacts}
          current={artifact?.file ?? ""}
          load={collection.load}
          onOpen={(next) => {
            setOverview(false)
            collection.onOpen(next)
          }}
          onClose={() => setOverview(false)}
          theme={theme}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="artifact-page">
      <ArtifactPageToolbar
        toolbar={toolbar}
        toolbarHost={toolbarHost}
        fullScreen={fullScreen}
        compact={compact}
        narrow={narrow}
        header={header}
        menu={menu}
        back={back}
        title={title}
        updated={updated}
        paged={folder.paged}
        pages={folder.pages}
        current={folder.current}
        entryPage={folder.entryPage}
        pageMarks={pageMarks}
        relation={relation}
        onSwitchPage={folder.switchPage}
        fold={fold}
        zoom={zoom}
        scale={scale}
        theme={theme}
        viewport={viewport}
        onStep={step}
        onResetZoom={resetZoom}
        onTheme={setTheme}
        onViewport={(value) => {
          fragment.current = null
          setLayout(null)
          setViewport(value)
          setZoom("fit")
        }}
        rail={rail}
        agent={agent}
        share={share}
        canMark={marks}
        feedbackButton={feedbackButton}
        armed={armed}
        onToggleFeedback={() => {
          setSelection(null)
          setArmed((was) => !was)
        }}
        manager={manager}
        artifact={artifact}
        pageHtml={folder.pageHtml}
        shownFile={folder.shownFile}
        loadPage={loadPage}
        actions={actions}
        moreItems={moreItems}
        pageManager={folder.pageManager}
        hasCollection={Boolean(collection)}
        status={status}
        onToggleManage={() => setManaging((was) => !was)}
        onOpenOverview={() => setOverview(true)}
        onOpenBrowser={openInBrowser}
        onLeaveFullScreen={() => requestFullScreen(false)}
        notice={notice}
      />
      {sectionProblem ? (
        <p className="dg-note" role="status">
          {sectionProblem}
        </p>
      ) : null}
      <ArtifactPageCanvas
        canvas={canvas}
        fragment={fragment}
        armed={armed}
        mark={mark}
        selection={selection}
        onSelection={setSelection}
        disarm={disarm}
        title={title}
        current={folder.current}
        scale={scale}
        width={width}
        height={height}
        theme={theme}
        viewQuery={viewQuery}
        reload={reload}
        pageHtml={folder.pageHtml}
        pageError={folder.pageError}
        runtimeError={runtimeError}
        retryPage={folder.retryPage}
        back={back}
        onClearRuntimeError={() => {
          setRuntimeError(null)
          setReload((value) => value + 1)
        }}
        onLayout={setLayout}
        onRuntimeError={setRuntimeError}
        paged={folder.paged}
        pages={folder.pages}
        entryPage={folder.entryPage}
        onSwitchPage={folder.switchPage}
        onLinkedSection={folder.setLinkedSection}
        onKey={key}
        pageManager={folder.pageManager}
        managing={managing}
        onCloseManage={() => setManaging(false)}
      />
    </div>
  )
}
