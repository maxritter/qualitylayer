// Pins on a diagram: a comment is anchored to a node or an arrow of the drawing, named by what the
// diagram itself calls it, so a redrawn diagram finds its pins again. The anchor is a short string:
//
//   node:<id>            a box of a flowchart, by the id the source gives it
//   edge:<from>><to>     an arrow of a flowchart
//   actor:<name>         a participant of a sequence diagram
//   message:<text>       an arrow of a sequence diagram, by its words
//
// Mermaid draws these as `g.node#flowchart-<id>-<n>`, `path.LS-<from>.LE-<to>`, `text.actor` and
// `text.messageText`; this file is the only place that knows it.

export type Pinned = { target: string; label: string }

export function elementPin(name: string, id: string): string | null {
  return /^(?:[a-z0-9][a-z0-9-]{0,39}|(?:wireframe|panel):\d+)$/.test(name) &&
    /^(?:[a-z][a-z0-9-]*|(?:[a-z][a-z0-9-]*|\d+)\/[a-z][a-z0-9-]*)$/.test(id)
    ? `el:${name}#${id}`
    : null
}

const words = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim()

const FLOW_NODE = /^(?:flowchart|graph|state|class)-(.+)-\d+$/

function nodeName(element: Element): string {
  const prefix = element.closest("svg")?.id
  const id =
    prefix && element.id.startsWith(`${prefix}-`) ? element.id.slice(prefix.length + 1) : element.id
  return id.match(FLOW_NODE)?.[1] ?? id
}

/** The elements a click may pin: what `pinnable` marks, found again by `find`. */
const PINNABLE = "g.node, g.cluster, path.flowchart-link, text.actor, rect.actor, text.messageText"

function describeEdge(hit: Element): Pinned | null {
  const classes = [...hit.classList]
  const origin = classes.find((c) => c.startsWith("LS-"))?.slice(3)
  const end = classes.find((c) => c.startsWith("LE-"))?.slice(3)
  return origin !== undefined && end !== undefined
    ? { target: `edge:${origin}>${end}`, label: `${origin} to ${end}` }
    : null
}

/** What a click landed on, as an anchor and the words to quote beside the comment; null for empty space. */
export function describe(from: Element, root: Element): Pinned | null {
  const hit = from.closest(PINNABLE)
  if (hit === null || !root.contains(hit)) return null
  if (hit.matches("g.node, g.cluster")) {
    const id = nodeName(hit)
    return id === "" ? null : { target: `node:${id}`, label: words(hit) || id }
  }
  if (hit.matches("path.flowchart-link")) return describeEdge(hit)
  if (hit.matches("text.actor, rect.actor")) {
    const name = hit.matches("rect.actor") ? words(hit.parentElement ?? hit) : words(hit)
    return name === "" ? null : { target: `actor:${name}`, label: name }
  }
  const message = words(hit)
  return message === "" ? null : { target: `message:${message}`, label: message }
}

/** The element a pin's anchor names in a drawing, or null when the diagram no longer has it. */
export function find(root: Element, target: string): Element | null {
  const [kind, ...rest] = target.split(":")
  const name = rest.join(":")
  const all = (selector: string) => [...root.querySelectorAll(selector)]
  if (kind === "node") {
    return all("g.node, g.cluster").find((el) => nodeName(el) === name) ?? null
  }
  if (kind === "edge") {
    const [origin, end] = name.split(">")
    return (
      all("path.flowchart-link").find(
        (el) => el.classList.contains(`LS-${origin}`) && el.classList.contains(`LE-${end}`),
      ) ?? null
    )
  }
  if (kind === "actor") {
    return all("text.actor").find((el) => words(el) === name) ?? null
  }
  if (kind === "message") {
    return all("text.messageText").find((el) => words(el) === name) ?? null
  }
  return null
}

/** Mark everything a click can pin, so the page can show it with a pointer. */
export function markPinnable(root: Element): void {
  for (const el of root.querySelectorAll(PINNABLE)) el.setAttribute("data-pinnable", "")
}
