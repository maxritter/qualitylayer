function parseVersion(v: string): { nums: number[]; pre: string | null } {
  const [core = "", pre] = v.replace(/^v/, "").split("-", 2)
  return { nums: core.split(".").map((n) => Number(n) || 0), pre: pre ?? null }
}

function comparePrerelease(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b, undefined, { numeric: true })
}

/** Major.minor.patch[-pre.N] compared numerically; prereleases sort before their release. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    const diff = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (diff !== 0) return diff
  }
  return comparePrerelease(x.pre, y.pre)
}

/** The running release without its build number: `12.1.0-beta.3.409614` is `12.1.0-beta.3`. */
export const releaseOf = (current: string): string =>
  /^(\d+\.\d+\.\d+(?:-beta\.\d+)?)\.\d+$/.exec(current)?.[1] ?? current
