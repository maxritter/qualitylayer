// The card an embed opens in: the whole artifact page in a body that scrolls, opened at the
// referenced section. Supports multi-place element/area annotations with DOM ID context (#268)
// alongside Open full size.

import { Maximize2Icon, MessageSquarePlusIcon } from "lucide-react"
import { type RefObject, useLayoutEffect, useRef, useState } from "react"
import { FullscreenDialog } from "../reader/VisualParts.tsx"
import { ArtifactAnnotateTray, type StagedAnnotation } from "./ArtifactAnnotateTray.tsx"
import { type ArtifactLayout, ArtifactPageFrame } from "./ArtifactPageFrame.tsx"
import { usePreviewAnnotations } from "./use-preview-annotations.ts"

const PAD = 16
const LEAD = 12
const MAX_WIDTH = 1100

function DialogModeBar({
  name,
  canAnnotate,
  armed,
  onArmed,
}: {
  name: string
  canAnnotate: boolean
  armed: boolean
  onArmed: (next: boolean) => void
}) {
  return (
    <span className="dg-ann-bar-group">
      <b>{name}</b>
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

export function ArtifactPreviewDialog({
  open,
  close,
  name,
  html,
  width,
  layout,
  section,
  theme,
  onOpen,
  onAnnotate,
  initialAnnotate = false,
  returnFocus,
}: {
  open: boolean
  close: () => void
  name: string
  html: string
  width: number
  layout: ArtifactLayout | null
  section?: string
  theme?: "light" | "dark"
  onOpen: (() => void) | null
  onAnnotate?: ((batchMarkdown: string, pins: StagedAnnotation[]) => Promise<void>) | null
  initialAnnotate?: boolean
  returnFocus: RefObject<HTMLElement | null>
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [current, setCurrent] = useState<ArtifactLayout | null>(null)
  const ann = usePreviewAnnotations({ open, name, section, initialAnnotate, onAnnotate, close })
  const measured = current ?? layout
  const matches = section ? (measured?.parts.filter((part) => part.id === section) ?? []) : []
  const focused = matches.length === 1 ? matches[0] : null
  const [roomHint, setRoomHint] = useState(0)
  const scale = roomHint ? Math.min(1, (roomHint - 2 * PAD) / width) : 1
  const metrics = useDialogViewportMetrics(viewport, focused?.top, scale)
  if (metrics.room !== roomHint) setRoomHint(metrics.room)
  const height = measured?.contentHeight || measured?.height || 900
  const trayExtra = ann.showTray ? 320 : 0

  return (
    <FullscreenDialog
      open={open}
      onClose={close}
      title={`Preview: ${name}`}
      testId="artifact-preview-overlay"
      returnFocus={returnFocus}
      style={{
        width: `min(${Math.min(width + 2 * PAD + 16 + trayExtra, MAX_WIDTH + trayExtra)}px, 95vw)`,
        height: "min(88vh, 920px)",
      }}
      bar={
        <DialogModeBar
          name={name}
          canAnnotate={ann.canAnnotate}
          armed={ann.armed}
          onArmed={ann.toggleArmed}
        />
      }
      actions={
        onOpen ? (
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
        ) : undefined
      }
    >
      <div className={ann.showTray ? "dg-ann-split" : "flex min-h-0 flex-1 flex-col"}>
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
              html={html}
              title={`${name}, enlarged preview`}
              width={width}
              height={Math.max(900, measured?.height ?? 900)}
              scale={scale}
              theme={theme}
              armed={ann.armed}
              multi={ann.canAnnotate}
              pins={ann.canAnnotate ? ann.pins : undefined}
              onMark={ann.canAnnotate ? (mark) => ann.setPending(mark) : undefined}
              onLayout={setCurrent}
              onKey={(key) => {
                if (key === "Escape") ann.handleEscape()
              }}
              className="dg-preview-dialog-frame"
            />
          </div>
        </div>
        {ann.showTray ? (
          <ArtifactAnnotateTray
            name={name}
            section={section}
            items={ann.items}
            pending={ann.pending}
            activeNum={ann.activeNum}
            sending={ann.sending}
            error={ann.sendError}
            onSelect={ann.setActiveNum}
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
