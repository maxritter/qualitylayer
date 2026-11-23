import { basename, join, relative } from "node:path"
import { hash } from "../validation.ts"
import { readSource, utf8, walkSources } from "./files.ts"
import { knowledgeDocument } from "./knowledge-document.ts"
import { invalid, object, observation, words } from "./normalize.ts"
import { issue, PILOT_DOCUMENT_MAX_BYTES, type PilotSourceData } from "./types.ts"

export { knowledgeDocument }

function bundleMappings(data: PilotSourceData, value: unknown) {
  if (
    !object(value) ||
    value.version !== 1 ||
    !Array.isArray(value.bundles) ||
    value.bundles.length > 1000
  ) {
    throw new Error("Pilot private knowledge mapping is not supported.")
  }
  for (const entry of value.bundles) {
    if (
      !object(entry) ||
      !/^[a-f0-9]{64}$/.test(words(entry.storageKey)) ||
      !Array.isArray(entry.checkouts)
    ) {
      throw new Error("Pilot private knowledge mapping is malformed.")
    }
    const checkouts = entry.checkouts.flatMap((item) =>
      object(item) &&
      words(item.project) &&
      words(item.projectRoot) &&
      hash(words(item.projectRoot)) === entry.storageKey
        ? [{ project: words(item.project), root: words(item.projectRoot) }]
        : [],
    )
    data.bundles.set(words(entry.storageKey), checkouts)
  }
}

function seedBundleRoots(data: PilotSourceData): void {
  for (const [project, roots] of data.roots) {
    for (const root of roots) {
      const key = hash(root)
      const known = data.bundles.get(key) ?? []
      if (!known.some((item) => item.project === project && item.root === root)) {
        known.push({ project, root })
      }
      data.bundles.set(key, known)
    }
  }
}

async function readBundleSyncState(
  data: PilotSourceData,
  memoryFolder: string,
  storageKey: string,
  states: Map<string, Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const cached = states.get(storageKey)
  if (cached) return cached
  const bytes = await readSource(
    data,
    join(memoryFolder, "knowledge-sync", `${storageKey}.json`),
    true,
  )
  if (bytes && bytes.length > PILOT_DOCUMENT_MAX_BYTES) {
    throw new Error("Pilot knowledge sync metadata exceeds 2 MiB.")
  }
  const parsed: unknown = bytes ? JSON.parse(utf8(bytes)) : {}
  const state = object(parsed) ? parsed : {}
  states.set(storageKey, state)
  return state
}

async function readPrivateFile(
  data: PilotSourceData,
  details: {
    memoryFolder: string
    root: string
    file: string
    states: Map<string, Record<string, unknown>>
  },
): Promise<void> {
  const { memoryFolder, root, file, states } = details
  const name = relative(root, file).split(/[\\/]/)
  const storageKey = name.shift() ?? ""
  if (!/^[a-f0-9]{64}$/.test(storageKey)) {
    invalid(data, "Private knowledge bundle name is invalid.")
    return
  }
  const mappings = data.bundles.get(storageKey) ?? []
  const mapping = mappings.length === 1 ? mappings[0] : undefined
  const content = await readSource(data, file)
  if (!content) throw new Error("Pilot source file was not found.")
  const sync = await readBundleSyncState(data, memoryFolder, storageKey, states)
  knowledgeDocument(data, {
    path: name.join("/"),
    content: utf8(content),
    project: mapping?.project ?? "",
    root: mapping?.root,
    bundle: storageKey,
    missing: new Set(
      Array.isArray(sync.missing)
        ? sync.missing.filter((value): value is string => typeof value === "string")
        : [],
    ),
    mirrored: object(sync.mirrored) ? sync.mirrored : {},
  })
}

export async function privateKnowledge(data: PilotSourceData, memoryFolder: string): Promise<void> {
  const manifest = await readSource(data, join(memoryFolder, "knowledge-bundles.json"), true)
  if (manifest) bundleMappings(data, JSON.parse(utf8(manifest)))
  seedBundleRoots(data)
  const root = join(memoryFolder, "knowledge")
  const states = new Map<string, Record<string, unknown>>()
  for (const file of await walkSources(data, root, /\.md$/, true)) {
    await readPrivateFile(data, { memoryFolder, root, file, states })
  }
  data.privateKnowledge = true
}

function importLegacyJsonl(data: PilotSourceData, text: string): void {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const row: unknown = JSON.parse(line)
      if (!object(row) || row.schemaVersion !== 1 || !words(row.uid) || !words(row.project)) {
        throw new Error("Legacy record is malformed.")
      }
      if (data.removed.has(words(row.uid))) {
        data.counts.excluded++
        continue
      }
      observation(data, row, true)
    } catch {
      invalid(data, "A legacy Pilot record could not be read.")
    }
  }
}

export async function projectKnowledge(data: PilotSourceData, checkout: string): Promise<void> {
  const project =
    [...data.roots].find(([, roots]) => roots.includes(checkout))?.[0] ?? basename(checkout)
  const root = join(checkout, ".pilot", "knowledge")
  for (const file of await walkSources(data, root, /\.md$/, true)) {
    const bytes = await readSource(data, file)
    if (!bytes) throw new Error("Pilot source file was not found.")
    knowledgeDocument(data, {
      path: relative(root, file).split("\\").join("/"),
      content: utf8(bytes),
      project,
      root: checkout,
      bundle: hash(checkout),
    })
  }
  const memoryFiles = await walkSources(
    data,
    join(checkout, ".pilot", "memories"),
    /\.jsonl$/,
    true,
  )
  for (const file of memoryFiles) {
    const bytes = await readSource(data, file)
    if (!bytes) throw new Error("Pilot source file was not found.")
    importLegacyJsonl(data, utf8(bytes))
  }
  if (!data.groups.size) {
    issue(data, "The selected checkout contains no supported Pilot knowledge.")
  }
}
