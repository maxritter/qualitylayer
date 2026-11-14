import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, readdir, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE_HEAD = "f1af6c91ae1065af51c043844e81c840997172b2"
const SOURCE_CATALOG_SHA256 = "1664a41d3ddcf7f989851dc14199696a82b81155f839f4e3f0b4e52fa0bca39a"
const OMISSION_POLICY_SHA256 = "eb4ba5f8bbabdbc4a66d66a607f1f208087d98b319f1ab17242f2f8bff0a27de"
const PRIVATE_RUNTIME = [
  "src/core/licence/",
  "src/commercial/licensing/",
  "src/server/ui/",
  "src/memory-engine/payloads/",
  "src/memory-embed/assets/",
]
const PUBLIC_LICENCE = new Set([
  "qualitylayer/src/memory-embed/assets/NOTICES.txt",
  "qualitylayer/src/memory-embed/assets/manifest.json",
  "qualitylayer/src/memory-embed/assets/vocab.txt",
  "qualitylayer/src/memory-engine/payloads/NOTICES.txt",
  "qualitylayer/src/memory-engine/payloads/darwin-arm64.build-info.txt",
  "qualitylayer/src/memory-engine/payloads/darwin-x64.build-info.txt",
  "qualitylayer/src/memory-engine/payloads/linux-arm64.build-info.txt",
  "qualitylayer/src/memory-engine/payloads/linux-x64.build-info.txt",
  "qualitylayer/src/memory-engine/payloads/manifest.json",
  "qualitylayer/src/memory-engine/payloads/win32-arm64.build-info.txt",
  "qualitylayer/src/memory-engine/payloads/win32-x64.build-info.txt",
  "qualitylayer/src/core/licence/address-policy.ts",
  "qualitylayer/src/core/licence/mask.ts",
  "qualitylayer/src/core/licence/workflow.ts",
])
const RETIRING = new Set([
  "qualitylayer/src/core/team/comments.ts",
  "qualitylayer/src/core/team/own-log.ts",
  "qualitylayer/src/core/team/people.ts",
  "qualitylayer/src/core/team/publication.ts",
  "qualitylayer/src/core/team/shared-text.ts",
  "qualitylayer/src/core/team/thread-publication.ts",
  "qualitylayer/src/ui/demo/artifact-feedback.ts",
])
const PROFILE_OUTPUTS = new Map([
  ["component-package.json", "qualitylayer/package.json"],
  ["component-bun.lock", "qualitylayer/bun.lock"],
  ["component-tsconfig.json", "qualitylayer/tsconfig.public.json"],
  ["component-biome.json", "qualitylayer/biome.public.json"],
])
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex")
const safe = (path) =>
  typeof path === "string" &&
  !/[\\\0]/.test(path) &&
  path.split("/").every((p) => p && p !== "." && p !== "..")
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
const inside = (root, path) => {
  const part = relative(root, path)
  return part && part !== ".." && !part.startsWith("../") && !part.startsWith("/")
}

function publicPath(path) {
  if (!safe(path)) return false
  if (path.startsWith("qualitylayer/src/")) {
    if (PUBLIC_LICENCE.has(path)) return true
    return !PRIVATE_RUNTIME.some((prefix) => path.startsWith(`qualitylayer/${prefix}`))
  }
  return (
    ["LICENSE", "CONTRIBUTING.md"].includes(path) ||
    /^qualitylayer\/scripts\/public\/(?:check-workflow|check-licensing|workflow-assets)\.ts$/.test(
      path,
    ) ||
    /^qualitylayer\/tests\/(?:workflow\/(?:asset-bundle|composition)|licensing-client\/(?:identity|transport))\.test\.ts$/.test(
      path,
    ) ||
    /^qualitylayer\/patches\/@xterm%2F(?:addon-webgl@0\.19\.0|xterm@6\.0\.0)\.patch$/.test(path)
  )
}

function validatePlan(plan) {
  if (plan.schema !== 1 || plan.scope !== "public-workflow-component" || plan.globalReady !== false)
    throw new Error("Expected an explicit component scope; global publication is unqualified")
  if (
    !Array.isArray(plan.files) ||
    !Array.isArray(plan.profiles) ||
    !Array.isArray(plan.runtimeOmissions)
  )
    throw new Error("Missing exact component membership")
  if (plan.files.length + plan.runtimeOmissions.length > 10000)
    throw new Error("Component file-count budget exceeded")
  if (
    plan.sourceHead !== SOURCE_HEAD ||
    plan.catalogSha256 !== SOURCE_CATALOG_SHA256 ||
    sha(JSON.stringify(plan.runtimeOmissions)) !== OMISSION_POLICY_SHA256
  )
    throw new Error(
      "Runtime omission policy differs from the exact reviewed committed source policy",
    )
  const selected = new Set()
  for (const row of plan.files) {
    if (
      "output" in row ||
      !publicPath(row.path) ||
      row.visibility !== "public" ||
      row.responsibility !== "nonlicensing" ||
      row.review !== "reviewed" ||
      !digest(row.sha256)
    )
      throw new Error(`Unapproved public component input: ${row.path}`)
    if (
      row.lifecycle !== "retained" &&
      !(row.lifecycle === "retirement-pending" && RETIRING.has(row.path))
    )
      throw new Error(`Unapproved component lifecycle: ${row.path}`)
    if (selected.has(row.path)) throw new Error("Duplicate component input")
    selected.add(row.path)
  }
  for (const path of RETIRING)
    if (!selected.has(path)) throw new Error(`Current public producer omitted: ${path}`)
  const profiles = new Set()
  for (const row of plan.profiles) {
    const name = row.path?.split("/").at(-1)
    if (
      row.path !== `qualitylayer/scripts/public/${name}` ||
      PROFILE_OUTPUTS.get(name) !== row.output ||
      !digest(row.sha256) ||
      profiles.has(row.output)
    )
      throw new Error("Unapproved contributor data profile")
    profiles.add(row.output)
  }
  if (profiles.size !== PROFILE_OUTPUTS.size)
    throw new Error("Incomplete contributor data profiles")
  for (const row of plan.runtimeOmissions) {
    if (
      !safe(row.path) ||
      publicPath(row.path) ||
      !row.path.startsWith("qualitylayer/src/") ||
      !["private", "excluded"].includes(row.visibility) ||
      !["licensing-enforcement", "excluded-data"].includes(row.responsibility) ||
      row.review !== "reviewed" ||
      selected.has(row.path)
    )
      throw new Error("Invalid private/generated runtime omission")
    if (selected.has(`omit:${row.path}`)) throw new Error("Duplicate runtime omission")
    selected.add(`omit:${row.path}`)
  }
}

async function regularBytes(root, path) {
  if (!safe(path)) throw new Error("Unsafe input path")
  let at = root
  for (const part of path.split("/")) {
    at = join(at, part)
    const info = await lstat(at)
    if (info.isSymbolicLink()) throw new Error("Input symlink refused")
  }
  const target = await realpath(at)
  if (!inside(root, target)) throw new Error("Input escapes source root")
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > 64 * 1024 * 1024)
      throw new Error("Input is not a bounded regular file")
    const bytes = await handle.readFile()
    const after = await handle.stat()
    if (
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs ||
      after.ctimeMs !== info.ctimeMs
    )
      throw new Error("Input changed while read")
    if (bytes.subarray(0, 10).equals(Buffer.from([0, 71, 73, 84, 67, 82, 89, 80, 84, 0])))
      throw new Error("Selected public input is encrypted; no decryption is available")
    return bytes
  } finally {
    await handle.close()
  }
}

async function runtimePaths(root, path = "qualitylayer/src") {
  const found = []
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`
    if (entry.isSymbolicLink()) throw new Error("Runtime symlink refused")
    if (entry.isDirectory()) found.push(...(await runtimePaths(root, child)))
    else if (entry.isFile()) found.push(child)
    else throw new Error("Unexpected runtime entry")
  }
  return found
}

export async function inspect(root, plan) {
  validatePlan(plan)
  const canonical = await realpath(root)
  const known = new Set([
    ...plan.files.map((r) => r.path),
    ...plan.runtimeOmissions.map((r) => r.path),
  ])
  const failures = []
  for (const path of await runtimePaths(canonical))
    if (!known.has(path)) failures.push({ path, code: "unlisted-runtime-producer" })
  const inputs = new Map()
  let total = 0
  for (const row of [...plan.files, ...plan.profiles]) {
    try {
      const bytes = await regularBytes(canonical, row.path)
      total += bytes.length
      if (total > 384 * 1024 * 1024) throw new Error("Component byte budget exceeded")
      const actual = sha(bytes)
      if (actual !== row.sha256)
        failures.push({ path: row.path, code: "hash-mismatch", expected: row.sha256, actual })
      else inputs.set(row.output ?? row.path, bytes)
    } catch (cause) {
      failures.push({ path: row.path, code: "input-refused", reason: cause.message })
    }
  }
  return { canonical, inputs, failures, bytes: total }
}

async function privateOutput(source, requested) {
  const target = resolve(requested)
  const requestedParent = dirname(target)
  let ancestor = "/"
  for (const part of requestedParent.split("/").filter(Boolean)) {
    ancestor = join(ancestor, part)
    if ((await lstat(ancestor)).isSymbolicLink() && !["/tmp", "/var"].includes(ancestor))
      throw new Error("Output parent symlink refused")
  }
  const parent = await realpath(requestedParent)
  const temporary = await realpath(tmpdir())
  const roots = new Set([temporary, "/private/tmp", "/tmp"])
  if (![...roots].some((root) => parent === root || inside(root, parent)))
    throw new Error("Component outputs must remain under private /tmp")
  const info = await lstat(parent)
  if (!roots.has(parent) && (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0))
    throw new Error("Component output parent must be private and owned")
  const output = join(parent, target.split("/").at(-1))
  if (output === source || inside(source, output)) throw new Error("Output overlaps source")
  return output
}

export async function prepare(root, plan, destination) {
  const observed = await inspect(root, plan)
  if (observed.failures.length)
    return {
      scope: plan.scope,
      globalReady: false,
      componentReady: false,
      failures: observed.failures,
    }
  const output = await privateOutput(observed.canonical, destination)
  const publicRoot = join(output, "public")
  for (const path of observed.inputs.keys())
    if (!safe(path) || !inside(publicRoot, resolve(publicRoot, path)))
      throw new Error("Unsafe final component write path")
  await mkdir(output, { mode: 0o700 })
  await mkdir(publicRoot, { mode: 0o700 })
  const publicFiles = {}
  for (const [path, bytes] of observed.inputs) {
    const target = join(publicRoot, path)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, bytes, { mode: 0o600, flag: "wx" })
    publicFiles[path] = sha(bytes)
  }
  // Existing source-projection readers and command/effect witnesses consume this ownership format.
  const owner = {
    schema: 1,
    tool: "qualitylayer-source-projection",
    manifestHash: sha(JSON.stringify(plan)),
    publicFiles,
  }
  await writeFile(join(output, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  })
  const receipt = {
    scope: plan.scope,
    globalReady: false,
    componentReady: true,
    sourceHead: plan.sourceHead,
    retirementPending: plan.files
      .filter((r) => r.lifecycle === "retirement-pending")
      .map((r) => r.path),
    publicRoot,
    packageRoot: join(publicRoot, "qualitylayer"),
    files: Object.keys(publicFiles).length,
  }
  await writeFile(join(output, "component.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  })
  return receipt
}

export async function main(args) {
  const [command, ...rest] = args
  const out = rest.length === 2 && rest[0] === "--out" ? rest[1] : undefined
  if (
    !["inspect", "prepare"].includes(command) ||
    (command === "inspect" ? rest.length !== 0 : !out)
  )
    throw new Error(
      "Usage: node qualitylayer/scripts/public/component-workspace.mjs inspect | prepare --out <new-private-/tmp-directory>",
    )
  const root = resolve(HERE, "../../..")
  const plan = JSON.parse(
    await regularBytes(root, "qualitylayer/scripts/public/component-inputs.json"),
  )
  const result =
    command === "prepare"
      ? await prepare(root, plan, out)
      : await inspect(root, plan).then((r) => ({
          scope: plan.scope,
          globalReady: false,
          componentReady: !r.failures.length,
          files: r.inputs.size,
          failures: r.failures,
        }))
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result.componentReady ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (cause) => {
      process.stderr.write(`${cause.message}\n`)
      process.exitCode = 1
    },
  )
