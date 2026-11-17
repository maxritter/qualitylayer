import { beforeEach, expect, mock, test } from "bun:test"
import { deflateSync } from "node:zlib"
import { crc32, zip } from "../../src/core/export/zip.ts"
import type { Ctx } from "../../src/ctx.ts"

function chunk(kind: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length)
  out.write(kind, 4)
  out.set(data, 8)
  out.writeUInt32BE(crc32(out.subarray(4, out.length - 4)), out.length - 4)
  return out
}
const header = Buffer.alloc(13)
header.writeUInt32BE(1)
header.writeUInt32BE(1, 4)
header[8] = 8
header[9] = 6
const PNG = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(Buffer.from([0, 255, 255, 255, 255]))),
  chunk("IEND", new Uint8Array()),
])
let failure = false
let pause: Promise<void> | undefined
const calls: { html: string; spec: { format?: string; section?: string } }[][] = []
mock.module("../../src/server/render.ts", () => ({
  findChrome: () => "/fixture/chrome",
  NO_CHROME: "Chrome unavailable",
  renderArtifacts: async (_chrome: string, jobs: { html: string; spec: { format?: string } }[]) => {
    calls.push(jobs)
    await pause
    if (failure) throw new Error("Fixture render failed")
    return jobs.map((job) =>
      job.spec.format === "pdf" ? Buffer.from("%PDF-1.7\nfixture\n%%EOF") : PNG,
    )
  },
}))
const { exportFile } = await import("../../src/server/export-files.ts")
const ctx = { env: { get: () => undefined } } as unknown as Ctx
const page = { title: "One", html: "<h1>Hello</h1>", width: 800 }
beforeEach(() => {
  failure = false
  pause = undefined
  calls.length = 0
})

function entries(base64: string): Map<string, Buffer> {
  const data = Buffer.from(base64, "base64"),
    found = new Map<string, Buffer>()
  let at = 0
  while (data.readUInt32LE(at) === 0x04034b50) {
    expect(data.readUInt16LE(at + 8)).toBe(0)
    const length = data.readUInt32LE(at + 18),
      nameLength = data.readUInt16LE(at + 26),
      extra = data.readUInt16LE(at + 28)
    const name = data.subarray(at + 30, at + 30 + nameLength).toString()
    const start = at + 30 + nameLength + extra,
      body = data.subarray(start, start + length)
    expect(crc32(body)).toBe(data.readUInt32LE(at + 14))
    found.set(name, body)
    at = start + length
  }
  expect(data.readUInt32LE(at)).toBe(0x02014b50)
  expect(data.readUInt32LE(data.length - 22)).toBe(0x06054b50)
  expect(data.readUInt16LE(data.length - 12)).toBe(found.size)
  return found
}

test("ZIP storage uses standard CRC32 and refuses traversal, duplicate names and excess bytes", () => {
  expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926)
  for (const name of ["../file", "/file", "a/../../file", "a\\file"])
    expect(() => zip([{ name, bytes: PNG }], 1000)).toThrow()
  expect(() =>
    zip(
      [
        { name: "A.png", bytes: PNG },
        { name: "a.png", bytes: PNG },
      ],
      1000,
    ),
  ).toThrow()
  expect(() => zip([{ name: "a.png", bytes: PNG }], 8)).toThrow()
})

test("one PNG is a real image response; multiple pages are an ordered ZIP", async () => {
  const one = await exportFile(ctx, {
    format: "png",
    title: "Example",
    name: "../example.html",
    pages: [page],
  })
  expect(one.ok).toBe(true)
  if (!one.ok) return
  expect(one.data.name).toBe("example.png")
  expect(Buffer.from(one.data.base64, "base64")).toEqual(PNG)
  const many = await exportFile(ctx, {
    format: "png",
    title: "Example",
    name: "example",
    pages: [page, { ...page, title: "Two" }],
  })
  if (!many.ok) throw new Error(many.error.message)
  expect(many.data.type).toBe("application/zip")
  expect([...entries(many.data.base64).keys()]).toEqual(["page-01.png", "page-02.png"])
})

test("artifact HTML contains labelled static pictures and no authored active HTML", async () => {
  const result = await exportFile(ctx, {
    format: "html",
    title: "<script>title</script>",
    name: "example",
    pages: [{ ...page, html: '<script>steal()</script><a href="https://example.com">Link</a>' }],
  })
  if (!result.ok) throw new Error(result.error.message)
  const html = Buffer.from(result.data.base64, "base64").toString()
  expect(html).toContain("Static page image")
  expect(html).toContain("data:image/png;base64,")
  expect(html).not.toMatch(/<script\b|href=/i)
  expect(html).not.toContain("steal()")
})

test("document HTML keeps readable text and web links while scripts and external loading are removed", async () => {
  const result = await exportFile(ctx, {
    format: "html",
    title: "Plan",
    name: "plan",
    pages: [
      {
        ...page,
        kind: "document",
        html: '<style>@import "https://example.com/x";p{background:url(https://example.com/image)}</style><h1 onclick="steal()">Readable plan</h1><a href="https://example.com">Evidence</a><script>steal()</script><iframe src="file:///etc/passwd"></iframe><img src="https://example.com/image">',
      },
    ],
  })
  if (!result.ok) throw new Error(result.error.message)
  const html = Buffer.from(result.data.base64, "base64").toString()
  expect(html).toContain("Readable plan")
  expect(html).toContain("script-src 'none'")
  expect(html).not.toMatch(/<script\b|onclick|<iframe|src="https:/i)
  expect(html).toContain('href="https://example.com"')
  expect(html).not.toContain("@import")
  expect(calls.length).toBe(0)
})

test("document tables keep short identifiers whole while long paths can wrap", async () => {
  const path = `qualitylayer/src/${"unbrokencomponent".repeat(12)}/export.ts`
  const result = await exportFile(ctx, {
    format: "html",
    title: "Table",
    name: "table",
    pages: [
      {
        ...page,
        kind: "document",
        html: `<table><tr><th>Step</th><th>File</th></tr><tr><td>A12</td><td><code>${path}</code></td></tr></table>`,
      },
    ],
  })
  if (!result.ok) throw new Error(result.error.message)
  const html = Buffer.from(result.data.base64, "base64").toString()
  expect(html).toContain('<td data-export-short-cell="">A12</td>')
  expect(html).toContain(`<td><code>${path}</code></td>`)
  expect(html).toContain("overflow-wrap:anywhere")
  expect(html).toContain("[data-export-short-cell]{white-space:nowrap}")
})

test("document PDF prints the sanitized document directly rather than rasterizing its text", async () => {
  const result = await exportFile(ctx, {
    format: "pdf",
    title: "Plan",
    name: "plan",
    pages: [{ ...page, kind: "document", html: "<h1>Selectable text</h1>" }],
  })
  if (!result.ok) throw new Error(result.error.message)
  expect(result.data.type).toBe("application/pdf")
  expect(Buffer.from(result.data.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-")
  expect(calls).toHaveLength(1)
  expect(calls[0]?.[0]?.html).toContain("Selectable text")
  expect(calls[0]?.[0]?.spec.format).toBe("pdf")
})

test("Markdown ZIP preserves text, PNG assets and the supplied revision without rendering or inventing approval", async () => {
  const markdown = "# Plan\n\n![Diagram](assets/diagram.png)\n",
    revision = "a".repeat(64)
  const result = await exportFile(ctx, {
    format: "markdown",
    title: "Plan",
    name: "plan",
    pages: [],
    markdown,
    revision,
    assets: [{ name: "diagram.png", type: "image/png", base64: PNG.toString("base64") }],
  })
  if (!result.ok) throw new Error(result.error.message)
  const files = entries(result.data.base64),
    manifest = JSON.parse(files.get("manifest.json")?.toString() ?? "{}")
  expect(files.get("plan.md")?.toString()).toBe(markdown)
  expect(files.get("assets/diagram.png")).toEqual(PNG)
  expect(manifest.revision).toBe(revision)
  expect(manifest.approval).toBeUndefined()
  expect(calls).toHaveLength(0)
})

test("download and ZIP entry names retain safe filename and length boundaries", async () => {
  for (const [name, stem] of [
    ["..--Report.PDF", "Report"],
    [`a${".".repeat(178)}b`, `a${".".repeat(99)}`],
    [`a${"-".repeat(179)}`, "a"],
    [".-".repeat(90), "export"],
    ["..RÉSUMÉ / plan..--", "R-SUM-plan"],
    [`${"a".repeat(99)}.b`, `${"a".repeat(99)}.`],
  ]) {
    const result = await exportFile(ctx, {
      format: "markdown",
      title: "Title",
      name,
      pages: [],
      markdown: "# Body",
    })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.data.name).toBe(`${stem}.zip`)
    expect([...entries(result.data.base64).keys()]).toEqual([`${stem}.md`, "manifest.json"])
  }
  expect(calls).toHaveLength(0)
})

test("underscores remain valid download names while ZIP entries retain their alphanumeric prefix guard", async () => {
  const html = await exportFile(ctx, {
    format: "html",
    title: "Title",
    name: "__",
    pages: [{ ...page, kind: "document" }],
  })
  if (!html.ok) throw new Error(html.error.message)
  expect(html.data.name).toBe("__.html")
  const archive = await exportFile(ctx, {
    format: "markdown",
    title: "Title",
    name: "__",
    pages: [],
    markdown: "# Body",
  })
  expect(archive).toEqual({
    ok: false,
    error: { code: "bad_args", message: "Invalid export archive filename" },
  })
  expect(calls).toHaveLength(0)
})

test("limits and render failures refuse the download and never return a success file", async () => {
  for (const input of [
    { format: "markdown", title: "x", name: "a".repeat(181), pages: [], markdown: "x" },
    { format: "png", title: "x", name: "x", pages: Array(17).fill(page) },
    { format: "png", title: "x", name: "x", pages: [{ ...page, width: 50000 }] },
    {
      format: "html",
      title: "x",
      name: "x",
      pages: [{ ...page, html: "x".repeat(21 * 1024 * 1024) }],
    },
    {
      format: "markdown",
      title: "x",
      name: "x",
      pages: [],
      markdown: "x",
      assets: [
        { name: "bad.png", type: "image/png", base64: Buffer.from("not PNG").toString("base64") },
      ],
    },
  ])
    expect((await exportFile(ctx, input)).ok).toBe(false)
  failure = true
  const failed = await exportFile(ctx, { format: "png", title: "x", name: "x", pages: [page] })
  expect(failed.ok).toBe(false)
})

test("a second export receives a retry response and completion releases the export slot", async () => {
  let release = () => {}
  pause = new Promise<void>((resolve) => {
    release = resolve
  })
  const first = exportFile(ctx, { format: "png", title: "One", name: "one", pages: [page] })
  const busy = await exportFile(ctx, { format: "png", title: "Two", name: "two", pages: [page] })
  expect(busy.ok).toBe(false)
  if (!busy.ok) expect(busy.error.message).toContain("Try again")
  release()
  expect((await first).ok).toBe(true)
  expect(
    (await exportFile(ctx, { format: "png", title: "Two", name: "two", pages: [page] })).ok,
  ).toBe(true)
})

test("a focused image passes only its validated section to the renderer", async () => {
  const result = await exportFile(ctx, {
    format: "png",
    title: "Focus",
    name: "focus",
    pages: [{ ...page, section: "checkout" }],
  })
  expect(result.ok).toBe(true)
  expect(calls[0]?.[0]?.spec.section).toBe("checkout")
  expect(
    (
      await exportFile(ctx, {
        format: "png",
        title: "Focus",
        name: "focus",
        pages: [{ ...page, section: "../outside" }],
      })
    ).ok,
  ).toBe(false)
})

test("readable documents keep one title and portable web links without scripts or local credentials", async () => {
  const result = await exportFile(ctx, {
    format: "html",
    title: "Review",
    name: "review",
    pages: [
      {
        title: "Review",
        width: 800,
        kind: "document",
        html: '<h1>Review</h1><a href="https://github.com/example/repo/pull/1">Pull request</a><a href="javascript:alert(1)">Bad</a><a href="http://127.0.0.1:41888/pair/private">Local</a><script>alert(1)</script>',
      },
    ],
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  const html = Buffer.from(result.data.base64, "base64").toString()
  expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
  expect(html).toContain('href="https://github.com/example/repo/pull/1"')
  expect(html).not.toContain("javascript:")
  expect(html).not.toContain("/pair/private")
  expect(html).not.toMatch(/<script[\s>]/i)
})
