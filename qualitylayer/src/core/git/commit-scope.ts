import { lstat, realpath } from "node:fs/promises"
import { dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path"

const outside = (root: string, path: string) => {
  const rest = relative(root, path)
  return rest === ".." || rest.startsWith(`..${sep}`) || isAbsolute(rest)
}
const quoted = (value: string) => JSON.stringify(value.slice(0, 300))

function validateRelativePath(file: string): { portable: string } | { reason: string } {
  if (typeof file !== "string" || !file || file.includes("\0"))
    return { reason: "a source path is invalid" }
  const portable = file.replaceAll("\\", "/")
  const normalized = posix.normalize(portable)
  if (normalized === ".." || normalized.startsWith("../"))
    return { reason: "the source path leaves this repository" }
  if (
    isAbsolute(portable) ||
    win32.isAbsolute(portable) ||
    /^(?:[A-Za-z][A-Za-z0-9+.-]*:|~|\$)/.test(portable)
  )
    return { reason: "the source path is not repository-relative" }
  return { portable }
}

const isMissingCode = (cause: unknown) =>
  ["ENOENT", "ENOTDIR"].includes((cause as NodeJS.ErrnoException).code ?? "")

async function resolveExistingAncestor(
  root: string,
  portable: string,
): Promise<{ actual: string; tail: string[] } | null> {
  let nearest = resolve(root, portable)
  const tail: string[] = []
  for (let depth = 0; depth < 128; depth++) {
    try {
      return { actual: await realpath(nearest), tail }
    } catch (cause) {
      if (!isMissingCode(cause)) throw cause
      const parent = dirname(nearest)
      if (parent === nearest) return null
      tail.unshift(nearest.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)))
      nearest = parent
    }
  }
  return null
}

async function hasGitBoundary(
  directory: string,
  boundaries: Map<string, boolean>,
): Promise<boolean> {
  const cached = boundaries.get(directory)
  if (cached !== undefined) return cached
  const found = await lstat(join(directory, ".git"))
    .then(() => true)
    .catch((cause) => {
      if (isMissingCode(cause)) return false
      throw cause
    })
  boundaries.set(directory, found)
  return found
}

async function checkNestedBoundaries(
  actual: string,
  canonical: string,
  boundaries: Map<string, boolean>,
): Promise<string | null> {
  let directory = (await lstat(actual)).isDirectory() ? actual : dirname(actual)
  for (let depth = 0; directory !== canonical && depth < 128; depth++) {
    if (boundaries.size >= 4096) return "repository-boundary checks exceeded their bound"
    if (await hasGitBoundary(directory, boundaries))
      return "the source belongs to a nested repository boundary"
    const parent = dirname(directory)
    if (parent === directory) return "the source repository boundary cannot be verified"
    directory = parent
  }
  return directory === canonical ? null : "the source repository boundary exceeds its path bound"
}

async function checkFileScope(
  root: string,
  canonical: string,
  file: string,
  boundaries: Map<string, boolean>,
): Promise<string | null> {
  const checked = validateRelativePath(file)
  if ("reason" in checked) return checked.reason
  try {
    const resolved = await resolveExistingAncestor(root, checked.portable)
    if (!resolved) return "the source location cannot be verified within its path bound"
    if (outside(canonical, resolve(resolved.actual, ...resolved.tail)))
      return "the source location resolves outside this repository"
    return await checkNestedBoundaries(resolved.actual, canonical, boundaries)
  } catch {
    return "the source location cannot be verified safely"
  }
}

/** Legacy admission cannot turn unsupported source scope into a successful no-change release. */
export async function commitScopeError(
  root: string,
  files: readonly string[],
): Promise<string | null> {
  const refuse = (path: string, reason: string) =>
    `Cannot commit selected Files ${quoted(path)}: ${reason}. This task's checkout is ${quoted(root)}. Slice commits and manual --commit adoption support repository-relative Files in this one repository. Nothing was committed. Preserve this work and use a separate task in the owning repository for its commit and verification records; cross-repository commit support is not available.`
  if (files.length > 4096)
    return refuse("selected Files", "source scope exceeds its 4096-path bound")
  let canonical: string
  try {
    canonical = await realpath(root)
  } catch {
    return refuse("selected Files", "the task checkout cannot be verified")
  }
  const boundaries = new Map<string, boolean>()
  for (const file of new Set(files)) {
    const reason = await checkFileScope(root, canonical, file, boundaries)
    if (reason !== null) return refuse(typeof file === "string" ? file : String(file), reason)
  }
  return null
}
