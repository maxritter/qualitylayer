import { createGunzip } from "node:zlib"
import {
  archiveCollection,
  importBundleDocuments,
  registerBundleCheckouts,
} from "./archive-knowledge.ts"
import { readSource, utf8 } from "./files.ts"
import { learning, object, observation, words } from "./normalize.ts"
import type { PilotSourceData } from "./types.ts"
import { budget, PILOT_EXPANDED_MAX_BYTES } from "./types.ts"

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = createGunzip()
  const chunks: Buffer[] = []
  let size = 0
  const finished = new Promise<Uint8Array>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > PILOT_EXPANDED_MAX_BYTES) {
        stream.destroy(new Error("Pilot backup exceeds the expanded byte limit."))
        return
      }
      chunks.push(chunk)
    })
    stream.on("end", () => resolve(Buffer.concat(chunks)))
    stream.on("error", reject)
  })
  stream.end(bytes)
  return await finished
}

async function readExpandedArchive(data: PilotSourceData, path: string): Promise<Uint8Array> {
  const bytes = await readSource(data, path)
  if (!bytes) throw new Error("Pilot source file was not found.")
  const compressed = /\.gz$/i.test(path)
  const expanded = compressed ? await gunzip(bytes) : bytes
  if (expanded.length > PILOT_EXPANDED_MAX_BYTES) {
    throw new Error("Pilot backup exceeds the expanded byte limit.")
  }
  if (compressed) data.bytes += expanded.length
  budget(data)
  return expanded
}

export async function archiveSource(data: PilotSourceData, path: string) {
  if (!/\.backup\.(?:json|gz)$/i.test(path)) {
    throw new Error("Choose a Pilot .backup.json or .backup.gz archive.")
  }
  const expanded = await readExpandedArchive(data, path)
  const parsed: unknown = JSON.parse(utf8(expanded))
  if (!object(parsed) || !["1.0", "1.1"].includes(words(parsed.version)) || !object(parsed.data)) {
    throw new Error("Pilot backup version is not supported.")
  }
  const source = parsed.data
  data.archiveAt = words(parsed.createdAt) || undefined
  const personal = source.personalKnowledge
  if (personal !== undefined && (!object(personal) || personal.version !== 1)) {
    throw new Error("Pilot backup private knowledge version is not supported.")
  }
  const bundles = object(personal) ? archiveCollection(personal.bundles, "knowledge bundles") : []
  if (bundles.length > 1000) throw new Error("Pilot backup has too many knowledge bundles.")
  registerBundleCheckouts(data, bundles)
  for (const row of archiveCollection(source.observations, "observations")) {
    budget(data)
    observation(data, row)
  }
  for (const row of archiveCollection(source.summaries, "summaries")) {
    budget(data)
    learning(data, row)
  }
  for (const field of ["sessions", "prompts", "pendingMessages"]) {
    if (Array.isArray(source[field])) data.counts.excluded += source[field].length
  }
  if (personal === undefined) return
  importBundleDocuments(data, bundles)
  data.privateKnowledge = true
}
