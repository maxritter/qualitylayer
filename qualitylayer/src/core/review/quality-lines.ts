import { recordLineTail } from "../docs/record-lines.ts"
import type { QualityItem, Severity } from "../polish.ts"
import { trimmedLineTail } from "../text-boundaries.ts"

const FINDING = /^[-*]\s+(?:\[([ xX])\]\s+)?(S\d+)\s+(critical|high|medium|low)\b\s*(?:·\s*)?/
const RESULT = "**Result:**"

export function qualityFinding(line: string): QualityItem | null {
  const finding = line.match(FINDING)
  if (finding === null) return null
  const text = recordLineTail(line, finding[0].length, 0, true)
  if (text === null) return null
  return {
    id: finding[2] ?? "",
    severity: (finding[3] ?? "high") as Severity,
    ticked: finding[1] === "x" || finding[1] === "X",
    text,
  }
}

export function qualityHeading(line: string): string | undefined {
  return line.startsWith("###") ? trimmedLineTail(line, 3, 1)?.toLowerCase() : undefined
}

export function qualityResult(line: string): string | null {
  return line.startsWith(RESULT) ? trimmedLineTail(line, RESULT.length, 0) : null
}
