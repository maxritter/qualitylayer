import { constants } from "node:fs"
import { lstat, mkdir, open, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { inside, runtimePaths, safe, sha, validatePlan } from "./component-plan.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))

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

async function inspectRow(canonical, row, state) {
  try {
    const bytes = await regularBytes(canonical, row.path)
    state.total += bytes.length
    if (state.total > 384 * 1024 * 1024) throw new Error("Component byte budget exceeded")
    const actual = sha(bytes)
    if (actual !== row.sha256)
      state.failures.push({ path: row.path, code: "hash-mismatch", expected: row.sha256, actual })
    else state.inputs.set(row.output ?? row.path, bytes)
  } catch (cause) {
    state.failures.push({ path: row.path, code: "input-refused", reason: cause.message })
  }
}

export async function inspect(root, plan) {
  validatePlan(plan)
  const canonical = await realpath(root)
  const known = new Set([
    ...plan.files.map((r) => r.path),
    ...plan.runtimeOmissions.map((r) => r.path),
  ])
  const state = { failures: [], inputs: new Map(), total: 0 }
  for (const path of await runtimePaths(canonical))
    if (!known.has(path)) state.failures.push({ path, code: "unlisted-runtime-producer" })
  for (const row of [...plan.files, ...plan.profiles]) await inspectRow(canonical, row, state)
  return { canonical, inputs: state.inputs, failures: state.failures, bytes: state.total }
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
