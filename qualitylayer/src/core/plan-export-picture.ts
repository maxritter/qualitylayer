// What `plan export` needs to know about a picture, and the page that draws a Mermaid diagram.

import { inflateSync } from "node:zlib"
import {
  DIAGRAM_FONT,
  DIAGRAM_PALETTES,
  endLifelines,
  mermaidConfig,
  titleGroupsLeft,
} from "./docs/mermaid-style.ts"

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex")
const DAMAGED = "the picture is a damaged PNG"
/** More decoded bytes than this are not checked: the picture is refused as too large to check. */
const DECODE_LIMIT = 1e8
/** Channels per pixel of the supported 8-bit direct-colour types (grey, RGB, grey+alpha, RGBA). */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

/** The PNG's chunks in order, or null when one runs past the end of the file. */
function chunksOf(bytes: Buffer): { type: string; data: Buffer }[] | null {
  const chunks: { type: string; data: Buffer }[] = []
  for (let at = 8; at < bytes.length; ) {
    if (at + 12 > bytes.length) return null
    const size = bytes.readUInt32BE(at)
    if (at + 12 + size > bytes.length) return null
    const type = bytes.toString("latin1", at + 4, at + 8)
    chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + size) })
    at += 12 + size
    if (type === "IEND") return chunks
  }
  return null
}

type PngHeader = {
  width: number
  height: number
  channels: number
  stride: number
  expected: number
}

function unsupportedLayoutReason(
  header: Buffer,
  chunks: { type: string; data: Buffer }[],
  channels: number | undefined,
): string | null {
  if (header[9] === 3) return "the picture's indexed PNG palette is not supported"
  if (chunks.some((chunk) => chunk.type === "tRNS"))
    return "the picture's tRNS transparency is not supported"
  if (header[8] !== 8 || header[12] !== 0 || channels === undefined)
    return "the picture's PNG layout is not supported (8-bit, non-interlaced only)"
  return null
}

function parsePngHeader(chunks: { type: string; data: Buffer }[]): PngHeader | string {
  const header = chunks[0]
  if (header?.type !== "IHDR" || header.data.length !== 13) return DAMAGED
  const width = header.data.readUInt32BE(0)
  const height = header.data.readUInt32BE(4)
  if (width === 0 || height === 0) return DAMAGED
  const channels = CHANNELS[header.data[9] ?? -1]
  const unsupported = unsupportedLayoutReason(header.data, chunks, channels)
  if (unsupported !== null) return unsupported
  const stride = width * (channels as number)
  const expected = (stride + 1) * height
  return expected > DECODE_LIMIT
    ? "the picture is too large to check"
    : { width, height, channels: channels as number, stride, expected }
}

function unfilterRow(
  raw: Buffer,
  rowOffset: number,
  above: Buffer,
  filter: number,
  channels: number,
): Buffer {
  const stride = above.length
  const row = Buffer.alloc(stride)
  for (let x = 0; x < stride; x++) {
    const left = x >= channels ? (row[x - channels] ?? 0) : 0
    const up = above[x] ?? 0
    const upLeft = x >= channels ? (above[x - channels] ?? 0) : 0
    row[x] = ((raw[rowOffset + x] ?? 0) + predicted(filter, left, up, upLeft)) & 255
  }
  return row
}

function rowVariesFrom(row: Buffer, channels: number, first: number): boolean {
  for (let x = 0; x < row.length; x += channels) {
    if (visibleColour(row, x, channels) !== first) return true
  }
  return false
}

function scanlineProblem(raw: Buffer, header: PngHeader): string | null {
  const { height, stride, channels } = header
  let above: Buffer = Buffer.alloc(stride)
  let first: number | null = null
  let varied = false
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0
    if (filter > 4) return DAMAGED
    const row = unfilterRow(raw, y * (stride + 1) + 1, above, filter, channels)
    first ??= visibleColour(row, 0, channels)
    varied ||= rowVariesFrom(row, channels, first)
    above = row
  }
  return varied ? null : "the picture is blank: every pixel is one colour"
}

function decodePngBuffer(
  chunks: { type: string; data: Buffer }[],
  expected: number,
): Buffer | null {
  try {
    // One byte more than the rows need: a longer stream fails here instead of growing without bound.
    const raw = inflateSync(
      Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)),
      { maxOutputLength: expected + 1 },
    )
    return raw.length === expected ? raw : null
  } catch {
    return null
  }
}

/**
 * Why a picture may not be kept or linked: not a PNG, damaged, a layout this check does not decode,
 * too large to check, or one colour throughout. Null only when it decoded whole and shows something.
 * The decode is bounded by the size the header declares: a stream that inflates past it is damaged.
 */
export function pictureProblem(png: Uint8Array): string | null {
  const bytes = Buffer.from(png)
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE))
    return "the picture is not a PNG"
  const chunks = chunksOf(bytes)
  const header = chunks === null ? DAMAGED : parsePngHeader(chunks)
  if (typeof header === "string") return header
  const raw = decodePngBuffer(chunks as { type: string; data: Buffer }[], header.expected)
  return raw === null ? DAMAGED : scanlineProblem(raw, header)
}

/** Capture/export uses light mode: compare visible RGB on white, not hidden colour or alpha bytes. */
function visibleColour(row: Buffer, at: number, channels: number): number {
  const red = row[at] ?? 0
  const green = channels < 3 ? red : (row[at + 1] ?? 0)
  const blue = channels < 3 ? red : (row[at + 2] ?? 0)
  const alphaOffset = channels === 2 ? 1 : channels === 4 ? 3 : -1
  const alpha = alphaOffset === -1 ? 255 : (row[at + alphaOffset] ?? 0)
  const overWhite = (value: number) => Math.round((value * alpha + 255 * (255 - alpha)) / 255)
  return (overWhite(red) << 16) | (overWhite(green) << 8) | overWhite(blue)
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft
  const a = Math.abs(p - left)
  const b = Math.abs(p - up)
  const c = Math.abs(p - upLeft)
  if (a <= b && a <= c) return left
  return b <= c ? up : upLeft
}

/** The PNG filter's prediction for one byte, from its neighbours to the left, above and above-left. */
const PREDICTORS: readonly ((left: number, up: number, upLeft: number) => number)[] = [
  () => 0,
  (left) => left,
  (_left, up) => up,
  (left, up) => (left + up) >> 1,
  paeth,
]

function predicted(filter: number | undefined, left: number, up: number, upLeft: number): number {
  const fn = PREDICTORS[filter ?? 0]
  return fn ? fn(left, up, upLeft) : 0
}

/**
 * The Mermaid bundle as a classic script: a page loaded with no network cannot import it, so its
 * `export default` becomes a global. Null when the bundle does not end the way the App's does.
 */
export function classicMermaid(script: string): string | null {
  const tail = script.slice(-400)
  const exported = /export\s*\{\s*([\w$]+)\s+as\s+default\s*\}\s*;?\s*$/.exec(tail)
  if (exported === null) return null
  const body = script.slice(0, script.length - tail.length + exported.index)
  return `${body}globalThis.__qlMermaid=${exported[1]};`.replaceAll("</script", "<\\/script")
}

export const DIAGRAM_WIDTH = 1000

/**
 * A page that draws one diagram with the inlined bundle in QualityLayer's style, light, as the App
 * draws it (core/docs/mermaid-style.ts): Geist loaded before Mermaid measures, the lifelines ended,
 * the group titles in their corner, on the light page colour. Its ready selector matches once the
 * SVG exists. Without the App's Geist (`font`, base64 woff2) the system face stands in.
 */
export function diagramPage(source: string, script: string, font: string | null = null): string {
  const json = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c")
  const finish = `(svg)=>(${titleGroupsLeft.toString()})((${endLifelines.toString()})(svg))`
  const draw = `(async()=>{await document.fonts.ready;const m=globalThis.__qlMermaid;m.initialize(${json(mermaidConfig("light"))});const r=await m.render("ql-diagram",${json(source)});document.getElementById("diagram").innerHTML=(${finish})(r.svg)})().catch(e=>console.error("Mermaid failed: "+(e&&e.message||e)))`
  const face =
    font === null
      ? ""
      : `@font-face{font-family:Geist;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format("woff2")}`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Diagram</title><meta name="viewport" content="width=${DIAGRAM_WIDTH}"><meta name="ql:ready-selector" content="#diagram svg"><style>${face}body{margin:0;background:${DIAGRAM_PALETTES.light.paper};font-family:${DIAGRAM_FONT}}#${DIAGRAM_SECTION}{display:inline-block;padding:24px;background:${DIAGRAM_PALETTES.light.paper}}#diagram svg{display:block}</style></head><body><span style="position:absolute;opacity:0;font-weight:600">Geist</span><div id="${DIAGRAM_SECTION}"><div id="diagram"></div></div><script>${script}</script><script>${draw}</script></body></html>`
}

/** The part of the diagram page the picture is taken of: the drawing and its margin, no more. */
export const DIAGRAM_SECTION = "picture"
