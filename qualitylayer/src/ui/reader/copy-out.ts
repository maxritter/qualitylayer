// A document taken out of the Cockpit: the same document as HTML with each diagram and mockup
// drawn as a PNG (for Confluence, Google Docs, Notion, Word), and as clean Markdown (for Jira,
// GitHub, Linear). A picture the browser cannot draw becomes words, never a gap. The browser draws
// the pictures in rasterise.ts.

import { marked } from "marked"
import { parseArtifactReference } from "../../core/artifact/reference.ts"
import { agentFileOf } from "../../core/docs/names.ts"
import { FLOW_STEPS, type FlowStepId } from "../../core/flow.ts"
import { artifactName } from "./ArtifactFrame.tsx"
import type { PlainBlock } from "./DocReader.tsx"
import { escapeHtml } from "./html-escape.ts"
import type { Renderer } from "./MermaidBlock.tsx"

export { escapeHtml } from "./html-escape.ts"

/** What draws the pictures: a canvas, which a test DOM does not have. Each returns a PNG data URI. */
export type Rasterise = {
  diagram(svg: string): Promise<string>
  mockup(html: string): Promise<string>
}

export type Formatted = {
  html: string
  /** What went as an image, and the mockups that went as their line instead. */
  diagrams: number
  mockups: number
  lines: number
}

/** Resolve local pictures through the task's existing read capability; copy never publishes them. */
export async function copyPictureBody(
  body: string,
  load: (name: string) => Promise<{ kind: string; type?: string; base64?: string }>,
): Promise<string> {
  const images: { raw: string; name: string; title: string }[] = []
  void marked.walkTokens(marked.lexer(body), (token) => {
    if (token.type === "image" && !/^(https?:|data:)/i.test(token.href))
      images.push({ raw: token.raw, name: token.href, title: token.text || "Picture" })
  })
  let result = body
  for (const image of images) {
    let replacement = `Picture: ${image.title} (not included in this copy)`
    try {
      const found = await load(image.name.replace(/^evidence\//, ""))
      if (
        found.kind === "image" &&
        /^image\/(?:png|jpeg|webp|gif)$/.test(found.type ?? "") &&
        found.base64 &&
        /^[A-Za-z0-9+/=]+$/.test(found.base64)
      )
        replacement = `![${image.title.replace(/[\\[\]]/g, "\\$&")}](data:${found.type};base64,${found.base64})`
    } catch {
      /* The copied document names the omitted picture. */
    }
    result = result.replace(image.raw, replacement)
  }
  return result
}

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
    const reference = ARTIFACT_OPEN.exec(html)?.[1]
    const found = reference === undefined ? null : parseArtifactReference(reference)
    if (found === null) {
      out.push(token.raw)
      continue
    }
    out.push(`\`\`\`artifact\n${found.file}${found.section ? `#${found.section}` : ""}\n\`\`\`\n\n`)
    skipping = true
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
}

const labelOf = (step: FlowStepId): string => FLOW_STEPS.find((s) => s.id === step)?.label ?? step

/** The agents' file of a step file, `agents/NN-step.md`. */
export const agentsPathOf = (step: FlowStepId): string => agentFileOf(step)

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
    firstLine.startsWith("# ") && firstLine.length > 2 && !/[\r\u2028\u2029]/.test(firstLine)
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
): string {
  const body = agentsFile.replace(/^\s*# [^\n]*\n/, "")
  return `${stepMarkdown.trimEnd()}\n\n---\n\n# For agents: ${labelOf(step)} (${agentsPathOf(step)})\n\nChanges nothing agreed; where it differs from the step file above, the step file wins.\n\n${toMarkdown(body.replace(/^\s+/, "")).trimEnd()}\n`
}

type Host = {
  artifactPicture?: (path: string) => Promise<string>
  theme: string
  renderMermaid: Renderer
  loadArtifact: (name: string) => Promise<string>
  rasterise: Rasterise
}

type Piece = { html: string; made?: "diagram" | "mockup" | "line" }

async function piece(block: PlainBlock, host: Host): Promise<Piece> {
  if (block.kind === "mermaid") {
    try {
      // A document leaves the App drawn light, whatever the App's theme: it lands on a white page.
      const svg = await host.renderMermaid(`copy-${block.key}`, block.source, "light")
      const png = await host.rasterise.diagram(svg)
      return {
        html: `<p><img src="${png}" alt="Diagram" data-export-block="${escapeHtml(block.key)}" data-export-scale="2"></p>`,
        made: "diagram",
      }
    } catch {
      return { html: `<pre><code>${escapeHtml(block.source)}</code></pre>` }
    }
  }
  if (block.kind === "artifact") {
    const name = artifactName(block.path)
    try {
      const png = host.artifactPicture
        ? await host.artifactPicture(block.path)
        : await host.rasterise.mockup(await host.loadArtifact(name))
      return {
        html: `<p><img src="${png}" alt="Mockup: ${escapeHtml(name)}" data-export-block="${escapeHtml(block.key)}"></p>`,
        made: "mockup",
      }
    } catch {
      return { html: `<p>${escapeHtml(mockupLine(name))}</p>`, made: "line" }
    }
  }
  if (block.kind === "added") {
    const why = block.reason !== "" ? `: ${escapeHtml(block.reason)}` : ""
    const head = `<p><b>Added in ${escapeHtml(block.stage)}${why}</b></p>`
    return { html: `<blockquote>${head}${block.html}</blockquote>` }
  }
  if (block.kind === "wireframe" || block.kind === "panel")
    return { html: `<pre><code>${escapeHtml(`${block.kind}\n${block.source}`)}</code></pre>` }
  return { html: block.html }
}

/** The document as HTML, its pictures drawn at the same time. */
export async function toFormatted(blocks: PlainBlock[], host: Host): Promise<Formatted> {
  const pieces: Piece[] = []
  for (const block of blocks) pieces.push(await piece(block, host))
  const count = (made: Piece["made"]) => pieces.filter((p) => p.made === made).length
  return {
    html: pieces.map((p) => p.html).join("\n"),
    diagrams: count("diagram"),
    mockups: count("mockup"),
    lines: count("line"),
  }
}
