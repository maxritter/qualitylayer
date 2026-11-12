import { createHash } from "node:crypto"
import { dirname, join, relative, resolve } from "node:path"
import { crc32, inflateSync } from "node:zlib"
import type { Ctx } from "../../ctx.ts"
import { publicationContext } from "../../publication-fs.ts"
import { packFolderPage } from "../../server/artifact-pack.ts"
import { writePicture } from "../../server/render.ts"
import { artifactMeta } from "../artifact/format.ts"
import { parseArtifactReference } from "../artifact/reference.ts"
import { artifactReferenceSource } from "../artifact/reference-source.ts"
import { artifactsInPlan } from "../artifact/store.ts"
import { safeArtifactPath } from "../artifact/workspace.ts"
import { type ProofList, type ProofStep, proofList, stepsOfPoint } from "../docs/acceptance.ts"
import { lastIteration, readBuildRecord, sectionText, verifyLogPath } from "../docs/build-log.ts"
import { parseDoc } from "../docs/frontmatter.ts"
import { parseMarkers } from "../docs/markers.ts"
import { ARTIFACT_DIR, EVIDENCE_DIR, folderDoc, RECORDS_DIR } from "../docs/names.ts"
import { evidenceIn } from "../docs/outline.ts"
import { buildRevision } from "../gate/revision.ts"
import {
  EVIDENCE_OUTPUT_MAX_BYTES,
  EVIDENCE_ROWS_KEPT,
  EVIDENCE_RUNS_KEPT,
  SCREEN_MAX_BYTES,
  SCREEN_REFERENCE_DOCS_KEPT,
} from "../home-caps.ts"
import { ASSETS_DIR, currentPlanAsset } from "../plan-assets.ts"
import type { Task } from "../task/store.ts"
import { acceptanceVerdicts, passedRun } from "../verdicts.ts"
import { namedPlanFences } from "./mockup-shots.ts"
import {
  type AcceptanceAsRun,
  type AcceptancePointRow,
  type AcceptanceRow,
  type AddedRow,
  type EvidenceKind,
  type EvidenceMode,
  type EvidenceRow,
  type EvidenceRun,
  type EvidenceSource,
  isEvidenceRow,
  isOutputFile,
  isPictureFile,
  isScreenRow,
  type ScreenOutcome,
  type ScreenRow,
  safeScreenKey,
  type VerificationRun,
} from "./screen-evidence.ts"
import type { WalkScreen } from "./screen-pairs.ts"

export type { WalkScreen } from "./screen-pairs.ts"
export type { AddedRow, EvidenceRow, EvidenceRun, ScreenOutcome, ScreenRow }

/** What a capture of a planned screen is recorded from; the file, digest and time are made here. */
export type ScreenInput = Omit<ScreenRow, "kind" | "file" | "shotDigest" | "at">
/** What an added picture or output is recorded from. */
export type EvidenceInput = EvidenceSource & { kind: EvidenceKind; buildRevision: string }
export type ScreenSurface = {
  key: string
  width: number
  artifactDigest: string
  artifact?: { kind: "wireframe" | "html"; source: string }
  /** The reference the Plan names the artifact by: what its approved picture is looked up with. */
  reference?: string
}
export type ScreenPair = ScreenSurface & {
  height?: number
  staleReason?: string
  row: ScreenRow | null
  stale: boolean
  file: string | null
  outcome: ScreenOutcome | "not captured"
  /** The picture of the artifact the Plan was approved with (`assets/…`), when it has one. */
  approved: string | null
}
const digest = (source: string | Uint8Array) => createHash("sha256").update(source).digest("hex")
const pathOf = (task: Task) => join(task.dir, "records", "screens.json")
const safeKey = safeScreenKey
/** A file the manifest may name: a picture under evidence/ or an output under records/. */
const safeFile = (file: unknown): file is string => isPictureFile(file) || isOutputFile(file)
const REFUSED =
  "records/screens.json holds records without a run, kind and mode; they are refused, not migrated. Remove that file and record the evidence again"

/** The name the Plan's marker gives an artifact, and `currentPlanAsset` looks its picture up by. */
const referenceName = (reference: { file: string; section?: string }): string =>
  `${reference.file}${reference.section ? `#${reference.section}` : ""}`

/** Identity comes from Interface's named fences and artifact pages, never its titles. */
export async function screenSurfaces(ctx: Ctx, task: Task): Promise<ScreenSurface[]> {
  const path = join(task.dir, folderDoc("plan"))
  if (!(await ctx.fs.exists(path))) return []
  const plan = await ctx.fs.readFile(path)
  const source = /^## Interface\s*$/m.test(plan)
    ? (plan.split(/^## Interface\s*$/m)[1]?.split(/^## /m)[0] ?? "")
    : plan
  const surfaces: ScreenSurface[] = namedPlanFences(task, source).map((fence) => ({
    key: fence.name,
    width: fence.width,
    artifactDigest: digest(fence.source),
    artifact: { kind: "wireframe" as const, source: fence.source },
  }))
  const references = parseMarkers(source).markers.flatMap((marker) => {
    const reference =
      marker.name === "artifact" ? parseArtifactReference(marker.args[0] ?? "") : null
    return reference ? [reference] : []
  })
  for (const file of artifactsInPlan(source)) {
    const reference = parseArtifactReference(file)
    if (reference && !references.some((kept) => kept.file === file)) references.push(reference)
  }
  const names = new Set(
    references
      .filter((reference) => reference.scope === "task")
      .map((reference) => reference.file.replace(/^artifacts\//, "")),
  )
  for (const match of source.matchAll(
    /^\s*<!--\s*ql:artifact\s+([a-z0-9-]+\/[A-Za-z0-9_.-]+\.html)\s*-->/gm,
  ))
    names.add(match[1] ?? "")
  for (const reference of references.filter((reference) => reference.scope === "project")) {
    const read = await artifactReferenceSource(
      ctx,
      { taskDir: task.dir, repoRoot: task.repoRoot },
      reference,
    ).catch(() => null)
    if (read)
      surfaces.push({
        key: reference.key,
        width: artifactMeta(read.html).width ?? 1280,
        artifactDigest: digest(read.html),
        artifact: { kind: "html", source: read.html },
        reference: referenceName(reference),
      })
  }
  for (const name of names) {
    const key = name.includes("/") ? name : name.replace(/\.html$/, "")
    if (!safeKey(key)) continue
    const relative = key.endsWith(".html") ? key : `${key}.html`
    const candidates = [
      join(task.dir, "artifacts", relative),
      join(task.repoRoot, "docs", "artifacts", relative),
    ]
    const file = await Promise.all(
      candidates.map(async (path) => ((await ctx.fs.exists(path)) ? path : null)),
    )
    const found = file.find((path) => path !== null)
    if (!found) continue
    let html = await ctx.fs.readFile(found)
    if (key.includes("/")) {
      const page = key.split("/").at(-1) ?? "index.html"
      await safeArtifactPath(ctx, task.repoRoot, dirname(found))
      const packed = await packFolderPage(dirname(found), page)
      if (packed.ok) html = packed.data.html
    }
    const identities = references.filter(
      (reference) => reference.scope === "task" && reference.file === `artifacts/${relative}`,
    )
    for (const identity of identities.length
      ? identities
      : [{ key, file: `artifacts/${relative}` }])
      surfaces.push({
        key: identity.key,
        width: artifactMeta(html).width ?? 1280,
        artifactDigest: digest(html),
        artifact: { kind: "html", source: html },
        reference: referenceName(identity),
      })
  }
  const keys = new Set<string>()
  for (const surface of surfaces) {
    if (keys.has(surface.key)) throw new Error(`Duplicate screen surface: ${surface.key}`)
    keys.add(surface.key)
  }
  return surfaces
}

/** Validate the PNG's chunks, checksums and decoded scanlines, within a bounded allocation. */
export function checkedScreenPng(png: Uint8Array): void {
  const bytes = Buffer.from(png)
  if (
    bytes.length > SCREEN_MAX_BYTES ||
    bytes.length < 57 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    throw new Error("Capture is not a PNG within the 2 MB limit")
  let offset = 8
  let width = 0,
    height = 0,
    channels = 0
  let ended = false
  const data: Buffer[] = []
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    if (length > SCREEN_MAX_BYTES || offset + length + 12 > bytes.length)
      throw new Error("PNG chunk is truncated")
    const type = bytes.toString("ascii", offset + 4, offset + 8)
    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
      bytes.readUInt32BE(offset + 8 + length)
    )
      throw new Error("PNG checksum failed")
    if (offset === 8 && type !== "IHDR") throw new Error("PNG has no header")
    if (type === "IHDR") {
      if (length !== 13 || width !== 0) throw new Error("Invalid PNG header")
      width = bytes.readUInt32BE(offset + 8)
      height = bytes.readUInt32BE(offset + 12)
      channels =
        ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[bytes[offset + 17] ?? -1] ?? 0
      if (
        !width ||
        width > 8000 ||
        !height ||
        height > 16000 ||
        bytes[offset + 16] !== 8 ||
        !channels ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20] !== 0
      )
        throw new Error("Unsupported PNG dimensions or encoding")
    } else if (type === "IDAT") data.push(bytes.subarray(offset + 8, offset + 8 + length))
    else if (type === "IEND") {
      ended = length === 0 && offset + 12 === bytes.length
      break
    }
    offset += length + 12
  }
  if (!ended || data.length === 0) throw new Error("PNG is incomplete")
  const stride = width * channels + 1
  const expected = stride * height
  if (expected > 64 * 1024 * 1024) throw new Error("Decoded PNG exceeds the memory limit")
  const decoded = inflateSync(Buffer.concat(data), { maxOutputLength: expected })
  if (decoded.length !== expected) throw new Error("PNG scanlines are incomplete")
  for (let row = 0; row < height; row++)
    if ((decoded[row * stride] ?? 255) > 4) throw new Error("Invalid PNG scanline filter")
}

/** The manifest's records, and how many entries were refused for lacking the run, kind and mode. */
async function rawRows(ctx: Ctx, task: Task): Promise<{ rows: EvidenceRow[]; refused: number }> {
  if (!(await ctx.fs.exists(pathOf(task)))) return { rows: [], refused: 0 }
  const value: unknown = JSON.parse(await ctx.fs.readFile(pathOf(task)))
  if (!Array.isArray(value) || value.length > EVIDENCE_ROWS_KEPT)
    throw new Error("Invalid screen manifest")
  const rows = value.filter(isEvidenceRow)
  return { rows, refused: value.length - rows.length }
}

const checkedFiles = new WeakMap<Ctx["fs"], Map<string, { stamp: string; digest: string }>>()

/** A stored picture decodes, or a stored output is text, and its bytes are the ones recorded. */
async function intact(ctx: Ctx, task: Task, row: EvidenceRow): Promise<boolean> {
  if (!row.file || !safeFile(row.file) || !ctx.fs.readBytes) return false
  const limit = row.kind === "output" ? EVIDENCE_OUTPUT_MAX_BYTES : SCREEN_MAX_BYTES
  try {
    const path = join(task.dir, row.file)
    const stat = await ctx.fs.stat?.(path)
    if (stat === null || (stat !== undefined && stat.size > limit)) return false
    const stamp = stat ? `${stat.mtimeMs}:${stat.size}` : null
    const cache = checkedFiles.get(ctx.fs) ?? new Map<string, { stamp: string; digest: string }>()
    checkedFiles.set(ctx.fs, cache)
    const known = cache.get(path)
    if (stamp !== null && known?.stamp === stamp && known.digest === row.shotDigest) return true
    const bytes = await ctx.fs.readBytes(path)
    if (row.kind === "output") checkedOutput(bytes)
    else checkedScreenPng(bytes)
    const fileDigest = digest(bytes)
    if (fileDigest !== row.shotDigest) return false
    if (stamp !== null) cache.set(path, { stamp, digest: fileDigest })
    while (cache.size > EVIDENCE_ROWS_KEPT * 4) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
    return true
  } catch {
    /* A removed or damaged file cannot stand in for evidence. */
    return false
  }
}

async function validRows(ctx: Ctx, task: Task, supplied?: EvidenceRow[]): Promise<EvidenceRow[]> {
  const rows = supplied ?? (await rawRows(ctx, task)).rows
  const valid: EvidenceRow[] = []
  for (const row of rows)
    if ((isScreenRow(row) && row.outcome !== "captured") || (await intact(ctx, task, row)))
      valid.push(row)
  return valid
}

/** Folders of the task that hold generated pages and plan pictures, never a note citing evidence. */
const UNCITED_DIRS: ReadonlySet<string> = new Set([ARTIFACT_DIR, ASSETS_DIR])

/**
 * The files to keep: a bounded citation inventory. A file stays while any Markdown file of the task
 * folder (the agents' files included) cites it, whether or not its manifest row still holds. An
 * inventory that cannot be completed (too many references, an unexpected depth, a link where a file
 * belongs, a file that keeps changing, a read that fails) authorizes no deletion, and never stops
 * new evidence: null means prune nothing.
 */
async function retainedPictures(
  ctx: Ctx,
  task: Task,
  rows: EvidenceRow[],
): Promise<Set<string> | null> {
  try {
    return await citedInventory(ctx, task, rows)
  } catch {
    return null
  }
}

const BOUNDED_TEXT = "Screen evidence reference inventory exceeds its bounded text limit"
const BOUNDED_ENTRIES = "Screen evidence reference inventory exceeds its entry limit"

/** A file cited by a Markdown text: a task-relative evidence path, or one relative to the citing file. */
const CITATION =
  /(?<![\w./:-])((?:\.\.?\/)*(?:evidence\/screen-[a-f0-9]{24}\.png|records\/output-[a-f0-9]{24}\.txt))(?![\w/-]|\.\w)/g

/** What one inventory has read so far, and the files the documents cite. */
type Inventory = {
  fs: Ctx["fs"]
  task: Task
  documents: number
  bytes: number
  entries: number
  cited: Set<string>
}

/** A file's text, read once more when it changed during the read (the Verify record, often). */
async function stableText(fs: Ctx["fs"], path: string, room: number): Promise<string> {
  const stat = fs.stat as NonNullable<Ctx["fs"]["stat"]>
  for (let attempt = 0; ; attempt++) {
    const before = await stat(path)
    if (!before || before.size > room) throw new Error(BOUNDED_TEXT)
    const text = await fs.readFile(path)
    const after = await stat(path)
    if (after && after.size === before.size && after.mtimeMs === before.mtimeMs) return text
    if (attempt > 0) throw new Error("Screen evidence references changed while being read")
  }
}

/** Reads one Markdown file of the task folder and notes the evidence files it cites. */
async function readDocument(inventory: Inventory, path: string): Promise<void> {
  const { fs, task } = inventory
  if (!(await fs.exists(path))) return
  if ((await fs.lstat?.(path))?.kind !== "file")
    throw new Error("Screen evidence references must be regular Markdown files")
  if (++inventory.documents > SCREEN_REFERENCE_DOCS_KEPT) throw new Error(BOUNDED_TEXT)
  const text = await stableText(fs, path, SCREEN_MAX_BYTES - inventory.bytes)
  inventory.bytes += Buffer.byteLength(text)
  if (inventory.bytes > SCREEN_MAX_BYTES) throw new Error(BOUNDED_TEXT)
  for (const match of text.matchAll(CITATION)) {
    const token = match[1] as string
    const file = /^(?:evidence|records)\//.test(token)
      ? token
      : relative(task.dir, resolve(dirname(path), token))
          .split("\\")
          .join("/")
    if (safeFile(file)) inventory.cited.add(file)
  }
}

/** Reads every Markdown file under `path`; a folder nested too deep authorizes no deletion. */
async function readFolder(inventory: Inventory, path: string, depth: number): Promise<void> {
  const { fs } = inventory
  if (!(await fs.exists(path))) return
  if (depth > 4 || (await fs.lstat?.(path))?.kind !== "directory")
    throw new Error("Screen evidence reference folders exceed their safe traversal limit")
  for (const entry of await fs.entries(path)) {
    if (++inventory.entries > EVIDENCE_ROWS_KEPT * 10) throw new Error(BOUNDED_ENTRIES)
    if (entry.kind === "directory") await readFolder(inventory, join(path, entry.name), depth + 1)
    else if (entry.name.endsWith(".md")) await readDocument(inventory, join(path, entry.name))
  }
}

async function citedInventory(ctx: Ctx, task: Task, rows: EvidenceRow[]): Promise<Set<string>> {
  const fs = publicationContext(ctx, task).fs
  const { lstat, stat } = fs
  if (!lstat || !stat) throw new Error("Screen evidence references cannot be checked safely")
  const inventory: Inventory = { fs, task, documents: 0, bytes: 0, entries: 0, cited: new Set() }
  // Every Markdown file of the task folder can cite a file: the step documents, the agents' files
  // (where the judge's iterations are), the reviews, the records. Generated pages and plan
  // pictures hold no citations. A file nobody can read to the end authorizes no deletion.
  for (const entry of await fs.entries(task.dir)) {
    if (++inventory.entries > EVIDENCE_ROWS_KEPT * 10) throw new Error(BOUNDED_ENTRIES)
    const path = join(task.dir, entry.name)
    if (entry.kind === "directory") {
      if (!UNCITED_DIRS.has(entry.name)) await readFolder(inventory, path, 0)
    } else if (entry.name.endsWith(".md")) await readDocument(inventory, path)
  }
  const keep = new Set(rows.flatMap((row) => (safeFile(row.file) ? [row.file] : [])))
  for (const file of inventory.cited) {
    const path = join(task.dir, file)
    if (!(await fs.exists(path))) continue
    const info = await stat(path)
    const limit = isOutputFile(file) ? EVIDENCE_OUTPUT_MAX_BYTES : SCREEN_MAX_BYTES
    if ((await lstat(path))?.kind !== "file" || !info || info.size > limit)
      throw new Error("Referenced screen evidence exceeds its file limit")
    keep.add(file)
  }
  if (keep.size > EVIDENCE_ROWS_KEPT)
    throw new Error("Screen evidence retention is full; cited historical pictures cannot be pruned")
  return keep
}

async function prunePictures(ctx: Ctx, task: Task, keep: Set<string>): Promise<void> {
  for (const folder of [EVIDENCE_DIR, RECORDS_DIR])
    for (const name of await ctx.fs.readdir(join(task.dir, folder)).catch(() => [])) {
      const relative = `${folder}/${name}`
      if (safeFile(relative) && !keep.has(relative)) await ctx.fs.remove(join(task.dir, relative))
    }
}

/** Reads repair dangling rows and orphan capture files under the same lock as writes. */
export async function screenRows(ctx: Ctx, task: Task): Promise<EvidenceRow[]> {
  if (!(await ctx.fs.exists(pathOf(task)))) return []
  const raw = await rawRows(ctx, task)
  const valid = await validRows(ctx, task, raw.rows)
  // A manifest with refused records is left as it is: reading never deletes what it cannot read.
  if (valid.length === raw.rows.length || raw.refused > 0) return valid
  return ctx.fs.withLock(join(task.runtimeDir, "screens.lock"), async () => {
    const again = await rawRows(ctx, task)
    const rows = await validRows(ctx, task, again.rows)
    if (again.refused === 0) {
      const keep = await retainedPictures(ctx, task, rows)
      if (rows.length !== again.rows.length)
        await ctx.fs.atomicWrite(pathOf(task), `${JSON.stringify(rows)}\n`)
      if (keep !== null) await prunePictures(ctx, task, keep)
    }
    return rows
  })
}

/** The rows of the latest runs and of the run that passed; runs are ordered by their first record. */
function keptRows(rows: EvidenceRow[], passed: string | null): EvidenceRow[] {
  const runs = [...new Set(rows.map((row) => row.run))]
  const keep = new Set(runs.slice(-EVIDENCE_RUNS_KEPT))
  if (passed !== null) keep.add(passed)
  return rows.filter((row) => keep.has(row.run))
}

/**
 * Keep the file first, then publish its row atomically, and retire only unreferenced files. A new
 * record never removes an older run's evidence while that run is among the latest three or passed.
 */
async function commitEvidence(
  ctx: Ctx,
  task: Task,
  row: EvidenceRow,
  bytes: Uint8Array | undefined,
  replaces: (old: EvidenceRow) => boolean,
): Promise<EvidenceRow> {
  await ctx.fs.mkdir(join(task.dir, "records"))
  return ctx.fs.withLock(join(task.runtimeDir, "screens.lock"), async () => {
    const found = await rawRows(ctx, task)
    if (found.refused > 0) throw new Error(REFUSED)
    const old = await validRows(ctx, task, found.rows)
    const first = old.find((kept) => kept.run === row.run)
    if (first && first.mode !== row.mode)
      throw new Error(`Run ${row.run} is recorded as ${first.mode}; it cannot also be ${row.mode}`)
    // A replacement takes its predecessor's place, so a run keeps its place among the runs.
    const at = old.findIndex(replaces)
    const others = old.filter((kept) => !replaces(kept))
    const rows = keptRows(
      at < 0 ? [...others, row] : [...others.slice(0, at), row, ...others.slice(at)],
      await passedRun(ctx, task),
    )
    if (!rows.includes(row))
      throw new Error(
        `Run ${row.run} is older than the ${EVIDENCE_RUNS_KEPT} latest runs kept; record under a current run`,
      )
    if (rows.length > EVIDENCE_ROWS_KEPT)
      throw new Error(
        `This task already holds ${EVIDENCE_ROWS_KEPT} evidence records; record fewer pictures per run`,
      )
    const keep = await retainedPictures(ctx, task, rows)
    await ctx.fs.mkdir(join(task.dir, "evidence"))
    if (row.file && bytes) await writePicture(join(task.dir, row.file), bytes)
    await ctx.fs.atomicWrite(pathOf(task), `${JSON.stringify(rows)}\n`)
    if (keep !== null) await prunePictures(ctx, task, keep)
    return row
  })
}

const imageSize = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset)
  return { imageWidth: view.getUint32(16), imageHeight: view.getUint32(20) }
}

/** A capture of a planned screen, or why there is none; earlier runs' captures stay. */
export async function recordScreen(
  ctx: Ctx,
  task: Task,
  input: ScreenInput,
  png?: Uint8Array,
): Promise<ScreenRow> {
  if (!safeKey(input.key)) throw new Error("Invalid surface key")
  if (input.outcome === "captured") {
    if (!png) throw new Error("Captured outcome needs a PNG")
    checkedScreenPng(png)
  } else if (png) throw new Error("An unavailable screen cannot have a picture")
  const shotDigest = png ? digest(png) : null
  const file = shotDigest
    ? `evidence/screen-${digest(`${input.run}:${input.step ?? ""}:${input.key}:${input.width}:${input.height ?? 900}:${input.theme}:${shotDigest}`).slice(0, 24)}.png`
    : null
  const row: ScreenRow = {
    ...input,
    kind: "picture",
    file,
    shotDigest,
    at: ctx.clock.now(),
    ...(png ? imageSize(png) : {}),
  }
  const same = (kept: ScreenRow) =>
    kept.run === row.run &&
    kept.step === row.step &&
    kept.key === row.key &&
    kept.width === row.width &&
    (kept.height ?? 900) === (row.height ?? 900) &&
    kept.theme === row.theme
  await commitEvidence(ctx, task, row, png, (kept) => isScreenRow(kept) && same(kept))
  return row
}

/** A terminal output must be whole UTF-8 text within its size limit. */
export function checkedOutput(bytes: Uint8Array): string {
  if (bytes.length === 0 || bytes.length > EVIDENCE_OUTPUT_MAX_BYTES)
    throw new Error(`An output is text from 1 byte to ${EVIDENCE_OUTPUT_MAX_BYTES / 1024} KB`)
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  if (text.includes("\0")) throw new Error("An output is text, not a binary file")
  return text
}

/** A picture or a terminal output of one run, kept beside the other runs' evidence. */
export async function recordEvidence(
  ctx: Ctx,
  task: Task,
  input: EvidenceInput,
  bytes: Uint8Array,
): Promise<AddedRow> {
  if (input.kind === "picture") checkedScreenPng(bytes)
  else checkedOutput(bytes)
  const shotDigest = digest(bytes)
  const name = digest(`${input.run}:${input.step ?? ""}:${shotDigest}`).slice(0, 24)
  const row: AddedRow = {
    ...input,
    file: input.kind === "picture" ? `evidence/screen-${name}.png` : `records/output-${name}.txt`,
    shotDigest,
    at: ctx.clock.now(),
    ...(input.kind === "picture" ? imageSize(bytes) : {}),
  }
  await commitEvidence(ctx, task, row, bytes, (kept) => kept.file === row.file)
  return row
}

/** A task's evidence grouped by run, the latest run first; each run says how it happened. */
export async function evidenceByRun(ctx: Ctx, task: Task): Promise<EvidenceRun[]> {
  const rows = await screenRows(ctx, task)
  const passed = rows.length > 0 ? await passedRun(ctx, task) : null
  const runs = new Map<string, EvidenceRun>()
  for (const row of rows) {
    const run = runs.get(row.run) ?? {
      run: row.run,
      mode: row.mode,
      at: row.at,
      passed: row.run === passed,
      records: [],
    }
    run.records.push(row)
    runs.set(row.run, run)
  }
  return [...runs.values()].reverse()
}

const citeWords = (kind: string, subject: string): string =>
  kind === "dod"
    ? `Task ${subject}`
    : kind === "done"
      ? `Done means ${subject}`
      : kind === "scenario"
        ? `Scenario ${subject}`
        : kind === "acceptance"
          ? `Acceptance ${subject}`
          : kind === "check"
            ? "Project check"
            : subject === ""
              ? "Review"
              : subject

/**
 * The pictures and outputs the verdicts cite, by run, the latest run first: what the Verify viewer
 * steps through. A file no verdict names is not listed, and a run none of whose files is cited is
 * left out.
 */
export async function citedEvidence(ctx: Ctx, task: Task): Promise<VerificationRun[]> {
  const runs = await evidenceByRun(ctx, task)
  if (runs.length === 0) return []
  const record = await readBuildRecord(ctx, task)
  const verdicts = lastIteration(record)?.verdicts ?? []
  // What each file proves, in the words of the verdict that cites it: "Done means 3", "Scenario 5".
  const cites = new Map<string, string[]>()
  for (const verdict of verdicts) {
    const what = citeWords(verdict.kind, verdict.subject)
    for (const file of evidenceIn(verdict.text))
      cites.set(file, [...new Set([...(cites.get(file) ?? []), what])])
  }
  return runs.flatMap((run) => {
    const files = run.records
      .filter((row) => row.file !== null && cites.has(row.file))
      .map((row) => ({
        file: row.file as string,
        kind: row.kind,
        ...(row.step === undefined ? {} : { step: row.step }),
        cites: cites.get(row.file as string)?.join(", ") ?? "",
        at: row.at,
      }))
    return files.length === 0
      ? []
      : [{ run: run.run, mode: run.mode, at: run.at, passed: run.passed, files }]
  })
}

/**
 * The Plan's steps as rows, each with the files `evidenceOf` gives it, grouped under the Done means
 * point each proves (a step that proves two shows under both), each step's action and what passes
 * kept apart.
 */
export function acceptanceRows(
  list: ProofList,
  evidenceOf: (step: ProofStep) => AcceptanceRow["evidence"],
  modeOf: (step: ProofStep) => EvidenceMode | undefined = () => undefined,
): { steps: AcceptanceRow[]; points?: AcceptancePointRow[] } {
  const steps = list.steps.map((step): AcceptanceRow => {
    const mode = modeOf(step)
    return {
      id: step.id,
      n: step.n,
      text: step.text,
      action: step.action,
      expected: step.expected,
      ...(step.before !== "" ? { before: step.before } : {}),
      evidence: evidenceOf(step),
      ...(mode !== undefined ? { mode } : {}),
    }
  })
  return {
    steps,
    points: list.points.map((point) => ({
      n: point.n,
      text: point.text,
      steps: stepsOfPoint(list, point.n).flatMap((step) => {
        const row = steps.find((r) => r.id === step.id)
        return row === undefined ? [] : [row]
      }),
    })),
  }
}

/**
 * The Plan's acceptance test as it ran: each step as the Plan wrote it, with the pictures and
 * outputs the run that passed recorded for it, and how that run happened. With no run that passed,
 * the steps stand without evidence and the run and mode are null.
 */
export async function acceptanceAsRun(ctx: Ctx, task: Task): Promise<AcceptanceAsRun> {
  const path = join(task.dir, folderDoc("plan"))
  const plan = (await ctx.fs.exists(path)) ? parseDoc(await ctx.fs.readFile(path)).body : ""
  const runs = await evidenceByRun(ctx, task)
  const passed = runs.find((run) => run.passed)
  const list = proofList(plan)
  const steps = list.steps
  const rowsOf = (run: EvidenceRun | undefined) =>
    acceptanceRows(
      list,
      (step) =>
        (run?.records ?? [])
          .filter((row) => row.step === step.id && row.file !== null)
          .map((row) => ({ file: row.file as string, kind: row.kind })),
      // Each step as its own record says it ran (an evidence run keeps one mode; verdicts may not).
      (step) => run?.records.find((row) => row.step === step.id)?.mode,
    )
  // A bug's test is shown before the fix and after it: the baseline run is the earliest run that is not
  // the one that passed and recorded a file for a step.
  const baseline =
    task.type === "bugfix"
      ? runs.findLast((run) => run !== passed && run.records.some((row) => row.step !== undefined))
      : undefined
  // No evidence run passed, but the judge passed every step with its evidence cited: the acceptance
  // test stands as the verdicts recorded it, with their files and the run and mode they name.
  if (passed === undefined && steps.length > 0) {
    const verdicts = await acceptanceVerdicts(ctx, task)
    const all = steps.map((step) => verdicts.get(step.id))
    if (all.every((v) => v?.verdict === "pass")) {
      const first = all.find((v) => v?.run !== undefined)
      return {
        run: first?.run ?? null,
        mode: all.find((v) => v?.mode !== undefined)?.mode ?? null,
        judged: true,
        ...acceptanceRows(
          list,
          (step) => {
            const file = verdicts.get(step.id)?.evidence
            return file === undefined
              ? []
              : [{ file, kind: /\.(png|jpe?g|webp|gif)$/i.test(file) ? "picture" : "output" }]
          },
          (step) => verdicts.get(step.id)?.mode,
        ),
      }
    }
  }
  return {
    run: passed?.run ?? null,
    mode: passed?.mode ?? null,
    ...rowsOf(passed),
    ...(baseline !== undefined
      ? { before: { run: baseline.run, mode: baseline.mode, steps: rowsOf(baseline).steps } }
      : {}),
  }
}

/** The last capture of each planned screen at each size and theme, whichever run took it. */
function latestCaptures(rows: EvidenceRow[]): ScreenRow[] {
  const latest = new Map<string, ScreenRow>()
  for (const row of rows) {
    if (!isScreenRow(row)) continue
    const identity = `${row.key}\n${row.width}\n${row.height ?? 900}\n${row.theme}`
    latest.delete(identity)
    latest.set(identity, row)
  }
  return [...latest.values()]
}

export async function screenPairs(ctx: Ctx, task: Task): Promise<ScreenPair[]> {
  const surfaces = await screenSurfaces(ctx, task)
  if (surfaces.length === 0) return []
  const rows = latestCaptures(await screenRows(ctx, task))
  const revision = rows.length > 0 ? await buildRevision(ctx, task).catch(() => null) : null
  // The picture each artifact was approved with, beside the last capture of the built screen.
  const approvedFiles = new Map<string, string | null>()
  for (const surface of surfaces)
    approvedFiles.set(
      surface.key,
      surface.reference === undefined
        ? null
        : ((await currentPlanAsset(ctx, task, surface.reference).catch(() => null))?.file ?? null),
    )
  return surfaces.flatMap<ScreenPair>((surface) => {
    const approved = approvedFiles.get(surface.key) ?? null
    const matches = rows.filter((row) => row.key === surface.key)
    if (!matches.length)
      return [
        {
          ...surface,
          row: null,
          stale: false,
          file: null,
          outcome: "not captured" as const,
          approved,
        },
      ]
    return matches.map((row) => ({
      ...surface,
      approved,
      width: row.width,
      ...(row.height === undefined ? {} : { height: row.height }),
      row,
      file: row.file,
      outcome: row.outcome,
      stale: row.artifactDigest !== surface.artifactDigest || row.buildRevision !== revision,
      ...(row.artifactDigest !== surface.artifactDigest || row.buildRevision !== revision
        ? {
            staleReason: [
              ...(row.artifactDigest !== surface.artifactDigest
                ? ["artifact content changed"]
                : []),
              ...(row.buildRevision !== revision
                ? [
                    revision === null
                      ? "current build revision unavailable"
                      : "recorded build changed",
                  ]
                : []),
            ].join("; "),
          }
        : {}),
    }))
  })
}

/** Keep the independent review's words when its record names the surface; never infer a visual match. */
export async function reviewScreens(ctx: Ctx, task: Task): Promise<WalkScreen[]> {
  const pairs = await screenPairs(ctx, task)
  if (pairs.length === 0) return []
  const path = verifyLogPath(task)
  const report = sectionText(
    (await ctx.fs.exists(path)) ? await ctx.fs.readFile(path) : "",
    "Verification",
  )
  return pairs.map((pair) => ({
    key: pair.key,
    width: pair.width,
    ...(pair.height === undefined ? {} : { height: pair.height }),
    ...(pair.staleReason ? { staleReason: pair.staleReason } : {}),
    theme: pair.row?.theme ?? "light",
    ...(pair.row
      ? {
          run: pair.row.run,
          mode: pair.row.mode,
          ...(pair.row.step === undefined ? {} : { step: pair.row.step }),
        }
      : {}),
    outcome: pair.outcome,
    stale: pair.stale,
    file: pair.file,
    ...(pair.approved !== null ? { approved: pair.approved } : {}),
    artifact: pair.artifact,
    verdict:
      screenComparison(report, pair.key, pair.width, pair.row?.theme ?? "light", pair.height) ??
      "No comparison recorded.",
  }))
}

/** A pair-specific verdict outranks the older surface-only report format. */
export function screenComparison(
  report: string,
  key: string,
  width: number,
  theme: "light" | "dark",
  height?: number,
): string | undefined {
  const lines = report.split(/\r?\n/)
  let legacy: string | undefined
  let widthOnly: string | undefined
  for (const line of lines) {
    for (const label of [key, `**${key}**`, `\`${key}\``]) {
      const prefix = `- ${label}`
      if (!line.startsWith(prefix)) continue
      const suffix = line.slice(prefix.length)
      const pair =
        /^\s*·\s*(\d+)(?:\s*[×x]\s*(\d+))?\s*(?:px)?\s*(?:·\s*)?(light|dark)\s*:\s*(\S.*)$/.exec(
          suffix,
        )
      if (pair && Number(pair[1]) === width && pair[3] === theme) {
        if (pair[2] !== undefined && Number(pair[2]) === height) return pair[4]?.trim()
        if (pair[2] === undefined) widthOnly = pair[4]?.trim()
      }
      if (suffix.startsWith(": ")) legacy = suffix.slice(2).trim() || undefined
    }
  }
  return widthOnly ?? legacy
}
