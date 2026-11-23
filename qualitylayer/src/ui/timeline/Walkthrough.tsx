// The change of a task as the review draws it: the rows its slices make for the code workspace, and
// the screens compared (the designed picture and the built one, side by side).

import { ChevronRightIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { screenSize, type WalkScreen } from "../../core/review/screen-pairs.ts"
import { ArtifactPreview } from "../artifact/ArtifactPreview.tsx"
import { FullscreenDialog } from "../reader/VisualParts.tsx"
import { WireframeBlock } from "../reader/WireframeBlock.tsx"
import { type LoadEvidence, plural, useEvidence } from "./parts.tsx"
import {
  artifactReferenceForScreen,
  captionOf,
  leadScreens,
  type ReviewFileGroups,
  rowsOf,
} from "./walkthrough-model.ts"
import "./walkthrough.css"

export { artifactReferenceForScreen, leadScreens, type ReviewFileGroups, rowsOf }

// ------------------------------------------------------------------ the parts

function Part({
  id,
  name,
  note,
  testId,
  children,
}: {
  id: string
  name: string
  note?: string | undefined
  testId: string
  children: React.ReactNode
}) {
  return (
    <div className="wt-sec" data-part={id} id={`wt-${id}`}>
      <h3 className="wt-k" data-testid="wt-key">
        {name}
        {note !== undefined ? <span className="wt-kn">{note}</span> : null}
      </h3>
      <div className="wt-b" data-testid={testId}>
        {children}
      </div>
    </div>
  )
}

export function ScreenImage({ src, title }: { src: string; title: string }) {
  const [full, setFull] = useState(false)
  return (
    <>
      <button
        type="button"
        className="wt-screen-image"
        aria-label={`Open ${title} full size`}
        onClick={() => setFull(true)}
      >
        <img src={src} alt={title} />
      </button>
      <FullscreenDialog
        open={full}
        onClose={() => setFull(false)}
        title={title}
        bar={<span>{title}</span>}
        testId="screen-fullscreen"
      >
        <img className="wt-screen-full" src={src} alt={title} />
      </FullscreenDialog>
    </>
  )
}

/** The screen as the Plan designed it: the approved picture, else the artifact drawn from its source. */
export function DesignedScreen({
  screen,
  title,
  onOpen,
}: {
  screen: WalkScreen
  title: string
  /** Open the artifact in its card, where the page can (the live Review). */
  onOpen?: () => void
}) {
  if (screen.image) return <ScreenImage src={screen.image} title={title} />
  if (screen.artifact?.kind === "wireframe")
    return <WireframeBlock source={screen.artifact.source} theme={screen.theme} />
  // The same preview card as the Plan's Interface draws: one look for an artifact on every step.
  const reference = artifactReferenceForScreen(screen.key)
  if (screen.artifact && reference !== null)
    return (
      <ArtifactPreview
        path={reference}
        title={title}
        load={async () => screen.artifact?.source ?? ""}
        {...(onOpen !== undefined ? { onOpen } : {})}
      />
    )
  return <p className="wt-screen-empty">Artifact picture unavailable.</p>
}

export function BuiltScreen({
  screen,
  load,
  title,
}: {
  screen: WalkScreen
  load: LoadEvidence
  title: string
}) {
  const { evidence, error } = useEvidence(screen.file ?? "", load)
  if (error !== null) return <p className="wt-screen-empty">{error}</p>
  if (evidence === null) return <p className="wt-screen-empty">Loading built screen…</p>
  return evidence.kind === "image" ? (
    <ScreenImage title={title} src={`data:${evidence.type};base64,${evidence.base64}`} />
  ) : (
    <p className="wt-screen-empty">The capture is not a picture.</p>
  )
}

/** A surface's picture: the latest capture, or its name and why there is no picture. */
function Shot({
  screen,
  loadEvidence,
  title = `Built ${screen.key}`,
  unavailable = screen.key,
}: {
  screen: WalkScreen
  loadEvidence?: LoadEvidence | undefined
  title?: string
  unavailable?: string
}) {
  if (screen.outcome !== "captured")
    return (
      <p className="wt-screen-empty">
        No picture. {screen.outcome === "not captured" ? "Not captured." : screen.outcome}
      </p>
    )
  if (screen.built) return <ScreenImage src={screen.built} title={title} />
  if (screen.file && loadEvidence)
    return <BuiltScreen key={screen.file} screen={screen} load={loadEvidence} title={title} />
  // A share link shows a picture as its name until the link carries pictures.
  return <p className="wt-screen-empty">{unavailable}</p>
}

/** One size and theme of a surface: the artifact beside the capture, and the independent review's verdict. */
function ScreenPair({
  screen,
  loadEvidence,
}: {
  screen: WalkScreen
  loadEvidence?: LoadEvidence | undefined
}) {
  // The matrix names each picture by its size and theme: the lead picture above carries the plain name.
  const which = `${screen.key}, ${screenSize(screen)}, ${screen.theme}`
  return (
    <div className="wt-screen" data-testid="screen-pair">
      <div className="wt-screen-head">
        <code>{screen.key}</code>
        <span>
          {screenSize(screen)} · {screen.theme}
        </span>
        <span>{screen.outcome}</span>
      </div>
      {screen.stale ? (
        <p className="wt-screen-stale">
          stale · {screen.staleReason ?? "the artifact or build changed after capture"}
        </p>
      ) : null}
      <div className="wt-screen-pair">
        <figure>
          <figcaption>Artifact</figcaption>
          <DesignedScreen screen={screen} title={`Artifact ${which}`} />
        </figure>
        <figure>
          <figcaption>Built</figcaption>
          <Shot
            screen={screen}
            loadEvidence={loadEvidence}
            title={`Built ${which}`}
            unavailable="Built picture unavailable in this copy."
          />
        </figure>
      </div>
      <p className="wt-screen-verdict">
        <b>Independent review</b> {screen.verdict}
      </p>
    </div>
  )
}

/**
 * Screens compared: one picture for each changed surface, open (the person approves what they can
 * see), and under them the independent review's comparison folded, the size and theme matrix with each artifact beside
 * its capture. Shared copies carry inert stills; local Review can also read its kept evidence.
 */
export function Screens({
  screens,
  loadEvidence,
}: {
  screens: readonly WalkScreen[]
  loadEvidence?: LoadEvidence
}) {
  const [expanded, setExpanded] = useState(false)
  const [inspected, setInspected] = useState(false)
  useEffect(() => {
    if (expanded) setInspected(true)
  }, [expanded])
  if (screens.length === 0) return null
  const surfaces = leadScreens(screens, loadEvidence)
  const stale = screens.filter((screen) => screen.stale).length
  const missing = screens.filter((screen) => screen.outcome !== "captured").length
  return (
    <Part
      id="screens"
      name="Screens compared"
      testId="wt-screens"
      note={[
        plural(surfaces.length, "surface"),
        stale > 0 ? "stale captures need refresh" : "",
        missing > 0 ? "some pictures unavailable" : "",
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <ul className="wt-shots" aria-label="The latest picture of each surface">
        {surfaces.map(({ key, lead }) => (
          <li key={key}>
            <figure className="wt-shot" data-testid="screen-shot" data-surface={key}>
              <Shot screen={lead} {...(loadEvidence !== undefined ? { loadEvidence } : {})} />
              <figcaption>
                <b>{key}</b>
                <span>{captionOf(lead)}</span>
                {lead.stale ? (
                  <span className="wt-screen-stale">
                    stale · {lead.staleReason ?? "the artifact or build changed after capture"}
                  </span>
                ) : null}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
      <details
        className="wt-matrix"
        data-testid="screen-matrix"
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary id="wt-matrix" tabIndex={-1}>
          <ChevronRightIcon aria-hidden="true" className="size-3.5 wt-disclosure-chevron" />
          <b>The independent review's comparison</b>
          <span className="wt-summary-note">
            {plural(screens.length, "screen")} compared · the size and theme matrix
          </span>
        </summary>
        {expanded || inspected
          ? screens.map((screen) => (
              <ScreenPair
                key={`${screen.key}:${screen.width}:${screen.height ?? "unknown"}:${screen.theme}`}
                screen={screen}
                loadEvidence={loadEvidence}
              />
            ))
          : null}
      </details>
    </Part>
  )
}
