import { expect, test } from "bun:test"
import { readableFigures } from "../../src/server/export-figures.ts"

const picture =
  '<p><img src="data:image/png;base64,AAAA" alt="Wide diagram" data-export-scale="2"></p>'

test("wide diagram retains its overview and readable overlapping source-order sheets", () => {
  const html = readableFigures(`<p>Before</p>${picture}<p>After</p>`, () => ({
    width: 4778,
    height: 520,
  }))
  expect(html.match(/class="export-detail"/g)).toHaveLength(4)
  expect(html).toContain("Figure 1 · overview")
  expect(html).toContain("background-size:2389px 260px")
  expect(html).toContain("background-position:-640px -0px")
  expect(html.indexOf("overview")).toBeLessThan(html.indexOf("detail 1 of 4"))
  expect(html.indexOf("detail 4 of 4")).toBeLessThan(html.indexOf("After"))
  expect(html).toContain('alt="Wide diagram"')
})

test("normal figures need no extra sheets and tall figures continue from top to bottom", () => {
  expect(readableFigures(picture, () => ({ width: 1200, height: 800 }))).not.toContain(
    "export-detail",
  )
  const tall = readableFigures(picture, () => ({ width: 800, height: 5000 }))
  expect(tall.match(/class="export-detail"/g)).toHaveLength(3)
  expect(tall).toContain("row 3/3, column 1/1")
  expect(tall).toContain("background-position:-0px -1620px")
})
