// Verify's people file of the demo task (`03-verify.md`), written as the pull request description:
// Why, Code, Diagrams, Interface, Done means as it ran, the Checks as they ended, Changed from the
// Plan and Ship. The sections below Why are QualityLayer's, written here by the real writers from the
// same walkthrough the review page draws (`walkthrough.ts`), so the page, the Reader and the pull
// request's body tell one story.

import { acceptanceMarkdown, screensMarkdown } from "../../../core/pages/sections/review.ts"
import { finalStages } from "./verify.ts"
import { DEMO_SECURITY, DEMO_WHY, demoWalkthrough } from "./walkthrough.ts"

/** The finished description, with the Checks section (`ql:stages`) the caller writes for its moment. */
export function demoDescription(checks: string): string {
  const walk = demoWalkthrough()
  return `# Usage-based billing

## Why

${DEMO_WHY}

## Code

<!-- ql:code -->
All ${walk.points.length} points pass · ${walk.totals.commits} commits · Security: ${DEMO_SECURITY.length} findings
<!-- /ql:code -->

## Diagrams

${walk.changed}

## Interface

${screensMarkdown(walk)}

## Done means

<!-- ql:acceptance -->
${acceptanceMarkdown(walk.acceptance)}
<!-- /ql:acceptance -->

## Checks

<!-- ql:stages -->
${checks}
<!-- /ql:stages -->

## Changed from the Plan

<!-- ql:risk -->
As planned.
<!-- /ql:risk -->

## Ship

<!-- ql:ship -->
Not shipped yet. Branch \`feat/usage-billing\`.
<!-- /ql:ship -->
`
}

/** The pull request's body as GitHub gets it: the sections above *Ship*, as written. */
export function demoPullRequestBody(): string {
  const text = demoDescription(finalStages())
  const start = text.indexOf("\n", text.indexOf("# ")) + 1
  return `${text.slice(start, text.indexOf("## Ship")).trim()}\n`
}
