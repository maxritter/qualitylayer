// The thing an item is about, drawn under it: a sandboxed mockup, a diagram, a diff or a plain
// sentence. The step pages decide which items carry media; this only draws one.

import { CheckIcon } from "lucide-react"
import { useState } from "react"
import type { ItemMedia as Media } from "../core/items.ts"
import type { Evidence } from "./api.ts"
import {
  ArtifactHostProvider,
  type ArtifactHostValue,
  ArtifactPreview,
} from "./artifact/ArtifactPreview.tsx"
import { Screenshot } from "./item-media-screenshot.tsx"
import type { Pinned } from "./reader/diagram-pins.ts"
import { type DiagramPin, MermaidBlock } from "./reader/MermaidBlock.tsx"
import { WireframeBlock } from "./reader/WireframeBlock.tsx"

/** Your own words, a few lines of them, the rest on click. */
function Words({ text }: { text: string }) {
  const [all, setAll] = useState(false)
  const long = text.length > 200
  return (
    <div className="q-words" data-testid="item-words">
      Your words: “{all || !long ? text : `${text.slice(0, 200).trimEnd()}…`}”
      {long ? (
        <button type="button" className="q-link more" onClick={() => setAll((was) => !was)}>
          {all ? "Show less" : "Read all"}
        </button>
      ) : null}
    </div>
  )
}

/** The agent's question: the choices, the recommended one marked, nothing to press. */
export function Choices({ media }: { media: Extract<Media, { kind: "choices" }> }) {
  return (
    <div data-testid="question-choices">
      <div className="q-opts">
        {media.choices.map((choice) => (
          <div
            key={choice.label}
            className={`q-opt${choice.recommended === true ? " rec" : ""}`}
            data-recommended={choice.recommended === true ? "true" : undefined}
          >
            <span className="r" aria-hidden="true" />
            <b>
              {choice.label}
              {choice.recommended === true ? " · recommended" : ""}
            </b>
            {choice.detail !== undefined ? <span className="d">{choice.detail}</span> : null}
          </div>
        ))}
      </div>
      <div className="q-where">
        <span className="q-chosen" data-testid="question-waiting">
          <CheckIcon className="size-3" aria-hidden="true" />
          Waiting for your answer
        </span>
        <span>The question and your answer stay here as a record.</span>
      </div>
    </div>
  )
}

function DiffMedia({ media }: { media: Extract<Media, { kind: "diff" }> }) {
  return (
    <div className="q-diff" data-testid="item-diff">
      <div className="q-diff-h">
        <span>{media.title}</span>
        {media.where !== undefined ? <span className="n">{media.where}</span> : null}
      </div>
      {media.lines.split("\n").map((line, index) => (
        <div
          // A diff has no ids; its lines are a fixed list.
          // biome-ignore lint/suspicious/noArrayIndexKey: lines of one diff never reorder
          key={index}
          className={`q-ln${line.startsWith("+") ? " add" : line.startsWith("-") || line.startsWith("−") ? " del" : ""}`}
        >
          {line}
        </div>
      ))}
    </div>
  )
}

function StaticMedia({
  media,
}: {
  media: Extract<Media, { kind: "choices" | "words" | "prompt" | "facts" | "diff" | "text" }>
}) {
  if (media.kind === "choices") return <Choices media={media} />
  if (media.kind === "words") return <Words text={media.text} />
  if (media.kind === "diff") return <DiffMedia media={media} />
  if (media.kind === "facts") {
    return (
      <dl className="q-facts m-0" data-testid="item-facts">
        {media.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    )
  }
  return media.kind === "prompt" ? (
    <div className="q-prompt" data-testid="item-prompt">
      {media.text}
    </div>
  ) : (
    <p className="m-0 text-[13px] text-muted-foreground">{media.text}</p>
  )
}

export function ItemMedia({
  media,
  theme,
  loadArtifact,
  loadEvidence,
  onPin,
  pins,
  artifactHost = null,
}: {
  media: Media
  theme: string
  loadArtifact: (name: string) => Promise<string>
  loadEvidence?: (name: string) => Promise<Evidence>
  /** A click on a node or an arrow of a diagram pins a comment on it. */
  onPin?: (pinned: Pinned) => void
  pins?: DiagramPin[]
  /** The task's artifacts: a mockup shows as their preview, with Open full size. */
  artifactHost?: ArtifactHostValue | null
}) {
  if (media.kind === "artifact") {
    return (
      <ArtifactHostProvider value={artifactHost}>
        <ArtifactPreview
          path={media.name.startsWith("artifacts/") ? media.name : `artifacts/${media.name}`}
          load={loadArtifact}
        />
      </ArtifactHostProvider>
    )
  }
  if (media.kind === "mermaid") {
    return (
      <MermaidBlock
        source={media.source}
        theme={theme}
        {...(media.diagram !== undefined ? { kind: media.diagram } : {})}
        {...(onPin !== undefined ? { onPin } : {})}
        {...(pins !== undefined ? { pins } : {})}
      />
    )
  }
  if (media.kind === "wireframe" || media.kind === "panel") {
    return (
      <WireframeBlock
        kind={media.kind}
        identity={media.name}
        source={media.source}
        theme={theme}
        onPin={onPin}
      />
    )
  }
  if (media.kind === "screenshot") {
    return (
      <Screenshot
        media={media}
        load={loadEvidence}
        {...(onPin !== undefined ? { onPin } : {})}
        {...(pins !== undefined ? { pins } : {})}
      />
    )
  }
  return <StaticMedia media={media} />
}
