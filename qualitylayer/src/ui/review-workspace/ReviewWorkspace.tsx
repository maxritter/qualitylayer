// The Review workspace: the change read like a pull request's Files changed, in the whole window. The
// Review page opens it (Review the code, any file in Built, slice by slice); Esc or Exit goes
// back. The tree groups the files as Built does, slice by slice. The diff viewer comes from /diffs.js
// (load.ts) and draws split or unified, coloured, with the agents' findings on their lines. A click on a
// line number, or a drag or Shift-click over several, marks those lines: the quick field opens there
// and sends the message with the lines as context to the task's session (`onMark`).
// Viewed marks are this person's, kept on this computer per task; a file whose content changed is
// unread again, even when a fix edited a line in place and the counts stayed.

import { cn } from "cn"
import { FileTextIcon, XIcon } from "lucide-react"
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { EDITOR_NAMES, type Editor } from "../../core/config-values.ts"
import type { LineFinding } from "../../core/review/findings.ts"
import { isGeneratedPath } from "../../core/review/generated.ts"
import type { WalkFile, Walkthrough as WalkthroughView } from "../../core/review/walkthrough.ts"
import type { Comment } from "../api.ts"
import { EditorMark } from "../files/EditorMark.tsx"
import { type Anchor, lineKey } from "../timeline/FilesChanged.tsx"
import { rowsOf } from "../timeline/Walkthrough.tsx"
import { ChangeDetails } from "./ChangeDetails.tsx"
import { factsOf, titlesOf, whyOf } from "./details.ts"
import { FileHeader, HEADER_PX } from "./FileHeader.tsx"
import { FindingThread } from "./FindingThread.tsx"
import { useFocusLayer } from "./focus.ts"
import { type DiffsModule, diffsViewer } from "./load.ts"
import { belongsToPart, type FilePart, fileParts, partAnchor, partFile } from "./parts.ts"
import { type MarkdownMode, ReadingControls, type ReadingMode } from "./ReadingControls.tsx"
import { ReadStatus } from "./ReadStatus.tsx"
import { type SourceLoader, SourceMarkdown, useReviewSource } from "./source.tsx"
import { Tree, treeWidth } from "./Tree.tsx"
import { changedFileOf } from "./target.ts"
import { useDiffFiles } from "./useDiffFiles.ts"
import "./workspace.css"

export type ReviewWorkspaceProps = {
  taskId: string
  title: string
  view: WalkthroughView
  /** The review decision's change requests on lines: counted on the files and the Finish button. */
  comments: readonly Comment[]
  /** The final review waits for the person: the header's button finishes the code review. */
  deciding: boolean
  loadDiff: (path: string, signal?: AbortSignal, revision?: string) => Promise<string>
  loadSource?: SourceLoader
  /**
   * Open on each file's header, in the place files open in (Settings › Git and editor). A workspace
   * whose files are not in this task's checkout, a teammate's change, has none.
   */
  open?: { editor: Editor; run: (path: string) => void }
  /** Lines marked (a line number clicked, or several dragged or Shift-clicked): the quick field opens. */
  onMark?: (mark: CodeMark) => void
  /** What the agents found on lines of the change, and what the person does with each. */
  findings?: readonly LineFinding[]
  onFinding?: (f: LineFinding, kind: "adopted" | "dismissed", reason?: string) => Promise<void>
  /** The file to open at; null opens at the first file. */
  file: string | null
  onClose: () => void
  onClearChanges?: () => Promise<void>
}

/** Lines of a file marked in the viewer, with their text and where on screen the marking ended. */
export type CodeMark = {
  path: string
  side: Anchor["side"]
  start: number
  end: number
  quote: string
  at: { x: number; y: number }
  /** Called when the quick field closes: the lines stop being marked. */
  clear: () => void
}

type Viewer = InstanceType<DiffsModule["CodeView"]>
type FileDiff = ReturnType<DiffsModule["parsePatchFiles"]>[number]["files"][number]
type Side = "additions" | "deletions"
type SelectedRange = { start: number; end: number; side?: Side; endSide?: Side }
type Slot = { key: string; el: HTMLElement }

/** The file's content stamp; a file the server could not stamp falls back to its counts. */
const stampOf = (f: WalkFile) => f.stamp ?? `${f.additions}-${f.deletions}`
const viewedKey = (taskId: string) => `ql:review-viewed:${taskId}`
const SPLIT_KEY = "ql:review-split"

function readViewed(taskId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(viewedKey(taskId)) ?? "{}") as Record<string, string>
  } catch {
    return {}
  }
}

/** The files the person reads by default: the code, without generated files and the task's documents. */
export function readableFiles(view: WalkthroughView): number {
  return filesOf(view).order.length
}

/** How many generated files the tree folds, and how many documents stand apart from the code. */
function foldCounts(view: WalkthroughView) {
  const generated = new Set<string>()
  for (const row of rowsOf(view))
    for (const f of row.files) if (isGeneratedPath(f.path)) generated.add(f.path)
  return { generated: generated.size, documents: view.documents?.length ?? 0 }
}

/** How many of the change's files this person marked viewed, unchanged since: the Review page's count. */
export function viewedCount(taskId: string, view: WalkthroughView): number {
  const marks = readViewed(taskId)
  return filesOf(view).order.filter((f) => marks[f.path] === stampOf(f)).length
}

/** A line's text as the patch shows it: what Replace with starts from and what the comment quotes. */
export function lineTextOf(diff: FileDiff | undefined, anchor: Anchor): string {
  if (diff === undefined) return ""
  const add = anchor.side === "new"
  for (const h of diff.hunks) {
    const start = add ? h.additionStart : h.deletionStart
    const count = add ? h.additionCount : h.deletionCount
    if (anchor.line < start || anchor.line >= start + count) continue
    const lines = add ? diff.additionLines : diff.deletionLines
    const index = (add ? h.additionLineIndex : h.deletionLineIndex) + anchor.line - start
    return (lines[index] ?? "").replace(/\r?\n$/, "")
  }
  return ""
}

/** A finding that needs the person: kept against its reviewer, or open, and not yet handled. */
const needsYou = (f: LineFinding) => f.state !== "fixed" && f.disposition === undefined

const darkNow = () => document.documentElement.classList.contains("dark")
const slotKey = (path: string, side: Side, line: number) => JSON.stringify([path, side, line])

/** What the tree folds away until the person asks: generated files and the task's documents. */
type Folds = { generated: boolean; documents: boolean }
const FOLDED: Folds = { generated: false, documents: false }

/** Every file once, in the order the tree lists them; the folds say what is drawn besides the code. */
function filesOf(view: WalkthroughView, folds: Folds = FOLDED) {
  const groups = rowsOf(view)
    .map((row) => ({
      ...row,
      files: folds.generated ? row.files : row.files.filter((f) => !isGeneratedPath(f.path)),
    }))
    .filter((row) => row.files.length > 0)
  const documents = view.documents ?? []
  if (folds.documents && documents.length > 0)
    groups.push({
      key: "documents",
      n: null,
      title: "The task's documents",
      summary: "",
      tasks: [],
      decisions: [],
      files: documents,
    })
  const seen = new Set<string>()
  const order: WalkFile[] = []
  for (const g of groups)
    for (const f of g.files)
      if (!seen.has(f.path)) {
        seen.add(f.path)
        order.push(f)
      }
  return { groups, order }
}

/** The keyboard way to mark lines: a line or a range typed into the file's header (10 or 10-14). */
function LineOpener({
  path,
  onOpen,
}: {
  path: string
  onOpen: (start: number, end: number, at: { x: number; y: number }) => void
}) {
  const [line, setLine] = useState("")
  const open = (from: HTMLElement) => {
    const [a, b] = line.split(/[-–]/).map(Number)
    if (a === undefined || !Number.isInteger(a) || a < 1) return
    const end = b !== undefined && Number.isInteger(b) && b >= a ? b : a
    const box = from.getBoundingClientRect()
    onOpen(a, end, { x: box.left, y: box.bottom + 6 })
    setLine("")
  }
  return (
    <span className="rw-line-open">
      <label>
        <span className="sr-only">Ask the agent about lines of {path}</span>
        <input
          inputMode="numeric"
          placeholder="Lines"
          value={line}
          onChange={(e) => setLine(e.target.value.replace(/[^\d\s–-]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              open(e.currentTarget)
            }
          }}
        />
      </label>
    </span>
  )
}

/**
 * Leaves the viewer, at the right end of the header after the viewed count. It is the header's filled
 * button unless a decision button (Finish code review, Send your review) holds that place.
 */
export function ExitButton({
  onClick,
  primary = false,
}: {
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button type="button" className={cn("rw-btn", primary && "primary")} onClick={onClick}>
      <XIcon className="size-3.5" aria-hidden="true" />
      Exit
    </button>
  )
}

/** Leave text fields and the App's keyboard chords alone. Checkboxes retain Escape navigation. */
function typingOrChord(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true
  return (
    e.target instanceof Element &&
    e.target.closest("textarea, input:not([type=checkbox]), select, [contenteditable=true]") !==
      null
  )
}

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  const { view, comments, deciding, taskId } = props
  const [folds, setFolds] = useState<Folds>(FOLDED)
  const { groups, order } = useMemo(() => filesOf(view, folds), [view, folds])
  const folded = useMemo(() => foldCounts(view), [view])
  const facts = useMemo(() => factsOf(view), [view])
  const titles = useMemo(() => titlesOf(view), [view])
  const [split, setSplit] = useState(() => localStorage.getItem(SPLIT_KEY) !== "unified")
  const [viewed, setViewed] = useState(() => readViewed(taskId))
  const [mode, setMode] = useState<ReadingMode>("diff")
  const [format, setFormat] = useState<MarkdownMode>("source")
  const target = useMemo(
    () =>
      changedFileOf(
        order.map((f) => f.path),
        props.file,
      ),
    [order, props.file],
  )
  const request = JSON.stringify([taskId, props.file])
  const [choice, setChoice] = useState<{ request: string; path: string; only: boolean } | null>(
    null,
  )
  const explicit = choice?.request === request ? choice : null
  const selected = explicit?.path ?? (props.file === null ? (order[0]?.path ?? null) : target)
  const current =
    selected !== null && order.some((file) => file.path === selected) ? selected : null
  const missing = current === null ? (explicit?.path ?? props.file) : null
  const only = mode === "file" || explicit?.only === true
  const activeOrder = useMemo(
    () => (missing !== null ? [] : only ? order.filter((file) => file.path === current) : order),
    [order, current, missing, only],
  )
  const selectedFile = order.find((file) => file.path === current)
  const allParts = useMemo(() => order.flatMap(fileParts), [order])
  const partsById = useMemo(() => new Map(allParts.map((item) => [item.id, item])), [allParts])
  const [versionChoice, setVersionChoice] = useState<{ path: string; stamp: string } | null>(null)
  const selectedParts = allParts.filter((item) => item.file.path === current)
  const selectedPart =
    selectedParts.find(
      (item) => item.file.path === versionChoice?.path && item.stamp === versionChoice.stamp,
    ) ?? selectedParts.at(-1)
  const source = useReviewSource(selectedFile, mode === "file", props.loadSource, selectedPart)
  const rendered = mode === "file" && current?.endsWith(".md") === true && format === "rendered"
  const reading = useRef({ mode, rendered, side: "additions" as Side })
  reading.current = {
    mode,
    rendered,
    side: (selectedPart?.part?.status ?? selectedFile?.status) === "D" ? "deletions" : "additions",
  }
  useLayoutEffect(() => {
    setChoice((previous) => (previous?.request === request ? previous : null))
  }, [request])
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading")
  const [slots, setSlots] = useState<readonly Slot[]>([])
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const made = useRef(new Map<string, HTMLElement>())
  const versions = useRef(new Map<string, [string, number]>())

  const isViewed = useCallback(
    (f: WalkFile) => viewed[f.path] !== undefined && viewed[f.path] === stampOf(f),
    [viewed],
  )
  const setFilesViewed = (files: readonly WalkFile[], on: boolean) =>
    setViewed((prev) => {
      const next = { ...prev }
      for (const f of files) {
        if (on) next[f.path] = stampOf(f)
        else delete next[f.path]
      }
      try {
        localStorage.setItem(viewedKey(taskId), JSON.stringify(next))
      } catch {
        // A full or blocked storage keeps the marks for this session only.
      }
      return next
    })
  const setFileViewed = (file: WalkFile, on: boolean) => setFilesViewed([file], on)

  /** The slot an annotation or a header draws into, made once and kept for React's portals. */
  const slot = useCallback((key: string) => {
    const known = made.current.get(key)
    if (known !== undefined) return known
    const el = document.createElement("div")
    el.className = key.startsWith("hdr|") ? "rw-fh-slot" : "rw-slot"
    made.current.set(key, el)
    queueMicrotask(() => setSlots([...made.current].map(([k, e]) => ({ key: k, el: e }))))
    return el
  }, [])

  // Marking lines reads this render's diff and source; the viewer's options are made once.
  const marks = useRef(props.onMark)
  marks.current = props.onMark
  const markLines = useRef<(item: FilePart, range: SelectedRange) => void>(() => {})
  // Where the pointer let go: the field opens there.
  const pointer = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const up = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener("pointerup", up, true)
    return () => window.removeEventListener("pointerup", up, true)
  }, [])

  const options = useCallback(
    (splitView: boolean) => ({
      theme: { light: "pierre-light", dark: "pierre-dark" },
      themeType: darkNow() ? ("dark" as const) : ("light" as const),
      diffStyle: splitView ? ("split" as const) : ("unified" as const),
      overflow: splitView ? ("wrap" as const) : ("scroll" as const),
      lineDiffType: "word-alt" as const,
      hunkSeparators: "line-info-basic" as const,
      stickyHeaders: true,
      lineHoverHighlight: "both" as const,
      // A line number clicked, dragged over or Shift-clicked marks lines: the quick field opens.
      enableLineSelection: marks.current !== undefined,
      onLineSelectionEnd: (range: SelectedRange | null, ctx: { item: { id: string } }) => {
        if (range === null || reading.current.rendered) return
        const item = partsById.get(ctx.item.id)
        if (item) markLines.current(item, range)
      },
      layout: { paddingTop: 12, paddingBottom: 24, gap: 12 },
      renderAnnotation: (a: { side?: Side; lineNumber: number }, ctx: { item: { id: string } }) =>
        slot(slotKey(ctx.item.id, a.side ?? reading.current.side, a.lineNumber)),
      // The whole header is ours (FileHeader): the file's line and Why it changed under it.
      itemMetrics: { diffHeaderHeight: HEADER_PX },
      renderCustomHeader: (_f: unknown, ctx: { item: { id: string } }) =>
        slot(`hdr|${ctx.item.id}`),
    }),
    [slot, partsById],
  )

  // What the one-time setup below reads when it runs: the viewer is made once per opening.
  const first = useRef({ options, split })
  first.current = { options, split }
  const parseRef = useRef<DiffsModule["parsePatchFiles"] | null>(null)

  // The viewer: fetched once, set up in the main area, told when the App's theme changes.
  useEffect(() => {
    let live = true
    let made: Viewer | null = null
    const at = first.current
    diffsViewer()
      .then(({ lib, pool }) => {
        if (!live || host.current === null) return
        made = new lib.CodeView(at.options(at.split) as never, pool)
        made.setup(host.current)
        viewer.current = made
        parseRef.current = lib.parsePatchFiles
        setState("ready")
      })
      .catch(() => {
        if (live) setState("failed")
      })
    const watch = new MutationObserver(() => {
      const now = first.current
      viewer.current?.setOptions(now.options(now.split) as never)
    })
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => {
      live = false
      watch.disconnect()
      made?.cleanUp()
      viewer.current = null
    }
  }, [])

  const diffs = useDiffFiles({
    files: activeOrder,
    current,
    parse: state === "ready" ? parseRef.current : null,
    load: props.loadDiff,
  })
  const { loaded, errors } = diffs

  useEffect(() => {
    viewer.current?.setOptions(options(split) as never)
    try {
      localStorage.setItem(SPLIT_KEY, split ? "split" : "unified")
    } catch {
      // Without storage the layout is this session's.
    }
  }, [split, options])

  const byFile = useMemo(() => {
    const map = new Map<string, Comment[]>()
    for (const c of comments)
      if (c.anchor !== undefined) map.set(c.anchor.file, [...(map.get(c.anchor.file) ?? []), c])
    return map
  }, [comments])
  const commentCounts = useMemo(
    () => new Map([...byFile].map(([path, list]) => [path, list.length])),
    [byFile],
  )
  const findingsByFile = useMemo(() => {
    const map = new Map<string, LineFinding[]>()
    for (const f of props.findings ?? []) map.set(f.file, [...(map.get(f.file) ?? []), f])
    return map
  }, [props.findings])

  // Clear an unavailable or replaced selection before paint; cached unrelated diffs stay hidden.
  useLayoutEffect(() => {
    const v = viewer.current
    if (v === null) return
    if (mode === "file") {
      const file = selectedFile
      const content = source.source
      if (!file || !content || !selectedPart || rendered) {
        v.setItems([])
        return
      }
      const side = content.side === "old" ? "deletions" : "additions"
      const annotations = new Map<number, { lineNumber: number }>()
      if (side === "additions" && selectedParts.length === 1)
        for (const finding of findingsByFile.get(file.path) ?? [])
          annotations.set(finding.line, { lineNumber: finding.line })
      const signature = JSON.stringify([content.stamp, content.side, [...annotations.keys()]])
      const previous = versions.current.get(`source:${file.path}`)
      const version =
        previous === undefined ? 1 : previous[0] === signature ? previous[1] : previous[1] + 1
      versions.current.set(`source:${file.path}`, [signature, version])
      v.setItems([
        {
          id: selectedPart.id,
          type: "file",
          file: {
            name: file.path,
            contents: content.content,
            cacheKey: JSON.stringify([taskId, file.path, content.stamp, content.side]),
          },
          annotations: [...annotations.values()],
          collapsed: false,
          version,
        },
      ] as never)
      return
    }
    const items = activeOrder.flatMap((file) =>
      fileParts(file).flatMap((item) => {
        const fileDiff = loaded.get(file.path)?.[item.index]
        if (fileDiff === undefined) return []
        const anchors = new Map<string, { side: Side; lineNumber: number }>()
        if (fileParts(file).length === 1)
          for (const f of findingsByFile.get(file.path) ?? [])
            anchors.set(lineKey(partAnchor(item, "new", f.line)), {
              side: "additions",
              lineNumber: f.line,
            })
        const annotations = [...anchors.values()]
        const collapsed = !only && isViewed(file)
        const signature = JSON.stringify([item.stamp, annotations, collapsed])
        const known = versions.current.get(item.id)
        const version = known === undefined ? 1 : known[0] === signature ? known[1] : known[1] + 1
        versions.current.set(item.id, [signature, version])
        return [{ id: item.id, type: "diff" as const, fileDiff, annotations, collapsed, version }]
      }),
    )
    v.setItems(items as never)
  }, [
    activeOrder,
    loaded,
    findingsByFile,
    isViewed,
    only,
    mode,
    selectedFile,
    selectedPart,
    selectedParts.length,
    source.source,
    rendered,
    taskId,
  ])

  // Marked lines open the quick field; they stay marked while it is open.
  markLines.current = (item, range) => {
    const onMark = marks.current
    if (!onMark) return
    const sideName =
      reading.current.mode === "file"
        ? reading.current.side
        : (range.endSide ?? range.side ?? "additions")
    const side: Anchor["side"] = sideName === "deletions" ? "old" : "new"
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    const path = item.file.path
    const text = (line: number) =>
      mode === "file" && source.source?.path === path && source.source.side === side
        ? (source.source.content.split("\n")[line - 1] ?? "")
        : lineTextOf(loaded.get(path)?.[item.index], partAnchor(item, side, line))
    const quote = Array.from({ length: Math.min(end - start + 1, 80) }, (_, i) => text(start + i))
      .join("\n")
      .trimEnd()
    onMark({
      path,
      side,
      start,
      end,
      quote,
      // Right of the line numbers, so the numbers below stay free for a Shift-click.
      at: { x: pointer.current.x + 64, y: pointer.current.y + 14 },
      clear: () => viewer.current?.clearSelectedLines(),
    })
  }

  const opened = useRef<{ request: string; path: string; preceding?: string } | null>(null)
  const userScroll = useRef(false)
  const go = useCallback(
    (path: string) => {
      if (!order.some((file) => file.path === path)) return
      userScroll.current = false
      opened.current = null
      setChoice({ request, path, only: only || missing !== null })
    },
    [order, request, only, missing],
  )

  useEffect(() => {
    if (state !== "ready") return
    const v = viewer.current
    const container = v?.getContainerElement?.()
    if (!v || !container || only) return
    const manual = () => {
      userScroll.current = true
    }
    container.addEventListener("wheel", manual, { passive: true })
    container.addEventListener("touchstart", manual, { passive: true })
    container.addEventListener("pointerdown", manual, { passive: true })
    container.addEventListener("keydown", manual, { passive: true })
    const unsubscribe = v.subscribeToScroll(() => {
      if (!userScroll.current) return
      const top = container.getBoundingClientRect().top
      const visible = v
        .getRenderedItems()
        .find((item) => item.element.getBoundingClientRect().bottom > top + HEADER_PX)
      const item = visible ? partsById.get(visible.id) : undefined
      if (!item) return
      opened.current = { request, path: item.file.path }
      setChoice({ request, path: item.file.path, only: false })
    })
    return () => {
      unsubscribe()
      container.removeEventListener("wheel", manual)
      container.removeEventListener("touchstart", manual)
      container.removeEventListener("pointerdown", manual)
      container.removeEventListener("keydown", manual)
    }
  }, [state, only, request, partsById])

  // The requested file may arrive later; a newer explicit choice remains authoritative.
  useEffect(() => {
    if (
      current === null ||
      (props.file === null && explicit === null) ||
      (mode === "diff" ? !loaded.has(current) : source.source === undefined)
    )
      return
    const preceding = JSON.stringify(
      activeOrder
        .slice(
          0,
          activeOrder.findIndex((file) => file.path === current),
        )
        .flatMap((file) => (loaded.has(file.path) ? [[file.path, stampOf(file)]] : [])),
    )
    const sameChoice = opened.current?.request === request && opened.current.path === current
    if (sameChoice && (userScroll.current || opened.current?.preceding === preceding)) return
    if (!sameChoice) userScroll.current = false
    opened.current = { request, path: current, preceding }
    viewer.current?.scrollTo({
      type: "item",
      id:
        mode === "file"
          ? (selectedPart?.id ?? current)
          : selectedFile
            ? (fileParts(selectedFile)[0]?.id ?? current)
            : current,
      align: "start",
    } as never)
  }, [
    activeOrder,
    loaded,
    current,
    request,
    explicit,
    props.file,
    mode,
    source.source,
    selectedPart,
    selectedFile,
  ])

  const close = props.onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typingOrChord(e)) return
      // The workspace covers the page: its keys come before the page's own (capture), and stop there.
      let handled = true
      if (e.key === "Escape") close()
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  })

  // Focus moves into the workspace when it opens and back to what opened it when it closes.
  const root = useFocusLayer<HTMLDivElement>()

  const read = order.filter(isViewed).length
  const unassigned = comments.filter((comment) => {
    const anchor = comment.anchor
    return anchor !== undefined && !allParts.some((item) => belongsToPart(anchor, item))
  })
  // Change requests still waiting for the decision; a question is answered on its own.
  const requests = comments.filter(
    (c) => c.source === undefined && c.delivered !== true && c.ask !== "question",
  )
  const mine = requests.length
  const filesByPath = useMemo(() => new Map(order.map((f) => [f.path, f])), [order])
  // Disagreements and open findings come first: the files that hold them, in tree order.
  const lookFirst = useMemo(
    () =>
      order.flatMap((f): [string, number][] => {
        const count = (findingsByFile.get(f.path) ?? []).filter(needsYou).length
        return count > 0 ? [[f.path, count]] : []
      }),
    [order, findingsByFile],
  )

  return createPortal(
    <div
      ref={root}
      tabIndex={-1}
      className={cn("rw", (missing !== null || only) && "rw-file-choice")}
      style={{ "--rw-tree": `${treeWidth(filesByPath.keys())}px` } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="Review the code"
      data-testid="review-workspace"
    >
      <header className="rw-top">
        <span className="rw-crumb">
          <span className="dim">{props.title}</span>
          <b>Code</b>
        </span>
        <span className="rw-sp" />
        <span className="rw-prog" data-testid="review-progress">
          {read} of {order.length} viewed
          <i aria-hidden="true">
            <b
              style={{
                width: `${order.length === 0 ? 0 : Math.round((read / order.length) * 100)}%`,
              }}
            />
          </i>
        </span>
        {deciding ? (
          <button type="button" className="rw-btn primary" onClick={close}>
            Finish code review{mine > 0 ? ` · ${mine}` : ""}
          </button>
        ) : (
          <ExitButton onClick={close} primary />
        )}
      </header>
      <ReadingControls
        index={order.findIndex((file) => file.path === current)}
        count={order.length}
        onGo={(offset) => {
          const file = order[order.findIndex((f) => f.path === current) + offset]
          if (file) go(file.path)
        }}
        only={only}
        onOnly={(value) => {
          if (current) setChoice({ request, path: current, only: value })
        }}
        mode={mode}
        onMode={(value) => {
          setMode(value)
          if (current) setChoice({ request, path: current, only: value === "file" || only })
        }}
        split={split}
        onSplit={setSplit}
        markdown={current?.endsWith(".md") === true}
        format={format}
        onFormat={setFormat}
        modified={order.find((file) => file.path === current)?.status === "M"}
      />
      <Tree
        groups={groups}
        lookFirst={lookFirst}
        files={filesByPath}
        comments={commentCounts}
        unreadable={[...errors.keys()]}
        details={
          <ChangeDetails
            scope={view.changeScope}
            comments={unassigned}
            clear={props.onClearChanges}
          />
        }
        current={current}
        isViewed={isViewed}
        onGo={go}
        onViewed={setFilesViewed}
        folds={{
          generated: {
            count: folded.generated,
            shown: folds.generated,
            toggle: () => setFolds((f) => ({ ...f, generated: !f.generated })),
          },
          documents: {
            count: folded.documents,
            shown: folds.documents,
            toggle: () => setFolds((f) => ({ ...f, documents: !f.documents })),
          },
        }}
      />
      <main className="rw-main" aria-label={mode === "diff" ? "Diff" : "Full file"}>
        {selectedFile?.current === "changed" ? (
          <p className="rw-note rw-note-changed" role="status">
            This file changed. You're viewing an earlier version.
          </p>
        ) : null}
        {mode === "file" && selectedParts.length > 1 ? (
          <label className="rw-version">
            Version{" "}
            <select
              aria-label="File version"
              value={selectedPart?.stamp ?? ""}
              onChange={(event) => {
                if (current) setVersionChoice({ path: current, stamp: event.target.value })
              }}
            >
              {selectedParts.map((item) => (
                <option key={item.id} value={item.stamp}>
                  {item.part?.label ?? "File"}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <ReadStatus
          missing={missing}
          empty={order.length === 0}
          state={state}
          mode={mode}
          source={{ ready: source.source !== undefined, error: source.error, retry: source.retry }}
          current={current}
          count={activeOrder.length}
          loaded={loaded.size}
          errors={errors}
          retry={diffs.retry}
          onDiff={() => setMode("diff")}
        />
        {mode === "diff" &&
        current !== null &&
        !errors.has(current) &&
        !loaded.has(current) &&
        loaded.size > 0 ? (
          <p role="status" className="rw-note">
            Reading {current}…
          </p>
        ) : null}
        {rendered && source.source && selectedFile ? (
          <>
            <FileHeader
              file={selectedFile}
              why={whyOf(selectedFile, facts.get(selectedFile.path), titles)}
              controls={
                <label className="rw-viewed">
                  <input
                    type="checkbox"
                    checked={isViewed(selectedFile)}
                    onChange={(event) => setFileViewed(selectedFile, event.target.checked)}
                  />
                  Viewed
                </label>
              }
            />
            <SourceMarkdown content={source.source.content} onSource={() => setFormat("source")} />
          </>
        ) : null}
        <div ref={host} className="rw-host" hidden={missing !== null || rendered} />
      </main>
      <footer className="rw-foot">
        <span className="rw-keys">
          <span>
            In the file tree: <kbd>↑</kbd>
            <kbd>↓</kbd> files
          </span>
          <span>
            <kbd>Esc</kbd> exit
          </span>
        </span>
        <span className="rw-sp" />
        <span>
          {mine > 0
            ? `${mine === 1 ? "1 change request goes" : `${mine} change requests go`} with your decision`
            : ""}
        </span>
      </footer>
      {slots.map(({ key, el }) => {
        if (key.startsWith("hdr|")) {
          const item = partsById.get(key.slice(4))
          if (item === undefined) return null
          const f = partFile(item)
          const fileFacts = facts.get(f.path)
          return createPortal(
            <FileHeader
              file={f}
              why={item.part ? { tasks: [], note: item.part.label } : whyOf(f, fileFacts, titles)}
              controls={
                <>
                  {item.stamp ? (
                    <button
                      type="button"
                      className="rw-btn quiet"
                      aria-label={`Read this version of ${f.path}`}
                      title={item.part?.label ?? "Read this file version"}
                      onClick={() => {
                        if (item.stamp) setVersionChoice({ path: f.path, stamp: item.stamp })
                        setChoice({ request, path: f.path, only: true })
                        setMode("file")
                      }}
                    >
                      <FileTextIcon size={14} />
                    </button>
                  ) : null}
                  {props.open !== undefined ? (
                    <button
                      type="button"
                      className="rw-open-ed"
                      title={`Open ${f.path} in ${EDITOR_NAMES[props.open.editor]}`}
                      aria-label={`Open ${f.path} in ${EDITOR_NAMES[props.open.editor]}`}
                      onClick={() => props.open?.run(f.path)}
                    >
                      <EditorMark editor={props.open.editor} size={13} />
                    </button>
                  ) : null}
                  {props.onMark !== undefined && !rendered ? (
                    <LineOpener
                      path={f.path}
                      onOpen={(start, end, at) => {
                        pointer.current = { x: at.x - 64, y: at.y - 14 }
                        const side = mode === "file" && f.status === "D" ? "deletions" : "additions"
                        viewer.current?.setSelectedLines?.({ start, end, side } as never)
                        markLines.current(item, { start, end, side })
                      }}
                    />
                  ) : null}
                  {mode === "file" || item.index === 0 ? (
                    <label className="rw-viewed">
                      <input
                        type="checkbox"
                        checked={isViewed(item.file)}
                        onChange={(e) => setFileViewed(item.file, e.target.checked)}
                      />
                      Viewed
                    </label>
                  ) : null}
                </>
              }
            />,
            el,
            key,
          )
        }
        const [itemId, side, line] = JSON.parse(key) as [string, Side, number]
        const item = partsById.get(itemId)
        if (!item) return null
        const path = item.file.path
        const anchor = partAnchor(item, side === "deletions" ? "old" : "new", line)
        const found =
          anchor.side === "new" && fileParts(item.file).length === 1
            ? (findingsByFile.get(path) ?? []).filter((f) => f.line === anchor.line)
            : []
        return createPortal(
          <>
            {found.map((f) => (
              <FindingThread
                key={f.id}
                finding={f}
                {...(props.onFinding !== undefined ? { onFinding: props.onFinding } : {})}
              />
            ))}
          </>,
          el,
          key,
        )
      })}
    </div>,
    document.body,
  )
}
