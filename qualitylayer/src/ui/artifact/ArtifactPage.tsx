// The canvas owns pages and zoom. Plain clicks, drags and selections use the artifact; feedback is
// deliberate (`onMark`): the Feedback button arms one spot or area mark, and selected words offer a
// Feedback chip; the quick field opens there. A standalone viewer portals only its toolbar and
// navigation above the canvas/sidebar grid, so changing the chrome never replaces the iframe.

import { cn } from "cn"
import {
  ArrowLeftIcon,
  CheckIcon,
  Columns2Icon,
  EllipsisIcon,
  ExternalLinkIcon,
  HistoryIcon,
  Minimize2Icon,
  MonitorIcon,
  MoonIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  SlidersHorizontalIcon,
  SmartphoneIcon,
  SunIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  type Artifact,
  type ArtifactPageInfo,
  artifactMeta,
  folderArtifactOf,
} from "../../core/artifact/format.ts"
import { ArtifactExport } from "../export/ArtifactExport.tsx"
import { agoPhrase, useRoute } from "../hooks.ts"
import { appShortcut, CHORD, useCommandKeys } from "../kit/command-keys.ts"
import { LoadingState } from "../kit/LoadingState.tsx"
import { offersHostActions } from "../machines/framed.ts"
import { TaskListToggle } from "../shell/TaskListToggle.tsx"
import { Hint } from "../sidebar/Hint.tsx"
import { useArtifactViewing } from "../viewing.tsx"
import { ArtifactCanvas } from "./ArtifactCanvas.tsx"
import { FeedbackButton, FeedbackHint, SelectionChip } from "./ArtifactFeedback.tsx"
import { ArtifactManage, type ArtifactManager } from "./ArtifactManage.tsx"
import {
  type ArtifactLayout,
  type ArtifactMark,
  ArtifactPageFrame,
  CANVAS_PAD,
  fitRoom,
} from "./ArtifactPageFrame.tsx"
import { PagePicker, PICKER_WIDTH_CAP } from "./PagePicker.tsx"

/** The zoom steps − and + move through. */
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2]
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

const typingIn = (el: Element | null): boolean =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))

export function artifactSectionTargets(layout: ArtifactLayout, section: string) {
  const exact = layout.parts.filter((part) => part.id === section)
  return exact.length ? exact : layout.parts.filter((part) => part.label === section)
}

function ToolbarHost({ target, children }: { target?: HTMLElement | null; children: ReactNode }) {
  return target ? createPortal(children, target) : children
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
  // The page of a folder artifact being shown: the artifact's file when it is the entry (null).
  const [pageFile, setPageFile] = useState<string | null>(initialPage ?? null)
  const [other, setOther] = useState<{
    file: string
    html: string | null
    error: string | null
  } | null>(null)
  const [managing, setManaging] = useState(false)
  const canvas = useRef<HTMLElement | null>(null)
  const toolbar = useRef<HTMLDivElement | null>(null)
  const focusFullScreen = useRef(false)
  const requestFullScreen = (on: boolean) => {
    focusFullScreen.current = true
    onFullScreen(on)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: leaving full screen is what moves the focus
  useLayoutEffect(() => {
    if (!focusFullScreen.current) return
    focusFullScreen.current = false
    const action = toolbar.current?.querySelector<HTMLElement>(
      '[aria-label="More artifact tools"], [aria-label="Artifact actions"]',
    )
    action?.focus({ preventScroll: true })
  }, [fullScreen])
  const [toolbarRoom, setToolbarRoom] = useState(0)
  // How many view controls have moved into the "More view options" menu: device, then theme, then zoom. It
  // belongs to the measure it was taken in, so a new width, name, page or mode starts again from nothing.
  const [folded, setFolded] = useState<{ key: string; fold: number }>({ key: "", fold: 0 })
  const [room, setRoom] = useState(0)
  const [layout, setLayout] = useState<ArtifactLayout | null>(null)
  const [zoom, setZoom] = useState<"fit" | number>("fit")
  const fragment = useRef<{ x: number; y: number } | null>(null)
  const expanded = useRef(fullScreen)
  useLayoutEffect(() => {
    if (expanded.current === fullScreen) return
    expanded.current = fullScreen
    setZoom("fit")
  }, [fullScreen])
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  )
  const [viewport, setViewport] = useState<"desktop" | "phone">("desktop")
  const chooseViewport = (value: "desktop" | "phone") => {
    fragment.current = null
    setLayout(null)
    setViewport(value)
    setZoom("fit")
  }
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [linkedSection, setLinkedSection] = useState<{ file: string; section: string } | null>(null)
  // Feedback is armed for one mark; words selected on the page offer their chip.
  const [armed, setArmed] = useState(false)
  const [selection, setSelection] = useState<ArtifactMark | null>(null)
  const feedbackButton = useRef<HTMLButtonElement | null>(null)
  const disarm = useCallback((returnFocus: boolean) => {
    setArmed(false)
    if (returnFocus) feedbackButton.current?.focus({ preventScroll: true })
  }, [])

  // An artifact that is a folder has pages: the picker switches them, and so does a link inside the artifact.
  const pages: ArtifactPageInfo[] = artifact?.pages ?? []
  const paged = pages.length > 1 && loadPage !== undefined
  const entryPage = pages[0]
  const current = paged ? (pages.find((p) => p.file === pageFile) ?? entryPage) : undefined
  const onEntry = current === undefined || current.file === entryPage?.file
  const otherFile = onEntry ? null : (current?.file ?? null)
  const [otherTry, setOtherTry] = useState(0)
  const retryPage = onEntry ? onRetry : () => setOtherTry((value) => value + 1)
  const loader = useRef(loadPage)
  loader.current = loadPage
  const artifactFile = artifact?.file ?? null
  useEffect(() => {
    const file = current?.file ?? artifactFile
    if (file) onPageChange?.(file)
  }, [current?.file, artifactFile, onPageChange])
  useArtifactViewing(current?.file ?? artifactFile)
  const stamp = artifact?.updated ?? 0
  const switchPage = useCallback((file: string | null) => {
    setPageFile(file)
    setLinkedSection(null)
    setLayout(null)
  }, [])
  const shownTarget = useRef<{
    file: string
    page: string | undefined
    query: string | undefined
  } | null>(null)
  useEffect(() => {
    if (artifactFile === null) return
    const before = shownTarget.current
    if (before?.file === artifactFile && before.page === initialPage && before.query === viewQuery)
      return
    shownTarget.current = { file: artifactFile, page: initialPage, query: viewQuery }
    const target = initialPage !== undefined && initialPage !== entryPage?.file ? initialPage : null
    setPageFile(target)
    setOther((previous) =>
      before?.file === artifactFile && previous?.file === target ? previous : null,
    )
  }, [artifactFile, initialPage, entryPage?.file, viewQuery])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the page is read again when the artifact changed
  useEffect(() => {
    const load = loader.current
    if (otherFile === null || load === undefined) return
    let live = true
    setOther((previous) => (previous?.file === otherFile ? previous : null))
    load(otherFile)
      .then((page) => live && setOther({ file: otherFile, html: page, error: null }))
      .catch(
        (cause: unknown) =>
          live &&
          setOther({
            file: otherFile,
            html: null,
            error: cause instanceof Error ? cause.message : String(cause),
          }),
      )
    return () => {
      live = false
    }
  }, [artifactFile, otherFile, stamp, artifact?.revision, otherTry])
  const shown = onEntry ? { html, error } : otherFile === other?.file ? other : null
  const pageHtml = shown === null ? null : shown.html
  const pageError = shown === null ? null : shown.error
  // biome-ignore lint/correctness/useExhaustiveDependencies: another page, source revision or query releases the earlier fragment before paint
  useLayoutEffect(() => {
    fragment.current = null
  }, [artifactFile, current?.file, pageHtml, artifact?.revision, viewQuery])
  const shownFile = current?.file ?? artifactFile
  // biome-ignore lint/correctness/useExhaustiveDependencies: corrected source or another page clears its previous runtime failure
  useEffect(() => {
    setRuntimeError(null)
  }, [pageHtml])
  useLayoutEffect(() => {
    const el = canvas.current
    if (overview || el === null) return
    const bar =
      toolbarHost && !fullScreen
        ? toolbarHost.querySelector<HTMLElement>('[role="toolbar"]')
        : toolbar.current
    const measure = () => {
      setRoom(el.clientWidth)
      setToolbarRoom(bar?.clientWidth ?? 0)
    }
    measure()
    if (typeof ResizeObserver === "undefined") return
    const watcher = new ResizeObserver(measure)
    watcher.observe(el)
    if (bar) watcher.observe(bar)
    return () => watcher.disconnect()
  }, [overview, toolbarHost, fullScreen])

  const declaredWidth = useMemo(
    () => (pageHtml === null ? null : artifactMeta(pageHtml).width),
    [pageHtml],
  )
  const base = viewport === "phone" ? 390 : (declaredWidth ?? artifact?.width ?? DEFAULT_WIDTH)
  // The page is laid out at its own width, or wider when it draws wider than that.
  const width = viewport === "phone" ? base : Math.max(base, Math.min(layout?.width ?? 0, 8_000))
  const height = layout?.height ?? 900
  // The page is a card on the dotted canvas, so Fit leaves the canvas' margin on both sides of it.
  const fit =
    room > 0
      ? viewport === "phone"
        ? Math.min(1, fitRoom(room) / width)
        : fitRoom(room) / width
      : 1
  const scale = zoom === "fit" ? fit : zoom
  // A width that is still settling (the side panel closing as the artifact opens) changes the fit scale
  // while the reader or a link inside the page has already scrolled: the same place of the page stays in
  // view, not the same pixel offset of the old scale. The place is read while the DOM still has the old
  // size, because the browser clamps the offset once the stage shrinks.
  const place = useRef({ scale, top: 0, left: 0, moved: false })
  if (place.current.scale !== scale) {
    const el = canvas.current
    place.current = {
      scale,
      top: el ? Math.max(0, el.scrollTop - CANVAS_PAD) / place.current.scale : 0,
      left: el ? Math.max(0, el.scrollLeft - CANVAS_PAD) / place.current.scale : 0,
      moved: true,
    }
  }
  useLayoutEffect(() => {
    const el = canvas.current
    const at = place.current
    if (!at.moved) return
    at.moved = false
    if (!el) return
    if (zoom === "fit" && fragment.current !== null) {
      el.scrollTo?.({ left: fragment.current.x * scale, top: fragment.current.y * scale })
      return
    }
    if (at.top > 0) el.scrollTop = at.top * at.scale + CANVAS_PAD
    if (at.left > 0) el.scrollLeft = at.left * at.scale + CANVAS_PAD
  })
  const jumpedSection = useRef<string | null>(null)
  const focusedSection =
    linkedSection?.file === (current?.file ?? artifactFile) ? linkedSection.section : section
  const sectionKey = `${artifactFile}:${current?.file ?? ""}:${focusedSection ?? ""}`
  const sectionTargets =
    focusedSection === undefined ? [] : layout ? artifactSectionTargets(layout, focusedSection) : []
  const sectionProblem =
    focusedSection !== undefined && layout !== null && sectionTargets.length !== 1
      ? sectionTargets.length > 1
        ? `More than one section matches “${focusedSection}”. Ask the agent for an exact section id.`
        : `Section “${focusedSection}” is not in this page. Ask the agent to check the page and section.`
      : null
  useEffect(() => {
    if (!focusedSection || !layout || !pageHtml || jumpedSection.current === sectionKey) return
    const matches = artifactSectionTargets(layout, focusedSection)
    if (matches.length !== 1) return
    const target = matches[0]
    // A page's first report can come before its styles apply, with the section still 0×0 at the top:
    // wait for the report that places it, or the one jump would land on the page's top.
    if (!target || target.width <= 0 || target.height <= 0) return
    fragment.current = { x: target.left, y: target.top }
    canvas.current?.scrollTo?.({ left: target.left * scale, top: target.top * scale })
    jumpedSection.current = sectionKey
  }, [focusedSection, sectionKey, layout, pageHtml, scale])
  const openInBrowser = () => {
    const top = Math.max(0, (canvas.current?.scrollTop ?? 0) - CANVAS_PAD) / scale
    const part = layout?.parts
      .filter((part) => part.top <= top + 16)
      .sort((a, b) => b.top - a.top)[0]
    onOpenBrowser({
      file: current?.file ?? artifactFile ?? undefined,
      section: part?.id ?? focusedSection,
    })
  }
  const step = (by: 1 | -1) => {
    fragment.current = null
    const now = scale
    const next =
      by > 0
        ? STEPS.find((s) => s > now + 0.001)
        : [...STEPS].reverse().find((s) => s < now - 0.001)
    setZoom(next ?? now)
  }

  // The keys read this render's state through a ref: the listener is set once.
  const now = useRef({ fullScreen, onFullScreen, step, armed, disarm })
  now.current = { fullScreen, onFullScreen, step, armed, disarm }
  const key = useCallback((pressed: string) => {
    const at = now.current
    const el = canvas.current
    if (
      el &&
      [
        "PageDown",
        "PageUp",
        "ArrowDown",
        "ArrowUp",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
      ].includes(pressed)
    ) {
      fragment.current = null
      if (pressed === "Home" || pressed === "End")
        el.scrollTo?.({ top: pressed === "Home" ? 0 : el.scrollHeight - el.clientHeight })
      else
        el.scrollBy?.({
          top:
            pressed === "PageDown"
              ? el.clientHeight * 0.85
              : pressed === "PageUp"
                ? -el.clientHeight * 0.85
                : pressed === "ArrowDown"
                  ? 40
                  : pressed === "ArrowUp"
                    ? -40
                    : 0,
          left: pressed === "ArrowRight" ? 40 : pressed === "ArrowLeft" ? -40 : 0,
        })
    } else if (pressed === "Escape") {
      // Escape leaves armed Feedback first, and only then full screen.
      if (at.armed) at.disarm(true)
      else if (at.fullScreen) at.onFullScreen(false)
    } else if (pressed === "f" || pressed === "F") {
      at.onFullScreen(!at.fullScreen)
    } else if (pressed === "+" || pressed === "=") at.step(1)
    else if (pressed === "-") at.step(-1)
    else if (pressed === "0") {
      fragment.current = null
      setZoom("fit")
    }
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (typingIn(document.activeElement)) return
      if (
        document.querySelector(
          '[role="dialog"][data-open], [role="menu"], [data-slot="select-positioner"][data-open]',
        ) !== null
      )
        return
      if (
        ![
          "f",
          "F",
          "Escape",
          "+",
          "=",
          "-",
          "0",
          "PageDown",
          "PageUp",
          "ArrowDown",
          "ArrowUp",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
        ].includes(event.key)
      )
        return
      if (
        [
          "PageDown",
          "PageUp",
          "ArrowDown",
          "ArrowUp",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
        ].includes(event.key) &&
        !canvas.current?.contains(document.activeElement)
      )
        return
      event.preventDefault()
      key(event.key)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [key])

  useCommandKeys({ sidebar: fullScreen ? undefined : rail?.onToggle })

  // A mark names the page it was made on (a page after the first by its name) and its source.
  const mark =
    onMark !== undefined && !readOnly && pageHtml !== null
      ? (said: ArtifactMark) =>
          onMark({
            ...said,
            file: shownFile,
            html: pageHtml,
            ...(paged && !onEntry && current !== undefined ? { page: current.page } : {}),
          })
      : undefined
  const marks = mark !== undefined
  // A new page, a reload or marks no longer offered end armed Feedback and drop a stale chip.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these changes are what reset it
  useEffect(() => {
    setArmed(false)
    setSelection(null)
  }, [shownFile, reload, marks])

  // Source and History work on the file being shown: a page of a folder artifact is a file of its own.
  const pageManager: ArtifactManager | undefined =
    manager !== undefined && paged && current !== undefined && artifact !== null
      ? {
          ...manager,
          file: current.file,
          onChanged: (next, deleted) => {
            const folderOf = (file: string) => file.slice(0, file.lastIndexOf("/"))
            if (folderArtifactOf(next) !== null && folderOf(next) === folderOf(artifact.file)) {
              // A page of this artifact changed (or went): the artifact is read again, and shown on.
              if (deleted) switchPage(null)
              manager.onChanged(artifact.file)
            } else manager.onChanged(next, deleted)
          },
        }
      : manager

  const updated =
    artifact !== null && artifact.updated > 0 ? `Updated ${agoPhrase(artifact.updated)}` : ""
  const barRoom = toolbarRoom || room
  // Below this container width the labels give way to their icons.
  const narrow = compact || (barRoom > 0 && barRoom < 1100)
  // Fold one view group per pass while the artifact's or the page's name is cut or the bar overflows. Only
  // the observers' changes start a measure; nothing polls.
  const foldKey = `${toolbarRoom}|${title}|${current?.file ?? ""}|${fullScreen}|${narrow}|${share !== undefined && share !== null}|${agent !== undefined && agent !== null}`
  const fold = barRoom > 0 && barRoom <= 480 ? 3 : folded.key === foldKey ? folded.fold : 0
  useLayoutEffect(() => {
    const bar = toolbar.current
    if (bar === null || fold >= 3) return
    // A page name cut only by the picker's own width cap is not short of room.
    const cut = Array.from(bar.querySelectorAll<HTMLElement>(".ds-name, .dg-pp-nm, .nm")).some(
      (el) =>
        el.scrollWidth > el.clientWidth + 1 &&
        (el.closest(".dg-pp")?.getBoundingClientRect().width ?? 0) < PICKER_WIDTH_CAP - 1,
    )
    if (cut || bar.scrollWidth > bar.clientWidth + 1) setFolded({ key: foldKey, fold: fold + 1 })
  }, [fold, foldKey])
  const backLabel = back.label.startsWith("Back to ") ? back.label : `Back to ${back.label}`
  const railWhat = rail?.what ?? "Files"

  const menuButton =
    menu === null ? null : (
      <TaskListToggle look="artifact" compact={menu.compact} onOpen={menu.onOpen} />
    )

  const toolItems = (
    <>
      {moreItems}
      {pageManager?.api.artifactMutate ? (
        <DropdownMenuItem onClick={() => setManaging((was) => !was)}>
          <HistoryIcon aria-hidden="true" />
          Source and history
        </DropdownMenuItem>
      ) : null}
      {collection ? (
        <DropdownMenuItem onClick={() => setOverview(true)}>
          <Columns2Icon aria-hidden="true" />
          Compare artboards
        </DropdownMenuItem>
      ) : null}
      {/* On a machine's framed page this would open a browser on that machine's own screen. */}
      {offersHostActions() ? (
        <DropdownMenuItem onClick={openInBrowser}>
          <ExternalLinkIcon aria-hidden="true" />
          Open in browser
        </DropdownMenuItem>
      ) : null}
      {updated || status ? (
        <>
          <DropdownMenuSeparator />
          <div className="grid gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            {updated}
            {status}
          </div>
        </>
      ) : null}
    </>
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="artifact-page">
      {collection && overview ? (
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
      ) : (
        <>
          <ToolbarHost target={fullScreen ? null : toolbarHost}>
            <div
              ref={toolbar}
              className={cn(
                "dg-bar",
                "tools",
                toolbarHost !== undefined && "unified",
                compact && "compact",
                narrow && "narrow",
              )}
              role="toolbar"
              aria-label="Artifact"
              data-testid={header !== undefined && !fullScreen ? "artifact-header" : undefined}
            >
              {fullScreen ? null : menuButton}
              <button
                type="button"
                className={cn("back", back.labelled && "labelled")}
                onClick={back.onClick}
                aria-label={backLabel}
                title={backLabel}
              >
                <ArrowLeftIcon aria-hidden="true" />
                {back.labelled ? backLabel : null}
              </button>
              <div className="dg-heading">
                {header !== undefined && !fullScreen ? (
                  header
                ) : (
                  <span
                    className="nm"
                    title={updated ? `${title} · ${updated}` : title}
                    data-testid="artifact-name"
                  >
                    {title}
                  </span>
                )}
                {paged && current !== undefined ? (
                  <PagePicker
                    pages={pages.map((p) => ({
                      key: p.file,
                      label: p.title,
                      mark: pageMarks?.[p.page],
                      group: p.group,
                      groupFolded: p.groupFolded,
                    }))}
                    value={current.file}
                    onPick={(file) => switchPage(file === entryPage?.file ? null : file)}
                  />
                ) : null}
                {relation}
              </div>
              {fold < 3 ? (
                <fieldset className="dg-zoom" aria-label="Zoom">
                  <Hint label="Zoom out · −">
                    <button
                      type="button"
                      className="dg-t"
                      aria-label="Zoom out"
                      onClick={() => step(-1)}
                    >
                      <ZoomOutIcon aria-hidden="true" />
                    </button>
                  </Hint>
                  <Hint label="Fit the width · 0">
                    <button
                      type="button"
                      className="dg-t pct"
                      aria-label={
                        zoom === "fit"
                          ? "Fit the width"
                          : `${Math.round(scale * 100)} %, fit the width`
                      }
                      data-testid="artifact-zoom"
                      onClick={() => {
                        fragment.current = null
                        setZoom("fit")
                      }}
                    >
                      {zoom === "fit" ? "Fit" : `${Math.round(scale * 100)}%`}
                    </button>
                  </Hint>
                  <Hint label="Zoom in · +">
                    <button
                      type="button"
                      className="dg-t"
                      aria-label="Zoom in"
                      onClick={() => step(1)}
                    >
                      <ZoomInIcon aria-hidden="true" />
                    </button>
                  </Hint>
                </fieldset>
              ) : null}
              {fold < 2 ? (
                <fieldset className="dg-zoom" aria-label="Theme">
                  {(
                    [
                      ["light", "Light", SunIcon],
                      ["dark", "Dark", MoonIcon],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <Hint key={value} label={label}>
                      <button
                        type="button"
                        className="dg-t"
                        aria-label={label}
                        aria-pressed={theme === value}
                        onClick={() => setTheme(value)}
                      >
                        <Icon aria-hidden="true" />
                      </button>
                    </Hint>
                  ))}
                </fieldset>
              ) : null}
              {fold < 1 ? (
                <fieldset className="dg-zoom" aria-label="Device">
                  {(
                    [
                      ["desktop", "Desktop", MonitorIcon],
                      ["phone", "Phone", SmartphoneIcon],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <Hint key={value} label={label}>
                      <button
                        type="button"
                        className="dg-t"
                        aria-label={label}
                        aria-pressed={viewport === value}
                        onClick={() => chooseViewport(value)}
                      >
                        <Icon aria-hidden="true" />
                      </button>
                    </Hint>
                  ))}
                </fieldset>
              ) : null}
              {fold > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        className="dg-t"
                        aria-label="More view options"
                        title="More view options"
                        data-testid="artifact-view-options"
                      />
                    }
                  >
                    <SlidersHorizontalIcon aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {fold >= 3 ? (
                      <>
                        <DropdownMenuItem onClick={() => step(1)}>
                          Zoom in <span className="dg-kh">+</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => step(-1)}>
                          Zoom out <span className="dg-kh">−</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          role="menuitemradio"
                          aria-checked={zoom === "fit"}
                          onClick={() => {
                            fragment.current = null
                            setZoom("fit")
                          }}
                        >
                          Fit the width <span className="dg-kh">0</span>
                          {zoom === "fit" ? <CheckIcon aria-hidden="true" /> : null}
                        </DropdownMenuItem>
                      </>
                    ) : null}
                    {fold >= 2 ? (
                      <>
                        {fold >= 3 ? <DropdownMenuSeparator /> : null}
                        {(["light", "dark"] as const).map((value) => (
                          <DropdownMenuItem
                            key={value}
                            role="menuitemradio"
                            aria-checked={theme === value}
                            onClick={() => setTheme(value)}
                          >
                            {value === "light" ? (
                              <SunIcon aria-hidden="true" />
                            ) : (
                              <MoonIcon aria-hidden="true" />
                            )}
                            {value === "light" ? "Light" : "Dark"}
                            {theme === value ? (
                              <CheckIcon aria-hidden="true" className="ml-auto" />
                            ) : null}
                          </DropdownMenuItem>
                        ))}
                      </>
                    ) : null}
                    <>
                      {fold >= 2 ? <DropdownMenuSeparator /> : null}
                      {(["desktop", "phone"] as const).map((value) => (
                        <DropdownMenuItem
                          key={value}
                          role="menuitemradio"
                          aria-checked={viewport === value}
                          onClick={() => chooseViewport(value)}
                        >
                          {value === "desktop" ? (
                            <MonitorIcon aria-hidden="true" />
                          ) : (
                            <SmartphoneIcon aria-hidden="true" />
                          )}
                          {value === "desktop" ? "Desktop" : "Phone"}
                          {viewport === value ? (
                            <CheckIcon aria-hidden="true" className="ml-auto" />
                          ) : null}
                        </DropdownMenuItem>
                      ))}
                    </>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              <span className="dg-vs" aria-hidden="true" />
              {/* One order on every header: agent, labelled actions, More, Archive and Delete. */}
              {rail === undefined ? agent : null}
              {share ? <span className="dg-share-slot">{share}</span> : null}
              <span className="dg-mark-tools">
                {mark !== undefined ? (
                  <FeedbackButton
                    ref={feedbackButton}
                    armed={armed}
                    labelled={!narrow}
                    onToggle={() => {
                      setSelection(null)
                      setArmed((was) => !was)
                    }}
                  />
                ) : null}
                <ArtifactExport
                  api={manager?.api}
                  artifact={artifact}
                  title={title}
                  html={pageHtml}
                  pages={pages}
                  currentFile={shownFile}
                  loadPage={loadPage}
                />
              </span>
              {actions && header !== undefined && !fullScreen ? (
                actions(toolItems)
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        className="dg-t"
                        aria-label="More artifact tools"
                        title="More artifact tools"
                      />
                    }
                  >
                    <EllipsisIcon aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">{toolItems}</DropdownMenuContent>
                </DropdownMenu>
              )}
              {fullScreen ? (
                <Hint label="Leave full screen · Esc">
                  <button
                    type="button"
                    className="dg-t"
                    aria-label="Leave full screen"
                    onClick={() => requestFullScreen(false)}
                  >
                    <Minimize2Icon aria-hidden="true" />
                  </button>
                </Hint>
              ) : null}
              {fullScreen || rail === undefined ? null : (
                <>
                  <span className="dg-vs" aria-hidden="true" />
                  <Hint
                    label={appShortcut(
                      rail.open
                        ? `Hide ${railWhat} · Esc`
                        : `${railWhat.charAt(0).toUpperCase()}${railWhat.slice(1)}`,
                      CHORD.sidebar,
                    )}
                  >
                    <button
                      type="button"
                      className="rs-hb show"
                      aria-label={rail.open ? `Hide ${railWhat}` : `Show ${railWhat}`}
                      data-testid={rail.open ? "artifact-rail-close" : "sidebar-button"}
                      onClick={rail.onToggle}
                    >
                      {rail.open ? (
                        <PanelRightCloseIcon aria-hidden="true" />
                      ) : (
                        <PanelRightOpenIcon aria-hidden="true" />
                      )}
                    </button>
                  </Hint>
                </>
              )}
            </div>
            {notice}
          </ToolbarHost>
          {sectionProblem ? (
            <p className="dg-note" role="status">
              {sectionProblem}
            </p>
          ) : null}
          <div className={cn("dm-workspace flex min-h-0 flex-1", armed && "dg-workspace-armed")}>
            {armed && mark !== undefined ? <FeedbackHint onCancel={() => disarm(true)} /> : null}
            {selection !== null && mark !== undefined && !armed ? (
              <SelectionChip
                selection={selection}
                onMark={(words) => {
                  setSelection(null)
                  mark(words)
                }}
              />
            ) : null}
            <section
              ref={canvas}
              className={cn("dg-cvs min-w-0 flex-1", armed && "armed")}
              onScroll={() => setSelection(null)}
              data-testid="artifact-canvas"
              data-scale={scale}
              onWheelCapture={() => {
                fragment.current = null
              }}
              onPointerDownCapture={() => {
                fragment.current = null
              }}
              aria-label={`Artifact preview: ${title}`}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: the overflow region accepts keyboard scrolling
              tabIndex={0}
            >
              {pageError !== null ? (
                <LoadingState
                  kind="artifact"
                  what="Drawing"
                  error={new Error(pageError)}
                  failedTitle="This page didn't load"
                  onRetry={retryPage}
                  back={back}
                />
              ) : null}
              {runtimeError !== null ? (
                <div className="dg-note" role="alert">
                  <p>The artifact's script failed: {runtimeError}</p>
                  <button
                    type="button"
                    className="q-btn sm"
                    onClick={() => {
                      setRuntimeError(null)
                      setReload((value) => value + 1)
                    }}
                  >
                    Reload artifact
                  </button>
                </div>
              ) : null}
              {pageHtml === null && pageError === null ? (
                <LoadingState
                  kind="artifact"
                  what={`Drawing ${current?.title ?? title}`}
                  back={back}
                />
              ) : null}
              {pageHtml !== null ? (
                <div className="dg-stage" style={{ width: width * scale, height: height * scale }}>
                  <ArtifactPageFrame
                    query={viewQuery}
                    key={reload}
                    html={pageHtml}
                    title={title}
                    className="dg-frame"
                    width={width}
                    height={height}
                    scale={scale}
                    theme={theme}
                    {...(mark
                      ? {
                          armed,
                          onMark: (said: ArtifactMark) => {
                            disarm(false)
                            mark(said)
                          },
                          onSelection: setSelection,
                        }
                      : {})}
                    onLayout={setLayout}
                    onRuntimeError={setRuntimeError}
                    onPage={(name, targetSection) => {
                      const target = paged ? pages.find((p) => p.page === name) : undefined
                      if (target !== undefined) {
                        switchPage(target === entryPage ? null : target.file)
                        if (targetSection)
                          setLinkedSection({ file: target.file, section: targetSection })
                      }
                    }}
                    onKey={key}
                    onAnchor={({ x, y }) => {
                      fragment.current = { x, y }
                      canvas.current?.scrollTo?.({ left: x * scale, top: y * scale })
                    }}
                    onScroll={({ x, y, unit }) => {
                      fragment.current = null
                      const el = canvas.current
                      if (!el) return
                      el.scrollBy?.({
                        left:
                          x *
                          (unit === 1 ? 16 : unit === 2 ? el.clientWidth : unit === 3 ? scale : 1),
                        top:
                          y *
                          (unit === 1 ? 16 : unit === 2 ? el.clientHeight : unit === 3 ? scale : 1),
                      })
                    }}
                  />
                </div>
              ) : null}
            </section>
            {pageManager && managing ? (
              <ArtifactManage
                key={pageManager.file}
                manager={pageManager}
                onClose={() => setManaging(false)}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
