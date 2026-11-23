// The demonstration's `?open=<step>,<step>…` address: after the App has drawn, each step is found
// (waiting a bounded time) and used in order, so a link can land on a popover, dialog, menu or tab the
// way a person would reach it. Demo only: nothing here is imported by the shipped App.

import {
  type OpenStep,
  type ParsedKey,
  parseKey,
  parseOpenSteps,
  parseStep,
} from "./open-steps-parse.ts"

export { type OpenStep, type ParsedKey, parseKey, parseOpenSteps, parseStep }

export const STEP_TIMEOUT_MS = 5000
const POLL_MS = 50
const SETTLE_MS = 400

const normalise = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase()

const TEXT_TARGETS =
  'button, a, [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="switch"], [role="checkbox"], label, summary'

function usable(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true
  if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true")
    return false
  return element.getClientRects().length > 0
}

function lookupAttach(field: string, scope: ParentNode): Element | undefined {
  const wanted = normalise(field)
  const pickers = [...scope.querySelectorAll('input[type="file"]')].map((input) => ({
    input,
    label: normalise(input.getAttribute("aria-label") ?? ""),
  }))
  return (
    pickers.find(({ label }) => label === wanted) ??
    pickers.find(({ label }) => label.includes(wanted))
  )?.input
}

function lookupFill(field: string, scope: ParentNode): Element | undefined {
  if (field.startsWith("@"))
    return [...scope.querySelectorAll(`[data-testid="${CSS.escape(field.slice(1))}"]`)].find(usable)
  const wanted = normalise(field)
  return [...scope.querySelectorAll("input, textarea")].find(
    (element) =>
      usable(element) &&
      normalise(
        `${element.getAttribute("placeholder") ?? ""} ${element.getAttribute("aria-label") ?? ""}`,
      ).includes(wanted),
  )
}

function lookupText(value: string, contains: boolean, scope: ParentNode): Element | undefined {
  const wanted = normalise(value)
  return [...scope.querySelectorAll(TEXT_TARGETS)].find((element) => {
    if (!usable(element)) return false
    const text =
      normalise(element.textContent ?? "") || normalise(element.getAttribute("aria-label") ?? "")
    return contains ? text.includes(wanted) : text === wanted
  })
}

const LOOKUP: Partial<
  Record<OpenStep["kind"], (step: never, scope: ParentNode) => Element | undefined>
> = {
  testid: (step: Extract<OpenStep, { kind: "testid" }>, scope) =>
    [...scope.querySelectorAll(`[data-testid="${CSS.escape(step.value)}"]`)].find(usable),
  label: (step: Extract<OpenStep, { kind: "label" }>, scope) =>
    [
      ...scope.querySelectorAll(
        `[aria-label${step.contains ? "*" : ""}="${CSS.escape(step.value)}"]`,
      ),
    ].find(usable),
  attach: (step: Extract<OpenStep, { kind: "attach" }>, scope) => lookupAttach(step.field, scope),
  fill: (step: Extract<OpenStep, { kind: "fill" }>, scope) => lookupFill(step.field, scope),
  text: (step: Extract<OpenStep, { kind: "text" }>, scope) =>
    lookupText(step.value, step.contains, scope),
}

function lookup(step: OpenStep, scope: ParentNode): Element | undefined {
  return LOOKUP[step.kind]?.(step as never, scope)
}

const LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/**
 * The first usable element a click step names, or `undefined` while it is not on the page. With a
 * dialog, menu or list open, the one on top is searched first: what lies behind it cannot be pressed.
 */
export function findTarget(step: OpenStep, root: ParentNode): Element | undefined {
  const top = [...root.querySelectorAll(LAYERS)].filter(usable).at(-1)
  return (top && lookup(step, top)) ?? lookup(step, root)
}

/** A click the way a pointer makes it: menus and popovers open on the press, not on the click. */
export function press(element: Element) {
  const view = element.ownerDocument.defaultView
  const rect = element.getBoundingClientRect()
  const point = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
  }
  const pointer = { ...point, pointerId: 1, pointerType: "mouse", isPrimary: true }
  if (element instanceof HTMLElement) element.focus({ preventScroll: true })
  element.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }))
  element.dispatchEvent(new MouseEvent("mousedown", { ...point, buttons: 1 }))
  element.dispatchEvent(new PointerEvent("pointerup", pointer))
  element.dispatchEvent(new MouseEvent("mouseup", point))
  element.dispatchEvent(new MouseEvent("click", point))
}

const FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  md: "text/markdown",
  json: "application/json",
}

/** Small made-up files, named as asked: the content says what they are. */
export function demoFiles(names: string[]): File[] {
  return names.map((name) => {
    const type = FILE_TYPES[name.split(".").at(-1)?.toLowerCase() ?? ""] ?? "text/plain"
    return new File([`Illustrative content of ${name}\n`], name, { type })
  })
}

/** Gives a file picker files the way choosing them would: its `files`, then a change event. */
export function attach(input: HTMLInputElement, names: string[]) {
  const list = new DataTransfer()
  for (const file of demoFiles(names)) list.items.add(file)
  input.files = list.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

/** Types into a field the way React hears it: the native setter, then an input event. */
export function fill(element: Element, value: string) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return
  element.focus({ preventScroll: true })
  const proto = element instanceof HTMLInputElement ? HTMLInputElement : HTMLTextAreaElement
  Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set?.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

function pressKey(target: Element, combo: ParsedKey) {
  const init = { ...combo, bubbles: true, cancelable: true, composed: true }
  target.dispatchEvent(new KeyboardEvent("keydown", init))
  target.dispatchEvent(new KeyboardEvent("keyup", init))
}

export type OpenResult = { done: number; failed?: OpenStep }

type Options = {
  root?: ParentNode
  timeoutMs?: number
  /** Resolves after `ms`; tests pass a quick one. */
  sleep?: (ms: number) => Promise<void>
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitForTarget(
  step: OpenStep,
  root: ParentNode,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<Element | undefined> {
  let target = findTarget(step, root)
  for (let waited = 0; target === undefined && waited < timeoutMs; waited += POLL_MS) {
    await sleep(POLL_MS)
    target = findTarget(step, root)
  }
  return target
}

async function runDomStep(
  step: OpenStep,
  root: ParentNode,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const target = await waitForTarget(step, root, timeoutMs, sleep)
  if (target === undefined) return false
  if (step.kind === "attach" && target instanceof HTMLInputElement) attach(target, step.names)
  else if (step.kind === "fill") fill(target, step.value)
  else press(target)
  await sleep(POLL_MS)
  return true
}

/** Does each step in order. The first one that cannot be found within the time ends the run. */
export async function runOpenSteps(
  steps: OpenStep[],
  { root = document, timeoutMs = STEP_TIMEOUT_MS, sleep = pause }: Options = {},
): Promise<OpenResult> {
  let done = 0
  if (steps.length > 0) await sleep(SETTLE_MS)
  for (const step of steps) {
    if (step.kind === "wait") await sleep(step.ms)
    else if (step.kind === "key") {
      const doc = root instanceof Document ? root : document
      pressKey(doc.activeElement ?? doc.body, step.combo)
    } else if (!(await runDomStep(step, root, timeoutMs, sleep))) {
      return { done, failed: step }
    }
    done += 1
  }
  return { done }
}

/**
 * The page's `?open=` steps, run once the App has had a moment to draw. While they run the page's
 * `<html data-demo-open>` says "running", then "done" or "failed", so a script knows when to look.
 */
export async function openFromAddress(search: string, options?: Options): Promise<OpenResult> {
  const steps = parseOpenSteps(search)
  if (steps.length === 0) return { done: 0 }
  const flag = (state: string) => {
    document.documentElement.dataset.demoOpen = state
  }
  flag("running")
  const result = await runOpenSteps(steps, options)
  if (result.failed !== undefined)
    console.warn(
      `[demo open] stopped after ${result.done} of ${steps.length} steps: nothing matched`,
      result.failed,
    )
  flag(result.failed === undefined ? "done" : "failed")
  return result
}
