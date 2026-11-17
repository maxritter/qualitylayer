import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test"
import type { ExportFile, ExportFormat, ExportInput } from "../../src/core/export/types.ts"
import type { ExportScope } from "../../src/ui/export/ExportCard.tsx"
import { mountDom, type Rtl, unmountDom } from "../helpers/dom.ts"
import { PNG } from "../helpers/feedbackBackend.ts"

const rtl: Rtl = await mountDom()
const { ExportCard, downloadExport } = await import("../../src/ui/export/ExportCard.tsx")
const { workflowExport } = await import("../../src/ui/export/workflow-export.ts")
const file: ExportFile = {
  name: "checkout.pdf",
  type: "application/pdf",
  base64: btoa("%PDF-test"),
}
const prepare = mock(
  async (_format: ExportFormat, _scope: ExportScope): Promise<ExportInput> => ({
    format: "pdf",
    title: "Checkout",
    name: "checkout",
    pages: [{ title: "Checkout", html: "<h1>Checkout</h1>", width: 800 }],
  }),
)
const url = spyOn(URL, "createObjectURL").mockReturnValue("blob:test-export")
const revoke = spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
afterEach(() => {
  delete (window as Window & { __QUALITYLAYER_NATIVE_DOWNLOADS__?: boolean })
    .__QUALITYLAYER_NATIVE_DOWNLOADS__
  rtl.cleanup()
  prepare.mockClear()
  click.mockClear()
  url.mockClear()
})
afterAll(() => {
  url.mockRestore()
  revoke.mockRestore()
  click.mockRestore()
  unmountDom(rtl)
})

test("native export waits for its own confirmed result", async () => {
  Object.defineProperty(window, "__QUALITYLAYER_NATIVE_DOWNLOADS__", {
    value: true,
    configurable: true,
  })
  let finished = false
  const saving = downloadExport(file).then((status) => {
    finished = true
    return status
  })
  window.dispatchEvent(
    new CustomEvent("qualitylayer-download-result", {
      detail: { url: "blob:another-export", status: "saved" },
    }),
  )
  await Promise.resolve()
  expect(finished).toBe(false)
  window.dispatchEvent(
    new CustomEvent("qualitylayer-download-result", {
      detail: { url: "blob:test-export", status: "saved" },
    }),
  )
  expect(await saving).toBe("saved")
  expect(revoke).toHaveBeenCalledWith("blob:test-export")
})

test("native cancellation leaves the card ready without a success result", async () => {
  Object.defineProperty(window, "__QUALITYLAYER_NATIVE_DOWNLOADS__", {
    value: true,
    configurable: true,
  })
  const view = rtl.render(
    <ExportCard title="Plan" kind="plan" write={async () => file} prepare={prepare} />,
  )
  rtl.fireEvent.click(view.getByRole("button", { name: "Export" }))
  rtl.fireEvent.click(await view.findByRole("button", { name: "Export PDF" }))
  await rtl.waitFor(() => expect(click).toHaveBeenCalledTimes(1))
  window.dispatchEvent(
    new CustomEvent("qualitylayer-download-result", {
      detail: { url: "blob:test-export", status: "cancelled" },
    }),
  )
  expect(await view.findByText("Save cancelled")).toBeTruthy()
  expect(view.queryByText("Saved")).toBeNull()
  expect(view.getByRole("button", { name: "Export PDF" }).getAttribute("aria-busy")).toBe("false")
  expect(click).toHaveBeenCalledTimes(1)
})

test("artifact opens only three formats and retains the selected page scope", async () => {
  const write = mock(async () => file)
  const view = rtl.render(
    <ExportCard title="Checkout" kind="artifact" pages={3} write={write} prepare={prepare} />,
  )
  rtl.fireEvent.click(view.getByRole("button", { name: "Export" }))
  const images = await view.findByRole("radio", { name: "Images PNG per page" })
  expect(view.getAllByRole("radio")).toHaveLength(5)
  rtl.fireEvent.click(images)
  rtl.fireEvent.click(view.getByRole("radio", { name: "This page" }))
  rtl.fireEvent.click(view.getByRole("button", { name: "Export images" }))
  await view.findByText("Download started")
  expect(prepare.mock.calls[0]?.slice(0, 2)).toEqual(["png", "current"])
  expect(click).toHaveBeenCalledTimes(1)
  expect(view.queryByText("Saved to Downloads")).toBeNull()
})

test("a failed export preserves choices and can be retried", async () => {
  let attempt = 0
  const write = mock(async () => {
    if (!attempt++) throw new Error("Could not prepare the PDF. Try again.")
    return file
  })
  const view = rtl.render(
    <ExportCard title="Checkout" kind="review" write={write} prepare={prepare} />,
  )
  rtl.fireEvent.click(view.getByRole("button", { name: "Export" }))
  rtl.fireEvent.click(await view.findByRole("button", { name: "Export PDF" }))
  expect((await view.findByRole("alert")).textContent).toContain("Try again")
  expect(click).not.toHaveBeenCalled()
  rtl.fireEvent.click(view.getByRole("button", { name: "Export PDF" }))
  await view.findByText("Download started")
  expect(write).toHaveBeenCalledTimes(2)
})

test("closing the card aborts a pending export and suppresses a late download", async () => {
  let resolve: (result: ExportFile) => void = () => {}
  const write = mock(
    () =>
      new Promise<ExportFile>((done) => {
        resolve = done
      }),
  )
  const view = rtl.render(
    <ExportCard title="Checkout" kind="plan" write={write} prepare={prepare} />,
  )
  rtl.fireEvent.click(view.getByRole("button", { name: "Export" }))
  rtl.fireEvent.click(await view.findByRole("button", { name: "Export PDF" }))
  await rtl.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
  rtl.fireEvent.click(view.getByRole("button", { name: "Close export" }))
  await rtl.act(async () => {
    resolve(file)
    await new Promise((done) => setTimeout(done, 10))
  })
  expect(click).not.toHaveBeenCalled()
})

test("Plan and Review keep Markdown distinct from artifact images", async () => {
  const view = rtl.render(
    <ExportCard title="Plan" kind="plan" write={async () => file} prepare={prepare} />,
  )
  rtl.fireEvent.click(view.getByRole("button", { name: "Export" }))
  expect(await view.findByRole("radio", { name: "Markdown With pictures" })).toBeTruthy()
  expect(view.queryByRole("radio", { name: /Images/ })).toBeNull()
  expect(view.queryByRole("group", { name: "Pages" })).toBeNull()
})

test("workflow output is a readable document with source identity and original evidence wording", async () => {
  const write = mock(async () => file)
  const result = await workflowExport({
    body: "# Review\n\nSaved delivery passed · scripted run.\n\nAn independent agent checked editing delivery.\n",
    title: "Checkout Review",
    format: "html",
    state: "Recorded review decision: pending",
    write,
    loadArtifact: async () => {
      throw new Error("Not used")
    },
  })
  expect(result.pages[0]?.kind).toBe("document")
  expect(result.pages[0]?.html).toContain("scripted run")
  expect(result.pages[0]?.html).toContain("Recorded review decision: pending")
  expect(result.revision).toMatch(/^[a-f0-9]{64}$/)
  expect(result.markdown).not.toContain("For agents")
  expect(write).not.toHaveBeenCalled()
})

test("workflow export refuses a missing selected image instead of claiming it was included", async () => {
  await expect(
    workflowExport({
      body: "# Review\n\n![Checkout](evidence/missing.png)\n",
      title: "Review",
      format: "markdown",
      write: async () => file,
      loadArtifact: async () => "",
      loadEvidence: async () => {
        throw new Error("Picture missing")
      },
    }),
  ).rejects.toThrow("Picture missing")
})

test("multiple embedded designs capture sequentially through the single-export service", async () => {
  let active = 0
  let peak = 0
  const write = mock(async () => {
    active++
    peak = Math.max(peak, active)
    if (active > 1) throw new Error("Another export is running")
    await new Promise((resolve) => setTimeout(resolve, 5))
    active--
    return { name: "design.png", type: "image/png", base64: Buffer.from(PNG).toString("base64") }
  })
  const result = await workflowExport({
    body: "# Plan\n\n```artifact\none.html\n```\n\n```artifact\ntwo.html\n```\n",
    title: "Two designs",
    format: "markdown",
    write,
    loadArtifact: async (name) => `<h1>${name}</h1>`,
  })
  expect(write).toHaveBeenCalledTimes(2)
  expect(peak).toBe(1)
  expect(result.assets).toHaveLength(2)
  expect(result.markdown).toContain("assets/image-2.png")
  expect(result.markdown).not.toContain("## Images")
  expect(result.markdown?.indexOf("assets/image-1.png")).toBeLessThan(
    result.markdown?.indexOf("assets/image-2.png") ?? -1,
  )
})

test("cancelled preparation never starts a capture after a delayed artifact read", async () => {
  const controller = new AbortController()
  let finish: (html: string) => void = () => {}
  const read = new Promise<string>((resolve) => {
    finish = resolve
  })
  const write = mock(async () => file)
  const pending = workflowExport({
    body: "# Plan\n\n```artifact\none.html\n```\n",
    title: "Design",
    format: "pdf",
    write,
    loadArtifact: async () => read,
    signal: controller.signal,
  })
  await new Promise((resolve) => setTimeout(resolve, 5))
  controller.abort()
  finish("<h1>Design</h1>")
  await expect(pending).rejects.toThrow("Export cancelled")
  expect(write).not.toHaveBeenCalled()
})

test("focused references keep separate captures of one source and the authored width", async () => {
  const loadArtifact = mock(
    async () =>
      '<meta name="viewport" content="width=1024"><section id="first">First</section><section id="second">Second</section>',
  )
  const write = mock(async (_input: ExportInput) => ({
    name: "design.png",
    type: "image/png",
    base64: Buffer.from(PNG).toString("base64"),
  }))
  const result = await workflowExport({
    body: "# Plan\n\n```artifact\nartifacts/layout.html#first\n```\n\n```artifact\nartifacts/layout.html#second\n```\n",
    title: "Focused designs",
    format: "html",
    write,
    loadArtifact,
  })
  expect(loadArtifact).toHaveBeenCalledTimes(1)
  expect(write.mock.calls.map(([input]) => input.pages[0]?.section)).toEqual(["first", "second"])
  expect(write.mock.calls.map(([input]) => input.pages[0]?.width)).toEqual([1024, 1024])
  expect(result.assets).toHaveLength(2)
})
