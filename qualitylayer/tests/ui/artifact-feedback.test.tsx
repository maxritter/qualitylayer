// Deliberate feedback on an artifact (App Model artifact-feedback.html): marks reach the quick field only
// after the Feedback button arms one, Escape leaves with focus back on the button, and selected words
// offer a chip. The bridge's own handling of real clicks, drags and keys runs in Chrome
// (tests/e2e/artifact-feedback.e2e.ts).

import { afterAll, afterEach, expect, test } from "bun:test"
import { mountDom, unmountDom } from "../helpers/dom.ts"

const rtl = await mountDom()
const { ArtifactPage } = await import("../../src/ui/artifact/ArtifactPage.tsx")
afterEach(() => rtl.cleanup())
afterAll(() => unmountDom(rtl))

function setup() {
  const marks: { mark: string; quote: string }[] = []
  const view = rtl.render(
    <ArtifactPage
      title="Pricing page"
      artifact={null}
      html="<html><body><p>Prices include VAT</p></body></html>"
      back={{ label: "Artifacts", onClick: () => {} }}
      onOpenBrowser={() => {}}
      fullScreen={false}
      onFullScreen={() => {}}
      onMark={(mark) => marks.push({ mark: mark.mark, quote: mark.quote })}
    />,
  )
  const frame = view.getByTestId("artifact-page-frame") as HTMLIFrameElement
  const told: Record<string, unknown>[] = []
  const win = frame.contentWindow as Window
  win.postMessage = ((data: Record<string, unknown>) => told.push(data)) as Window["postMessage"]
  const say = (data: Record<string, unknown>, source: MessageEventSource | null = win) =>
    rtl.act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { type: "ql:artifact", ...data }, source }),
      )
    })
  const button = () => view.getByTestId("artifact-feedback")
  return { view, marks, told, say, button }
}

const spot = { kind: "mark", mark: "spot", x: 40, y: 60, quote: "Choose Pro", boxes: [] }

test("a mark is heard only while Feedback is armed, and one mark ends it", async () => {
  const { view, marks, told, say, button } = setup()
  expect(button().getAttribute("aria-pressed")).toBe("false")
  await say(spot)
  expect(marks).toEqual([])

  rtl.fireEvent.click(button())
  expect(button().getAttribute("aria-pressed")).toBe("true")
  expect(view.getByTestId("artifact-feedback-hint").textContent).toContain(
    "Click a spot or drag an area",
  )
  await rtl.waitFor(() =>
    expect(told.at(-1)).toMatchObject({ kind: "mode", mark: true, armed: true }),
  )
  // Another window cannot mark, even while armed.
  await say(spot, window)
  expect(marks).toEqual([])
  await say(spot)
  expect(marks).toEqual([{ mark: "spot", quote: "Choose Pro" }])
  expect(button().getAttribute("aria-pressed")).toBe("false")
  expect(view.queryByTestId("artifact-feedback-hint")).toBeNull()
  await rtl.waitFor(() => expect(told.at(-1)).toMatchObject({ kind: "mode", armed: false }))
})

test("Escape from the page or the hint's Esc leaves Feedback and returns focus to the button", async () => {
  const { view, say, button } = setup()
  rtl.fireEvent.click(button())
  await say({ kind: "key", key: "Escape" })
  expect(button().getAttribute("aria-pressed")).toBe("false")
  expect(document.activeElement).toBe(button())

  rtl.fireEvent.click(button())
  rtl.fireEvent.click(view.getByRole("button", { name: "Cancel feedback" }))
  expect(button().getAttribute("aria-pressed")).toBe("false")
  expect(document.activeElement).toBe(button())

  rtl.fireEvent.click(button())
  rtl.fireEvent.keyDown(window, { key: "Escape" })
  expect(button().getAttribute("aria-pressed")).toBe("false")
})

test("selected words offer a chip; only choosing it marks them", async () => {
  const { view, marks, say } = setup()
  await say({
    kind: "selection",
    quote: "Prices include VAT",
    x: 4,
    y: 8,
    boxes: [{ x: 4, y: 8, width: 120, height: 18 }],
  })
  const chip = await rtl.waitFor(() => view.getByTestId("artifact-feedback-chip"))
  expect(marks).toEqual([])
  rtl.fireEvent.click(chip)
  expect(marks).toEqual([{ mark: "text", quote: "Prices include VAT" }])
  expect(view.queryByTestId("artifact-feedback-chip")).toBeNull()

  await say({
    kind: "selection",
    quote: "Prices include VAT",
    x: 4,
    y: 8,
    boxes: [{ x: 4, y: 8, width: 120, height: 18 }],
  })
  await rtl.waitFor(() => view.getByTestId("artifact-feedback-chip"))
  await say({ kind: "selection", quote: "" })
  expect(view.queryByTestId("artifact-feedback-chip")).toBeNull()
})

test("a read-only artifact has no Feedback button and hears no marks", async () => {
  const marks: unknown[] = []
  const view = rtl.render(
    <ArtifactPage
      title="Pricing page"
      artifact={null}
      html="<html><body>x</body></html>"
      back={{ label: "Artifacts", onClick: () => {} }}
      onOpenBrowser={() => {}}
      fullScreen={false}
      onFullScreen={() => {}}
      readOnly
      onMark={(mark) => marks.push(mark)}
    />,
  )
  expect(view.queryByTestId("artifact-feedback")).toBeNull()
  expect(view.getByTestId("export-trigger")).toBeTruthy()
})
