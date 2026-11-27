// Named engine rules: a schema lists rule names, this table implements each once. A rule guards a
// record the App reads or a hard limit; how a document is worded is the phase text's business.

import { fenceChecks } from "../visuals.ts"
import {
  deployedStateChecked,
  mermaidParses,
  projectChecks,
  referencesResolve,
  trustBoundaryLine,
  yourCallCount,
} from "./doc-rules.ts"
import { acceptanceBeforeFix, doneMeansProof } from "./done-means-rules.ts"
import {
  artifactRefsResolve,
  everyTaskHasLabels,
  filesAreSource,
  prerequisitesSettled,
  proofOrder,
  testFirstOrTrivial,
  unapprovedCommand,
} from "./outline-rules.ts"
import {
  fenceStyleSafe,
  markersOwned,
  planArtifact,
  sectionOwned,
  wireframeFragment,
  wireframeHeader,
} from "./page-rules.ts"
import { planConcise } from "./plan-concise.ts"
import type { Rule } from "./types.ts"
import { validationTestsExist } from "./validation-tests.ts"
import { verifyVerdicts } from "./verify-rules.ts"

export const rules: Record<string, Rule> = {
  ...Object.fromEntries(
    ["panel-header", "panel-fragment", "panel-labels"].map((rule) => [
      rule,
      (input: Parameters<Rule>[0]) => fenceChecks(input, rule),
    ]),
  ),
  "wireframe-header": wireframeHeader,
  "wireframe-fragment": wireframeFragment,
  "fence-style-safe": fenceStyleSafe,
  "references-resolve": referencesResolve,
  "mermaid-parses": mermaidParses,
  "markers-owned": markersOwned,
  // A task's Plan.
  "plan-artifact": planArtifact,
  "plan-concise": planConcise,
  "your-call-count": yourCallCount,
  "done-means-proof": doneMeansProof,
  "acceptance-before-fix": acceptanceBeforeFix,
  prerequisites: prerequisitesSettled,
  "deployed-state-checked": deployedStateChecked,
  "trust-boundary-line": trustBoundaryLine,
  "project-checks": projectChecks,
  // Implement's slices and cards.
  "every-task-has-labels": everyTaskHasLabels,
  "test-first-or-trivial": testFirstOrTrivial,
  "proof-order": proofOrder,
  "unapproved-command": unapprovedCommand,
  "files-are-source": filesAreSource,
  "artifact-refs-resolve": artifactRefsResolve,
  "validation-tests-exist": validationTestsExist,
  // A task's Implement and Verify documents.
  "section-owned": sectionOwned,
  "verify-verdicts": verifyVerdicts,
}

export type { Rule, RuleInput } from "./types.ts"
