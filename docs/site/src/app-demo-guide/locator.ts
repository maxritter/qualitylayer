// The part of Playwright's page and locator API that the demo's storyboard (scripts/demo/story.mjs) uses,
// on the live page in the visitor's browser: the same beats the presenter plays drive the guided web demo.
// Roles and names follow the ARIA rules closely enough for the App's own controls, not in general.

import { below, centerOf, matches, nameOf, pointer, press, roleOf, setValue, visible, xpath, type Text } from "./dom.ts"

export { centerOf }

type Step = (roots: Element[]) => Element[]

export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

/**
 * While the guide replays a beat up to the page change it already made (a reload lost the rest), the
 * locator's own actions do nothing: the page they acted on is gone.
 */
export const replay = { skipping: false }

export class Locator {
  /** `framed`: a locator inside an artifact's sandboxed frame, which the guide cannot reach into. */
  constructor(
    private readonly steps: Step[],
    readonly framed = false,
  ) {}

  private then_(step: Step) {
    return new Locator([...this.steps, step], this.framed)
  }

  all(root: Element = document.documentElement): Element[] {
    let set = [root]
    for (const step of this.steps) set = step(set)
    return set
  }

  locator(selector: string) {
    if (this.framed) return this
    return this.then_((roots) =>
      selector.startsWith("xpath=") ? xpath(roots, selector.slice(6)) : below(roots, selector),
    )
  }
  getByRole(role: string, options: { name?: Text; exact?: boolean } = {}) {
    if (this.framed) return this
    return this.then_((roots) =>
      below(roots).filter(
        (element) =>
          roleOf(element) === role &&
          visible(element) &&
          (options.name === undefined || matches(nameOf(element), options.name, options.exact)),
      ),
    )
  }
  getByText(text: Text, options: { exact?: boolean } = {}) {
    if (this.framed) return this
    return this.then_((roots) => {
      const hits = below(roots).filter(
        (element) =>
          !["SCRIPT", "STYLE"].includes(element.tagName) &&
          matches(element.textContent ?? "", text, options.exact),
      )
      // The innermost element that holds the text, as Playwright picks it.
      return hits.filter(
        (element) => visible(element) && ![...element.children].some((child) => hits.includes(child)),
      )
    })
  }
  getByTestId(id: string) {
    if (this.framed) return this
    return this.then_((roots) => below(roots, `[data-testid="${CSS.escape(id)}"]`))
  }
  getByPlaceholder(text: Text, options: { exact?: boolean } = {}) {
    if (this.framed) return this
    return this.then_((roots) =>
      below(roots, "[placeholder]").filter(
        (element) => visible(element) && matches(element.getAttribute("placeholder") ?? "", text, options.exact),
      ),
    )
  }
  /** Inside an artifact's frame: the frame itself stands for every element in it. */
  frameLocator(selector: string) {
    return new Locator([...this.locator(selector).first().steps], true)
  }
  filter(options: { hasText?: Text; has?: Locator }) {
    return this.then_((elements) =>
      elements.filter(
        (element) =>
          (options.hasText === undefined || matches(element.textContent ?? "", options.hasText)) &&
          (options.has === undefined || options.has.all(element).length > 0),
      ),
    )
  }
  /** Either locator's matches, in page order, as Playwright's `or`. */
  or(other: Locator) {
    const steps = this.steps
    return new Locator(
      [
        (roots) => {
          const mine = new Locator(steps).all(roots[0])
          const theirs = other.all(roots[0])
          const both = new Set([...mine, ...theirs])
          return [...both].sort((a, b) =>
            a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
          )
        },
      ],
      this.framed || other.framed,
    )
  }
  first() {
    return this.then_((elements) => elements.slice(0, 1))
  }
  last() {
    return this.then_((elements) => elements.slice(-1))
  }
  nth(index: number) {
    return this.then_((elements) => elements.slice(index, index + 1))
  }

  /** The first match, waiting for it as Playwright's actions do. */
  async element({ timeout = 8000, state = "visible" }: { timeout?: number; state?: string } = {}) {
    const until = Date.now() + timeout
    for (;;) {
      const found = this.all().find((element) => state !== "visible" || visible(element))
      if (found) return found
      if (Date.now() > until) throw new Error(`Timed out waiting for an element (${timeout} ms)`)
      await sleep(60)
    }
  }
  async waitFor(options: { timeout?: number; state?: string } = {}) {
    if (replay.skipping) return
    await this.element(options)
  }
  async count() {
    return this.all().length
  }
  async evaluate<T, A>(fn: (element: Element, arg: A) => T, arg?: A): Promise<T | undefined> {
    if (replay.skipping) return undefined
    return fn(await this.element({ state: "attached" }), arg as A)
  }
  async scrollIntoViewIfNeeded() {
    if (replay.skipping) return
    ;(await this.element()).scrollIntoView({ block: "nearest" })
  }
  async click(_options?: unknown) {
    if (replay.skipping || this.framed) return
    press(await this.element())
  }
  async hover() {
    if (replay.skipping) return
    pointer(await this.element())
  }
  async inputValue() {
    return ((await this.element()) as HTMLInputElement).value ?? ""
  }
  async selectText() {
    const element = (await this.element()) as HTMLInputElement
    element.select?.()
  }
  async fill(text: string) {
    if (replay.skipping) return
    setValue(await this.element(), text)
  }
  async pressSequentially(text: string, { delay = 0 }: { delay?: number } = {}) {
    if (replay.skipping) return
    const element = (await this.element()) as HTMLInputElement
    const start = element.selectionStart === 0 && element.selectionEnd === element.value.length ? "" : element.value
    for (let i = 1; i <= text.length; i++) {
      setValue(element, start + text.slice(0, i))
      if (delay) await sleep(delay)
    }
  }
}

/** The page object the beats get as `d.page`. */
export const page = {
  locator: (selector: string) => new Locator([]).locator(selector),
  getByRole: (role: string, options?: { name?: Text; exact?: boolean }) => new Locator([]).getByRole(role, options),
  getByText: (text: Text, options?: { exact?: boolean }) => new Locator([]).getByText(text, options),
  getByTestId: (id: string) => new Locator([]).getByTestId(id),
  getByPlaceholder: (text: Text, options?: { exact?: boolean }) => new Locator([]).getByPlaceholder(text, options),
  frameLocator: (selector: string) => new Locator([]).frameLocator(selector),
  waitForTimeout: (ms: number) => (replay.skipping ? Promise.resolve() : sleep(ms)),
  mouse: {
    /** A wheel turn at the middle of the screen: the box under it scrolls, as a person's wheel scrolls it. */
    async wheel(dx: number, dy: number) {
      if (replay.skipping) return
      const x = innerWidth / 2
      const y = innerHeight / 2
      const target = document.elementFromPoint(x, y)
      if (!target) return
      const event = new WheelEvent("wheel", { deltaX: dx, deltaY: dy, clientX: x, clientY: y, bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      if (event.defaultPrevented) return
      for (let box: Element | null = target; box; box = box.parentElement) {
        const style = getComputedStyle(box)
        if (/(auto|scroll)/.test(style.overflowY) && box.scrollHeight > box.clientHeight) {
          box.scrollBy({ left: dx, top: dy, behavior: "smooth" })
          return
        }
      }
      window.scrollBy({ left: dx, top: dy, behavior: "smooth" })
    },
  },
  keyboard: {
    async press(key: string) {
      if (replay.skipping) return
      const target = document.activeElement ?? document.body
      const init = { key, code: key, bubbles: true, cancelable: true, composed: true }
      target.dispatchEvent(new KeyboardEvent("keydown", init))
      target.dispatchEvent(new KeyboardEvent("keyup", init))
    },
  },
}
