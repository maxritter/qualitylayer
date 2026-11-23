import { scrollSpotlight } from "../../scripts/demo/story.mjs"
import { type Locator, centerOf, page, replay, sleep } from "./locator.ts"

export type DemoOverlay = {
  cursor(x: number, y: number, ms: number): void
  ring(x: number, y: number): void
  spot(element: Element): void
  unspot(instant?: boolean): void
  begin(): void
  end(): void
  hide(): void
  show(): void
  reveal(): void
}

export const overlay = () => (window as unknown as { __demo?: DemoOverlay }).__demo

export interface DirectorHooks {
  fast: boolean
  onNavigate: (query: string) => Promise<void>
  showPage: () => void
  avoidElement: (element: Element) => void
}

async function pointAt(at: { x: number; y: number }, hooks: DirectorHooks) {
  if (hooks.fast) return
  hooks.showPage()
  overlay()?.cursor(at.x, at.y, 520)
  await sleep(560)
}

async function hoverTarget(locator: Locator, hooks: DirectorHooks) {
  if (replay.skipping) return { x: 0, y: 0 }
  const at = centerOf(await locator.element())
  await pointAt(at, hooks)
  await locator.hover()
  return at
}

async function clickTarget(locator: Locator, hooks: DirectorHooks) {
  if (replay.skipping) return
  const at = await hoverTarget(locator, hooks)
  if (!hooks.fast) overlay()?.ring(at.x, at.y)
  await locator.click()
  if (!hooks.fast) await sleep(450)
}

async function typeIntoTarget(locator: Locator, text: string, hooks: DirectorHooks) {
  if (replay.skipping) return
  await clickTarget(locator, hooks)
  if (hooks.fast) {
    await locator.fill(text)
  } else {
    if ((await locator.inputValue()) !== "") await locator.selectText()
    await locator.pressSequentially(text, { delay: 26 })
  }
  if ((await locator.inputValue()) !== text) await locator.fill(text)
  if (!hooks.fast) await sleep(300)
}

async function focusTarget(locator: Locator, taskPane: boolean, hooks: DirectorHooks) {
  if (replay.skipping) return
  const element = await locator.element()
  if (hooks.fast) return
  hooks.showPage()
  scrollSpotlight(element, { behavior: "smooth", taskPane })
  await sleep(350)
  overlay()?.spot(element)
  hooks.avoidElement(element)
  await sleep(150)
}

export function createDirector(hooks: DirectorHooks) {
  const pause = (ms: number) => (hooks.fast ? Promise.resolve() : sleep(ms))
  return {
    page,
    go: (query: string, _options?: { keep?: boolean }) => hooks.onNavigate(query),
    reveal: async () => { if (!hooks.fast) hooks.showPage() },
    hover: (locator: Locator) => hoverTarget(locator, hooks),
    click: (locator: Locator) => clickTarget(locator, hooks),
    /** A spot inside an artifact's frame: the guide cannot click into it, so it points and leaves it to the visitor. */
    clickSpot: (locator: Locator) => clickTarget(locator, hooks),
    type: (locator: Locator, text: string) => typeIntoTarget(locator, text, hooks),
    focus: (locator: Locator, { taskPane = false } = {}) => focusTarget(locator, taskPane, hooks),
    unspot: async () => overlay()?.unspot(),
    wait: pause,
  }
}

export type Director = ReturnType<typeof createDirector>
