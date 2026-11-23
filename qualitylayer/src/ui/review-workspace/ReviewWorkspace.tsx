// The Review workspace: the change read like a pull request's Files changed, in the whole window. The
// Review page opens it (Review the code, any file in Built, slice by slice); Esc or Exit goes
// back. The tree groups the files as Built does, slice by slice. The diff viewer comes from /diffs.js
// (load.ts) and draws split or unified, coloured, with the agents' findings on their lines. A click on a
// line number, or a drag or Shift-click over several, marks those lines: the quick field opens there
// and sends the message with the lines as context to the task's session (`onMark`).
// Viewed marks are this person's, kept on this computer per task; a file whose content changed is
// unread again, even when a fix edited a line in place and the counts stayed.

import { cn } from "cn"
import {
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import type { Editor } from "../../core/config-values.ts"
import type { LineFinding } from "../../core/review/findings.ts"
import type { WalkFile, Walkthrough } from "../../core/review/walkthrough.ts"
import type { Comment } from "../api.ts"
import type { Anchor } from "../timeline/FilesChanged.tsx"
import type { ReviewFileGroups } from "../timeline/Walkthrough.tsx"
import { ChangeDetails } from "./ChangeDetails.tsx"
import { useFocusLayer } from "./focus.ts"
import type { FilePart } from "./parts.ts"
import { type MarkdownMode, ReadingControls, type ReadingMode } from "./ReadingControls.tsx"
import { type SourceLoader, useReviewSource } from "./source.tsx"
import { Tree, treeWidth } from "./Tree.tsx"
import { useDiffFiles } from "./useDiffFiles.ts"
import { useViewerSync } from "./useViewerSync.ts"
import { useWorkspaceFiles } from "./useWorkspaceFiles.ts"
import { type ChoiceState, useViewerInstance } from "./useWorkspaceViewer.ts"
import { WorkspaceFooter, WorkspaceHeader, WorkspaceMainBody } from "./WorkspaceChrome.tsx"
import { WorkspaceSlots } from "./WorkspaceSlots.tsx"
import {
  FOLDED,
  type Folds,
  readViewed,
  type SelectedRange,
  type Side,
  SPLIT_KEY,
  stampOf,
  typingOrChord,
  writeViewed,
} from "./workspace-model.ts"
import "./workspace.css"

export { ExitButton } from "./WorkspaceChrome.tsx"
export { readableFiles, viewedCount } from "./workspace-model.ts"

export type ReviewWorkspaceProps = {
  taskId: string
  title: string
  view: ReviewFileGroups & Pick<Partial<Walkthrough>, "columns" | "rounds">
  comments: readonly Comment[]
  deciding: boolean
  loadDiff: (
    path: string,
    signal?: AbortSignal,
    revision?: string,
    since?: string,
  ) => Promise<string>
  loadSource?: SourceLoader
  open?: { editor: Editor; run: (path: string) => void }
  onMark?: (mark: CodeMark) => void
  findings?: readonly LineFinding[]
  onFinding?: (f: LineFinding, kind: "adopted" | "dismissed", reason?: string) => Promise<void>
  file: string | null
  initialSlice?: number | null
  onClose: () => void
  onClearChanges?: () => Promise<void>
  commitReview?: ReactNode
}

/** Lines of a file marked in the viewer, with their text and where on screen the marking ended. */
export type CodeMark = {
  path: string
  side: Anchor["side"]
  start: number
  end: number
  quote: string
  at: { x: number; y: number }
  clear: () => void
}

function useEscapeClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typingOrChord(e) || e.key !== "Escape") return
      onClose()
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  })
}

function usePointerPosition() {
  const pointer = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const up = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener("pointerup", up, true)
    return () => window.removeEventListener("pointerup", up, true)
  }, [])
  return pointer
}

function useViewedMarks(taskId: string) {
  const [viewed, setViewed] = useState(() => readViewed(taskId))
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
      writeViewed(taskId, next)
      return next
    })
  const setFileViewed = (file: WalkFile, on: boolean) => setFilesViewed([file], on)
  return { isViewed, setFilesViewed, setFileViewed }
}

function useWorkspaceState(props: ReviewWorkspaceProps) {
  const [fileTreeOpen, setFileTreeOpen] = useState(false)
  const [focus, setFocus] = useState(false)
  const [showDiagrams, setShowDiagrams] = useState(false)
  const [activeSlice, setActiveSlice] = useState<number | null>(() => props.initialSlice ?? null)
  const [sinceRound, setSinceRound] = useState<string | null>(null)
  const [folds, setFolds] = useState<Folds>(FOLDED)
  const [split, setSplit] = useState(
    () =>
      (!props.commitReview || window.innerWidth > 760) &&
      localStorage.getItem(SPLIT_KEY) !== "unified",
  )
  const [mode, setMode] = useState<ReadingMode>("diff")
  const [format, setFormat] = useState<MarkdownMode>("source")
  const [versionChoice, setVersionChoice] = useState<{ path: string; stamp: string } | null>(null)
  const request = JSON.stringify([props.taskId, props.file])
  const [choice, setChoice] = useState<ChoiceState | null>(null)
  const explicit = choice?.request === request ? choice : null

  useLayoutEffect(() => {
    setChoice((previous) => (previous?.request === request ? previous : null))
  }, [request])

  return {
    fileTreeOpen,
    setFileTreeOpen,
    focus,
    setFocus,
    showDiagrams,
    setShowDiagrams,
    activeSlice,
    setActiveSlice,
    sinceRound,
    setSinceRound,
    folds,
    setFolds,
    split,
    setSplit,
    mode,
    setMode,
    format,
    setFormat,
    versionChoice,
    setVersionChoice,
    request,
    explicit,
    setChoice,
  }
}

function WorkspaceControls({
  props,
  ui,
  derived,
  currentIndex,
  unreadable,
  isViewed,
  setFilesViewed,
  go,
  selectSlice,
}: {
  props: ReviewWorkspaceProps
  ui: ReturnType<typeof useWorkspaceState>
  derived: ReturnType<typeof useWorkspaceFiles>
  currentIndex: number
  unreadable: readonly string[]
  isViewed: (file: WalkFile) => boolean
  setFilesViewed: (files: readonly WalkFile[], on: boolean) => void
  go: (path: string) => void
  selectSlice: (slice: number | null, file?: string | null) => void
}) {
  return (
    <>
      <ReadingControls
        mobileFileTree={
          props.commitReview
            ? { open: ui.fileTreeOpen, toggle: () => ui.setFileTreeOpen((open) => !open) }
            : undefined
        }
        focus={ui.focus}
        onFocus={() => ui.setFocus((on) => !on)}
        rounds={props.view.rounds}
        sinceRound={ui.sinceRound}
        onSinceRound={(rev) => {
          ui.setSinceRound(rev)
          ui.setShowDiagrams(false)
        }}
        hasDiagrams={props.view.slices.length >= 2}
        showDiagrams={ui.showDiagrams}
        onToggleDiagrams={() => ui.setShowDiagrams((on) => !on)}
        index={currentIndex}
        count={derived.order.length}
        onGo={(offset) => {
          const file = derived.order[currentIndex + offset]
          if (file) go(file.path)
        }}
        only={derived.only}
        onOnly={(value) => {
          if (derived.current)
            ui.setChoice({ request: ui.request, path: derived.current, only: value })
        }}
        mode={ui.mode}
        onMode={(value) => {
          ui.setMode(value)
          if (derived.current)
            ui.setChoice({
              request: ui.request,
              path: derived.current,
              only: value === "file" || derived.only,
            })
        }}
        split={ui.split}
        onSplit={ui.setSplit}
        markdown={derived.current?.endsWith(".md") === true}
        format={ui.format}
        onFormat={ui.setFormat}
        modified={derived.selectedFile?.status === "M"}
      />
      <Tree
        groups={derived.groups}
        lookFirst={derived.lookFirst}
        files={derived.filesByPath}
        comments={derived.commentCounts}
        unreadable={unreadable}
        activeSlice={ui.activeSlice}
        onSelectSlice={(slice) => selectSlice(slice)}
        details={
          <ChangeDetails
            scope={props.view.changeScope}
            comments={derived.unassigned}
            clear={props.onClearChanges}
          />
        }
        current={derived.current}
        isViewed={isViewed}
        onGo={(path) => {
          ui.setShowDiagrams(false)
          if (ui.activeSlice !== null && derived.facts.get(path)?.slice !== ui.activeSlice)
            ui.setActiveSlice(null)
          go(path)
        }}
        onViewed={setFilesViewed}
        folds={{
          generated: {
            count: derived.folded.generated,
            shown: ui.folds.generated,
            toggle: () => ui.setFolds((f) => ({ ...f, generated: !f.generated })),
          },
          documents: {
            count: derived.folded.documents,
            shown: ui.folds.documents,
            toggle: () => ui.setFolds((f) => ({ ...f, documents: !f.documents })),
          },
        }}
      />
    </>
  )
}

function useWorkspaceNavigation(
  ui: ReturnType<typeof useWorkspaceState>,
  derived: ReturnType<typeof useWorkspaceFiles>,
  opened: MutableRefObject<{ request: string; path: string; preceding?: string } | null>,
  userScroll: MutableRefObject<boolean>,
) {
  const go = useCallback(
    (path: string) => {
      if (!derived.order.some((file) => file.path === path)) return
      userScroll.current = false
      opened.current = null
      ui.setChoice({ request: ui.request, path, only: derived.only || derived.missing !== null })
    },
    [derived.order, ui.request, ui.setChoice, derived.only, derived.missing, opened, userScroll],
  )
  const selectSlice = useCallback(
    (slice: number | null, file?: string | null) => {
      ui.setActiveSlice(slice)
      ui.setShowDiagrams(false)
      const fallback =
        slice !== null ? derived.groups.find((g) => g.n === slice)?.files[0]?.path : null
      const nextFile = file ?? fallback
      if (nextFile)
        ui.setChoice({
          request: ui.request,
          path: nextFile,
          only: derived.only || derived.missing !== null,
        })
    },
    [
      derived.groups,
      derived.missing,
      derived.only,
      ui.request,
      ui.setActiveSlice,
      ui.setChoice,
      ui.setShowDiagrams,
    ],
  )
  return { go, selectSlice }
}

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  const { view, comments, deciding, taskId } = props
  const ui = useWorkspaceState(props)
  const derived = useWorkspaceFiles({
    view,
    comments,
    findings: props.findings,
    folds: ui.folds,
    sinceRound: ui.sinceRound,
    activeSlice: ui.activeSlice,
    initialFile: props.file,
    explicit: ui.explicit,
    mode: ui.mode,
    versionChoice: ui.versionChoice,
  })
  const source = useReviewSource(
    derived.selectedFile,
    ui.mode === "file",
    props.loadSource,
    derived.selectedPart,
  )
  const rendered =
    ui.mode === "file" && derived.current?.endsWith(".md") === true && ui.format === "rendered"
  const reading = useRef({ mode: ui.mode, rendered, side: "additions" as Side })
  const partStatus = derived.selectedPart?.part?.status ?? derived.selectedFile?.status
  reading.current = {
    mode: ui.mode,
    rendered,
    side: partStatus === "D" ? "deletions" : "additions",
  }

  const { isViewed, setFilesViewed, setFileViewed } = useViewedMarks(taskId)
  const marks = useRef(props.onMark)
  marks.current = props.onMark
  const markLines = useRef<(item: FilePart, range: SelectedRange) => void>(() => {})
  const pointer = usePointerPosition()
  const opened = useRef<{ request: string; path: string; preceding?: string } | null>(null)
  const userScroll = useRef(false)

  const { state, slots, host, viewer, parseRef } = useViewerInstance({
    split: ui.split,
    partsById: derived.partsById,
    reading,
    marks,
    markLines,
  })
  const diffs = useDiffFiles({
    files: derived.activeOrder,
    current: derived.current,
    parse: state === "ready" ? parseRef.current : null,
    load: props.loadDiff,
    since: ui.sinceRound,
  })
  useViewerSync({
    viewer,
    state,
    taskId,
    mode: ui.mode,
    only: derived.only,
    rendered,
    request: ui.request,
    initialFile: props.file,
    explicit: ui.explicit,
    current: derived.current,
    activeOrder: derived.activeOrder,
    selectedFile: derived.selectedFile,
    selectedPart: derived.selectedPart,
    selectedPartsCount: derived.selectedParts.length,
    source: source.source,
    loaded: diffs.loaded,
    findingsByFile: derived.findingsByFile,
    partsById: derived.partsById,
    isViewed,
    reading,
    marks,
    markLines,
    pointer,
    opened,
    userScroll,
    setChoice: ui.setChoice,
  })

  const { go, selectSlice } = useWorkspaceNavigation(ui, derived, opened, userScroll)
  useEscapeClose(props.onClose)
  const root = useFocusLayer<HTMLDivElement>()
  const read = derived.allReadableOrder.filter(isViewed).length
  const currentIndex = derived.order.findIndex((file) => file.path === derived.current)
  const mainLabel = ui.showDiagrams ? "Slice flow" : ui.mode === "diff" ? "Diff" : "Full file"
  const workspaceClass = cn(
    "rw",
    ui.focus && "rw-focused",
    (derived.missing !== null || derived.only) && "rw-file-choice",
    props.commitReview && "rw-precommit",
    props.commitReview && ui.fileTreeOpen && "rw-precommit-tree",
  )

  return createPortal(
    <div
      ref={root}
      tabIndex={-1}
      className={workspaceClass}
      style={{ "--rw-tree": `${treeWidth(derived.filesByPath.keys())}px` } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label={props.commitReview ? "Review before committing" : "Review the code"}
      data-testid="review-workspace"
    >
      <WorkspaceHeader
        title={props.title}
        hasCommitReview={Boolean(props.commitReview)}
        read={read}
        total={derived.allReadableOrder.length}
        deciding={deciding}
        mine={derived.mine}
        onClose={props.onClose}
      />
      <WorkspaceControls
        props={props}
        ui={ui}
        derived={derived}
        currentIndex={currentIndex}
        unreadable={[...diffs.errors.keys()]}
        isViewed={isViewed}
        setFilesViewed={setFilesViewed}
        go={go}
        selectSlice={selectSlice}
      />
      <main className="rw-main" aria-label={mainLabel}>
        <WorkspaceMainBody
          showDiagrams={ui.showDiagrams}
          view={view}
          activeSliceObj={derived.activeSliceObj}
          activeSliceFiles={derived.activeSliceFiles}
          activeSlice={ui.activeSlice}
          selectedFile={derived.selectedFile}
          selectedParts={derived.selectedParts}
          selectedPart={derived.selectedPart}
          current={derived.current}
          missing={derived.missing}
          orderCount={derived.order.length}
          activeOrderCount={derived.activeOrder.length}
          state={state}
          mode={ui.mode}
          source={source}
          rendered={rendered}
          loadedCount={diffs.loaded.size}
          hasCurrentLoaded={derived.current !== null && diffs.loaded.has(derived.current)}
          errors={diffs.errors}
          facts={derived.facts}
          titles={derived.titles}
          isViewed={isViewed}
          setFilesViewed={setFilesViewed}
          setFileViewed={setFileViewed}
          setActiveSlice={ui.setActiveSlice}
          selectSlice={selectSlice}
          setVersionChoice={ui.setVersionChoice}
          retryDiffs={diffs.retry}
          setMode={ui.setMode}
          setFormat={ui.setFormat}
        />
        <div
          ref={host}
          className="rw-host"
          hidden={ui.showDiagrams || derived.missing !== null || rendered}
        />
      </main>
      <WorkspaceFooter commitReview={props.commitReview} mine={derived.mine} />
      <WorkspaceSlots
        slots={slots}
        partsById={derived.partsById}
        facts={derived.facts}
        titles={derived.titles}
        findingsByFile={derived.findingsByFile}
        mode={ui.mode}
        rendered={rendered}
        request={ui.request}
        open={props.open}
        canMark={props.onMark !== undefined}
        onFinding={props.onFinding}
        isViewed={isViewed}
        pointer={pointer}
        viewer={viewer}
        markLines={markLines}
        setVersionChoice={ui.setVersionChoice}
        setChoice={ui.setChoice}
        setMode={ui.setMode}
        setFileViewed={setFileViewed}
      />
    </div>,
    document.body,
  )
}
