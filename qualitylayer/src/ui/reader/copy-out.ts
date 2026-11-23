// A document taken out of the Cockpit: the same document as HTML with each diagram and mockup
// drawn as a PNG (for Confluence, Google Docs, Notion, Word), and as clean Markdown (for Jira,
// GitHub, Linear). A picture the browser cannot draw becomes words, never a gap. The browser draws
// the pictures in rasterise.ts.

import { marked } from "marked"
import { parseArtifactReference } from "../../core/artifact/reference.ts"
import { agentFileOf, CHECKS_RECORD } from "../../core/docs/names.ts"
import { FLOW_STEPS, type FlowStepId } from "../../core/flow.ts"
import { artifactName } from "./ArtifactFrame.tsx"

export { copyPictureBody, type Formatted, type Rasterise, toFormatted } from "./copy-out-html.ts"
export { escapeHtml } from "./html-escape.ts"

export const mockupLine = (name: string) => `Mockup: ${name} (open it in QualityLayer)`

/** A document-local picture as its name; web images keep their own address. */
function localPictures(body: string): string {
  const pictures: { raw: string; text: string }[] = []
  void marked.walkTokens(marked.lexer(body), (token) => {
    if (token.type !== "image" || /^(https?:|data:)/i.test(token.href)) return
    pictures.push({
      raw: token.raw,
      text: `Picture: ${token.text || "Picture"} (open it in QualityLayer)`,
    })
  })
  let result = body
  for (const picture of pictures) result = result.replace(picture.raw, picture.text)
  return result
}

/**
 * A document's body (frontmatter already off) as Markdown for another tool. `namePictures` turns
 * each local picture into its name; a mockup always goes as its name.
 */
export function toMarkdown(body: string, namePictures = false): string {
  const out: string[] = []
  let removed = false
  for (const token of marked.lexer(body)) {
    // The blank lines that followed a removed comment go with it.
    const dropBlank = token.type === "space" && removed
    removed = false
    if (dropBlank) continue
    if (token.type === "html" && /^<!--[\s\S]*-->$/.test(token.raw.trim())) {
      removed = true
    } else if (token.type === "code" && token.lang === "artifact") {
      const tail = token.raw.slice(token.raw.trimEnd().length)
      const name = artifactName(token.text.trim())
      out.push(mockupLine(name) + tail)
    } else {
      out.push(namePictures ? localPictures(token.raw) : token.raw)
    }
  }
  return out.join("").replace(/^\n+/, "")
}

const ARTIFACT_OPEN = /^<!--\s*ql:artifact\s+(\S+?)\s*-->$/
const ARTIFACT_CLOSE = /^<!--\s*\/ql:artifact\s*-->$/

function artifactFenceFor(html: string): string | null {
  const reference = ARTIFACT_OPEN.exec(html)?.[1]
  const found = reference === undefined ? null : parseArtifactReference(reference)
  if (found === null) return null
  return `\`\`\`artifact\n${found.file}${found.section ? `#${found.section}` : ""}\n\`\`\`\n\n`
}

/**
 * A step file's `ql:artifact <name>` markers, each with the generated description between it and
 * its closing marker, as the artifact fence the copy draws or names: the mockup is what the page
 * shows there. A marker that names no artifact stays a comment, which both copies drop.
 */
function withArtifactFences(body: string): string {
  const out: string[] = []
  let skipping = false
  for (const token of marked.lexer(body)) {
    const html = token.type === "html" ? token.raw.trim() : ""
    if (skipping) {
      if (ARTIFACT_CLOSE.test(html)) skipping = false
      // A section ends the marker even when its closing line is missing.
      if (token.type !== "heading") continue
      skipping = false
    }
    const fence = artifactFenceFor(html)
    out.push(fence ?? token.raw)
    if (fence !== null) skipping = true
  }
  return out.join("")
}

/** The step file the copy comes from: which step it is, whose task, and how to read its agents' file. */
export type StepFile = {
  step: FlowStepId
  /** The task's folder name, which the copied subtitle names. */
  task?: string
  /** Reads a file of the task folder; Copy for an agent reads the agents' file with it. */
  load?: (name: string) => Promise<string>
  /** Implement also copies the newer check lines, if the task has a check record. */
  loadChecks?: (() => Promise<string | null>) | undefined
}

const labelOf = (step: FlowStepId): string => FLOW_STEPS.find((s) => s.id === step)?.label ?? step

/** The agents' file of a step file, `agents/NN-step.md`. */
export const agentsPathOf = (step: FlowStepId): string => agentFileOf(step)

const LINE_SEP = String.fromCharCode(0x2028)
const PARA_SEP = String.fromCharCode(0x2029)
const hasExtraLineBreak = (line: string): boolean =>
  line.includes("\r") || line.includes(LINE_SEP) || line.includes(PARA_SEP)

/**
 * A step file (frontmatter already off) as a document that reads on its own: the page title
 * `# Step · Title`, a one-line subtitle, then its sections in page order. A mockup marker becomes
 * the mockup it stands for; the other markers and comments stay for the two outputs to drop.
 */
export function stepCopy(body: string, { step, task }: Pick<StepFile, "step" | "task">): string {
  const label = labelOf(step)
  const n = FLOW_STEPS.findIndex((s) => s.id === step) + 1
  const rest = body.replace(/^\s+/, "")
  const newline = rest.indexOf("\n")
  const firstLine = newline < 0 ? rest : rest.slice(0, newline)
  const heading =
    firstLine.startsWith("# ") && firstLine.length > 2 && !hasExtraLineBreak(firstLine)
  const title = heading ? firstLine.slice(2).trim() : ""
  const page =
    title === ""
      ? label
      : title.toLowerCase().startsWith(label.toLowerCase())
        ? title
        : `${label} · ${title}`
  const subtitle = `QualityLayer · ${label}, step ${n} of ${FLOW_STEPS.length}${task ? ` · ${task}` : ""}`
  const sections = heading ? rest.slice(newline < 0 ? rest.length : newline + 1) : rest
  return `# ${page}\n\n_${subtitle}_\n\n${withArtifactFences(sections.replace(/^\s+/, ""))}`
}

/**
 * Copy for an agent: the step file as Markdown, then its agents' file under its own heading. The
 * agents' file loses its own title and frontmatter; the note says which of the two wins.
 */
export function forAgentMarkdown(
  stepMarkdown: string,
  step: FlowStepId,
  agentsFile: string,
  checks?: string | null,
): string {
  const body = agentsFile.replace(/^\s*# [^\n]*\n/, "")
  const newChecks = checks
    ?.split("\n## Earlier checks\n")[0]
    ?.replace(/^# Checks\n+/, "")
    .trimEnd()
  const heading = `# For agents: ${labelOf(step)} (${agentsPathOf(step)})`
  const parts = [
    stepMarkdown.trimEnd(),
    `---\n\n${heading}\n\nChanges nothing agreed; where it differs from the step file above, the step file wins.\n\n${toMarkdown(body.replace(/^\s+/, "")).trimEnd()}`,
  ]
  if (newChecks) parts.push(`---\n\n# Checks (${CHECKS_RECORD})\n\n${newChecks}`)
  return `${parts.join("\n\n")}\n`
}
