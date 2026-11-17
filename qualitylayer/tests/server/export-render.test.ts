import { afterAll, expect, test } from "bun:test"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Ctx } from "../../src/ctx.ts"
import { exportFile } from "../../src/server/export-files.ts"
import { findChrome, renderArtifacts, stopRenderBrowsers } from "../../src/server/render.ts"

const chrome = findChrome((name) => process.env[name])
const ctx = { env: { get: (name: string) => process.env[name] } } as unknown as Ctx
const page = { title: "Export fixture", html: "<h1>A readable exported page</h1>", width: 480 }
const profiles = async () =>
  (await readdir(tmpdir())).filter((name) => name.startsWith("ql-artifact-chrome-"))
afterAll(async () => {
  await stopRenderBrowsers()
})

test.skipIf(chrome === null)(
  "actual PNG is complete, no-network, and leaves no render profile",
  async () => {
    let requests = 0
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requests++
        return new Response("unexpected")
      },
    })
    const before = await profiles()
    try {
      const result = await exportFile(ctx, {
        format: "png",
        title: "Fixture",
        name: "fixture",
        pages: [
          {
            ...page,
            html: `${page.html}<script>fetch(${JSON.stringify(server.url.href)}).catch(()=>{})</script>`,
          },
        ],
      })
      if (!result.ok) throw new Error(result.error.message)
      const picture = Buffer.from(result.data.base64, "base64")
      expect(picture.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
      expect(picture.readUInt32BE(16)).toBeGreaterThanOrEqual(480)
      expect(requests).toBe(0)
      expect(await profiles()).toEqual(before)
    } finally {
      await server.stop(true)
    }
  },
  30_000,
)

test.skipIf(chrome === null)(
  "actual document PDF paginates long selectable text beyond screenshot height",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "ql-export-pdf-")),
      before = await profiles()
    try {
      const html = Array.from(
        { length: 400 },
        (_, index) =>
          `<p>Export paragraph ${index}. ${"Readable human document text. ".repeat(20)}</p>`,
      ).join("")
      const result = await exportFile(ctx, {
        format: "pdf",
        title: "Long Plan",
        name: "long-plan",
        pages: [{ ...page, kind: "document", html }],
      })
      if (!result.ok) throw new Error(result.error.message)
      const file = join(root, "plan.pdf"),
        data = Buffer.from(result.data.base64, "base64")
      expect(data.subarray(0, 5).toString()).toBe("%PDF-")
      await writeFile(file, data)
      const extractor = Bun.which("pdftotext")
      if (extractor) {
        const child = Bun.spawn([extractor, file, "-"], { stdout: "pipe", stderr: "pipe" })
        const text = await new Response(child.stdout).text()
        expect(await child.exited).toBe(0)
        expect(text).toContain("Export paragraph 0.")
        expect(text).toContain("Export paragraph 399.")
      }
      expect(await profiles()).toEqual(before)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  40_000,
)

test.skipIf(chrome === null)(
  "actual two-page artifact PDF has exactly two readable labelled pages",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "ql-export-artifact-pdf-")),
      before = await profiles()
    try {
      const result = await exportFile(ctx, {
        format: "pdf",
        title: "Two pages",
        name: "two",
        pages: [page, { ...page, title: "Second", html: "<h1>Second artboard</h1>" }],
      })
      if (!result.ok) throw new Error(result.error.message)
      const file = join(root, "two.pdf")
      await writeFile(file, Buffer.from(result.data.base64, "base64"))
      const info = Bun.which("pdfinfo")
      if (info) {
        const child = Bun.spawn([info, file], { stdout: "pipe", stderr: "pipe" })
        const output = await new Response(child.stdout).text()
        expect(await child.exited).toBe(0)
        expect(output).toMatch(/Pages:\s+2\b/)
      }
      expect(await profiles()).toEqual(before)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  40_000,
)

test.skipIf(chrome === null)(
  "oversized images and render budget failures reap the browser/profile and release the export slot",
  async () => {
    if (!chrome) throw new Error("Chrome missing")
    const before = await profiles()
    const huge = await exportFile(ctx, {
      format: "png",
      title: "Tall",
      name: "tall",
      pages: [{ ...page, html: '<div style="height:20000px">Too tall for one complete PNG</div>' }],
    })
    expect(huge.ok).toBe(false)
    await expect(
      renderArtifacts(chrome, [{ html: page.html, spec: { width: 480, theme: "light" } }], {
        maxBytes: 1,
        maxPixels: 1,
        timeoutMs: 10000,
      }),
    ).rejects.toThrow("size limit")
    expect(await profiles()).toEqual(before)
    expect(
      (
        await exportFile(ctx, {
          format: "html",
          title: "After",
          name: "after",
          pages: [{ ...page, kind: "document" }],
        })
      ).ok,
    ).toBe(true)
  },
  40_000,
)
