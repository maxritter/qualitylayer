import { marked } from "marked"
import type { ExportAsset, ExportFormat, ExportInput } from "../../core/export/types.ts"
import { artifactName } from "../reader/ArtifactFrame.tsx"
import { toFormatted, toMarkdown } from "../reader/copy-out.ts"
import { sanitize, toBlocks } from "../reader/DocReader.tsx"
import { escapeHtml } from "../reader/html-escape.ts"
import { renderWithMermaid } from "../reader/MermaidBlock.tsx"
import { browserRasterise } from "../reader/rasterise.ts"
import { exportName, exportRevision } from "./filename.ts"
import {
  artifactPictures,
  checkCancelled,
  includePictures,
  verifyFormattedImages,
  type WorkflowContentInput,
} from "./workflow-export-media.ts"

type Input = WorkflowContentInput & {
  title: string
  format: ExportFormat
  state?: string
}

/** File export and rich copy use one completed, sequential visual preparation. */
export async function workflowFormatted(input: WorkflowContentInput) {
  if (!input.body.trim())
    throw new Error("The document is still being written. Try again when it is ready.")
  checkCancelled(input.signal)
  const body = await includePictures(input.body, input.loadEvidence, input.signal)
  const blocks = toBlocks(body)
  const pictures = await artifactPictures(blocks, input)
  const formatted = await toFormatted(blocks, {
    theme: "light",
    renderMermaid: renderWithMermaid,
    loadArtifact: input.loadArtifact,
    artifactPicture: async (path) => {
      const picture = pictures.get(artifactName(path))
      if (!picture) throw new Error("The design could not be captured.")
      return picture
    },
    rasterise: browserRasterise,
  })
  checkCancelled(input.signal)
  const mermaidCount = blocks.filter((block) => block.kind === "mermaid").length
  if (formatted.lines || formatted.diagrams !== mermaidCount)
    throw new Error("A design or diagram could not be included. Check its preview and try again.")
  if (new TextEncoder().encode(formatted.html).length > 20 * 1024 * 1024)
    throw new Error("The document exceeds 20 MiB.")
  verifyFormattedImages(formatted.html)
  return { body, formatted }
}

function collectExportAssets(html: string) {
  const page = new DOMParser().parseFromString(html, "text/html")
  const assets: ExportAsset[] = []
  const sources = new Map<string, string>()
  const figures = new Map<string, { name: string; alt: string }>()
  for (const image of page.querySelectorAll("img")) {
    const source = image.getAttribute("src") ?? ""
    const base64 = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(source)?.[1]
    if (!base64)
      throw new Error("A picture is not available offline. Save it in the task and try again.")
    const name = `image-${assets.length + 1}.png`
    assets.push({ name, type: "image/png", base64 })
    sources.set(source, `assets/${name}`)
    const key = image.getAttribute("data-export-block")
    if (key) figures.set(key, { name, alt: image.getAttribute("alt") ?? "Picture" })
  }
  return { assets, sources, figures }
}

function renderExportMarkdown(
  body: string,
  figures: Map<string, { name: string; alt: string }>,
  sources: Map<string, string>,
  record: string,
) {
  let markdown = marked
    .lexer(body)
    .map((token, index) => {
      if (token.type === "space") return token.raw
      const figure = figures.get(`${index}-${token.type}`)
      if (figure) {
        const caption = figure.alt.replace(/[[\]\\]/g, "")
        const source = token.type === "code" && token.lang === "mermaid" ? token.raw : ""
        return `${source}\n![${caption}](assets/${figure.name})\n\n`
      }
      return toMarkdown(token.raw)
    })
    .join("")
  for (const [source, path] of sources) markdown = markdown.replaceAll(source, path)
  return `${markdown}\n\n---\n${record}\n`
}

export async function workflowExport(input: Input): Promise<ExportInput> {
  const { body, title, format } = input
  const revision = await exportRevision(body)
  const prepared = await workflowFormatted(input)
  const html = sanitize(prepared.formatted.html)
  const { assets, sources, figures } = collectExportAssets(html)
  const record = `Snapshot ${revision}${input.state ? ` · ${input.state}` : ""}`
  const markdown = renderExportMarkdown(prepared.body, figures, sources, record)
  const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>footer{margin-top:28px;font-size:10px;overflow-wrap:anywhere;color:#555}</style></head><body>${html}<footer>${escapeHtml(record)}</footer></body></html>`
  return {
    format,
    title,
    name: exportName(title),
    pages: [{ title, html: document, width: 860, kind: "document" }],
    markdown,
    assets,
    revision,
  }
}
