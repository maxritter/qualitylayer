import type { ExportFile, ExportInput } from "../core/export/types.ts"
import { zip } from "../core/export/zip.ts"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import {
  documentBody,
  htmlDocument,
  imagePagesDocument,
  renderHtmlToPdf,
  renderPagePictures,
} from "./export-files-html.ts"
import {
  MAX_BYTES,
  parseExportInput,
  sha256Hex,
  suppliedAssets,
  utf8Bytes,
} from "./export-files-validate.ts"

let exporting = false

function exportStem(name: string): string {
  const safe = name.replace(/\.(pdf|png|html?|md|zip)$/i, "").replace(/[^a-z0-9._-]+/gi, "-")
  let start = 0
  let end = safe.length
  while (start < end && (safe[start] === "." || safe[start] === "-")) start++
  while (end > start && (safe[end - 1] === "." || safe[end - 1] === "-")) end--
  return safe.slice(start, end).slice(0, 100) || "export"
}

type BuiltExport = { file: Uint8Array; extension: string; type: string }

function buildMarkdownArchive(
  input: ExportInput,
  stem: string,
  assets: ReturnType<typeof suppliedAssets>,
): BuiltExport {
  const manifest = {
    version: 1,
    title: input.title,
    ...(input.revision ? { revision: input.revision } : {}),
    pages: input.pages.map((page) => ({ title: page.title, sourceSha256: sha256Hex(page.html) })),
    assets: assets.map((asset) => ({ name: asset.name, sha256: sha256Hex(asset.bytes) })),
  }
  const markdown = utf8Bytes(input.markdown ?? "")
  const file = zip(
    [
      { name: `${stem}.md`, bytes: markdown },
      ...assets,
      {
        name: "manifest.json",
        bytes: utf8Bytes(
          JSON.stringify({ ...manifest, markdownSha256: sha256Hex(markdown) }, null, 2),
        ),
      },
    ],
    MAX_BYTES,
  )
  return { file, extension: "zip", type: "application/zip" }
}

function packPngExport(pictures: Uint8Array[]): BuiltExport {
  if (pictures.length === 1) {
    return { file: pictures[0] ?? new Uint8Array(), extension: "png", type: "image/png" }
  }
  const file = zip(
    pictures.map((picture, index) => ({
      name: `page-${String(index + 1).padStart(2, "0")}.png`,
      bytes: picture,
    })),
    MAX_BYTES,
  )
  return { file, extension: "zip", type: "application/zip" }
}

async function buildRenderedExport(
  ctx: Ctx,
  input: ExportInput,
  assets: ReturnType<typeof suppliedAssets>,
): Promise<BuiltExport> {
  const allDocuments = input.pages.every((page) => page.kind === "document")
  let html: string
  if (allDocuments && input.format !== "png") {
    html = htmlDocument(input.title, input.pages.map((page) => documentBody(page, assets)).join(""))
  } else {
    const pictures = await renderPagePictures(ctx, input, assets)
    if (input.format === "png") return packPngExport(pictures)
    html = imagePagesDocument(input, pictures)
  }
  if (input.format === "html") {
    return { file: utf8Bytes(html), extension: "html", type: "text/html;charset=utf-8" }
  }
  return {
    file: await renderHtmlToPdf(ctx, html, !allDocuments),
    extension: "pdf",
    type: "application/pdf",
  }
}

/** Already-read App content only: no project paths, permanent output directory or extra read authority. */
export async function exportFile(ctx: Ctx, value: unknown): Promise<Result<ExportFile>> {
  if (exporting) {
    return err({
      code: "bad_args",
      message: "Another export is running. Try again when it finishes.",
    })
  }
  exporting = true
  try {
    const input = parseExportInput(value)
    const assets = suppliedAssets(input)
    const stem = exportStem(input.name)
    const built =
      input.format === "markdown"
        ? buildMarkdownArchive(input, stem, assets)
        : await buildRenderedExport(ctx, input, assets)
    if (built.file.length > MAX_BYTES) throw new Error("Export exceeds 20 MiB")
    return ok({
      name: `${stem}.${built.extension}`,
      type: built.type,
      base64: Buffer.from(built.file).toString("base64"),
    })
  } catch (cause) {
    return err({
      code: "bad_args",
      message: cause instanceof Error ? cause.message : "The export could not be generated",
    })
  } finally {
    exporting = false
  }
}
