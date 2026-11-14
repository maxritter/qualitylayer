/** The Git pointer's first line is its path; only whitespace may follow it. */
export function worktreePointer(marker: string): string | null {
  const found = /^gitdir: ([^\r\n]+)/.exec(marker)
  if (found === null || !/^\s*$/.test(marker.slice(found[0].length))) return null
  return found[1] ?? null
}
