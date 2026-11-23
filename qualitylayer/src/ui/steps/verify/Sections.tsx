// The review's sections (Workflow model, Verify): the Diagrams as tabs, the Interface as the Plan's
// Interface draws it (one picture a tab, what was built or the design you approved), and Done means
// as it ran, a numbered row per step that opens to its picture or output. Each tab
// leads with an icon; a result says how it was obtained.

import {
  BlocksIcon,
  LayersIcon,
  ListOrderedIcon,
  type LucideIcon,
  WorkflowIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import type { Walkthrough } from "../../../core/review/walkthrough.ts"
import { InlineMarkdown } from "../../reader/DocReader.tsx"
import { openReviewWorkspace } from "../../review-workspace/open.ts"
import { DocMarkdown } from "../../step-page/DocMarkdown.tsx"
import { GalleryTabs } from "../../step-page/kit/GalleryTabs.tsx"
import type { StepLive } from "../../step-page/live.ts"
import type { Mode, StepState } from "../../step-page/state.ts"
import { AcceptanceTabs } from "./AcceptanceTabs.tsx"
import type { ChangedDiagram } from "./record.ts"
import { ScreenTabs } from "./ScreenTabs.tsx"
import { SliceFlowGraph } from "./SliceFlowGraph.tsx"

export { AcceptanceTabs, ScreenTabs }

type Where = { state: StepState; mode: Mode; live: StepLive | undefined }

const icon = (Icon: LucideIcon) => <Icon className="size-[13px]" aria-hidden="true" />

const DIAGRAM_ICONS: Record<ChangedDiagram["kind"], LucideIcon> = {
  sequence: ListOrderedIcon,
  flow: WorkflowIcon,
  state: BlocksIcon,
}

const Caption = ({ children, hidden }: { children: ReactNode; hidden?: boolean }) =>
  children === "" || hidden === true ? null : <p className="rvw-cap">{children}</p>

/** Up to three diagrams in tabs, plus the deterministic Slice flow architecture graph when >=2 slices exist. */
export function ChangedTabs({
  diagrams,
  walk,
  taskId,
  state,
  mode,
  live,
}: {
  diagrams: readonly ChangedDiagram[]
  walk?: Walkthrough | null
  taskId?: string
} & Where) {
  const tabs = diagrams.map((item) => ({
    id: item.id,
    icon: icon(DIAGRAM_ICONS[item.kind]),
    label: item.title,
    panel: (
      <>
        <DocMarkdown
          markdown={`\`\`\`mermaid\n${item.code}\n\`\`\``}
          state={state}
          first={false}
          live={live}
        />
        <Caption>
          <InlineMarkdown text={item.caption} />
        </Caption>
      </>
    ),
  }))
  if (walk && walk.slices.length >= 2) {
    tabs.push({
      id: "slice-flow",
      icon: icon(LayersIcon),
      label: "Slice flow",
      panel: (
        <SliceFlowGraph
          walk={walk}
          {...(mode === "live" && taskId !== undefined
            ? {
                onOpenSlice: (slice, file) =>
                  openReviewWorkspace(taskId, { slice, file: file ?? null }),
              }
            : {})}
        />
      ),
    })
  }
  if (tabs.length === 0) return null
  return <GalleryTabs label="Diagrams" tabs={tabs} />
}
