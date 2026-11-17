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

async function artifactPictures(blocks: PlainBlock[], input: Input) {
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

export async function workflowExport(input: Input): Promise<ExportInput> {
  const { body, title, format } = input
  if (!body.trim())
    throw new Error("The document is still being written. Try again when it is ready.")
  const revision = await exportRevision(body)
  checkCancelled(input.signal)
  const blocks = toBlocks(await includePictures(body, input.loadEvidence, input.signal))
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
  const html = sanitize(formatted.html)
  const page = new DOMParser().parseFromString(html, "text/html")
  const assets: ExportAsset[] = []
  let markdown = toMarkdown(body, true).replace(
    /\(open it in QualityLayer\)/g,
    "(see images below)",
  )
  for (const image of page.querySelectorAll("img")) {
    const source = image.getAttribute("src") ?? ""
    const base64 = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(source)?.[1]
    if (!base64)
      throw new Error("A picture is not available offline. Save it in the task and try again.")
    const name = `image-${assets.length + 1}.png`
    assets.push({ name, type: "image/png", base64 })
    markdown = markdown.replaceAll(source, `assets/${name}`)
  }
  if (assets.length)
    markdown += `\n\n## Images\n\n${assets.map((asset, index) => `![Image ${index + 1}](assets/${asset.name})`).join("\n\n")}\n`
  const record = `Snapshot ${revision}${input.state ? ` · ${input.state}` : ""}`
  markdown += `\n\n---\n${record}\n`
  const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font:14px/1.55 system-ui,sans-serif;color:#171717;background:#fff;margin:32px auto;max-width:760px;padding:0 24px}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}td,th{padding:7px;border:1px solid #aaa;text-align:left}h1,h2,h3{break-after:avoid}img,tr{break-inside:avoid}footer{margin-top:28px;font-size:10px;overflow-wrap:anywhere;color:#555}@page{size:A4;margin:16mm}</style></head><body>${html}<footer>${escapeHtml(record)}</footer></body></html>`
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
