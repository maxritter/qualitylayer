import { marked } from "marked"
import { artifactMeta } from "../../core/artifact/format.ts"
import { parseArtifactReference } from "../../core/artifact/reference.ts"
import type { ExportAsset, ExportFormat, ExportInput } from "../../core/export/types.ts"
import type { Evidence } from "../api.ts"
import { artifactName } from "../reader/ArtifactFrame.tsx"
import { toFormatted, toMarkdown } from "../reader/copy-out.ts"
import { type PlainBlock, sanitize, toBlocks } from "../reader/DocReader.tsx"
import { escapeHtml } from "../reader/html-escape.ts"
import { renderWithMermaid } from "../reader/MermaidBlock.tsx"
import { browserRasterise } from "../reader/rasterise.ts"
import type { ExportWriter } from "./ExportCard.tsx"
import { exportName, exportRevision } from "./filename.ts"

type Input = {
  body: string
  title: string
  format: ExportFormat
  state?: string
  signal?: AbortSignal
  write: ExportWriter
  loadArtifact: (name: string) => Promise<string>
  loadEvidence?: (name: string) => Promise<Evidence>
}

async function pictureData(source: string): Promise<string> {
  const image = new Image()
  image.src = source
  await image.decode()
  if (
    !image.naturalWidth ||
    !image.naturalHeight ||
    image.naturalWidth * image.naturalHeight > 32_000_000
  )
    throw new Error("A picture is too large to export.")
  const canvas = document.createElement("canvas")
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext("2d")
  if (!context) throw new Error("The picture could not be prepared.")
  context.drawImage(image, 0, 0)
  return canvas.toDataURL("image/png")
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError")
}

async function includePictures(body: string, load: Input["loadEvidence"], signal?: AbortSignal) {
  const images: { raw: string; name: string; title: string }[] = []
  void marked.walkTokens(marked.lexer(body), (token) => {
    if (token.type === "image")
      images.push({ raw: token.raw, name: token.href, title: token.text || "Picture" })
  })
  let prepared = body
  for (const image of images) {
    checkCancelled(signal)
    let data = image.name
    if (!/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(data)) {
      if (!load || /^(?:[a-z]+:|\/|\\)/i.test(data))
        throw new Error(`Save “${image.title}” in the task before exporting.`)
      const evidence = await load(data.replace(/^evidence\//, ""))
      checkCancelled(signal)
      if (
        evidence.kind !== "image" ||
        !evidence.base64 ||
        !/^image\/(?:png|jpeg|webp|gif)$/.test(evidence.type ?? "")
      )
        throw new Error(
          `Could not include “${image.title}”. Check the evidence file and try again.`,
        )
      data = `data:${evidence.type};base64,${evidence.base64}`
    }
    const png = await pictureData(data)
    checkCancelled(signal)
    prepared = prepared.replace(image.raw, `![${image.title.replace(/[[\]\\]/g, "")}](${png})`)
  }
  return prepared
}

type ContentInput = Pick<Input, "body" | "signal" | "write" | "loadArtifact" | "loadEvidence">

async function artifactPictures(blocks: PlainBlock[], input: ContentInput) {
  const sources = new Map<string, string>()
  const pictures = new Map<string, string>()
  for (const block of blocks) {
    if (block.kind !== "artifact") continue
    checkCancelled(input.signal)
    const name = artifactName(block.path)
    if (pictures.has(name)) continue
    const reference =
      parseArtifactReference(block.path) ?? parseArtifactReference(`artifacts/${name}`)
    if (!reference) throw new Error("The design reference could not be read.")
    const html = sources.get(reference.file) ?? (await input.loadArtifact(name))
    checkCancelled(input.signal)
    sources.set(reference.file, html)
    const image = await input.write(
      {
        format: "png",
        title: "Design",
        name: "design",
        pages: [
          {
            title: "Design",
            html,
            width: artifactMeta(html).width ?? 1280,
            section: reference.section,
          },
        ],
      },
      input.signal,
    )
    checkCancelled(input.signal)
    if (image.type !== "image/png") throw new Error("The design could not be captured.")
    pictures.set(name, `data:image/png;base64,${image.base64}`)
  }
  return pictures
}

/** File export and rich copy use one completed, sequential visual preparation. */
export async function workflowFormatted(input: ContentInput) {
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
  if (
    formatted.lines ||
    formatted.diagrams !== blocks.filter((block) => block.kind === "mermaid").length
  )
    throw new Error("A design or diagram could not be included. Check its preview and try again.")
  if (new TextEncoder().encode(formatted.html).length > 20 * 1024 * 1024)
    throw new Error("The document exceeds 20 MiB.")
  const page = new DOMParser().parseFromString(formatted.html, "text/html")
  let pixels = 0
  for (const image of page.querySelectorAll("img")) {
    const encoded = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(image.src)?.[1]
    if (!encoded)
      throw new Error("A picture is not available offline. Save it in the task and try again.")
    const header = Uint8Array.from(atob(encoded).slice(0, 24), (char) => char.charCodeAt(0))
    if (header.length < 24) throw new Error("A picture could not be prepared.")
    const view = new DataView(header.buffer)
    pixels += view.getUint32(16) * view.getUint32(20)
    if (pixels > 64_000_000) throw new Error("The document's pictures exceed the pixel limit.")
  }
  return { body, formatted }
}

export async function workflowExport(input: Input): Promise<ExportInput> {
  const { body, title, format } = input
  const revision = await exportRevision(body)
  const prepared = await workflowFormatted(input)
  const formatted = prepared.formatted
  const html = sanitize(formatted.html)
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
  let markdown = marked
    .lexer(prepared.body)
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
  const record = `Snapshot ${revision}${input.state ? ` · ${input.state}` : ""}`
  markdown += `\n\n---\n${record}\n`
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
