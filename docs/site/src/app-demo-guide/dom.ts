// DOM, ARIA role/name matching, and synthetic pointer/input helpers for the guided web demo.

export type Text = string | RegExp

const normal = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim()

/** Playwright's text match: a regex tests, `exact` compares whole, otherwise a case-blind substring. */
export function matches(value: string, wanted: Text, exact = false): boolean {
  const text = normal(value)
  if (wanted instanceof RegExp) return wanted.test(text)
  return exact ? text === normal(wanted) : text.toLowerCase().includes(normal(wanted).toLowerCase())
}

export function visible(element: Element): boolean {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false
  if (element.getClientRects().length === 0) return false
  const style = getComputedStyle(element)
  return style.visibility !== "hidden" && style.visibility !== "collapse"
}

const INPUT_ROLES: Record<string, string> = {
  checkbox: "checkbox",
  radio: "radio",
  button: "button",
  submit: "button",
  reset: "button",
  range: "slider",
  search: "searchbox",
}

const STATIC_TAG_ROLES: Record<string, string> = {
  button: "button",
  textarea: "textbox",
  dialog: "dialog",
  option: "option",
  summary: "button",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
}

export function roleOf(element: Element): string | null {
  const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0]
  if (explicit) return explicit
  const tag = element.tagName.toLowerCase()
  if (tag === "a") return element.hasAttribute("href") ? "link" : null
  if (tag === "input") return INPUT_ROLES[(element as HTMLInputElement).type] ?? "textbox"
  if (tag === "select") return (element as HTMLSelectElement).multiple ? "listbox" : "combobox"
  return STATIC_TAG_ROLES[tag] ?? null
}

/** The accessible name, by aria-labelledby, aria-label, a label, then the element's own text. */
export function nameOf(element: Element): string {
  const by = element.getAttribute("aria-labelledby")
  if (by) {
    return normal(
      by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" "),
    )
  }
  const label = element.getAttribute("aria-label")
  if (label) return normal(label)
  const labels = (element as HTMLInputElement).labels
  if (labels && labels.length > 0) return normal([...labels].map((l) => l.textContent).join(" "))
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return normal(element.getAttribute("title") ?? element.placeholder)
  }
  return normal((element as HTMLElement).innerText ?? element.textContent) || normal(element.getAttribute("title"))
}

export const unique = (elements: Element[]) => [...new Set(elements)]
export const below = (roots: Element[], selector = "*") =>
  unique(roots.flatMap((root) => [...root.querySelectorAll(selector)]))

export function xpath(roots: Element[], expression: string): Element[] {
  const found: Element[] = []
  for (const root of roots) {
    const result = document.evaluate(expression, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
    for (let i = 0; i < result.snapshotLength; i++) {
      const node = result.snapshotItem(i)
      if (node instanceof Element) found.push(node)
    }
  }
  return unique(found)
}

/** The center of an element in the viewport, after scrolling it into view. */
export function centerOf(element: Element) {
  element.scrollIntoView({ block: "nearest", behavior: "instant" as ScrollBehavior })
  const r = element.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

/**
 * Where a mouse at the element's center lands: the topmost element there when it belongs to the element
 * (as Playwright and a person hit it), else the element itself.
 */
export function pointer(element: Element) {
  const { x, y } = centerOf(element)
  const hit = document.elementFromPoint(x, y)
  const target = hit !== null && element.contains(hit) ? hit : element
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window }
  const pointerInit = { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true }
  target.dispatchEvent(new PointerEvent("pointerover", pointerInit))
  target.dispatchEvent(new MouseEvent("mouseover", init))
  target.dispatchEvent(new PointerEvent("pointermove", pointerInit))
  target.dispatchEvent(new MouseEvent("mousemove", init))
  return { target, init, pointerInit }
}

/** A mouse click as a person makes it: Radix and Base UI open their menus on pointerdown. */
export function press(element: Element) {
  const { target, init, pointerInit } = pointer(element)
  target.dispatchEvent(new PointerEvent("pointerdown", { ...pointerInit, buttons: 1 }))
  target.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }))
  const focusable = target.closest("button, a, input, select, textarea, [tabindex]") ?? element
  if (focusable instanceof HTMLElement && focusable.isConnected) focusable.focus({ preventScroll: true })
  target.dispatchEvent(new PointerEvent("pointerup", pointerInit))
  target.dispatchEvent(new MouseEvent("mouseup", init))
  target.dispatchEvent(new MouseEvent("click", { ...init, detail: 1 }))
}

/** A value set the way React notices it: through the element's own setter, then an input event. */
export function setValue(element: Element, value: string) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error(`Not a text field: <${element.tagName.toLowerCase()}>`)
  }
  const prototype =
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}
