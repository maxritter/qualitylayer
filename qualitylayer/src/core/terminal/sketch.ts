import { parse } from "parse5"
import {
  attr,
  CONTROLS,
  type HtmlElement,
  type HtmlNode,
  hidden,
  isRegion,
  leafDisplay,
  TEXT_TAGS,
  text,
  words,
} from "./sketch-dom.ts"

type SketchState = {
  lines: string[]
  index: number
  width: number
}

function nextId(state: SketchState, prefix: string): string {
  state.index += 1
  return `${prefix}-${state.index}`
}

function visitNestedControls(state: SketchState, parent: HtmlElement, prefix: string): void {
  for (const child of parent.childNodes) {
    if (!("tagName" in child) || hidden(child)) continue
    if (CONTROLS.has(child.tagName)) visitNode(state, child, prefix)
    else visitNestedControls(state, child, prefix)
  }
}

function visitRegion(state: SketchState, node: HtmlElement, prefix: string, id: string): void {
  const title = `${attr(node, "aria-label") || attr(node, "data-title") || node.tagName} [${id}]`
  const rule = "─".repeat(
    Math.max(1, Math.min(state.width - Bun.stringWidth(prefix) - 4, 72) - Bun.stringWidth(title)),
  )
  state.lines.push(`${prefix}┌─ ${title} ${rule}┐`)
  for (const child of node.childNodes) visitNode(state, child, `${prefix}│ `, id)
  const bottom = "─".repeat(Math.max(1, Math.min(state.width - Bun.stringWidth(prefix) - 2, 76)))
  state.lines.push(`${prefix}└${bottom}┘`)
}

function visitElement(state: SketchState, node: HtmlElement, prefix: string): void {
  if (hidden(node)) return
  const id = attr(node, "id") || attr(node, "data-id") || nextId(state, node.tagName)
  if (isRegion(node)) {
    visitRegion(state, node, prefix, id)
    return
  }
  const label = words(attr(node, "aria-label") || text(node, !CONTROLS.has(node.tagName)))
  const leaf = leafDisplay(node, label)
  if (leaf !== null) {
    state.lines.push(`${prefix}${leaf} [${id}]`)
    return
  }
  if (TEXT_TAGS.has(node.tagName) && label) {
    state.lines.push(`${prefix}${label} [${id}]`)
    visitNestedControls(state, node, prefix)
    return
  }
  for (const child of node.childNodes) visitNode(state, child, prefix, id)
}

function visitNode(state: SketchState, node: HtmlNode, prefix: string, textId?: string): void {
  if ("tagName" in node) {
    visitElement(state, node, prefix)
    return
  }
  if ("childNodes" in node) {
    for (const child of node.childNodes) visitNode(state, child, prefix)
  } else if ("value" in node && words(node.value)) {
    state.lines.push(`${prefix}${words(node.value)} [${textId ?? nextId(state, "text")}]`)
  }
}

/** Read the inert HTML tree in source order; generated ids stay tied to that order. */
export function sketch(html: string, width = 100): string {
  const state: SketchState = { lines: [], index: 0, width }
  visitNode(state, parse(html), "")
  return state.lines.join("\n") || "No visible elements."
}
