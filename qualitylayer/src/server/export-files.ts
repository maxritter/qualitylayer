import { createHash } from "node:crypto"
import { type DefaultTreeAdapterTypes as Html, parse, serialize } from "parse5"
import { prepareSharedArtifact } from "../core/artifact/inert.ts"
import type { ExportFile, ExportInput, ExportPage } from "../core/export/types.ts"
import { crc32, zip } from "../core/export/zip.ts"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { figureStyles, readableFigures } from "./export-figures.ts"
import { findChrome, NO_CHROME, renderArtifacts } from "./render.ts"

const MAX_BYTES = 20 * 1024 * 1024
const MAX_PIXELS = 64_000_000
const BUDGET = { maxBytes: MAX_BYTES, maxPixels: MAX_PIXELS, timeoutMs: 60_000 }
let exporting = false
const POLICY =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
const text = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
const bytes = (value: string) => new TextEncoder().encode(value)
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex")
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

function inputOf(value: unknown): ExportInput {
  if (
    !record(value) ||
    !["pdf", "png", "html", "markdown"].includes(String(value.format)) ||
    typeof value.title !== "string" ||
    value.title.length > 500 ||
    typeof value.name !== "string" ||
    value.name.length > 180 ||
    !Array.isArray(value.pages) ||
    value.pages.length > 16 ||
    (value.format !== "markdown" && value.pages.length === 0)
  )
    throw new Error("Choose up to 16 pages and a supported export format")
  for (const page of value.pages) {
    if (
      !record(page) ||
      typeof page.title !== "string" ||
      page.title.length > 500 ||
      typeof page.html !== "string" ||
      typeof page.width !== "number" ||
      !Number.isInteger(page.width) ||
      page.width < 240 ||
      page.width > 4000 ||
      (page.kind !== undefined && page.kind !== "document") ||
      (page.section !== undefined &&
        (typeof page.section !== "string" ||
          !/^[A-Za-z][A-Za-z0-9_-]{0,159}$/.test(page.section) ||
          page.kind === "document"))
    )
      throw new Error("Invalid export page")
  }
  if (value.markdown !== undefined && typeof value.markdown !== "string")
    throw new Error("Invalid Markdown document")
  if (value.format === "markdown" && (typeof value.markdown !== "string" || !value.markdown.trim()))
    throw new Error("The export has no Markdown document")
  if (
    value.revision !== undefined &&
    (typeof value.revision !== "string" || !/^[a-f0-9]{64}$/.test(value.revision))
  )
    throw new Error("Invalid export revision")
  if (value.assets !== undefined && (!Array.isArray(value.assets) || value.assets.length > 128))
    throw new Error("Too many export pictures")
  const names = new Set<string>()
  for (const asset of value.assets ?? []) {
    if (
      !record(asset) ||
      typeof asset.name !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,120}\.png$/i.test(asset.name) ||
      asset.type !== "image/png" ||
      typeof asset.base64 !== "string" ||
      asset.base64.length > Math.ceil(MAX_BYTES / 3) * 4
    )
      throw new Error("Export pictures must be named PNG files")
    const key = asset.name.toLowerCase()
    if (names.has(key)) throw new Error("Duplicate export picture name")
    names.add(key)
  }
  if (bytes(JSON.stringify(value)).length > MAX_BYTES)
    throw new Error("Export input exceeds 20 MiB")
  return value as ExportInput
}

function pngSize(picture: Uint8Array): { width: number; height: number } {
  if (
    picture.length < 24 ||
    Buffer.from(picture.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a" ||
    Buffer.from(picture.subarray(12, 16)).toString() !== "IHDR"
  )
    throw new Error("An export picture is not a PNG")
  const view = new DataView(picture.buffer, picture.byteOffset, picture.byteLength)
  const width = view.getUint32(16),
    height = view.getUint32(20)
  if (!width || !height || width * height > MAX_PIXELS)
    throw new Error("An export picture is too large")
  let image = false,
    ended = false
  for (let at = 8; at < picture.length; ) {
    if (at + 12 > picture.length) throw new Error("An export PNG is incomplete")
    const length = view.getUint32(at),
      end = at + length + 12
    if (
      end > picture.length ||
      crc32(picture.subarray(at + 4, end - 4)) !== view.getUint32(end - 4)
    )
      throw new Error("An export PNG is damaged")
    const kind = Buffer.from(picture.subarray(at + 4, at + 8)).toString()
    if (kind === "IDAT") image = true
    if (kind === "IEND") {
      ended = length === 0 && end === picture.length
      break
    }
    at = end
  }
  if (!image || !ended) throw new Error("An export PNG is incomplete")
  return { width, height }
}

function suppliedAssets(input: ExportInput) {
  let pixels = 0
  return (input.assets ?? []).map((asset) => {
    const picture = Buffer.from(asset.base64, "base64")
    if (picture.toString("base64") !== asset.base64)
      throw new Error("Invalid export picture encoding")
    const size = pngSize(picture)
    pixels += size.width * size.height
    if (pixels > MAX_PIXELS) throw new Error("Export pictures exceed the pixel limit")
    return { name: `assets/${asset.name}`, bytes: picture }
  })
}

function cellText(node: Html.ChildNode): string {
  if (node.nodeName === "#text") return (node as Html.TextNode).value
  return "childNodes" in node ? node.childNodes.map(cellText).join("") : ""
}

function documentBody(page: ExportPage, assets: ReturnType<typeof suppliedAssets>): string {
  const source = parse(page.html)
  const embed = (parent: Html.ParentNode) => {
    for (const node of parent.childNodes)
      if ("tagName" in node) {
        if (node.tagName === "td" || node.tagName === "th") {
          node.attrs = node.attrs.filter((attr) => attr.name !== "data-export-short-cell")
          if (/^\S{1,24}$/u.test(cellText(node).trim()))
            node.attrs.push({ name: "data-export-short-cell", value: "" })
        }
        const src = node.attrs.find((attr) => attr.name === "src")
        const asset =
          src &&
          assets.find((item) => item.name === src.value || item.name === `assets/${src.value}`)
        if (asset && src)
          src.value = `data:image/png;base64,${Buffer.from(asset.bytes).toString("base64")}`
        embed(node)
        if ("content" in node) embed((node as Html.Template).content)
      }
  }
  embed(source)
  const safe = parse(prepareSharedArtifact(serialize(source), { links: true }))
  let body = "",
    styles = ""
  const collect = (parent: Html.ParentNode) => {
    for (const node of parent.childNodes)
      if ("tagName" in node) {
        if (node.tagName === "style") styles += `<style>${serialize(node)}</style>`
        else if (node.tagName === "body") body = serialize(node)
        else collect(node)
      }
  }
  collect(safe)
  const heading = /<h1(?:\s|>)/i.test(body) ? "" : `<h1>${text(page.title)}</h1>`
  return `${styles}<section class="document">${heading}${readableFigures(body, pngSize)}</section>`
}

function htmlDocument(title: string, content: string, styles = ""): string {
  return `<!doctype html><html lang="en" data-theme="light" style="color-scheme:light"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}"><title>${text(title)}</title><style>html{color-scheme:light;background:white;color:#171717}body{margin:0 auto;font:15px/1.5 system-ui,sans-serif}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;table-layout:auto}td,th{border:1px solid #bbb;padding:6px;text-align:left;overflow-wrap:anywhere;word-break:normal}[data-export-short-cell]{white-space:nowrap}td:first-child{min-width:3ch}.document{max-width:680px;margin:0 auto;break-after:page;overflow-wrap:break-word}.document:last-child{break-after:auto}@page{size:A4;margin:14mm}h1,h2,h3{break-after:avoid}img,svg,tr{break-inside:avoid}${figureStyles}${styles}</style></head><body>${content}</body></html>`
}

function exportStem(name: string): string {
  const safe = name.replace(/\.(pdf|png|html?|md|zip)$/i, "").replace(/[^a-z0-9._-]+/gi, "-")
  let start = 0,
    end = safe.length
  while (start < end && (safe[start] === "." || safe[start] === "-")) start++
  while (end > start && (safe[end - 1] === "." || safe[end - 1] === "-")) end--
  return safe.slice(start, end).slice(0, 100) || "export"
}

/** Already-read App content only: no project paths, permanent output directory or extra read authority. */
export async function exportFile(ctx: Ctx, value: unknown): Promise<Result<ExportFile>> {
  if (exporting)
    return err({
      code: "bad_args",
      message: "Another export is running. Try again when it finishes.",
    })
  exporting = true
  try {
    const input = inputOf(value),
      assets = suppliedAssets(input)
    const stem = exportStem(input.name)
    const manifest = {
      version: 1,
      title: input.title,
      ...(input.revision ? { revision: input.revision } : {}),
      pages: input.pages.map((page) => ({ title: page.title, sourceSha256: hash(page.html) })),
      assets: assets.map((asset) => ({ name: asset.name, sha256: hash(asset.bytes) })),
    }
    let file: Uint8Array, extension: string, type: string
    if (input.format === "markdown") {
      const markdown = bytes(input.markdown ?? "")
      file = zip(
        [
          { name: `${stem}.md`, bytes: markdown },
          ...assets,
          {
            name: "manifest.json",
            bytes: bytes(JSON.stringify({ ...manifest, markdownSha256: hash(markdown) }, null, 2)),
          },
        ],
        MAX_BYTES,
      )
      extension = "zip"
      type = "application/zip"
    } else {
      const allDocuments = input.pages.every((page) => page.kind === "document")
      let html: string
      if (allDocuments && input.format !== "png") {
        html = htmlDocument(
          input.title,
          input.pages.map((page) => documentBody(page, assets)).join(""),
        )
      } else {
        const chrome = findChrome((name) => ctx.env.get(name))
        if (!chrome) throw new Error(NO_CHROME)
        const rendered = await renderArtifacts(
          chrome,
          input.pages.map((page) => ({
            html:
              page.kind === "document"
                ? htmlDocument(page.title, documentBody(page, assets))
                : page.html,
            spec: {
              width: page.width,
              section: page.section,
              theme: "light" as const,
              refuseClipped: true,
              requireVisibleContent: true,
            },
          })),
          BUDGET,
        )
        const pictures = rendered.map((picture) => {
          if (picture instanceof Error) throw picture
          pngSize(picture)
          return picture
        })
        if (input.format === "png") {
          if (pictures.length === 1) {
            file = pictures[0] ?? new Uint8Array()
            extension = "png"
            type = "image/png"
          } else {
            file = zip(
              pictures.map((picture, index) => ({
                name: `page-${String(index + 1).padStart(2, "0")}.png`,
                bytes: picture,
              })),
              MAX_BYTES,
            )
            extension = "zip"
            type = "application/zip"
          }
          if (file.length > MAX_BYTES) throw new Error("Export exceeds 20 MiB")
          return ok({
            name: `${stem}.${extension}`,
            type,
            base64: Buffer.from(file).toString("base64"),
          })
        }
        let css = ""
        const content = pictures
          .map((picture, index) => {
            const size = pngSize(picture),
              page = input.pages[index]
            css += `.art${index}{width:${size.width}px;break-after:page}.art${index} img{display:block;width:100%}`
            const header =
              input.format === "pdf"
                ? ""
                : `<h2>${text(page?.title ?? `Page ${index + 1}`)}</h2><p>Static page image. Interactive controls are not included.</p>`
            return `<section class="art${index}" data-export-image-page>${header}<img alt="Static image of ${text(page?.title ?? "page")}" src="data:image/png;base64,${Buffer.from(picture).toString("base64")}"></section>`
          })
          .join("")
        html = htmlDocument(
          input.title,
          content,
          `body{margin:0}[data-export-image-page]{display:flow-root}h2{font-size:18px;margin:8px}section:last-child{break-after:auto}${css}`,
        )
      }
      if (input.format === "html") {
        file = bytes(html)
        extension = "html"
        type = "text/html;charset=utf-8"
      } else {
        const chrome = findChrome((name) => ctx.env.get(name))
        if (!chrome) throw new Error(NO_CHROME)
        const [pdf] = await renderArtifacts(
          chrome,
          [
            {
              html,
              spec: { width: 1000, theme: "light", format: "pdf", imagePages: !allDocuments },
            },
          ],
          BUDGET,
        )
        if (!pdf || pdf instanceof Error) throw pdf ?? new Error("PDF generation returned no file")
        if (!Buffer.from(pdf.subarray(0, 5)).equals(Buffer.from("%PDF-")))
          throw new Error("PDF generation returned an invalid file")
        file = pdf
        extension = "pdf"
        type = "application/pdf"
      }
    }
    if (file.length > MAX_BYTES) throw new Error("Export exceeds 20 MiB")
    return ok({ name: `${stem}.${extension}`, type, base64: Buffer.from(file).toString("base64") })
  } catch (cause) {
    return err({
      code: "bad_args",
      message: cause instanceof Error ? cause.message : "The export could not be generated",
    })
  } finally {
    exporting = false
  }
}
