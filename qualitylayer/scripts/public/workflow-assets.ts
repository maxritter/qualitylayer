import { createHash } from "node:crypto"
import { lstat, readFile, realpath, writeFile } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  assetHash,
  composeAsset,
  createAssetBundle,
  serializeAssetBundle,
} from "../../src/workflow/asset-bundle.ts"
import type {
  AssetDefinition,
  AssetId,
  AssetSource,
  WorkflowBundle,
} from "../../src/workflow/asset-contract.ts"

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

const PHASE_INPUTS: Record<string, string[]> = {
  "artifact-authoring": ["artifact-authoring"],
  "artifact-check": ["artifact-check"],
  plan: ["plan", "_style", "_pictures"],
  "plan-bugfix": ["plan", "plan-bugfix", "_style", "_pictures"],
  "plan-adopted": ["plan-adopted", "_style"],
  "research-helper": ["research-helper"],
  "cross-review": ["cross-review"],
  "cross-review-round": ["cross-review-round"],
  implement: ["implement"],
  "implement-bugfix": ["implement", "implement-bugfix"],
  handback: ["handback"],
  "quality-security": ["quality-security"],
  "quality-security-recheck": ["quality-security-recheck"],
  verify: ["verify"],
  "verify-bugfix": ["verify", "verify-bugfix"],
  judge: ["judge"],
  "judge-rerun": ["judge-rerun"],
  "verify-judge": ["verify-judge"],
  "judge-bugfix": ["judge-bugfix"],
  final: ["final"],
  "review-triage": ["review-triage"],
  ship: ["ship"],
  "show-me": ["show-me"],
  "line-question": ["line-question"],
  "another-review": ["another-review"],
  style: ["_style"],
}

const SCHEMAS = ["research", "plan", "plan-bugfix", "plan-adopted", "implement", "verify"]

const SKILLS = {
  main: "workflow",
  peers: "peer",
  artifact: "artifact",
  manage: "manage",
  quality: "quality",
  chat: "chat",
}
const MOD_FILES = [
  ".claude-plugin/plugin.json",
  "hooks/hooks.json",
  "hooks/register.tsx",
  "hooks/register.test.tsx",
  "types/index.d.ts",
]

export const ASSET_DEFINITIONS: readonly AssetDefinition[] = [
  ...Object.entries(PHASE_INPUTS).map(
    ([name, inputs]): AssetDefinition => ({
      id: `phase:${name}`,
      transform: "join",
      sources: inputs.map((input) => `src/workflow/phases/${input}.md`),
    }),
  ),
  ...SCHEMAS.map(
    (name): AssetDefinition => ({
      id: `schema:${name}`,
      transform: "json",
      sources: [`src/workflow/schemas/${name}.json`],
    }),
  ),
  ...["artifact", "wireframe"].map(
    (name): AssetDefinition => ({
      id: `template:${name}`,
      transform: "verbatim",
      sources: [`src/workflow/artifacts/${name}.html.tmpl`],
    }),
  ),
  ...Object.entries(SKILLS).map(
    ([name, folder]): AssetDefinition => ({
      id: `skill:${name}`,
      transform: "verbatim",
      sources: [`src/skills/ql-${folder}/SKILL.md`],
    }),
  ),
  ...["pi.ts.tmpl", "opencode.ts.tmpl", "peers.js.tmpl"].map(
    (name): AssetDefinition => ({
      id: `native:${name}`,
      transform: "verbatim",
      sources: [`src/workflow/native/${name}`],
    }),
  ),
  ...MOD_FILES.map(
    (name): AssetDefinition => ({
      id: `bootstrap:mod/${name}`,
      transform: "verbatim",
      sources: [`src/workflow/mod/qualitylayer/${name}`],
    }),
  ),
]

// Conservative provenance: bind all application runtime files, including text/data/static inputs.
// Hashing unrelated public UI files costs metadata but avoids a silently incomplete producer list.
// This is not a publication allowlist. Retired application paths leave with their implementation.
const RUNTIME_INPUTS = "src/**/*"
const NONPUBLIC_OR_GENERATED = [
  "src/core/licence/",
  "src/commercial/licensing/",
  "src/server/ui/",
  "src/memory-engine/payloads/",
  "src/memory-embed/assets/",
] as const

async function sourceFile(root: string, path: string): Promise<string> {
  const target = resolve(root, path)
  const actual = await realpath(target)
  const inside = relative(await realpath(root), actual)
  if (inside.startsWith("../") || inside === ".." || inside.startsWith("/"))
    throw new Error(`Asset source escapes package: ${path}`)
  if (!(await lstat(target)).isFile())
    throw new Error(`Asset source is not a regular file: ${path}`)
  return target
}

export async function generateWorkflowBundle(
  version: string,
  root = PACKAGE_ROOT,
): Promise<WorkflowBundle> {
  const files = new Map<string, Buffer>()
  const bytes = async (path: string) => {
    let source = files.get(path)
    if (source === undefined) {
      source = await readFile(await sourceFile(root, path))
      files.set(path, source)
    }
    return source
  }
  const read = async (path: string) => (await bytes(path)).toString("utf8")
  const assets = []
  for (const definition of ASSET_DEFINITIONS) {
    const inputs = await Promise.all(definition.sources.map(read))
    const text = composeAsset(definition.transform, inputs)
    assets.push({
      ...definition,
      sources: definition.sources.map((path, index) => ({
        path,
        sha256: assetHash(inputs[index] as string),
      })),
      text,
      sha256: assetHash(text),
    })
  }
  const contextualFiles = new Set(["scripts/public/workflow-assets.ts"])
  for await (const path of new Bun.Glob(RUNTIME_INPUTS).scan({
    cwd: root,
    onlyFiles: true,
    dot: true,
  }))
    if (
      !path.endsWith("/.DS_Store") &&
      !NONPUBLIC_OR_GENERATED.some((prefix) => path.startsWith(prefix))
    )
      contextualFiles.add(path)
  const composition: AssetSource[] = []
  for (const path of [...contextualFiles].sort())
    composition.push({
      path,
      sha256: createHash("sha256")
        .update(await bytes(path))
        .digest("hex"),
    })
  return createAssetBundle(version, assets, composition)
}

export function assetTexts(bundle: WorkflowBundle): Record<AssetId, string> {
  return Object.fromEntries(bundle.assets.map((asset) => [asset.id, asset.text]))
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length !== 4 || args[0] !== "--version" || args[2] !== "--out")
    throw new Error(
      "Usage: bun scripts/public/workflow-assets.ts --version <exact-version> --out <file>",
    )
  const bundle = await generateWorkflowBundle(args[1] as string)
  await writeFile(args[3] as string, serializeAssetBundle(bundle))
  console.log(`${bundle.digest}  ${args[3]}`)
}
