import type { MemoryExchangeResult, MemoryRepositoryOperation } from "../../../memory-contracts.ts"

const lessonCount = (n: number) => `${n} ${n === 1 ? "lesson" : "lessons"}`
export function rememberResult(operation: MemoryRepositoryOperation, result: MemoryExchangeResult) {
  const { written, imported, skipped, conflicts, issues } = result
  const lead =
    operation === "export"
      ? written
        ? `Exported ${lessonCount(written)} to docs/memories/.`
        : "No new files were exported."
      : imported
        ? `Restored ${lessonCount(imported)}.`
        : "No new lessons were restored."
  const problem = issues.find(
    (issue) => !/^Preserved (conflicting revision|repository file conflict)/.test(issue),
  )
  return {
    message: [
      lead,
      skipped > 0 && `${lessonCount(skipped)} skipped.`,
      conflicts > 0 &&
        `${lessonCount(conflicts)} ${conflicts === 1 ? "needs" : "need"} a version choice.`,
    ]
      .filter(Boolean)
      .join(" "),
    problem,
  }
}
