import { dirname, join } from "node:path"
import type { PilotSourceInput } from "../../../pilot-memory-contracts.ts"
import { closeSourceAnchors, registerSourceAnchor } from "./anchor.ts"
import { archiveSource } from "./archive.ts"
import { selectedPath, sourceDirectory, verifySources } from "./files.ts"
import { knowledgeDocument, privateKnowledge, projectKnowledge } from "./knowledge.ts"
import { reconcileLineage } from "./lineage.ts"
import { invalid, object, observation, words } from "./normalize.ts"
import { sqliteSource } from "./sqlite.ts"
import { budget, issue, type PilotSourceData, sourceData } from "./types.ts"

function importExportedJsonl(data: PilotSourceData, content: string): void {
  for (const line of content.split("\n")) {
    if (!line.trim()) continue
    try {
      const row: unknown = JSON.parse(line)
      if (!object(row) || row.schemaVersion !== 1 || !words(row.uid) || !words(row.project)) {
        throw new Error("Invalid exported Pilot record.")
      }
      observation(data, row, true)
    } catch {
      invalid(data, "An exported Pilot record is malformed.")
    }
  }
}

function textFiles(data: PilotSourceData, files: NonNullable<PilotSourceInput["files"]>) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 100) {
    throw new Error("Choose 1–100 exported memory files.")
  }
  for (const file of files) {
    if (
      !object(file) ||
      typeof file.name !== "string" ||
      typeof file.content !== "string" ||
      !/\.(?:md|jsonl)$/.test(file.name)
    ) {
      throw new Error("Choose exported Pilot Markdown or JSONL memory files.")
    }
    data.bytes += Buffer.byteLength(file.content)
    budget(data)
    if (file.name.endsWith(".md")) {
      knowledgeDocument(data, {
        path: file.name,
        content: file.content,
        project: "",
        bundle: "exported",
      })
      continue
    }
    importExportedJsonl(data, file.content)
  }
}

async function scanFolderSource(data: PilotSourceData, path: string): Promise<void> {
  const names = await sourceDirectory(data, path)
  if (names.includes("pilot-memory.db")) {
    await sqliteSource(data, join(path, "pilot-memory.db"))
    return
  }
  issue(data, "No Pilot database was present. Only selected knowledge documents were scanned.")
}

async function scanPathSource(data: PilotSourceData, input: PilotSourceInput): Promise<void> {
  const path = await selectedPath(input.path ?? "")
  await registerSourceAnchor(data, input.kind === "folder" ? path : dirname(path))
  if (input.kind === "backup") await archiveSource(data, path)
  else if (input.kind === "folder") await scanFolderSource(data, path)
  else await sqliteSource(data, path)

  const privateFolder = input.kind === "folder" ? path : input.knowledgeFolder
  if (privateFolder) {
    const folder = await selectedPath(privateFolder)
    await registerSourceAnchor(data, folder)
    await privateKnowledge(data, folder)
  }
  if (input.kind === "database" && !input.knowledgeFolder) {
    issue(
      data,
      "The database does not include private knowledge files. Add their memory folder to include them.",
    )
  }
}

async function scanProjectFolders(
  data: PilotSourceData,
  projectFolders: PilotSourceInput["projectFolders"],
): Promise<void> {
  if (
    projectFolders !== undefined &&
    (!Array.isArray(projectFolders) || projectFolders.length > 100)
  ) {
    throw new Error("Select at most 100 project knowledge folders.")
  }
  for (const inputFolder of projectFolders ?? []) {
    const folder = await selectedPath(inputFolder)
    await registerSourceAnchor(data, folder)
    await projectKnowledge(data, folder)
  }
}

export async function scanPilotSource(
  input: PilotSourceInput,
  signal?: AbortSignal,
): Promise<PilotSourceData> {
  const data = sourceData()
  data.signal = signal
  try {
    if (!input || !["folder", "database", "backup", "files"].includes(input.kind)) {
      throw new Error("Choose a supported Pilot memory source.")
    }
    if (input.kind === "files") textFiles(data, input.files ?? [])
    else await scanPathSource(data, input)
    await scanProjectFolders(data, input.projectFolders)
    budget(data)
    await verifySources(data.stamps, signal, data.deadline)
    reconcileLineage(data)
    return data
  } finally {
    closeSourceAnchors(data)
  }
}
