// The Copy menu in a document's header: formatted for Confluence, Google Docs, Notion or Word
// (diagrams and mockups as images), or as Markdown for Jira, GitHub or Linear. The menu asks the
// browser what it can copy, never a list of browsers.

import { cn } from "cn"
import {
  BotIcon,
  ChevronDownIcon,
  CopyIcon,
  FileTextIcon,
  FolderIcon,
  GitBranchIcon,
  HashIcon,
  SquareTerminalIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CutText } from "@/components/ui/cut-text"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { FlowStepId } from "../../core/flow.ts"
import { writeClipboardText } from "../clipboard.ts"
import {
  type Formatted,
  forAgentMarkdown,
  type Rasterise,
  toFormatted,
  toMarkdown,
} from "./copy-out.ts"
import type { PlainBlock } from "./DocReader.tsx"
import type { Renderer } from "./MermaidBlock.tsx"

type Props = {
  /** The document without its frontmatter, and the same document as blocks. */
  body: string
  blocks: PlainBlock[]
  theme: string
  renderMermaid: Renderer
  loadArtifact: (name: string) => Promise<string>
  rasterise: Rasterise
  /**
   * The prompt that starts the build in any agent (the command that continues the approved task
   * through the CLI); offered once the Plan is approved.
   */
  forAgent?: string
  /** Under the slim bar the file's full path is copied from here, not from a second copy icon. */
  copyPath?: () => void
  /**
   * A Plan: the Markdown copy says its images stay links and that `plan export` writes the files,
   * so nobody expects a clipboard to carry local pictures into another service.
   */
  planExport?: boolean
  /** Shown beside the path in Copy path: the file's name. */
  pathHint?: string
  /** A task's branch name, copied from here rather than from a second icon in the header. */
  branch?: { name: string; copy: () => void }
  /** The trigger says "Copy" in words (a step page's title row); the Reader's bar keeps the icon alone. */
  labelled?: boolean
  /**
   * A step file with an agents' file: Copy for an agent gives `body` (the step file as Markdown),
   * then that file, read when the item is chosen. `body` is already the document that reads on its own.
   */
  agents?: {
    step: FlowStepId
    load: () => Promise<string>
    loadChecks?: () => Promise<string | null>
  }
  prepareBlocks?: () => Promise<PlainBlock[]>
  prepareFormatted?: () => Promise<Formatted>
}

/** One menu item: its icon, what it does and what it copies in a muted line under it. */
function Item({
  icon,
  title,
  hint,
  mono = false,
  onClick,
  testId,
}: {
  icon: ReactNode
  title: string
  hint: string
  mono?: boolean
  onClick: () => void
  testId?: string
}) {
  return (
    <DropdownMenuItem
      data-testid={testId}
      className="items-start gap-2.5 [&>svg]:mt-0.5 [&>svg]:text-dim"
      onClick={onClick}
    >
      {icon}
      <span className="grid min-w-0">
        <b className="font-medium">{title}</b>
        <CutText className={cn("max-w-full text-xs text-muted-foreground", mono && "font-mono")}>
          {hint}
        </CutText>
      </span>
    </DropdownMenuItem>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

function copied({ diagrams, mockups, lines }: Formatted): string {
  const parts = [
    ...(diagrams + mockups > 0
      ? [`Copied with ${plural(diagrams, "diagram")} and ${plural(mockups, "mockup")}`]
      : ["Copied"]),
    ...(lines > 0 ? [`${plural(lines, "mockup")} as a line`] : []),
  ]
  return `${parts.join("; ")}. Paste it into your page.`
}

export function CopyMenu({
  body,
  blocks,
  theme,
  renderMermaid,
  loadArtifact,
  rasterise,
  forAgent,
  copyPath,
  planExport = false,
  pathHint,
  branch,
  labelled = false,
  agents,
  prepareBlocks,
  prepareFormatted,
}: Props) {
  const [fallback, setFallback] = useState<string | null>(null)
  const writeText = async (text: string, said: string) => {
    if (await writeClipboardText(text).catch(() => false)) toast.success(said)
    else {
      setFallback(text)
      toast.error("Copy failed: select the text instead")
    }
  }
  const canFormat =
    typeof ClipboardItem !== "undefined" && ClipboardItem.supports?.("text/html") === true
  // A local picture or mockup goes as its name: the copy never publishes anything.
  const copyMarkdown = () =>
    void writeText(toMarkdown(body, true), "Copied as Markdown. Paste it into your page.")

  // The agents' file is read in the click and handed to the clipboard as it arrives. A file that
  // cannot be read is said, never left out: an agent outside QualityLayer would work on half.
  const copyForAgent = async () => {
    if (agents === undefined) return
    const joined = Promise.all([agents.load(), agents.loadChecks?.()]).then(([file, checks]) =>
      forAgentMarkdown(toMarkdown(body), agents.step, file, checks),
    )
    void joined.catch(() => {})
    const written = await writeClipboardText(joined).then(
      (ok) => ({ ok }),
      (cause: unknown) => ({ cause }),
    )
    if ("cause" in written) {
      toast.error(
        `Not copied: the agents' file could not be read (${written.cause instanceof Error ? written.cause.message : String(written.cause)})`,
      )
      return
    }
    if (written.ok)
      toast.success("Copied the step file and its agents' file. Give it to your agent.")
    else
      await writeText(
        await joined,
        "Copied the step file and its agents' file. Give it to your agent.",
      )
  }

  // The pictures take a moment to draw, and a browser only lets a click write to the clipboard:
  // the item holds the HTML as a promise, so the write starts inside the click.
  const copyFormatted = () => {
    const markdown = toMarkdown(body, true)
    const made = prepareFormatted
      ? prepareFormatted()
      : (prepareBlocks ? prepareBlocks() : Promise.resolve(blocks)).then((prepared) =>
          toFormatted(prepared, { theme, renderMermaid, loadArtifact, rasterise }),
        )
    const html = made.then((m) => new Blob([m.html], { type: "text/html" }))
    void html.catch(() => {})
    const fallback = async () => {
      try {
        await made
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : "The pictures could not be prepared. Try again.",
        )
        return
      }
      await writeText(markdown, "The browser refused formatted copy: copied as Markdown instead.")
    }
    try {
      const item = new ClipboardItem({
        "text/html": html,
        "text/plain": new Blob([markdown], { type: "text/plain" }),
      })
      void Promise.resolve(navigator.clipboard.write([item]))
        .then(async () => toast.success(copied(await made)), fallback)
        .catch(fallback)
    } catch {
      void fallback()
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className="text-muted-foreground"
              aria-label="Copy document"
              title="Copy the document"
              data-testid="copy-menu"
            />
          }
        >
          <CopyIcon aria-hidden="true" />
          {labelled ? "Copy" : null}
          <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <Item
            testId="copy-markdown"
            icon={<HashIcon aria-hidden="true" />}
            title="Copy as Markdown"
            hint={
              planExport
                ? "Jira, GitHub, Linear · names only; plan export writes picture files"
                : "Jira, GitHub, Linear"
            }
            onClick={copyMarkdown}
          />
          {canFormat ? (
            <Item
              icon={<FileTextIcon aria-hidden="true" />}
              title="Copy formatted"
              hint="Confluence, Docs, Notion, Word · pictures included"
              onClick={copyFormatted}
            />
          ) : null}
          {agents !== undefined ? (
            <Item
              testId="copy-for-agent"
              icon={<BotIcon aria-hidden="true" />}
              title="Copy for an agent"
              hint={
                agents.loadChecks
                  ? "The step, agent notes and checks"
                  : "The step file, then its agents' file"
              }
              onClick={() => void copyForAgent()}
            />
          ) : null}
          {forAgent !== undefined ? (
            <Item
              icon={<SquareTerminalIcon aria-hidden="true" />}
              title="For another agent"
              hint="A prompt that starts the build in any agent"
              onClick={() => void writeText(forAgent, "Copied. Give it to your agent.")}
            />
          ) : null}
          {copyPath !== undefined || branch !== undefined ? <DropdownMenuSeparator /> : null}
          {copyPath !== undefined ? (
            <Item
              icon={<FolderIcon aria-hidden="true" />}
              title="Copy path"
              hint={pathHint ?? "The file's full path on this computer"}
              mono={pathHint !== undefined}
              onClick={copyPath}
            />
          ) : null}
          {branch !== undefined ? (
            <Item
              icon={<GitBranchIcon aria-hidden="true" />}
              title="Copy branch name"
              hint={branch.name}
              mono
              onClick={branch.copy}
            />
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={fallback !== null}
        onOpenChange={(open) => {
          if (!open) setFallback(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy unavailable</DialogTitle>
            <DialogDescription>
              Select and copy this text. It is the exact export the clipboard could not accept.
            </DialogDescription>
          </DialogHeader>
          <textarea
            aria-label="Text to copy"
            readOnly
            value={fallback ?? ""}
            rows={12}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full resize-y rounded-md border border-input bg-transparent p-3 font-mono text-sm"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
