import { parse } from "parse5"
import { networkUses } from "../docs/visuals.ts"
import { artifactMeta, metaContent } from "./format.ts"

type SourceNode = {
  tagName?: string
  namespaceURI?: string
  value?: string
  attrs?: { name: string; value: string }[]
  childNodes?: SourceNode[]
  content?: SourceNode
  sourceCodeLocation?: { endTag?: unknown } | null
}

type Finding = { rule: string; message: string }

const ACTION_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "switch",
  "tab",
  "treeitem",
])

const NON_ACTION_ROLES = new Set([
  "alert",
  "article",
  "cell",
  "columnheader",
  "definition",
  "document",
  "feed",
  "figure",
  "generic",
  "grid",
  "group",
  "heading",
  "img",
  "list",
  "listbox",
  "listitem",
  "main",
  "math",
  "menu",
  "menubar",
  "meter",
  "navigation",
  "none",
  "note",
  "presentation",
  "progressbar",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "separator",
  "status",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "tooltip",
  "tree",
])

function titleOf(node: SourceNode): SourceNode | undefined {
  if (node.tagName === "title" && node.namespaceURI === "http://www.w3.org/1999/xhtml") return node
  for (const child of node.childNodes ?? []) {
    const title = titleOf(child)
    if (title) return title
  }
  return undefined
}

function checkDocumentStructure(
  html: string,
  title: SourceNode | undefined,
  purpose: string | undefined,
  findings: Finding[],
): void {
  if (!/<!doctype\s+html/i.test(html) || !/<html\b/i.test(html) || !/<body\b/i.test(html))
    findings.push({
      rule: "complete-page",
      message: "Use a complete HTML document with a doctype, html and body",
    })
  if (!/<html\b[^>]*\blang\s*=/i.test(html))
    findings.push({ rule: "language", message: "Set the document's language on html" })
  const hasTitleText = title?.childNodes?.some(
    (node) => typeof node.value === "string" && node.value.trim() !== "",
  )
  if (!title?.sourceCodeLocation?.endTag || !hasTitleText)
    findings.push({ rule: "title", message: "Give this artboard its own meaningful title" })
  if (!purpose)
    findings.push({
      rule: "purpose",
      message: "Add a one-line purpose in the description meta tag",
    })
  if (/<x-dc\b|DCLogic|src=["']\.\/support\.js/i.test(html))
    findings.push({
      rule: "native-html",
      message: "Use ordinary HTML and JavaScript; the Claude Design runtime is not present in QL",
    })
}

function checkNetworkUses(html: string, findings: Finding[], notes: string[]): void {
  const fixture =
    /^[a-f0-9]{64}$/.test(metaContent(html, "ql:source-digest") ?? "") &&
    /class=["'][^"']*\bsource-preview\b/i.test(html) &&
    /(?:window|globalThis)\.fetch\s*=/.test(html)
  for (const hit of networkUses(html)) {
    if (fixture && ["a fetch() call", "a network API"].includes(hit.what)) {
      if (notes.length === 0)
        notes.push(
          "The source export includes its offline fixture adapter. Network API references remain subject to the artifact sandbox; render verification is still required.",
        )
      continue
    }
    findings.push({
      rule: "local-assets",
      message: `line ${hit.line}: ${hit.what}; embed local assets instead`,
    })
  }
}

function checkRolesAndIds(node: SourceNode, ids: Set<string>, findings: Finding[]): void {
  const attrs = new Map(node.attrs?.map((attr) => [attr.name, attr.value]))
  const id = attrs.get("id")
  if (id !== undefined) {
    if (ids.has(id))
      findings.push({
        rule: "unique-id",
        message: `The id ${id} is repeated; keep artboard anchors stable and unique`,
      })
    ids.add(id)
  }
  const isAction =
    node.tagName === "button" ||
    (node.tagName === "a" && attrs.has("href")) ||
    (node.tagName === "input" && ["button", "submit", "reset"].includes(attrs.get("type") ?? ""))
  const role = attrs
    .get("role")
    ?.trim()
    .split(/\s+/)
    .find((value) => ACTION_ROLES.has(value) || NON_ACTION_ROLES.has(value))
  if (isAction && role && NON_ACTION_ROLES.has(role))
    findings.push({
      rule: "action-role",
      message: `${node.tagName} role=${role} hides the action's native semantics; keep its button/link role or a valid interactive role, then verify keyboard activation in the rendered artifact`,
    })
  for (const child of node.childNodes ?? []) checkRolesAndIds(child, ids, findings)
  if (node.content) checkRolesAndIds(node.content, ids, findings)
}

export function checkArtifactSource(html: string) {
  const meta = artifactMeta(html)
  const document = parse(html, { sourceCodeLocationInfo: true }) as SourceNode
  const findings: Finding[] = []
  const notes: string[] = []
  checkDocumentStructure(html, titleOf(document), meta.purpose, findings)
  checkNetworkUses(html, findings, notes)
  checkRolesAndIds(document, new Set<string>(), findings)
  return {
    valid: findings.length === 0,
    findings,
    ...(notes.length > 0 ? { notes } : {}),
    sections: meta.sections,
    verification: "source only",
    then: "Render at 1440 and 390 in light and dark with artifact shot, inspect the pictures, and exercise the main path and recovery. Source validation does not establish visual quality.",
  }
}
