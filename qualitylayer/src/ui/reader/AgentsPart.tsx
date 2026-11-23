// The Reader's For agents heading, last in a step file: the file the agents on later steps read
// (agents/NN-step.md), marked not approved because it changes nothing agreed. It is read on demand,
// when the heading is opened or the outline jumps to it, so a step file reads on its own until then.

import { BotIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { FlowStepId } from "../../core/flow.ts"
import { agentsPathOf } from "./copy-out.ts"
import type { PlainBlock } from "./DocReader.tsx"
import { MermaidBlock, type Renderer } from "./MermaidBlock.tsx"

/** The slug of the For agents heading, which the outline lists and jumps to. */
export const AGENTS_SLUG = "for-agents"

type Read =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "ready"; blocks: PlainBlock[] }
  | { kind: "missing"; why: string }

/** The agents' file's blocks under the heading: its own title goes (every other heading steps down below). */
function withoutTitle(blocks: PlainBlock[]): PlainBlock[] {
  const first = blocks[0]
  return first?.kind === "html" && first.level === 1 ? blocks.slice(1) : blocks
}

const lower = (html: string) =>
  html.replace(
    /<(\/?)h([1-5])(?=[\s>])/g,
    (_all, slash: string, level: string) => `<${slash}h${Number(level) + 1}`,
  )

function AgentsBlock({
  block,
  theme,
  renderMermaid,
}: {
  block: PlainBlock
  theme: string
  renderMermaid: Renderer
}) {
  if (block.kind === "mermaid") {
    return (
      <MermaidBlock
        source={block.source}
        theme={theme}
        render={renderMermaid}
        {...(block.lens !== undefined ? { kind: block.lens } : {})}
      />
    )
  }
  if (block.kind === "html" || block.kind === "added") {
    return (
      <div
        className={block.kind === "html" && block.table === true ? "table-scroll" : undefined}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by DOMPurify in toBlocks
        dangerouslySetInnerHTML={{ __html: lower(block.html) }}
      />
    )
  }
  return (
    <pre>
      <code>{block.kind === "artifact" ? block.path : block.source}</code>
    </pre>
  )
}

function AgentsBody({
  read,
  theme,
  renderMermaid,
}: {
  read: Read
  theme: string
  renderMermaid: Renderer
}) {
  if (read.kind === "loading") {
    return <p className="text-[13px] text-muted-foreground">Reading the agents' file…</p>
  }
  if (read.kind === "missing") {
    return (
      <p className="text-[13px] text-muted-foreground" role="status">
        {read.why}
      </p>
    )
  }
  if (read.kind !== "ready") return null
  return (
    <>
      <p className="m-0 mt-2 text-[13px] text-muted-foreground">
        Changes nothing agreed; where it differs from the step file above, the step file wins.
      </p>
      {read.blocks.map((block) => (
        <AgentsBlock key={block.key} block={block} theme={theme} renderMermaid={renderMermaid} />
      ))}
    </>
  )
}

function useAgentsRead(load: () => Promise<string>, parse: (markdown: string) => PlainBlock[]) {
  const [read, setRead] = useState<Read>({ kind: "closed" })
  const loader = useRef(load)
  loader.current = load
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  const show = () => {
    const current = ++generation.current
    setRead({ kind: "loading" })
    loader.current().then(
      (markdown) => {
        if (generation.current === current)
          setRead({ kind: "ready", blocks: withoutTitle(parse(markdown)) })
      },
      (cause: unknown) => {
        if (generation.current === current)
          setRead({ kind: "missing", why: cause instanceof Error ? cause.message : String(cause) })
      },
    )
  }
  const hide = () => {
    generation.current++
    setRead({ kind: "closed" })
  }
  return { read, open: read.kind !== "closed", show, hide }
}

export function AgentsPart({
  step,
  load,
  parse,
  theme,
  renderMermaid,
  jump,
}: {
  step: FlowStepId
  /** Reads the agents' file's text; called each time the section opens, so it is never stale. */
  load: () => Promise<string>
  /** The Reader's own Markdown reading (`toBlocks`), handed in so the two files do not import each other. */
  parse: (markdown: string) => PlainBlock[]
  theme: string
  renderMermaid: Renderer
  /** The outline jumped here: changes on every jump, so the same jump opens it again. */
  jump?: number | undefined
}) {
  const path = agentsPathOf(step)
  const own = useRef<HTMLElement | null>(null)
  const { read, open, show, hide } = useAgentsRead(load, parse)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a jump (its counter) opens the section
  useEffect(() => {
    if (jump === undefined) return
    if (!open) show()
    own.current?.scrollIntoView?.({ block: "start" })
  }, [jump])

  return (
    <section
      ref={own}
      id={AGENTS_SLUG}
      className="mt-12 border-t border-line pt-5"
      data-reader-agents=""
      data-testid="reader-agents"
      aria-label="For agents"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 flex items-center gap-2 text-[17px]" data-agents-h="">
          <BotIcon aria-hidden="true" className="size-4 text-dim" />
          For agents
        </h2>
        <span
          className="rounded-full border border-line px-2 text-[11.5px] leading-5 text-muted-foreground"
          data-testid="agents-not-approved"
        >
          not approved
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto text-muted-foreground"
          aria-expanded={open}
          aria-controls="reader-agents-body"
          onClick={() => (open ? hide() : show())}
        >
          {open ? <ChevronDownIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      <p className="m-0 mt-1.5 truncate font-mono text-[12px] text-muted-foreground" title={path}>
        {path}
      </p>
      <div id="reader-agents-body" aria-live="polite">
        <AgentsBody read={read} theme={theme} renderMermaid={renderMermaid} />
      </div>
    </section>
  )
}
