import type { CheckRecord } from "../checks.ts"

function successfulCurrentCheck(row: CheckRecord | undefined, reviewedAt: number): boolean {
  if (row?.ran !== true || row.exit !== 0) return false
  if (row.notRun !== undefined || row.timedOut === true) return false
  if (typeof row.key !== "string" || row.key.length === 0) return false
  if (typeof row.head !== "string" || !/^[a-f0-9]{7,64}$/.test(row.head)) return false
  return row.at >= reviewedAt
}

/** A taken finding remains planned until the recorded fix has current, complete project checks. */
export function reviewFixFacts(
  findings: readonly { stance?: string; answer?: string }[],
  commands: readonly string[],
  checks: readonly CheckRecord[],
  reviewedAt: number | undefined,
) {
  const taken = findings.filter((finding) => finding.stance === "taken")
  const latest = commands.map((command) =>
    checks.findLast((row) => row.scope === "all" && row.command === command),
  )
  const checked =
    reviewedAt !== undefined &&
    commands.length > 0 &&
    latest.every((row) => successfulCurrentCheck(row, reviewedAt)) &&
    new Set(latest.map((row) => row?.head)).size === 1
  const fixed = checked
    ? taken.filter((finding) => (finding.answer?.trim().length ?? 0) > 0).length
    : 0
  return {
    fixed,
    planned: taken.length - fixed,
    kept: findings.filter((finding) => finding.stance === "kept").length,
  }
}
