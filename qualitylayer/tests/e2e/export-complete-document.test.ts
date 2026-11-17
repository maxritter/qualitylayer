import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { type Browser, chromium, type Page } from "@playwright/test"
import { findChrome, pairedUrl } from "../helpers/chrome.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import { walkTaskTo } from "../helpers/taskWalk.ts"
import { tmpRepo } from "../helpers/tmpRepo.ts"

const chrome = findChrome()
const LONG_PATH = `qualitylayer/src/${"unbrokencomponent".repeat(12)}/export-proof.ts`
const artifact = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=1024"><title>Synthetic sections</title><style>body{margin:0;font:24px system-ui}section{box-sizing:border-box;padding:32px;width:100%;height:220px}#first{background:#fef3c7}#second{background:#dbeafe}@media(min-width:1000px){h1:after{content:' · authored wide layout'}}</style></head><body><section id="first" data-screen-label="First"></section><section id="second" data-screen-label="Second"></section><script>document.querySelector('#first').innerHTML='<h1>FIRST SCRIPT SECTION</h1><p>Captured after script population.</p>';document.querySelector('#second').innerHTML='<h1>SECOND SCRIPT SECTION</h1><p>A distinct focused reference.</p>';</script></body></html>`

function documentFixture(step: string) {
  const wide = Array.from(
    { length: 18 },
    (_, index) => `W${index}["Wide stage ${index}: review the recorded result"]`,
  ).join(" --> ")
  const tall = Array.from(
    { length: 16 },
    (_, index) => `T${index}["Tall stage ${index}: next recorded step"]`,
  ).join(" --> ")
  return `\n\n## Complete export fixture\n\n${step}-FIRST-SENTINEL\n\n${Array.from({ length: 12 }, (_, index) => `Paragraph ${index}: ${"A complete human-facing document retains its supporting details. ".repeat(8)}`).join("\n\n")}\n\n| Step | Acceptance | Evidence |\n| --- | --- | --- |\n| A12 | ${"The recorded acceptance description stays readable beside its short identifier. ".repeat(5)} | Scripted run |\n| B34 | The last identifier remains whole. | Real agent session |\n\n${step}-MIDDLE-SENTINEL\n\n### Wide diagram\n\n\`\`\`mermaid\nflowchart LR\n${wide}\n\`\`\`\n\n### Tall diagram\n\n\`\`\`mermaid\nflowchart TB\n${tall}\n\`\`\`\n\n### Sequence\n\n\`\`\`mermaid\nsequenceDiagram\nPerson->>App: Export complete document\nApp-->>Person: Readable saved file\n\`\`\`\n\n### Focused artifact sections\n\nBefore first section.\n\n\`\`\`artifact\nartifacts/export-sections.html#first\n\`\`\`\n\nBetween sections.\n\n\`\`\`artifact\nartifacts/export-sections.html#second\n\`\`\`\n\nAfter second section.\n\n### Evidence pictures\n\n${["png", "jpeg", "webp", "gif"].map((type) => `Before ${type}.\n\n![${type.toUpperCase()} evidence caption](evidence/export-picture.${type})\n\nAfter ${type}.`).join("\n\n")}\n\n> [!ADDED] Verify · Export fixture\n> Added content is retained with its reason.\n\n\`\`\`text\nCode stays selectable.\n\`\`\`\n\n${step}-LAST-SENTINEL\n`
}

async function entered(page: Page) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const tour = page.locator('[data-testid="tour"] button.skip')
    if (await tour.isVisible()) await tour.click()
    const welcome = page.locator('[data-testid="blocked"] .foot button')
    if (await welcome.isVisible()) await welcome.click()
    if (await page.locator(".sp-page").isVisible()) return
    await page.waitForTimeout(100)
  }
  throw new Error("Actual step page did not open")
}

function zipEntries(buffer: Buffer) {
  const entries = new Map<string, Buffer>()
  let at = 0
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const size = buffer.readUInt32LE(at + 18)
    const nameLength = buffer.readUInt16LE(at + 26)
    const extra = buffer.readUInt16LE(at + 28)
    const name = buffer.subarray(at + 30, at + 30 + nameLength).toString()
    const start = at + 30 + nameLength + extra
    entries.set(name, buffer.subarray(start, start + size))
    at = start + size
  }
  return entries
}

async function offlineProof(browser: Browser, proof: string, step: string) {
  const offline = await browser.newContext({ offline: true })
  try {
    const shown = await offline.newPage()
    await shown.goto(pathToFileURL(join(proof, `${step}.html`)).href)
    const state = await shown.evaluate(async () => {
      const images = [...document.images]
      await Promise.all(images.map((image) => image.decode()))
      return {
        text: document.body.innerText,
        images: images.map((image) => ({
          width: image.naturalWidth,
          height: image.naturalHeight,
          type: image.src.slice(0, 22),
        })),
        details: document.querySelectorAll(".export-detail").length,
        tableWidths: [...document.querySelectorAll("table")].map(
          (table) => table.getBoundingClientRect().width,
        ),
        table: [...document.querySelectorAll("td:first-child")].map((cell) => ({
          text: cell.textContent,
          width: cell.getBoundingClientRect().width,
          height: cell.getBoundingClientRect().height,
        })),
      }
    })
    for (const sentinel of ["FIRST", "MIDDLE", "LAST"])
      expect(state.text).toContain(`${step}-${sentinel}-SENTINEL`)
    expect(state.images.length).toBeGreaterThanOrEqual(9)
    expect(
      state.images.every(
        (image) => image.width > 0 && image.type.startsWith("data:image/png;base64,"),
      ),
    ).toBe(true)
    expect(state.details).toBeGreaterThan(4)
    expect(Math.max(...state.tableWidths)).toBeLessThanOrEqual(681)
    await shown.screenshot({ path: join(proof, `${step}-offline.png`) })
    return state
  } finally {
    await offline.close()
  }
}

test.skipIf(!chrome)(
  "complete Plan and Verify export and rich paste retain readable visual content",
  async () => {
    const repo = await tmpRepo()
    const proof = process.env.QUALITYLAYER_EXPORT_PROOF_DIR ?? join(repo.home, "export-proof")
    await mkdir(proof, { recursive: true })
    repo.env.QUALITYLAYER_CHROME = chrome as string
    const browser = await chromium.launch({ executablePath: chrome as string, headless: true })
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 },
      permissions: ["clipboard-read", "clipboard-write"],
    })
    let page = await context.newPage()
    const sources = await page.evaluate(() => {
      const canvas = document.createElement("canvas")
      canvas.width = 320
      canvas.height = 120
      const drawing = canvas.getContext("2d") as CanvasRenderingContext2D
      drawing.fillStyle = "#dbeafe"
      drawing.fillRect(0, 0, 320, 120)
      drawing.fillStyle = "#171717"
      drawing.font = "24px sans-serif"
      drawing.fillText("SYNTHETIC EVIDENCE", 14, 65)
      return Object.fromEntries(
        ["png", "jpeg", "webp"].map((type) => [
          type,
          canvas.toDataURL(`image/${type}`).split(",")[1],
        ]),
      )
    })
    sources.gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
    let cockpit: Awaited<ReturnType<typeof startCockpit>> | undefined
    const editor = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(
          '<!doctype html><html lang="en"><title>Owned paste editor</title><body><label for="paste">Pasted export</label><div id="paste" role="textbox" aria-label="Pasted export" contenteditable="true" style="padding:24px;min-height:600px;max-width:1000px"></div></body></html>',
          { headers: { "content-type": "text/html" } },
        ),
    })
    const results: unknown[] = []
    try {
      const task = await walkTaskTo(repo, "Synthetic complete export qualification", "final")
      const folder = join(repo.repo, "docs", "plans", task.slug)
      await Bun.write(join(folder, "artifacts", "export-sections.html"), artifact)
      for (const [type, data] of Object.entries(sources))
        await Bun.write(
          join(folder, "evidence", `export-picture.${type}`),
          Buffer.from(data as string, "base64"),
        )
      for (const [file, step] of [
        ["01-plan.md", "PLAN"],
        ["03-verify.md", "VERIFY"],
      ]) {
        const path = join(folder, file as string)
        const content = documentFixture(step as string).replace(
          `${step}-LAST-SENTINEL`,
          `### Long unbroken path\n\n| Step | File |\n| --- | --- |\n| C56 | \`${LONG_PATH}\` |\n\n${step}-LAST-SENTINEL`,
        )
        await Bun.write(path, `${await Bun.file(path).text()}${content}`)
      }
      cockpit = await startCockpit(repo)
      const tasks = (await cockpit.json("/api/tasks")).tasks as { id: string }[]
      const id = tasks[0]?.id as string
      const before = await cockpit.json(`/api/tasks/${encodeURIComponent(id)}`)
      for (const [route, step] of [
        ["01-plan.md", "PLAN"],
        ["verify", "VERIFY"],
      ]) {
        await page.goto(
          await pairedUrl(
            `${cockpit.base}/?token=${cockpit.token}&in=app#/task/${encodeURIComponent(id)}/${route}`,
          ),
        )
        await entered(page)
        await page.screenshot({ path: join(proof, `${step}-source.png`) })
        for (const [choice, extension] of [
          ["PDF Document", "pdf"],
          ["Markdown With pictures", "zip"],
          ["Web page Opens offline", "html"],
        ]) {
          await page.getByRole("button", { name: "Export", exact: true }).click()
          await page.getByRole("radio", { name: choice, exact: true }).check()
          const waiting = page.waitForEvent("download", { timeout: 60_000 })
          await page.locator(".q-export-go").click()
          const download = await waiting
          expect(await download.failure()).toBeNull()
          const target = join(proof, `${step}.${extension}`)
          await download.saveAs(target)
          if (extension === "pdf") {
            const child = Bun.spawn(["pdftotext", "-layout", target, "-"], {
              stdout: "pipe",
              stderr: "pipe",
            })
            const text = await new Response(child.stdout).text()
            expect(await child.exited).toBe(0)
            await Bun.write(join(proof, `${step}-pdf.txt`), text)
            for (const sentinel of ["FIRST", "MIDDLE", "LAST"])
              expect(text).toContain(`${step}-${sentinel}-SENTINEL`)
            expect(text).toContain("A12")
            expect(text).toContain("B34")
            expect(text).toContain("C56")
            const raw = Bun.spawn(["pdftotext", "-raw", target, "-"], {
              stdout: "pipe",
              stderr: "pipe",
            })
            const rawText = await new Response(raw.stdout).text()
            expect(await raw.exited).toBe(0)
            expect(rawText.replace(/\s+/g, "")).toContain(LONG_PATH)
            expect(text).toContain("Figure 1 · overview")
            expect(text).toContain("detail 1 of")
          } else if (extension === "zip") {
            const entries = zipEntries(Buffer.from(await Bun.file(target).arrayBuffer()))
            const markdown =
              [...entries].find(([name]) => name.endsWith(".md"))?.[1].toString() ?? ""
            expect(markdown).not.toContain("## Images")
            expect(markdown.indexOf("Before first section.")).toBeLessThan(
              markdown.indexOf("![Mockup:"),
            )
            expect(markdown.indexOf("Between sections.")).toBeGreaterThan(
              markdown.indexOf("![Mockup:"),
            )
            for (const type of ["PNG", "JPEG", "WEBP", "GIF"])
              expect(markdown).toContain(`![${type} evidence caption](assets/`)
            expect(
              [...entries.keys()].filter((name) => name.endsWith(".png")).length,
            ).toBeGreaterThanOrEqual(9)
            await Bun.write(join(proof, `${step}.md`), markdown)
          }
          await page.getByRole("button", { name: "Close export" }).click()
        }
        await page.getByRole("button", { name: "Copy document" }).click()
        await page.getByText("Copy formatted", { exact: true }).click()
        await page.getByText(/Copied with 3 diagrams and 2 mockups/).waitFor()
        await page.close()
        await cockpit.kill()
        cockpit = undefined
        const pasted = await context.newPage()
        await pasted.goto(editor.url.href)
        await pasted.getByRole("textbox", { name: "Pasted export" }).click()
        await pasted.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V")
        await pasted.locator("#paste img").first().waitFor()
        const paste = await pasted.locator("#paste").evaluate(async (element) => {
          const images = [...element.querySelectorAll("img")]
          await Promise.all(images.map((image) => image.decode()))
          return {
            text: element.textContent,
            images: images.map((image) => ({
              width: image.naturalWidth,
              height: image.naturalHeight,
              src: image.src.slice(0, 22),
            })),
          }
        })
        expect(paste.images.length).toBeGreaterThanOrEqual(9)
        expect(
          paste.images.every(
            (image) => image.width > 0 && image.src.startsWith("data:image/png;base64,"),
          ),
        ).toBe(true)
        expect(paste.text).toContain(`${step}-LAST-SENTINEL`)
        await pasted.screenshot({ path: join(proof, `${step}-paste.png`) })
        results.push({ step, paste })
        await pasted.close()
        results.push({ step, offline: await offlineProof(browser, proof, step as string) })
        cockpit = await startCockpit(repo)
        page = await context.newPage()
      }
      const after = await cockpit.json(`/api/tasks/${encodeURIComponent(id)}`)
      expect((after.task as { gate: unknown }).gate).toEqual(
        (before.task as { gate: unknown }).gate,
      )
      await Bun.write(
        join(proof, "RESULT.json"),
        JSON.stringify({ chrome, version: browser.version(), results }, null, 2),
      )
    } catch (cause) {
      await page.screenshot({ path: join(proof, "failure.png") }).catch(() => {})
      throw cause
    } finally {
      await browser.close()
      await cockpit?.kill()
      await editor.stop(true)
      repo.cleanup()
    }
  },
  240_000,
)
