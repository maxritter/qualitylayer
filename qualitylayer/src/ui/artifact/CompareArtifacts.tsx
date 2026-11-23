// Compare a task's draft with the lasting artifact it drafts on: two interactive frames side by side, the
// lasting page and the draft's page, one page at a time with the page tabs; one column on a phone. The
// frames are the sandboxed ones an artifact opens in (scripts run, no network). `CompareView` is the view
// itself; `CompareDialog` puts it in a dialog, which the Files tab and the Review card both use.

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Api } from "../api.ts"
import { DEFAULT_WIDTH } from "./ArtifactPage.tsx"
import { type ArtifactLayout, ArtifactPageFrame } from "./ArtifactPageFrame.tsx"
import "./task-lasting.css"

/** One page of either side: its name in the artifact, its title and the file the artifact routes know it by. */
export type ComparePage = { page: string; title: string; file: string }

export type CompareSides = {
  api: Pick<Api, "artifactPage">
  /** The task whose draft it is, and the project the lasting artifact belongs to. */
  task: { id: string }
  project: string
  /** The lasting artifact. */
  artifact: { name: string; title: string; pages: ComparePage[] }
  /** The task's draft; its pages carry the names they will have in the artifact. */
  draft: { name: string; title: string; pages: ComparePage[] }
  /** The page to open on. */
  page?: string
}

const HEIGHT = 480

function useSideHtml(load: (() => Promise<string>) | null) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A side is drawn again for another page (its `key`), so it reads its page once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once per mount
  useEffect(() => {
    if (load === null) return
    let live = true
    load().then(
      (text) => live && setHtml(text),
      (cause: Error) => live && setError(cause.message),
    )
    return () => {
      live = false
    }
  }, [])
  return { html, error }
}

function useElementWidth(box: React.RefObject<HTMLDivElement | null>): number {
  const [room, setRoom] = useState(0)
  useLayoutEffect(() => {
    const el = box.current
    if (el === null) return
    const measure = () => setRoom(el.clientWidth)
    measure()
    if (typeof ResizeObserver === "undefined") return
    const watcher = new ResizeObserver(measure)
    watcher.observe(el)
    return () => watcher.disconnect()
  }, [box])
  return room
}

/** One side: a label and the page in its frame, or why there is none. */
function Side({
  label,
  testid,
  load,
  title,
  empty,
  onPage,
}: {
  label: string
  testid: string
  load: (() => Promise<string>) | null
  title: string
  empty: string
  onPage: (page: string) => void
}) {
  const { html, error } = useSideHtml(load)
  const [layout, setLayout] = useState<ArtifactLayout | null>(null)
  const box = useRef<HTMLDivElement | null>(null)
  const room = useElementWidth(box)
  const width = Math.max(DEFAULT_WIDTH, layout?.width ?? 0)
  const scale = room > 0 ? Math.min(1, room / width) : 0.5
  return (
    <section className="cmp-side" aria-label={label} data-testid={testid}>
      <h3 className="cmp-label">{label}</h3>
      <div ref={box} className="cmp-shot" style={{ height: HEIGHT }}>
        {error !== null ? (
          <p className="cmp-empty" role="alert">
            {error}
          </p>
        ) : load === null ? (
          <p className="cmp-empty">{empty}</p>
        ) : html === null ? (
          <p className="cmp-empty" role="status">
            Reading the page…
          </p>
        ) : (
          <ArtifactPageFrame
            html={html}
            title={title}
            width={width}
            height={Math.ceil(HEIGHT / scale)}
            scale={scale}
            onLayout={setLayout}
            onPage={onPage}
            className="cmp-frame"
          />
        )}
      </div>
    </section>
  )
}

export function CompareView({ api, task, project, artifact, draft, page }: CompareSides) {
  const pages = draft.pages
  const [current, setCurrent] = useState(
    pages.find((each) => each.page === page)?.page ?? pages[0]?.page ?? "",
  )
  const mine = pages.find((each) => each.page === current)
  const theirs = artifact.pages.find((each) => each.page === current)
  const open = (name: string) => {
    if (pages.some((each) => each.page === name)) setCurrent(name)
  }
  return (
    <div className="cmp" data-testid="compare">
      {pages.length > 1 ? (
        <div className="cmp-tabs" role="tablist" aria-label="Pages">
          {pages.map((each) => (
            <button
              key={each.page}
              type="button"
              role="tab"
              aria-selected={each.page === current}
              className="cmp-tab"
              onClick={() => setCurrent(each.page)}
            >
              {each.title}
              {artifact.pages.some((other) => other.page === each.page) ? null : (
                <span className="cmp-new">new</span>
              )}
            </button>
          ))}
        </div>
      ) : null}
      <div className="cmp-cols">
        <Side
          key={`lasting:${current}`}
          label={`${artifact.title}, as it is now`}
          testid="compare-lasting"
          title={`${artifact.title}, ${theirs?.title ?? current}`}
          load={
            theirs === undefined
              ? null
              : () => api.artifactPage({ scope: "project", id: project }, theirs.file)
          }
          empty={`${artifact.title} has no page ${current} yet. The draft would add it.`}
          onPage={open}
        />
        <Side
          key={`draft:${current}`}
          label="This task's draft"
          testid="compare-draft"
          title={`${draft.title}, ${mine?.title ?? current}`}
          load={
            mine === undefined
              ? null
              : () => api.artifactPage({ scope: "task", id: task.id }, mine.file)
          }
          empty="The draft has no such page."
          onPage={open}
        />
      </div>
    </div>
  )
}

export function CompareDialog({
  sides,
  onClose,
}: {
  sides: CompareSides | null
  onClose: () => void
}) {
  return (
    <Dialog open={sides !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      {sides !== null ? (
        <DialogContent
          className="cmp-dialog sm:max-w-[min(1240px,calc(100vw-2rem))]"
          data-testid="compare-dialog"
        >
          <DialogHeader>
            <DialogTitle>
              Compare {sides.artifact.title} with {sides.draft.title}
            </DialogTitle>
            <DialogDescription>
              Both pages work as they do in the App. The draft changes only this task's copy.
            </DialogDescription>
          </DialogHeader>
          <CompareView {...sides} />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
