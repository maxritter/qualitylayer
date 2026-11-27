// The card an embed opens in: the whole artifact page in a body that scrolls, opened at the
// referenced section. Supports multi-place element/area annotations with DOM ID context (#268)
// alongside Open full size.

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Maximize2Icon,
  MessageSquarePlusIcon,
} from "lucide-react"
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { FullscreenDialog } from "../reader/VisualParts.tsx"
import { ArtifactAnnotateTray, type StagedAnnotation } from "./ArtifactAnnotateTray.tsx"
import { type ArtifactLayout, ArtifactPageFrame } from "./ArtifactPageFrame.tsx"
import { usePreviewAnnotations } from "./use-preview-annotations.ts"
import {
  type PreviewScreenEntry,
  resolvePagerScreens,
  usePreviewPager,
} from "./use-preview-pager.ts"

export { type PreviewScreenEntry, resolvePagerScreens }

const PAD = 16
const LEAD = 12
const MAX_WIDTH = 1100

export function DialogPager({
  index,
  total,
  label,
  onPrev,
  onNext,
}: {
  index: number
  total: number
  label: string
  onPrev: () => void
  onNext: () => void
}) {
  if (total <= 1) return null
  return (
    <fieldset className="dg-ann-pager" aria-label="Screen pager" data-testid="screen-pager">
      <button
        type="button"
        aria-label="Previous screen"
        data-testid="screen-pager-prev"
        disabled={index <= 0}
        onClick={onPrev}
      >
        <ChevronLeftIcon size={14} aria-hidden="true" />
      </button>
      <span className="dg-ann-pager-label" data-testid="screen-pager-label">
        {index + 1} / {total} · {label}
      </span>
      <button
        type="button"
        aria-label="Next screen"
        data-testid="screen-pager-next"
        disabled={index >= total - 1}
        onClick={onNext}
      >
        <ChevronRightIcon size={14} aria-hidden="true" />
      </button>
    </fieldset>
  )
}

function DialogModeBar({
  name,
  pager,
  canAnnotate,
  armed,
  onArmed,
}: {
  name: string
  pager: {
    index: number
    total: number
    label: string
    onPrev: () => void
    onNext: () => void
  } | null
  canAnnotate: boolean
  armed: boolean
  onArmed: (next: boolean) => void
}) {
  return (
    <span className="dg-ann-bar-group">
      <b>{name}</b>
      {pager !== null ? <DialogPager {...pager} /> : null}
      {canAnnotate ? (
        <>
          <fieldset className="dg-ann-seg" aria-label="Interaction mode">
            <button
              type="button"
              aria-pressed={!armed}
              data-testid="annotate-mode-use"
              onClick={() => onArmed(false)}
            >
              Use screen
            </button>
            <button
              type="button"
              aria-pressed={armed}
              data-testid="annotate-mode-arm"
              onClick={() => onArmed(true)}
            >
              <MessageSquarePlusIcon size={12} aria-hidden="true" />
              Annotate
            </button>
          </fieldset>
          {armed ? (
            <span className="dg-ann-hint">Click an element or drag an area · Esc exits</span>
          ) : null}
        </>
      ) : null}
    </span>
  )
}

function useDialogViewportMetrics(
  viewport: HTMLDivElement | null,
  top: number | undefined,
  scale: number,
) {
  const [room, setRoom] = useState(0)
  const taken = useRef(false)
  const placed = useRef(0)

  useLayoutEffect(() => {
    if (!viewport) {
      taken.current = false
      placed.current = 0
      return
    }
    const measure = () => setRoom(viewport.clientWidth)
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [viewport])

  useLayoutEffect(() => {
    if (!viewport || top === undefined || taken.current) return
    placed.current = Math.max(0, PAD + top * scale - LEAD)
    viewport.scrollTop = placed.current
  }, [viewport, top, scale])

  return {
    room,
    onScroll: (scrollTop: number) => {
      if (Math.abs(scrollTop - placed.current) > 2) taken.current = true
    },
  }
}

function scrollViewportToPin(
  viewport: HTMLDivElement | null,
  items: readonly StagedAnnotation[],
  num: number,
  scale: number,
) {
  const pin = items.find((item) => item.num === num)
  if (!pin || !viewport) return
  const targetTop = Math.max(0, PAD + pin.y * scale - 60)
  if (typeof viewport.scrollTo === "function") {
    viewport.scrollTo({ top: targetTop, behavior: "smooth" })
  } else {
    viewport.scrollTop = targetTop
  }
}

function focusedPartOf(measured: ArtifactLayout | null, section?: string) {
  if (!section || !measured) return null
  const matches = measured.parts.filter((part) => part.id === section)
  return matches.length === 1 ? (matches[0] ?? null) : null
}

function OpenFullSizeButton({ onOpen, close }: { onOpen: (() => void) | null; close: () => void }) {
  if (!onOpen) return undefined
  return (
    <button
      className="q-btn sm"
      type="button"
      onClick={() => {
        close()
        onOpen()
      }}
    >
      <Maximize2Icon size={14} aria-hidden="true" />
      Open full size
    </button>
  )
}

function useScrollOnPageChange(
  safeIndex: number,
  viewport: HTMLDivElement | null,
  focusedTop: number | undefined,
  scale: number,
) {
  const lastPagedIndex = useRef(safeIndex)
  useEffect(() => {
    if (lastPagedIndex.current === safeIndex) return
    lastPagedIndex.current = safeIndex
    if (!viewport || focusedTop === undefined) return
    viewport.scrollTop = Math.max(0, PAD + focusedTop * scale - LEAD)
  }, [safeIndex, viewport, focusedTop, scale])
}

function handlePreviewFrameKey(
  key: string,
  totalScreens: number,
  onEscape: () => void,
  pageBy: (delta: -1 | 1) => void,
) {
  if (key === "Escape") onEscape()
  else if (key === "ArrowLeft" && totalScreens > 1) pageBy(-1)
  else if (key === "ArrowRight" && totalScreens > 1) pageBy(1)
}

export function ArtifactPreviewDialog({
  open,
  close,
  name,
  file,
  html,
  width,
  layout,
  section,
  screens,
  loadScreenHtml,
  theme,
  onOpen,
  onAnnotate,
  initialAnnotate = false,
  returnFocus,
}: {
  open: boolean
  close: () => void
  name: string
  file?: string
  html: string
  width: number
  layout: ArtifactLayout | null
  section?: string
  screens?: readonly PreviewScreenEntry[]
  loadScreenHtml?: ((file: string) => Promise<string>) | null
  theme?: "light" | "dark"
  onOpen: (() => void) | null
  onAnnotate?:
    | ((batchMarkdown: string, pins: StagedAnnotation[], activeFile?: string) => Promise<void>)
    | null
  initialAnnotate?: boolean
  returnFocus: RefObject<HTMLElement | null>
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [current, setCurrent] = useState<ArtifactLayout | null>(null)
  const measured = current ?? layout
  const paging = usePreviewPager({
    open,
    name,
    file,
    html,
    section,
    screens,
    measured,
    loadScreenHtml,
  })
  const focused = focusedPartOf(measured, paging.activeSection)
  const activeFileRef = useRef(paging.activeFile)
  activeFileRef.current = paging.activeFile
  const stableAnnotate = useMemo(
    () =>
      onAnnotate
        ? (batchMarkdown: string, pins: StagedAnnotation[]) =>
            onAnnotate(batchMarkdown, pins, activeFileRef.current)
        : null,
    [onAnnotate],
  )
  const ann = usePreviewAnnotations({
    open,
    name: paging.activeTitle,
    section: paging.activeSection,
    screenKey: paging.activeScreenKey,
    screenTitle: paging.activeTitle,
    screenFile: paging.activeFile,
    initialAnnotate,
    onAnnotate: stableAnnotate,
    close,
  })
  const [roomHint, setRoomHint] = useState(0)
  const scale = roomHint ? Math.min(1, (roomHint - 2 * PAD) / width) : 1
  const metrics = useDialogViewportMetrics(viewport, focused?.top, scale)
  if (metrics.room !== roomHint) setRoomHint(metrics.room)
  useScrollOnPageChange(paging.safeIndex, viewport, focused?.top, scale)

  const height = measured?.contentHeight || measured?.height || 900
  const trayExtra = ann.showTray ? 320 : 0
  const selectPin = (num: number) => {
    ann.setActiveNum(num)
    const target = ann.items.find((item) => item.num === num)
    const onActiveScreen = !target?.screenKey || target.screenKey === paging.activeScreenKey
    if (target && target.kind !== "group" && onActiveScreen) {
      scrollViewportToPin(viewport, ann.items, num, scale)
    }
  }
  const onFrameKey = (key: string) =>
    handlePreviewFrameKey(key, paging.totalScreens, ann.handleEscape, paging.pageBy)

  return (
    <FullscreenDialog
      open={open}
      onClose={close}
      title={`Preview: ${name}`}
      testId="artifact-preview-overlay"
      returnFocus={returnFocus}
      overflowHidden
      style={{
        width: `min(${Math.min(width + 2 * PAD + 16 + trayExtra, MAX_WIDTH + trayExtra)}px, 95vw)`,
        height: "min(88vh, 920px)",
      }}
      bar={
        <DialogModeBar
          name={name}
          pager={paging.pager}
          canAnnotate={ann.canAnnotate}
          armed={ann.armed}
          onArmed={ann.toggleArmed}
        />
      }
      actions={OpenFullSizeButton({ onOpen, close })}
    >
      <div className={ann.showTray ? "dg-ann-split" : "flex h-full min-h-0 flex-1 flex-col"}>
        <div
          className="dg-preview-dialog-viewport"
          data-testid="artifact-preview-body"
          ref={setViewport}
          style={{ overflowY: "auto" }}
          onScroll={(event) => metrics.onScroll(event.currentTarget.scrollTop)}
        >
          <div
            className="dg-preview-dialog-picture"
            data-testid="artifact-preview-page"
            style={{ width: width * scale, height: height * scale }}
          >
            <ArtifactPageFrame
              html={paging.shownHtml}
              title={`${paging.activeTitle}, enlarged preview`}
              width={width}
              height={Math.max(900, measured?.height ?? 900)}
              scale={scale}
              theme={theme}
              armed={ann.armed}
              multi={ann.canAnnotate}
              pins={ann.canAnnotate ? ann.pins : undefined}
              onMark={ann.canAnnotate ? ann.handleMark : undefined}
              onLayout={setCurrent}
              onKey={onFrameKey}
              className="dg-preview-dialog-frame"
            />
          </div>
        </div>
        {ann.showTray ? (
          <ArtifactAnnotateTray
            name={paging.activeTitle}
            section={paging.activeSection}
            items={ann.items}
            pending={ann.pending}
            subMode={ann.subMode}
            selectedRefs={ann.selectedRefs}
            activeNum={ann.activeNum}
            editingNum={ann.editingNum}
            sending={ann.sending}
            error={ann.sendError}
            onSelect={selectPin}
            onSubMode={ann.setSubMode}
            onRemoveRef={ann.removeSelectedRef}
            onSaveGroup={ann.saveGroup}
            onStartEdit={ann.startEdit}
            onSaveEdit={ann.saveEdit}
            onCancelEdit={ann.cancelEdit}
            onRemove={ann.remove}
            onSavePending={ann.savePending}
            onCancelPending={() => ann.setPending(null)}
            onSend={() => void ann.sendBatch()}
          />
        ) : null}
      </div>
    </FullscreenDialog>
  )
}
