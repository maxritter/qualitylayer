// Pieces the build's three views share: the kinds of notes, a note, evidence
// the runner or the judge kept, a copyable command, and a clock for "4 s ago".

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { Evidence } from "../api.ts"
import { terminalText } from "../reader/terminal-text.ts"
import { FullscreenDialog } from "../reader/VisualParts.tsx"

export type LoadEvidence = (name: string) => Promise<Evidence>

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** One kept file under evidence/: its output, or a screenshot that opens full size. */
export function EvidenceFig({ path, load }: { path: string; load: LoadEvidence }) {
  const name = path.replace(/^evidence\//, "")
  const { evidence, error } = useEvidence(path, load)
  const [full, setFull] = useState(false)
  return (
    <figure className="v3-fig" data-testid="evidence">
      <figcaption>evidence/{name}</figcaption>
      {error !== null ? (
        <div className="v3-ph">{error}</div>
      ) : evidence === null ? (
        <div className="v3-ph">Loading…</div>
      ) : evidence.kind === "image" ? (
        <>
          <button
            type="button"
            className="block w-full cursor-zoom-in"
            onClick={() => setFull(true)}
            aria-label={`Open ${name} full size`}
          >
            <img src={`data:${evidence.type};base64,${evidence.base64}`} alt={name} />
          </button>
          <EvidenceFullscreen
            name={name}
            evidence={evidence}
            open={full}
            onClose={() => setFull(false)}
          />
        </>
      ) : (
        <pre>{terminalText(evidence.text)}</pre>
      )}
    </figure>
  )
}

/** A screenshot of evidence/ at full size. */
export function EvidenceFullscreen({
  name,
  evidence,
  open,
  onClose,
}: {
  name: string
  evidence: Extract<Evidence, { kind: "image" }>
  open: boolean
  onClose: () => void
}) {
  return (
    <FullscreenDialog
      open={open}
      onClose={onClose}
      title={`Evidence ${name}`}
      testId="evidence-fullscreen"
      bar={<span className="visual-kind">evidence/{name}</span>}
    >
      <div className="min-h-full bg-sunken p-3">
        <img
          className="mx-auto block max-w-full"
          src={`data:${evidence.type};base64,${evidence.base64}`}
          alt={name}
        />
      </div>
    </FullscreenDialog>
  )
}

export function EvidenceGrid({ paths, load }: { paths: string[]; load: LoadEvidence }) {
  const unique = [...new Set(paths)]
  if (unique.length === 0) return null
  return (
    <div className="v3-evidence">
      {unique.map((p) => (
        <EvidenceFig key={p} path={p} load={load} />
      ))}
    </div>
  )
}

/** An evidence file, loaded once: null while it loads, an error message when it cannot be read. */
export function useEvidence(
  path: string,
  load: LoadEvidence,
): { evidence: Evidence | null; error: string | null } {
  const name = path.replace(/^evidence\//, "")
  const [state, setState] = useState<{ evidence: Evidence | null; error: string | null }>({
    evidence: null,
    error: null,
  })
  useEffect(() => {
    let live = true
    setState({ evidence: null, error: null })
    load(name).then(
      (evidence) => live && setState({ evidence, error: null }),
      (e: Error) => live && setState({ evidence: null, error: e.message }),
    )
    return () => {
      live = false
    }
  }, [name, load])
  return state
}

/** The lines of a text proof as a terminal reads them: commands, good news, bad news, the rest. */
function terminalLines(text: string, max: number): { cls: string; text: string }[] {
  return terminalText(text)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(0, max)
    .map((line) => ({
      text: line,
      cls: /^\s*(\$|>)\s/.test(line)
        ? "cmd"
        : /\b(fail(ed)?|error|refused|denied|exit=[1-9])\b/i.test(line)
          ? "bad"
          : /\b(ok|pass(ed)?|exit=0|200)\b/i.test(line)
            ? "ok"
            : "dim",
    }))
}

/** What a checkpoint's picture is: the captured file, shown as a screenshot or as terminal text. */
export type PictureData = { file: string; caption: string }

/** The big picture: every picture of the build, one at a time, with arrow keys and Esc. */
export function PictureViewer({
  pictures,
  index,
  load,
  onStep,
  onClose,
}: {
  pictures: (PictureData & { where: string })[]
  index: number
  load: LoadEvidence
  onStep: (to: number) => void
  onClose: () => void
}) {
  const picture = pictures[index]
  const { evidence, error } = useEvidence(picture?.file ?? "", load)
  const count = pictures.length
  // No Trigger opens this dialog, so it has nothing to give the focus back to: keep the opener.
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  if (picture === undefined) return null
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        finalFocus={() => opener ?? false}
        // The dialog owns Escape and focus, and keeps the arrows to itself: they step from inside it.
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onStep((index + 1) % count)
          else if (e.key === "ArrowLeft") onStep((index - 1 + count) % count)
        }}
        className="bv-lb block max-h-[calc(100vh-32px)] w-[min(880px,calc(100vw-32px))] max-w-none gap-0 overflow-auto border border-strong bg-background p-0 sm:max-w-none"
        data-testid="viewer"
      >
        <DialogTitle className="sr-only">Picture</DialogTitle>
        <div className="bv-ph">
          <h2 className="bv-pt">{picture.caption}</h2>
          <span className="bv-sub">{picture.where}</span>
          <span className="bv-sp" />
          <button
            type="button"
            className="bv-btn"
            aria-label="Previous picture"
            onClick={() => onStep((index - 1 + count) % count)}
          >
            ←
          </button>
          <span className="bv-time">
            {index + 1} / {count}
          </span>
          <button
            type="button"
            className="bv-btn"
            aria-label="Next picture"
            onClick={() => onStep((index + 1) % count)}
          >
            →
          </button>
          <button type="button" className="bv-btn" onClick={onClose}>
            Close
          </button>
        </div>
        {error !== null ? (
          <p className="bv-quiet" role="alert">
            {error}
          </p>
        ) : evidence === null ? (
          <p className="bv-quiet">Loading…</p>
        ) : evidence.kind === "image" ? (
          <img src={`data:${evidence.type};base64,${evidence.base64}`} alt={picture.caption} />
        ) : (
          <div className="bv-term big">
            {terminalLines(evidence.text, 400).map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a terminal's lines are positional
              <span key={i} className={line.cls}>
                {line.text}
              </span>
            ))}
          </div>
        )}
        <p className="bv-lbcap">{picture.caption}</p>
        <p className="bv-lbfile">
          From <code>{picture.file}</code>
        </p>
      </DialogContent>
    </Dialog>
  )
}
