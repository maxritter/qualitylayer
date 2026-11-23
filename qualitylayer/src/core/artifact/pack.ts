// The packer: an artifact that is a folder (pages, scripts, styles, fonts, pictures) becomes ONE
// self-contained page, so the App's frame keeps its sandbox and its no-network policy exactly as they
// are while the artifact still runs like the real thing. Stylesheets and classic scripts are inlined,
// `.jsx`/`.tsx` and `type="text/babel"` scripts are transpiled here (they run after the page is
// parsed, as Babel in the browser runs them), ES module imports between the artifact's files are
// bundled, fonts and pictures become `data:` URLs, network scripts and stylesheets are dropped (the
// frame would block them), and a reference that leaves the folder (`..`, an absolute path, a link
// out) is left out with a comment that names it. React and ReactDOM go in first, as globals, when a
// script needs them; an in-memory `localStorage` and `sessionStorage` go in before everything,
// because a sandboxed frame without same-origin has none and touching them throws.
//
// Four things the folder-artifact spike taught, kept here: replace with
// function replacers only (minified React contains `$&`), escape `</script` in every inlined script
// (React DOM holds the literal "<script></script>"), declare UTF-8, and transpile with dead-code
// elimination off and the classic JSX runtime so scripts share globals as they do under Babel.

import { realpath } from "node:fs/promises"
import { err, ok, type Result } from "../../ctx.ts"
import {
  ARTIFACT_PACK_CACHE_ENTRIES,
  ARTIFACT_PACK_CACHE_MAX_BYTES,
  ARTIFACT_PACKED_MAX_BYTES,
  ARTIFACT_PAGE_NAME,
} from "./format.ts"
import { STORAGE_STAND_IN, scriptText } from "./pack-assets.ts"
import { Packer } from "./pack-resolver.ts"
import { stampFolder } from "./pack-stamp.ts"
import { packHtmlPage } from "./pack-tags.ts"

export { STORAGE_STAND_IN, scriptText } from "./pack-assets.ts"
export { stampFolder } from "./pack-stamp.ts"

/** React and ReactDOM as one browser script that sets `React` and `ReactDOM` globals. */
export type PackRuntime = () => Promise<string>

export type PackOmission = {
  reference: string
  kind: "script" | "stylesheet" | "asset"
  reason: string
}

export type Packed = {
  html: string
  /** Files read into the page, as paths from the artifact's folder. */
  files: string[]
  /** References left out, each with why. */
  left: string[]
  /** Network scripts and stylesheets dropped. */
  dropped: string[]
  omissions: PackOmission[]
  usesReact: boolean
}

async function readEntryPage(
  dir: string,
  page: string,
  publicationRead?: (path: string) => Promise<Uint8Array>,
): Promise<Result<{ packer: Packer; source: string }>> {
  if (!ARTIFACT_PAGE_NAME.test(page))
    return err({ code: "bad_args", message: `"${page}" is not a page of an artifact` })
  let root: string
  try {
    root = await realpath(dir)
  } catch {
    return err({ code: "no_task", message: "the artifact's folder does not exist" })
  }
  const packer = new Packer(root, publicationRead)
  const entry = await packer.resolve(root, page)
  if (entry.kind !== "file")
    return err({
      code: "bad_args",
      message: `"${page}" is not a page of this artifact${entry.kind === "left" ? ` (${entry.why})` : ""}`,
    })
  const source = await packer.text(entry)
  packer.files.delete(entry.rel)
  return typeof source === "string"
    ? ok({ packer, source })
    : err({ code: "bad_args", message: `${page}: ${source.why}` })
}

export async function packArtifactPage(
  ...[dir, page, runtime, clean = (text) => text, publicationRead]: [
    dir: string,
    page: string,
    runtime: PackRuntime,
    /** Applied to the page's own text first (the App drops the agent's licence notice from a page). */
    clean?: (text: string) => string,
    publicationRead?: (path: string) => Promise<Uint8Array>,
  ]
): Promise<Result<Packed>> {
  const loaded = await readEntryPage(dir, page, publicationRead)
  if (!loaded.ok) return loaded
  const { packer, source } = loaded.data
  const body = await packHtmlPage(packer, clean(source))
  const doctype = body.match(/^\s*<!doctype[^>]*>/i)?.[0] ?? ""
  const charset = /<meta\b[^>]*\bcharset\s*=/i.test(body) ? "" : '<meta charset="utf-8">'
  const react = packer.usesReact ? `<script>${scriptText(await runtime())}</script>` : ""
  const html = `${doctype}${charset}<script>${STORAGE_STAND_IN}</script>${react}${body.slice(doctype.length)}`
  if (Buffer.byteLength(html) > ARTIFACT_PACKED_MAX_BYTES)
    return err({
      code: "bad_args",
      message: `This page packs to more than ${ARTIFACT_PACKED_MAX_BYTES / 1024 / 1024} MiB; trim its fonts and pictures`,
    })
  return ok({
    html,
    files: [...packer.files].sort(),
    left: packer.left,
    dropped: packer.dropped,
    omissions: packer.omissions,
    usesReact: packer.usesReact,
  })
}

type Kept = { stamp: string; packed: Packed; bytes: number }
const kept = new Map<string, Kept>()
let keptBytes = 0

/** Forget every packed page (for the tests). */
export function clearPackCache(): void {
  kept.clear()
  keptBytes = 0
}

/** How many packed pages are in memory (for the tests). */
export const packCacheSize = (): number => kept.size

/**
 * The packed page, from memory while no file of the artifact changed its path, size or time. The cost
 * of a hit is one walk of the folder's stats; nothing watches and nothing polls.
 */
export async function packedPage(
  dir: string,
  page: string,
  runtime: PackRuntime,
  clean?: (text: string) => string,
): Promise<Result<Packed>> {
  const stamp = await stampFolder(dir)
  if (!stamp.ok) return stamp
  const key = `${dir}\0${page}`
  const hit = kept.get(key)
  if (hit !== undefined && hit.stamp === stamp.data.key) {
    kept.delete(key)
    kept.set(key, hit)
    return ok(hit.packed)
  }
  const packed = await packArtifactPage(dir, page, runtime, clean)
  if (!packed.ok) return packed
  const old = kept.get(key)
  if (old !== undefined) {
    keptBytes -= old.bytes
    kept.delete(key)
  }
  const bytes = Buffer.byteLength(packed.data.html)
  kept.set(key, { stamp: stamp.data.key, packed: packed.data, bytes })
  keptBytes += bytes
  while (
    kept.size > ARTIFACT_PACK_CACHE_ENTRIES ||
    (keptBytes > ARTIFACT_PACK_CACHE_MAX_BYTES && kept.size > 1)
  ) {
    const oldest = kept.keys().next().value as string
    keptBytes -= kept.get(oldest)?.bytes ?? 0
    kept.delete(oldest)
  }
  return packed
}
