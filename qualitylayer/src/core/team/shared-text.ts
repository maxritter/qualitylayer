// The plaintext rules of the team-copy boundary (publication.ts), without the HTML and CSS
// validators: the caller says which wireframe and panel fences stay. publication.ts keeps a fence
// only when it validates; the App's first script reads copies the server already passed through it.
import { marked } from "marked"
import { sharedArtifactSources } from "../artifact/sharing.ts"
import { extractFences } from "../docs/fence-scanner.ts"
import { NAMES, type Step } from "../docs/names.ts"
import { FLOW_STEPS, flowStepOf } from "../flow.ts"
import { blocks, type FenceCheck } from "./shared-markdown.ts"
import { isPlanStill, PLAN_STILL, SCREEN_STILLS, screenStillsFromDocs } from "./shared-stills.ts"

export type { FenceCheck } from "./shared-markdown.ts"
export {
  isPlanStill,
  PLAN_STILL,
  type PlanStill,
} from "./shared-stills.ts"

/** The file a shared copy holds for each step. */
export const STEP_DOCS: Record<Step, readonly string[]> = {
  plan: [NAMES.plan],
  implement: [NAMES.implement],
  verify: [NAMES.verify],
}

const CODE_TAGS = new Set([
  "pre",
  "code",
  "script",
  "style",
  "textarea",
  "xmp",
  "iframe",
  "object",
  "svg",
  "math",
  "template",
])

const HTML_TAG_PATTERN =
  /<!--[\s\S]*?(?:-->|$)|<\/?([a-z][a-z0-9]*)\b(?:[^<>"']|"[^"]*"|'[^']*')*(?:>|$)/gi

type Range = { start: number; end: number }

function findFenceRanges(markdown: string): Range[] {
  const offsets = [0]
  for (const line of markdown.matchAll(/\n/g)) offsets.push(line.index + 1)
  // Markdown containers add quote/list prefixes; remove their width only for locating fence lines.
  const unwrapped = markdown.replace(
    /^(?:[ \t]*(?:>|(?:[-+*]|\d+[.)])(?=[ \t])))+[ \t]*(?=[`~]{3})/gm,
    (prefix) => " ".repeat(prefix.length),
  )
  return extractFences(unwrapped).map((fence) => ({
    start: offsets[fence.line - 1] ?? 0,
    end: offsets[fence.endLine] ?? markdown.length,
  }))
}

function updateCodeTagStack(stack: string[], rawTag: string, name: string): void {
  if (rawTag.startsWith("</")) {
    const at = stack.lastIndexOf(name)
    if (at >= 0) stack.splice(at)
    return
  }
  const selfClosing = rawTag.endsWith("/>") && (name === "svg" || name === "math")
  if (!selfClosing) stack.push(name)
}

function stripHtmlCodeRegions(markdown: string, fences: Range[]): string {
  const stack: string[] = []
  let plain = ""
  let cursor = 0
  // Quoted attributes and nested code elements must not end a region early.
  for (const tag of markdown.matchAll(HTML_TAG_PATTERN)) {
    // Validate original fences before HTML stripping could turn hostile source into safe source.
    if (fences.some((fence) => tag.index >= fence.start && tag.index < fence.end)) continue
    if (stack.length === 0) plain += markdown.slice(cursor, tag.index)
    const name = tag[1]?.toLowerCase() ?? ""
    if (CODE_TAGS.has(name)) updateCodeTagStack(stack, tag[0], name)
    else if (stack.length === 0) plain += tag[0]
    cursor = tag.index + tag[0].length
  }
  if (stack.length === 0) plain += markdown.slice(cursor)
  return plain
}

/**
 * Remove code contents, including indented/nested/unclosed fences and inline HTML code regions. Given
 * the name of the document it is, a task's Review keeps the file names of the three sections
 * QualityLayer writes.
 *
 * The owner's machine and the teammate's page both pass a document through here, so the result is
 * the one text that passing it again leaves as it is: what one pass writes can read as other
 * Markdown (two lists a removed block parted read as one), and the pass is repeated until it settles.
 */
export function stripSharedCodeWith(
  valid: FenceCheck,
  markdown: string,
  docName?: string,
  layout = false,
): string {
  let text = stripOnce(valid, markdown, docName, layout)
  for (let pass = 0; pass < 4; pass++) {
    const next = stripOnce(valid, text, docName, layout)
    if (next === text) break
    text = next
  }
  return text
}

function stripOnce(valid: FenceCheck, markdown: string, docName?: string, layout = false): string {
  const plain = stripHtmlCodeRegions(markdown, findFenceRanges(markdown))
  return blocks(marked.lexer(plain), {
    review: docName === NAMES.verify,
    names: false,
    planInline: STEP_DOCS.plan.some((name) => name === docName),
    valid,
    layout,
  })
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function sharedDocumentsWith(
  valid: FenceCheck,
  value: Record<string, unknown>,
  stage?: string,
): Record<string, string> {
  const docs: Record<string, string> = {}
  const reached = FLOW_STEPS.findIndex((step) => step.id === flowStepOf(stage ?? ""))
  for (const [index, step] of FLOW_STEPS.entries()) {
    if (reached >= 0 && index > reached) continue
    const name = STEP_DOCS[step.id].find((file) => typeof value[file] === "string")
    if (name !== undefined)
      docs[name] = stripSharedCodeWith(
        valid,
        String(value[name]).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""),
        name,
      )
  }
  if (STEP_DOCS.plan.some((name) => docs[name] !== undefined) && isPlanStill(value[PLAN_STILL]))
    docs[PLAN_STILL] = value[PLAN_STILL]
  Object.assign(docs, sharedArtifactSources(value))
  const screens = screenStillsFromDocs(value)
  if (Object.keys(screens).length) docs[SCREEN_STILLS] = JSON.stringify(screens)
  return docs
}
