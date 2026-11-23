// The centre column: one document at reading width, split into top-level
// blocks. A text selection in it is a mark: `onMark` opens the quick field
// there, whose message goes to the task's session with the passage as context.

import { marked } from "marked"
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { headingSlug } from "../../core/docs/anchor.ts"
import type { Evidence } from "../api.ts"
import type { ExportWriter } from "../export/ExportCard.tsx"
import { workflowFormatted } from "../export/workflow-export.ts"
import { useClaimReaderBar, useReaderBarSlot } from "../sidebar/ReaderBar.tsx"
import { LeadFold } from "../step-page/LeadFold.tsx"
import { useSectionViewing } from "../viewing.tsx"
import { AGENTS_SLUG, AgentsPart } from "./AgentsPart.tsx"
import { CopyMenu } from "./CopyMenu.tsx"
import {
  agentsPathOf,
  copyPictureBody,
  type Rasterise,
  type StepFile,
  stepCopy,
} from "./copy-out.ts"
import { type Block, type PlainBlock, toBlocks } from "./doc-blocks.ts"
import {
  detailKeysOf,
  jumpsTo,
  leadFoldsOf,
  rangeOfQuote,
  readerDimmed,
  withLeadFolds,
} from "./doc-folds.ts"
import { markdownRenderer, neutralise, sanitize, stripFrontmatter } from "./doc-markdown.ts"
import { FoldButtons } from "./FoldedParts.tsx"
import { type Fold, foldDocument, glanceKind, withoutSections } from "./folding.ts"
import { type Renderer, renderWithMermaid } from "./MermaidBlock.tsx"
import {
  ReaderBlock,
  type ReaderMark,
  useReaderBackHighlight,
  useReaderJumpEffect,
  useReaderSelectionEffect,
} from "./ReaderBlock.tsx"
import { browserRasterise } from "./rasterise.ts"

export { passageSection, selectedPassage } from "./selected-passage.ts"
export {
  type Block,
  leadFoldsOf,
  type PlainBlock,
  type ReaderMark,
  rangeOfQuote,
  readerDimmed,
  sanitize,
  stripFrontmatter,
  toBlocks,
  withLeadFolds,
}

/**
 * One line of agent-written prose with its bold, italics and code, rendered and sanitised the way
 * the document reader renders them.
 */
export const InlineMarkdown = memo(function InlineMarkdown({ text }: { text: string }) {
  const tokens = marked.Lexer.lexInline(text)
  neutralise(tokens)
  // Sanitised inside an element: a parser may treat a tag at the very start of a string
  // specially (the test DOM's drops a leading <strong>), and the line is inline anyway.
  const html = sanitize(
    `<span>${marked.Parser.parseInline(tokens, { renderer: markdownRenderer() })}</span>`,
  )
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by the reader's own sanitiser
  return <span dangerouslySetInnerHTML={{ __html: html }} />
})

type Props = {
  exportFile?: ExportWriter
  markdown: string
  theme: string
  loadArtifact: (name: string) => Promise<string>
  loadEvidence?: (name: string) => Promise<Evidence>
  onMark?: (mark: ReaderMark) => void
  back?: { quote: string; before?: string; after?: string; key: number }
  renderMermaid?: Renderer
  rasterise?: Rasterise
  at?: string
  jumpKey?: number
  forAgent?: string
  planExport?: boolean
  hide?: readonly string[]
  unfolded?: boolean
  tools?: React.ReactNode
  dimmed?: ReadonlySet<string>
  folded?: ReadonlySet<string>
  artifacts?: { open?: ((name: string) => void) | undefined }
  stepFile?: StepFile
}

function useReaderBarHost(page: React.RefObject<HTMLDivElement | null>) {
  const bar = useReaderBarSlot()
  const [barHost, setBarHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const around = bar?.element.closest(".rs-crumb")?.parentElement
    setBarHost(
      bar !== null && around != null && page.current !== null && around.contains(page.current)
        ? bar.element
        : null,
    )
  }, [bar, page])
  useClaimReaderBar(barHost !== null)
  return { bar, barHost }
}

function passageSectionsOf(plain: readonly PlainBlock[]): Map<string, string> {
  const sections = new Map<string, string>()
  let section = ""
  for (const block of plain) {
    if (block.kind === "html" && block.heading !== undefined) section = headingSlug(block.heading)
    if (section) sections.set(block.key, section)
  }
  return sections
}

function DocReaderTools({
  tools,
  copied,
  theme,
  renderMermaid,
  loadArtifact,
  rasterise,
  exportFile,
  loadEvidence,
  stepFile,
  forAgent,
  planExport,
  copyPath,
}: {
  tools?: React.ReactNode
  copied: { body: string; blocks: PlainBlock[] }
  theme: string
  renderMermaid: Renderer
  loadArtifact: (name: string) => Promise<string>
  rasterise: Rasterise
  exportFile?: ExportWriter
  loadEvidence?: (name: string) => Promise<Evidence>
  stepFile?: StepFile
  forAgent?: string
  planExport?: boolean
  copyPath?: () => void
}) {
  const stepId = stepFile?.step
  const loadAgents = stepFile?.load
  const agentsProp =
    stepId !== undefined && loadAgents !== undefined
      ? {
          agents: {
            step: stepId,
            load: () => loadAgents(agentsPathOf(stepId)),
            ...(stepFile?.loadChecks !== undefined ? { loadChecks: stepFile.loadChecks } : {}),
          },
        }
      : {}
  return (
    <>
      {tools}
      <CopyMenu
        body={copied.body}
        blocks={copied.blocks}
        theme={theme}
        renderMermaid={renderMermaid}
        loadArtifact={loadArtifact}
        rasterise={rasterise}
        prepareFormatted={
          exportFile
            ? () =>
                workflowFormatted({
                  body: copied.body,
                  write: exportFile,
                  loadArtifact,
                  loadEvidence,
                }).then((result) => result.formatted)
            : undefined
        }
        prepareBlocks={async () => {
          const load = loadEvidence
          return load ? toBlocks(await copyPictureBody(copied.body, load)) : copied.blocks
        }}
        {...agentsProp}
        {...(forAgent !== undefined ? { forAgent } : {})}
        {...(planExport === true ? { planExport: true } : {})}
        {...(copyPath !== undefined ? { copyPath } : {})}
      />
    </>
  )
}

function DocReaderContent({
  blocks,
  leadFolds,
  folds,
  foldOpen,
  onToggleFold,
  renderBlock,
}: {
  blocks: readonly Block[]
  leadFolds: ReturnType<typeof leadFoldsOf>
  folds: Fold[]
  foldOpen: (id: string) => boolean
  onToggleFold: (id: string) => void
  renderBlock: (block: Block) => React.ReactNode
}) {
  const visible = blocks.filter((b) => b.fold === undefined)
  return (
    <>
      {withLeadFolds(visible, leadFolds).map((group) =>
        group.kind === "one" ? (
          renderBlock(group.block)
        ) : (
          <LeadFold
            key={group.id}
            whole={group.whole}
            diagram={group.blocks.some((b) => b.kind === "mermaid")}
          >
            {group.blocks.map(renderBlock)}
          </LeadFold>
        ),
      )}
      {folds.length > 0 ? (
        <FoldButtons folds={folds} isOpen={foldOpen} toggle={onToggleFold} />
      ) : null}
      {folds
        .filter((fold) => foldOpen(fold.id))
        .flatMap((fold) => blocks.filter((b) => b.fold === fold.id).map(renderBlock))}
    </>
  )
}

export function DocReader({
  markdown,
  theme,
  loadArtifact,
  onMark,
  back,
  renderMermaid = renderWithMermaid,
  rasterise = browserRasterise,
  at,
  jumpKey,
  forAgent,
  planExport,
  hide,
  unfolded = false,
  tools,
  dimmed,
  folded,
  artifacts,
  stepFile,
  loadEvidence,
  exportFile,
}: Props) {
  const drawsArtifacts = artifacts !== undefined
  const plain = useMemo(
    () => toBlocks(markdown, { artifacts: drawsArtifacts }),
    [markdown, drawsArtifacts],
  )
  const stepTask = stepFile?.task
  const stepId = stepFile?.step
  const copied = useMemo(() => {
    const body = stripFrontmatter(markdown)
    const text = stepId !== undefined ? stepCopy(body, { step: stepId, task: stepTask }) : body
    return { body: text, blocks: stepId !== undefined ? toBlocks(text) : plain }
  }, [markdown, plain, stepId, stepTask])
  const loadAgents = stepFile?.load
  const { blocks, folds } = useMemo(() => {
    const shown =
      !unfolded && hide !== undefined && hide.length > 0 ? withoutSections(plain, hide) : plain
    return glanceKind(markdown) === null || unfolded
      ? { blocks: shown, folds: [] as Fold[] }
      : foldDocument(shown)
  }, [markdown, plain, hide, unfolded])
  const detailKeys = useMemo(() => detailKeysOf(blocks, dimmed), [blocks, dimmed])
  const leadFolds = useMemo(() => leadFoldsOf(blocks, folded), [blocks, folded])
  const passageSections = useMemo(() => passageSectionsOf(plain), [plain])
  const page = useRef<HTMLDivElement>(null)
  const { bar, barHost } = useReaderBarHost(page)
  const [chosen, setChosen] = useState<Record<string, boolean>>({})

  useSectionViewing(page, markdown, at)
  useReaderJumpEffect({ page, at, blocks, jumpKey })
  useReaderSelectionEffect({ page, markdown, onMark })
  useReaderBackHighlight({ page, back, blocks })

  const foldOpen = (id: string) =>
    chosen[id] ?? blocks.some((b) => b.fold === id && at !== undefined && jumpsTo(b, at))

  const renderBlock = (block: Block) => (
    <ReaderBlock
      key={block.key}
      block={block}
      isDetail={detailKeys.has(block.key)}
      section={passageSections.get(block.key)}
      theme={theme}
      renderMermaid={renderMermaid}
      loadArtifact={loadArtifact}
      artifactsOpen={artifacts?.open}
      at={at}
    />
  )

  const toolRow = (
    <DocReaderTools
      tools={tools}
      copied={copied}
      theme={theme}
      renderMermaid={renderMermaid}
      loadArtifact={loadArtifact}
      rasterise={rasterise}
      exportFile={exportFile}
      loadEvidence={loadEvidence}
      stepFile={stepFile}
      forAgent={forAgent}
      planExport={planExport}
      copyPath={bar?.copyPath != null && barHost !== null ? bar.copyPath : undefined}
    />
  )

  return (
    <div className="page" ref={page} data-testid="doc-reader">
      {barHost !== null ? (
        createPortal(toolRow, barHost)
      ) : (
        <div className="doc-tools" data-testid="doc-tools">
          {toolRow}
        </div>
      )}
      <DocReaderContent
        blocks={blocks}
        leadFolds={leadFolds}
        folds={folds}
        foldOpen={foldOpen}
        onToggleFold={(id) => setChosen({ ...chosen, [id]: !foldOpen(id) })}
        renderBlock={renderBlock}
      />
      {stepId !== undefined && loadAgents !== undefined ? (
        <AgentsPart
          key={`${stepTask ?? ""}:${stepId}`}
          step={stepId}
          load={() => loadAgents(agentsPathOf(stepId))}
          parse={toBlocks}
          theme={theme}
          renderMermaid={renderMermaid}
          jump={at === AGENTS_SLUG ? (jumpKey ?? 0) : undefined}
        />
      ) : null}
    </div>
  )
}
