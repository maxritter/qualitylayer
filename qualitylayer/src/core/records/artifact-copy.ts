import {
  ARTIFACT_FILE_MAX_BYTES,
  ARTIFACT_FOLDER_MAX_FILES,
  folderArtifactOf,
} from "../artifact/format.ts"
import type { AnchoredRoot } from "../filesystem/anchored-root.ts"
import { installCopyOutputs, stageCopyOutputs } from "./artifact-copy-install.ts"
import { artifactFileSnapshot } from "./artifact-identity.ts"
import { ANNOTATION_ASSETS_BYTES, jsonBytes, recordHash } from "./contract.ts"

export type CopyFile = {
  file: string
  identity: string
  version: string
  sha256: string
  size: number
  bytes?: Uint8Array
}
export type CopyTree = {
  files: CopyFile[]
  bytes: number
  directories: { path: string; identity: string }[]
}

function readCopyFile(root: AnchoredRoot, file: string, keepBytes: boolean): CopyFile {
  const captured = artifactFileSnapshot(root, file)
  return {
    file,
    identity: captured.identity,
    version: captured.version,
    sha256: recordHash(captured.bytes),
    size: captured.bytes.length,
    ...(keepBytes ? { bytes: captured.bytes } : {}),
  }
}

type CopyContext = { tree: CopyTree; keepBytes: boolean }

function appendCopyFile(root: AnchoredRoot, context: CopyContext, file: string) {
  const captured = readCopyFile(root, file, context.keepBytes)
  context.tree.bytes += captured.size
  if (context.tree.bytes > ANNOTATION_ASSETS_BYTES)
    throw new Error("Artifact adoption exceeds its byte bound")
  context.tree.files.push(captured)
  if (context.tree.files.length > ARTIFACT_FOLDER_MAX_FILES)
    throw new Error("Artifact adoption exceeds its file bound")
}

function visitCopyDirectory(
  root: AnchoredRoot,
  context: CopyContext,
  directory: string,
  depth: number,
) {
  if (depth > 16) throw new Error("Artifact folder nesting exceeds its bound")
  const entries = root.entries(directory, ARTIFACT_FOLDER_MAX_FILES)
  if (!entries) throw new Error("Artifact source folder is unavailable")
  const held = root.directory(directory)
  try {
    held.assertCurrentRoot()
    context.tree.directories.push({ path: directory, identity: held.identity })
  } finally {
    held.close()
  }
  if (context.tree.directories.length > ARTIFACT_FOLDER_MAX_FILES)
    throw new Error("Artifact adoption exceeds its directory bound")
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = `${directory}/${entry.name}`
    if (entry.kind === "directory") visitCopyDirectory(root, context, file, depth + 1)
    else {
      if (entry.kind !== "file")
        throw new Error("Artifact adoption refuses links and nonregular files")
      appendCopyFile(root, context, file)
    }
  }
}

function copyTree(root: AnchoredRoot, folder: string, keepBytes: boolean): CopyTree {
  const context = { tree: { files: [], bytes: 0, directories: [] } as CopyTree, keepBytes }
  visitCopyDirectory(root, context, folder, 0)
  return context.tree
}

const treeFingerprint = (tree: CopyTree) =>
  recordHash(
    jsonBytes({
      directories: tree.directories,
      files: tree.files.map(({ bytes: _bytes, ...file }) => file),
    }),
  )

function adoptionSource(root: AnchoredRoot, from: string, keepBytes: boolean) {
  const folder = folderArtifactOf(from)
  if (folder)
    return {
      prefix: `${folder.root}/${folder.name}/`,
      tree: copyTree(root, `${folder.root}/${folder.name}`, keepBytes),
    }
  const captured = readCopyFile(root, from, keepBytes)
  return {
    prefix: from,
    tree: { files: [captured], bytes: captured.size, directories: [] },
  }
}

function destinationPrefix(to: string) {
  const folder = folderArtifactOf(to)
  return folder ? `${folder.root}/${folder.name}/` : to
}

function assertAdoptionTargetMissing(root: AnchoredRoot, to: string) {
  const folder = folderArtifactOf(to)
  if (folder) {
    if (root.entries(`${folder.root}/${folder.name}`, ARTIFACT_FOLDER_MAX_FILES))
      throw new Error("Artifact adoption target folder already exists")
  } else if (root.snapshot(to, ARTIFACT_FILE_MAX_BYTES))
    throw new Error("Artifact adoption target already exists")
}

export type ArtifactCopyOutput = {
  from: string
  to: string
  stage: string
  identity: string
  version: string
  sha256: string
  sourceIdentity: string
  sourceVersion: string
}
export type ArtifactCopyAddress = {
  from: string
  to: string
  expected: string
  folder?: { from: string; to: string; rename?: { from: string; to: string } }
}
export type ArtifactCopyPlan = {
  from: string
  to: string
  expected: string
  sourceIdentity: string
  sourceVersion: string
  sourceFingerprint: string
  folder?: ArtifactCopyAddress["folder"]
  install?: { from: string; to: string; identity: string; fingerprint: string }
  outputs: ArtifactCopyOutput[]
}

function copySource(root: AnchoredRoot, address: ArtifactCopyAddress, keepBytes: boolean) {
  return address.folder
    ? { prefix: `${address.folder.from}/`, tree: copyTree(root, address.folder.from, keepBytes) }
    : adoptionSource(root, address.from, keepBytes)
}

/** Stage native objects first. The durable caller records these identities before any target moves. */
export function stageArtifactCopy(
  root: AnchoredRoot,
  address: ArtifactCopyAddress,
  stage: string,
): ArtifactCopyPlan {
  const namedSource = folderArtifactOf(address.from),
    namedTarget = folderArtifactOf(address.to)
  if (!address.folder && namedSource && namedTarget)
    address = {
      ...address,
      folder: {
        from: `${namedSource.root}/${namedSource.name}`,
        to: `${namedTarget.root}/${namedTarget.name}`,
      },
    }
  const source = artifactFileSnapshot(root, address.from, address.expected)
  const before = copySource(root, address, true)
  const page = before.tree.files.find((file) => file.file === address.from)
  if (!page || page.identity !== source.identity || page.version !== source.version)
    throw new Error("Artifact adoption source identity changed before capture")
  if (address.folder) {
    if (root.entries(address.folder.to, ARTIFACT_FOLDER_MAX_FILES))
      throw new Error("Library adoption destination exists")
  } else assertAdoptionTargetMissing(root, address.to)
  const prefix = address.folder ? `${address.folder.to}/` : destinationPrefix(address.to)
  const { outputs, install } = stageCopyOutputs(
    root,
    { address, before, stage, prefix },
    (folder) => installedTreeFingerprint(root, folder),
  )
  const plan = {
    ...address,
    ...(install ? { install } : {}),
    sourceIdentity: source.identity,
    sourceVersion: source.version,
    sourceFingerprint: treeFingerprint(before.tree),
    outputs,
  }
  verifyArtifactCopySource(root, plan)
  return plan
}

export function verifyArtifactCopySource(root: AnchoredRoot, plan: ArtifactCopyPlan) {
  const after = copySource(root, plan, false)
  if (treeFingerprint(after.tree) !== plan.sourceFingerprint)
    throw new Error("Artifact adoption source tree changed; originals and target are preserved")
}

function installedTreeFingerprint(root: AnchoredRoot, folder: string) {
  const tree = copyTree(root, folder, false)
  return recordHash(
    jsonBytes({
      directories: tree.directories.map((directory) => ({
        ...directory,
        path: directory.path.slice(folder.length),
      })),
      files: tree.files.map(({ file, bytes: _bytes, ...value }) => ({
        ...value,
        file: file.slice(folder.length),
      })),
    }),
  )
}

export function commitArtifactCopy(root: AnchoredRoot, plan: ArtifactCopyPlan) {
  verifyArtifactCopySource(root, plan)
  installCopyOutputs(root, plan, (folder) => installedTreeFingerprint(root, folder))
  verifyArtifactCopySource(root, plan)
  root.assertCurrentRoot()
}
