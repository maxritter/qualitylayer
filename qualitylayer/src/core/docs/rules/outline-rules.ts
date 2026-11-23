// Rules over Implement's slices and cards (agents/02-implement.md): the records the build reads
// and the limits it runs under (no command that leaves the machine unseen, repository files only).

import type { ValidationError } from "../../../ctx.ts"
import { agentFileOf, folderDoc } from "../names.ts"
import type { ProofOrderLine } from "../outline.ts"
import { planProof } from "./plan-proof.ts"
import { type Rule, sectionRanges, verr } from "./types.ts"

type SectionRange = ReturnType<typeof sectionRanges>[number]

export { artifactRefsResolve, filesAreSource } from "./outline-files-rules.ts"
export { commandRisk, prerequisitesSettled, unapprovedCommand } from "./outline-prereq-rules.ts"
export { everyTaskHasLabels, testFirstOrTrivial } from "./outline-task-rules.ts"

const CARDS_FILE = agentFileOf("implement")

function checkProofOrderLine(
  line: ProofOrderLine,
  steps: readonly string[],
  slices: readonly number[],
  written: (id: string) => string,
): ValidationError | null {
  if (!steps.includes(line.id)) {
    const plan = folderDoc("plan")
    return verr(
      line.line,
      "proof-order",
      `Proof order names ${line.id}, which the Plan's Done means does not have (its steps are ${steps.join(", ")})`,
      `take the line out; if the Plan is missing that step, add it to ${plan} and record it with \`qualitylayer plan amend --by agent --note "<the step, and why>"\``,
    )
  }
  if (slices.length > 0 && !slices.includes(line.slice)) {
    return verr(
      line.line,
      "proof-order",
      `Proof order puts ${line.id} after slice ${line.slice}, which the cards do not have`,
      `name one of its slices (${slices.map((n) => `slice ${n}`).join(", ")}) in \`${written(line.id)}\``,
    )
  }
  return null
}

function missingProofOrderError(
  heading: SectionRange | undefined,
  steps: readonly string[],
  missing: readonly string[],
  written: (id: string) => string,
): ValidationError {
  if (heading === undefined) {
    return verr(
      1,
      "proof-order",
      `${CARDS_FILE} has no \`## Proof order\` section, and the Plan's Done means has ${steps.length === 1 ? "one step" : `${steps.length} steps`} (${steps.join(", ")})`,
      `add "## Proof order" to ${CARDS_FILE} with one line per step saying after which slice it can first run, such as ${missing
        .slice(0, 3)
        .map((id) => `\`${written(id)}\``)
        .join(" and ")}`,
    )
  }
  return verr(
    heading.start,
    "proof-order",
    `Proof order has no line for ${missing.join(", ")}`,
    `under "## Proof order" in ${CARDS_FILE} add one line for ${missing.length === 1 ? "it" : "each"}, such as \`${written(missing[0] ?? "A1")}\``,
  )
}

/**
 * The Plan's Done means is proved step by step: every step has one line in *Proof order*
 * (`A3 · after slice 2`) naming a slice the cards have, and no line names a step the Plan lacks.
 * The build runs each step as soon as its slice is committed.
 */
export const proofOrder: Rule = async (input) => {
  const list = await planProof(input)
  const outline = input.outline()
  const heading = sectionRanges(input.markdown).find(
    (r) => r.heading.toLowerCase() === "proof order",
  )
  const slices = outline.slices.map((slice) => slice.n)
  // The last slice is always true: every step can run once the whole build is committed.
  const last = slices[slices.length - 1] ?? 1
  const written = (id: string) => `- ${id} · after slice ${last}`
  const steps = list.steps.map((step) => step.id)
  const errors = outline.proofOrderUnread.map((line) =>
    verr(
      line.line,
      "proof-order",
      `Proof order line "${line.text}" names a step and no slice it can run after`,
      `write the step and the slice after which it can first run, as \`${written(line.ids[0] ?? "A1")}\``,
    ),
  )
  for (const line of outline.proofOrder) {
    const found = checkProofOrderLine(line, steps, slices, written)
    if (found !== null) errors.push(found)
  }
  // A line that names a step without a slice is refused above; its step is not also missing.
  const placed = new Set([
    ...outline.proofOrder.map((line) => line.id),
    ...outline.proofOrderUnread.flatMap((line) => line.ids),
  ])
  const missing = steps.filter((id) => !placed.has(id))
  if (missing.length > 0) errors.push(missingProofOrderError(heading, steps, missing, written))
  return errors
}
