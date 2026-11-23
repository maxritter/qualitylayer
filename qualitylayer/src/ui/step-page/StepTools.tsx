// The step page's document tools, at the end of its title row on every step: the Copy menu (the
// document formatted or as Markdown, a prompt for another agent on the Plan, the file's path, the task's
// branch name) and the Sections outline. The step pages draw their sections themselves, so the Reader's
// header row, where these used to stand, is not on them. Both are the Reader's own components.

import { useMemo, useRef } from "react"
import type { DocSections, TaskDetail } from "../api.ts"
import { ExportCard } from "../export/ExportCard.tsx"
import { workflowExport, workflowFormatted } from "../export/workflow-export.ts"
import { CopyMenu } from "../reader/CopyMenu.tsx"
import { agentsPathOf, copyPictureBody, stepCopy } from "../reader/copy-out.ts"
import {
  OUTLINE_MIN,
  OutlineButton,
  type OutlineEntry,
  outlineOf,
  withSectionShow,
} from "../reader/DocOutline.tsx"
import { stripFrontmatter, toBlocks } from "../reader/DocReader.tsx"
import { renderWithMermaid } from "../reader/MermaidBlock.tsx"
import { browserRasterise } from "../reader/rasterise.ts"
import type { StepDocument } from "./document.ts"
import { jumpTo } from "./jump.ts"
import type { StepLive } from "./live.ts"
import { sectionId } from "./sections.ts"

/** The prompt that starts the build in any agent: Copy › For another agent; present once the Plan is approved. */
export function forAgentOf(task: Pick<TaskDetail, "slug" | "implementStart">): string | undefined {
  const prompt = task.implementStart?.agents.find((a) => a.agent === "other")?.prompt
  return prompt !== undefined
    ? `Continue the approved QualityLayer task "${task.slug}" in this repository: run \`${prompt}\` and follow what each reply says until it reports done.`
    : undefined
}

const noArtifact = () => Promise.reject(new Error("This page has no artifacts to load"))

/** The step page's sections: the document's second-level headings, those the page draws. */
function sectionsOf(markdown: string, cut: DocSections | null | undefined): OutlineEntry[] {
  const found = outlineOf(markdown).filter((entry) => entry.level === 2)
  const entries = cut ? withSectionShow(found, cut.sections) : found
  return entries.length >= OUTLINE_MIN ? entries.filter((entry) => entry.show !== "detail") : []
}

function trimTrailingSlashes(folder: string | undefined): string | undefined {
  if (folder === undefined) return undefined
  let end = folder.length
  while (end > 0 && (folder[end - 1] === "/" || folder[end - 1] === "\\")) end--
  return folder.slice(0, end)
}

function jumpToOutlineEntry(
  container: HTMLElement | null,
  entries: readonly OutlineEntry[],
  slug: string,
) {
  const entry = entries.find((each) => each.slug === slug)
  const page = container?.closest<HTMLElement>(".sp-page")
  if (entry === undefined || !page) return
  const target =
    page.querySelector<HTMLElement>(`[data-passage-section="${entry.slug}"]`) ??
    page.querySelector<HTMLElement>(`#${sectionId(entry.text)}`) ??
    [...page.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")].find(
      (element) => element.textContent?.trim().replace(/\s+/g, " ") === entry.text,
    )
  jumpTo(target ?? page.querySelector<HTMLElement>("h1") ?? page)
}

function copyMenuOptions(doc: StepDocument, dir: string | undefined, live: StepLive | undefined) {
  const loadDoc = (live as Partial<StepLive> | undefined)?.loadDoc
  const copyDoc = live?.copyDoc
  const branchName = copyDoc?.branch
  return {
    ...(loadDoc !== undefined
      ? { agents: { step: doc.step, load: () => loadDoc(agentsPathOf(doc.step)) } }
      : {}),
    ...(copyDoc?.planExport === true && doc.step === "plan" ? { planExport: true } : {}),
    ...(copyDoc?.forAgent !== undefined && doc.step === "plan"
      ? { forAgent: copyDoc.forAgent }
      : {}),
    ...(live !== undefined && dir !== undefined
      ? { copyPath: () => void live.copy(`${dir}/${doc.file}`, "Copied the path") }
      : {}),
    ...(live !== undefined && branchName
      ? {
          branch: {
            name: branchName,
            copy: () => void live.copy(branchName, "Copied the branch name"),
          },
        }
      : {}),
  }
}

function StepExportCard({
  doc,
  plain,
  task,
  live,
}: {
  doc: StepDocument
  plain: string
  task: string | undefined
  live: StepLive
}) {
  const isPlan = doc.step === "plan"
  const title = `${live.exportContext?.title ?? task ?? "Task"} · ${isPlan ? "Plan" : "Review"}`
  return (
    <ExportCard
      kind={isPlan ? "plan" : "review"}
      title={title}
      disabled={!plain.trim()}
      write={live.exportFile}
      prepare={async (format, _scope, signal) => {
        if (!live.exportFile) throw new Error("Export is available in the App.")
        return workflowExport({
          body: plain,
          title,
          format,
          signal,
          state: live.exportContext?.recordedDecision,
          write: live.exportFile,
          loadArtifact: live.loadArtifact,
          loadEvidence: live.loadEvidence,
        })
      }}
    />
  )
}

export function StepTools({
  doc,
  cut,
  live,
}: {
  doc: StepDocument
  cut: DocSections | null | undefined
  live: StepLive | undefined
}) {
  const file = doc.file
  const tools = useRef<HTMLSpanElement | null>(null)
  // Without the task folder there is no path to copy; the document still copies.
  const dir = trimTrailingSlashes((live as Partial<StepLive> | undefined)?.dir)
  const task = dir?.split(/[\\/]/).pop()
  // The copies are the step file as a document that reads on its own: no markers, no agents' file,
  // pictures for the diagrams and mockups; Copy for an agent adds the agents' file after it.
  const plain = useMemo(
    () =>
      stepCopy(stripFrontmatter(doc.markdown), {
        step: doc.step,
        ...(task !== undefined && task !== "" ? { task } : {}),
      }),
    [doc.markdown, doc.step, task],
  )
  const blocks = useMemo(() => toBlocks(plain), [plain])
  const entries = useMemo(() => sectionsOf(doc.markdown, cut), [doc.markdown, cut])
  const exportFile = live?.exportFile
  const prepareFormatted = exportFile
    ? () =>
        workflowFormatted({
          body: plain,
          write: exportFile,
          loadArtifact: live.loadArtifact,
          loadEvidence: live.loadEvidence,
        }).then((result) => result.formatted)
    : undefined
  const canExport = (doc.step === "plan" || doc.step === "verify") && live !== undefined
  return (
    <span className="contents" ref={tools}>
      <CopyMenu
        labelled
        body={plain}
        blocks={blocks}
        theme={live?.theme ?? "light"}
        renderMermaid={renderWithMermaid}
        loadArtifact={live?.loadArtifact ?? noArtifact}
        rasterise={browserRasterise}
        prepareFormatted={prepareFormatted}
        pathHint={file}
        prepareBlocks={async () => {
          const load = live?.loadEvidence
          return load ? toBlocks(await copyPictureBody(plain, load)) : blocks
        }}
        {...copyMenuOptions(doc, dir, live)}
      />
      {canExport ? <StepExportCard doc={doc} plain={plain} task={task} live={live} /> : null}
      {entries.length > 0 ? (
        <OutlineButton
          always
          path={file}
          entries={entries}
          active={null}
          onJump={(slug) => jumpToOutlineEntry(tools.current, entries, slug)}
        />
      ) : null}
    </span>
  )
}
