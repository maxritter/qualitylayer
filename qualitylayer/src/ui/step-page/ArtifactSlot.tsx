// The Plan's Interface: a preview of the artifact the Plan names, with "Open in card", and the look
// the Plan asks for under it. The card carries "Open full size", which opens the full viewer through
// the task's artifact host. The preview reads and draws its page only near the viewport, and holds
// its height before and after.

import { ImageIcon } from "lucide-react"
import { createPortal } from "react-dom"
import { parseArtifactReference } from "../../core/artifact/reference.ts"
import { ArtifactPreview } from "../artifact/ArtifactPreview.tsx"
import type { PreviewScreenEntry } from "../artifact/ArtifactPreviewDialog.tsx"
import { useActionSlot } from "../kit/action-slot.ts"
import { WhoMark } from "../kit/WhoMark.tsx"
import { Answers, markOf, Pin } from "./Answers.tsx"
import type { StepLive } from "./live.ts"
import { type ArtifactView, jumpId, type Mode } from "./state.ts"

export function ArtifactSlot({
  artifact,
  mode,
  live,
  screens,
}: {
  artifact: ArtifactView
  mode: Mode
  live: StepLive | undefined
  screens?: readonly PreviewScreenEntry[]
}) {
  const look = artifact.look
  const projectReference = parseArtifactReference(artifact.name)?.scope === "project"
  // In a row that names the screen (the Interface tabs), the still's note goes to the row's end.
  const slot = useActionSlot()
  const snap = (
    <span className="sp-snap">
      <ImageIcon className="size-3" aria-hidden="true" />
      {projectReference ? "Project artifact" : "A picture, not the live artifact"}
    </span>
  )
  return (
    <div
      className="sp-mk"
      id={jumpId(`artifact-${artifact.name}`)}
      tabIndex={-1}
      data-testid="artifact-slot"
    >
      {mode === "live" && live !== undefined && artifact.file !== undefined ? (
        <ArtifactPreview
          path={artifact.file}
          title={artifact.title}
          load={live.loadArtifact}
          {...(screens !== undefined ? { screens } : {})}
          {...(live.openArtifact !== undefined
            ? { onOpen: () => live.openArtifact?.(artifact.name) }
            : {})}
        />
      ) : (
        <>
          {slot === null ? (
            <div className="sp-mk-bar">
              <span>artifact · {artifact.title}</span>
              <span className="sp">{snap}</span>
            </div>
          ) : slot.shown && slot.element !== null ? (
            createPortal(snap, slot.element)
          ) : null}
          <div className="sp-mk-ph">
            {projectReference
              ? "This project artifact is unavailable in this shared task. Open it in the owning project."
              : "The artifact shows full size in the author's QualityLayer."}
          </div>
        </>
      )}
      {look !== undefined ? (
        <div className={look.state === "open" ? "sp-dk" : "sp-dk done"}>
          <span className="w">
            <WhoMark who={markOf(look)} />
            <span className="kd">Look</span>
            {look.what}
            <Pin n={look.pins} />
          </span>
          <Answers card={look} mode={mode} live={live} />
        </div>
      ) : null}
    </div>
  )
}
