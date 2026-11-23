import { ArrowLeftIcon, FrameIcon, SearchIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { Artifact } from "../../core/artifact/format.ts"
import { Hint } from "../sidebar/Hint.tsx"
import { ArtifactPageFrame } from "./ArtifactPageFrame.tsx"

type Props = {
  artifacts: Artifact[]
  current: string
  load: (file: string) => Promise<string>
  onOpen: (artifact: Artifact) => void
  onClose: () => void
  theme: "light" | "dark"
}

function Board({
  artifact,
  scale,
  theme,
  load,
  onOpen,
}: {
  artifact: Artifact
  scale: number
  theme: "light" | "dark"
  load: Props["load"]
  onOpen: () => void
}) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [height, setHeight] = useState(800)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the source reloads when its modification time changes
  useEffect(() => {
    let active = true
    setHtml(null)
    setError(null)
    load(artifact.file)
      .then((source) => {
        if (active) setHtml(source)
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message)
      })
    return () => {
      active = false
    }
  }, [artifact.file, artifact.updated, load])
  const width = artifact.width ?? 1280
  return (
    <section className="dc-board" style={{ width: width * scale }} aria-label={artifact.title}>
      <button
        type="button"
        className="dc-board-title"
        onClick={onOpen}
        title={`Open ${artifact.title}`}
      >
        <span>{artifact.title}</span>
      </button>
      <div className="dc-board-body" style={{ width: width * scale, height: height * scale }}>
        {error ? (
          <p role="alert">{error}</p>
        ) : html === null ? (
          <p role="status">Loading artifact…</p>
        ) : (
          <ArtifactPageFrame
            html={html}
            title={artifact.title}
            width={width}
            height={height}
            scale={scale}
            theme={theme}
            onLayout={(layout) => setHeight(Math.min(2400, Math.max(160, layout.height)))}
          />
        )}
        <button
          type="button"
          className="dc-board-open"
          aria-label={`Focus ${artifact.title}`}
          onClick={onOpen}
        />
      </div>
      {artifact.purpose ? <p className="dc-purpose">{artifact.purpose}</p> : null}
    </section>
  )
}

function CanvasToolbar({
  artifacts,
  visibleCount,
  compare,
  onToggleCompare,
  filter,
  onFilter,
  fitted,
  percent,
  onFit,
  onStep,
  onClose,
}: {
  artifacts: readonly Artifact[]
  visibleCount: number
  compare: readonly string[]
  onToggleCompare: (file: string) => void
  filter: string
  onFilter: (value: string) => void
  fitted: boolean
  percent: string
  onFit: () => void
  onStep: (by: number) => void
  onClose: () => void
}) {
  return (
    <div className="dg-bar tools dc-tools" role="toolbar" aria-label="Canvas tools">
      <Hint label="Back to the artifact">
        <button type="button" className="back" aria-label="Back to artifact" onClick={onClose}>
          <ArrowLeftIcon aria-hidden="true" />
        </button>
      </Hint>
      <span className="nm dc-name">Compare</span>
      <span className="dc-count" role="status" aria-label={`${visibleCount} artboards`}>
        {visibleCount}
      </span>
      <span className="dg-vs" aria-hidden="true" />
      <fieldset className="dc-selection" aria-label="Artboards to compare">
        {artifacts.map((artifact) => {
          const on = compare.includes(artifact.file)
          return (
            <button
              key={artifact.file}
              type="button"
              className="dc-chip"
              aria-pressed={on}
              title={artifact.title}
              onClick={() => onToggleCompare(artifact.file)}
            >
              <FrameIcon aria-hidden="true" />
              <span>{artifact.title}</span>
            </button>
          )
        })}
      </fieldset>
      <label className="dc-find">
        <SearchIcon aria-hidden="true" />
        <input
          type="search"
          aria-label="Find artifacts"
          placeholder="Find"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
        />
      </label>
      <fieldset className="dg-zoom" aria-label="Zoom">
        <Hint label="Zoom out">
          <button
            type="button"
            className="dg-t"
            aria-label="Zoom canvas out"
            onClick={() => onStep(-0.1)}
          >
            <ZoomOutIcon aria-hidden="true" />
          </button>
        </Hint>
        <Hint label="Fit the width">
          <button
            type="button"
            className="dg-t pct"
            aria-label={fitted ? "Fit canvas" : `${percent}, fit canvas`}
            onClick={onFit}
          >
            {fitted ? "Fit" : percent}
          </button>
        </Hint>
        <Hint label="Zoom in">
          <button
            type="button"
            className="dg-t"
            aria-label="Zoom canvas in"
            onClick={() => onStep(0.1)}
          >
            <ZoomInIcon aria-hidden="true" />
          </button>
        </Hint>
      </fieldset>
      <output className="sr-only" aria-label="Canvas zoom">
        {percent}
      </output>
    </div>
  )
}

export function ArtifactCanvas({ artifacts, current, load, onOpen, onClose, theme }: Props) {
  const room = useRef<HTMLElement>(null)
  const [scale, setScale] = useState(0.33)
  /** True while the boards are fitted to the room; a zoom step leaves it and the button then reads the percent. */
  const [fitted, setFitted] = useState(true)
  const [filter, setFilter] = useState("")
  const [compare, setCompare] = useState<string[]>([])
  const visible = artifacts.filter(
    (d) =>
      (compare.length === 0 || compare.includes(d.file)) &&
      `${d.title} ${d.purpose}`.toLowerCase().includes(filter.toLowerCase()),
  )
  const fit = () => {
    const width = room.current?.clientWidth ?? 900
    const widest = Math.max(320, ...visible.map((d) => d.width ?? 1280))
    const columns = width < 700 ? 1 : Math.min(visible.length || 1, 2)
    const padding = width < 600 ? 32 : 64
    setScale(
      Math.max(0.1, Math.min(1, (width - padding - (columns - 1) * 32 - 2) / (widest * columns))),
    )
    setFitted(true)
  }
  // The boards open fitted, and stay fitted while the subset or search changes them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit reads the visible boards
  useLayoutEffect(() => {
    if (fitted) fit()
  }, [fitted, visible.length, compare.length])
  const step = (by: number) => {
    setFitted(false)
    setScale((s) => Math.min(1.5, Math.max(0.1, s + by)))
  }
  const toggleCompare = (file: string) =>
    setCompare((list) =>
      list.includes(file) ? list.filter((item) => item !== file) : [...list, file],
    )
  const percent = `${Math.round(scale * 100)}%`
  return (
    <section className="dc-workspace" aria-label="Artifact canvas" data-testid="artifact-workspace">
      <CanvasToolbar
        artifacts={artifacts}
        visibleCount={visible.length}
        compare={compare}
        onToggleCompare={toggleCompare}
        filter={filter}
        onFilter={setFilter}
        fitted={fitted}
        percent={percent}
        onFit={fit}
        onStep={step}
        onClose={onClose}
      />
      <section
        className="dc-room"
        ref={room}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: this scroll region must support keyboard panning
        tabIndex={0}
        aria-label="Artboards, scroll to pan"
      >
        {visible.length === 0 ? (
          <p role="status">No artifacts match your search.</p>
        ) : (
          <div className="dc-boards">
            {visible.map((artifact) => (
              <div
                key={artifact.file}
                data-selected={current === artifact.file ? "true" : undefined}
              >
                <Board
                  artifact={artifact}
                  scale={scale}
                  theme={theme}
                  load={load}
                  onOpen={() => {
                    onOpen(artifact)
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  )
}
