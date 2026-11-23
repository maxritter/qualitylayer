// The Plan's pictures and its test, each a gallery of tabs (Workflow model: Plan): Diagrams in the
// App's own diagram view, Interface as the artifact preview cards; Done means is a numbered list of
// points that open in place to the steps that prove them. A bug's Done means shows each step's Before
// the fix and After the fix. Each draws from the text the document holds.

import {
  BlocksIcon,
  BookOpenIcon,
  FileDiffIcon,
  GitBranchIcon,
  HomeIcon,
  ListOrderedIcon,
  type LucideIcon,
  MonitorIcon,
  SettingsIcon,
  TerminalIcon,
  WorkflowIcon,
} from "lucide-react"
import { type ReactNode, useRef, useState } from "react"
import { parseArtifactReference } from "../../../core/artifact/reference.ts"
import { headingSlug } from "../../../core/docs/anchor.ts"
import { useGalleryThumbnails } from "../../artifact/ArtifactPreview.tsx"
import { InlineMarkdown } from "../../reader/DocReader.tsx"
import { MermaidBlock, usePageTheme } from "../../reader/MermaidBlock.tsx"
import { ArtifactSlot } from "../../step-page/ArtifactSlot.tsx"
import { CommentBlock } from "../../step-page/DocMarkdown.tsx"
import { GalleryTabs } from "../../step-page/kit/GalleryTabs.tsx"
import type { StepLive } from "../../step-page/live.ts"
import type { Mode, StepState } from "../../step-page/state.ts"
import { AcceptanceList, RunKindMark, RunMark } from "./AcceptanceList.tsx"
import type { DiagramItem, InterfaceItem } from "./plan-model.ts"

export { AcceptanceList, RunKindMark, RunMark }

type Where = {
  state: StepState
  mode: Mode
  live: StepLive | undefined
}

const icon = (Icon: LucideIcon) => <Icon className="size-[13px]" aria-hidden="true" />

const DIAGRAM_ICONS: Record<DiagramItem["kind"], LucideIcon> = {
  "before-after": BlocksIcon,
  flow: WorkflowIcon,
  sequence: ListOrderedIcon,
  state: WorkflowIcon,
}

/** A titled part of the core with its icon (fixed structure carries one; the tabs inside carry their own). */
export function PlanPart({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string
  icon: LucideIcon
  action?: ReactNode
  children: ReactNode
}) {
  const id = `bd-sec-${headingSlug(title)}-h`
  return (
    <section className="bd-part pl-part" aria-label={title} data-testid="step-part">
      <h2 id={id} tabIndex={-1} data-passage-section={headingSlug(title)}>
        <Icon className="size-3.5" aria-hidden="true" />
        {title}
        {action !== undefined ? <span className="pl-part-action">{action}</span> : null}
      </h2>
      {children}
    </section>
  )
}

const Caption = ({ text }: { text: string }) =>
  text === "" ? null : (
    <p className="pl-cap">
      <InlineMarkdown text={text} />
    </p>
  )

const isVerticalFlow = (code: string) =>
  /^[^\S\r\n\u2028\u2029]*(?:flowchart|graph)\s+(?:TB|TD)\b/m.test(code)

/** Named choices and a readable figure; a vertical flow keeps its drawn height. */
export function DiagramTabs({ items, live }: { items: readonly DiagramItem[] } & Where) {
  const theme = usePageTheme()
  if (items.length === 0) return null
  return (
    <GalleryTabs
      named
      collection="diagrams"
      label="Diagrams"
      tabs={items.map((item) => {
        const vertical = isVerticalFlow(item.code)
        return {
          id: item.id,
          icon: icon(vertical ? GitBranchIcon : DIAGRAM_ICONS[item.kind]),
          label: item.title,
          caption:
            item.caption.replace(/[.!?]$/, "") === item.title ? null : (
              <Caption text={item.caption} />
            ),
          panel: (
            <CommentBlock raw={`\`\`\`mermaid\n${item.code}\n\`\`\``} live={live}>
              <MermaidBlock
                source={item.code}
                theme={live?.theme ?? theme}
                title={item.title}
                gallery={vertical ? "natural" : "fit"}
              />
            </CommentBlock>
          ),
        }
      })}
    />
  )
}

const screenIcon = (item: InterfaceItem): LucideIcon => {
  if (item.artifact === null) return item.lang === "diff" ? FileDiffIcon : TerminalIcon
  if (/setting/i.test(item.title)) return SettingsIcon
  if (/first|start|home/i.test(item.title)) return HomeIcon
  if (/guide|doc|readme/i.test(item.title)) return BookOpenIcon
  return MonitorIcon
}

/** An output the design shows: a picker or terminal text, or a change as added and removed lines. */
function CodeScreen({ item }: { item: InterfaceItem }) {
  const lines = (item.code ?? "").split("\n")
  if (item.lang === "diff")
    return (
      <div className="pl-diff" data-testid="plan-diff">
        {lines.map((line, at) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: the lines are a fixed list in document order
            key={at}
            className={line.startsWith("-") ? "del" : line.startsWith("+") ? "add" : ""}
          >
            {line}
          </div>
        ))}
      </div>
    )
  return (
    <pre className="pl-term" data-testid="plan-output">
      {item.code}
    </pre>
  )
}

/** The artifact's preview card, or the output; a missing artifact says so in one line. */
function Screen({ item, state, mode, live }: { item: InterfaceItem } & Where) {
  if (item.artifact === null) return <CodeScreen item={item} />
  const artifact = state.plan?.artifacts[item.artifact]
  return artifact === undefined ? (
    <p className="pl-cap">The artifact {item.artifact} is not in this task.</p>
  ) : (
    <ArtifactSlot artifact={artifact} mode={mode} live={live} />
  )
}

function ArtifactMiniature({ src, fallback }: { src: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState<string>()
  if (failed === src) return fallback
  // biome-ignore lint/performance/noImgElement: the App serves a pre-sized thumbnail from its own artifact cache
  return <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} />
}

/** One selected preview with its existing card and full-size destination. */
export function InterfaceTabs({ items, ...where }: { items: readonly InterfaceItem[] } & Where) {
  const ref = useRef<HTMLDivElement>(null)
  const thumbnails = useGalleryThumbnails(
    ref,
    where.mode === "live" && items.length > 1 && items.some((item) => item.artifact !== null),
  )
  if (items.length === 0) return null
  return (
    <div ref={ref}>
      <GalleryTabs
        named
        collection="artifacts"
        label="Interface"
        tabs={items.map((item) => {
          const path =
            item.artifact === null ? undefined : where.state.plan?.artifacts[item.artifact]?.file
          const file = path ? parseArtifactReference(path)?.file : undefined
          const thumb = file ? thumbnails?.get(file) : undefined
          return {
            id: item.id,
            icon: icon(screenIcon(item)),
            label: item.title,
            caption: <Caption text={item.caption} />,
            thumbnail: thumb ? (
              <ArtifactMiniature src={thumb} fallback={icon(screenIcon(item))} />
            ) : undefined,
            panel: <Screen item={item} {...where} />,
          }
        })}
      />
    </div>
  )
}
