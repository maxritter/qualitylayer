import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { chromium, type Page, expect as webExpect } from "@playwright/test"
import { findChrome, pairedUrl } from "../helpers/chrome.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import { PNG } from "../helpers/feedbackBackend.ts"
import { seedPlanWithArtifact, walkTaskTo } from "../helpers/taskWalk.ts"
import { tmpRepo } from "../helpers/tmpRepo.ts"

const chrome = findChrome()
const board = `<!doctype html><html><head><meta charset="utf-8"><title>Checkout</title><style>body{font:16px/1.5 system-ui;margin:0;padding:32px;background:white;color:#171717}button,[role=button]{display:block;margin:16px 0;padding:14px;border:1px solid #777;cursor:pointer}#drag{width:80px;height:45px;background:#ddd;touch-action:none}html[data-theme=dark] body{background:#171717;color:#eee}</style></head><body><section id="checkout" data-screen-label="Checkout"><h1>Checkout</h1><p id="words">Returning customers can edit their saved delivery address.</p><button id="normal">Native control 0</button><div id="custom" role="button" tabindex="0">Custom control 0</div><div id="drag" tabindex="0">Drag 0</div><p id="blank" style="padding:50px 0">Checkout details</p></section><script>let n=0,c=0,d=0;document.querySelector('#normal').addEventListener('click',e=>e.target.textContent='Native control '+(++n));document.querySelector('#custom').addEventListener('click',e=>e.target.textContent='Custom control '+(++c));document.querySelector('#drag').addEventListener('pointerdown',e=>{e.target.setPointerCapture(e.pointerId);e.target.onpointermove=()=>e.target.textContent='Drag '+(++d);e.target.onpointerup=()=>e.target.onpointermove=null});</script></body></html>`

async function entered(page: Page, expected = '[data-testid="artifact-page"]') {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await page.locator('[data-testid="tour"] button.skip').isVisible())
      await page.locator('[data-testid="tour"] button.skip').click()
    if (await page.locator('[data-testid="blocked"] .foot button').isVisible())
      await page.locator('[data-testid="blocked"] .foot button').click()
    if (await page.locator(expected).isVisible()) return
    await page.waitForTimeout(100)
  }
  throw new Error("The actual App artifact viewer did not open")
}

function exportDownload(page: Page) {
  const file = page.waitForEvent("download", { timeout: 12_000 })
  const failed = page
    .locator(".q-export-error")
    .waitFor({ state: "visible", timeout: 12_000 })
    .then(async () => {
      throw new Error(await page.locator(".q-export-error").innerText())
    })
  return Promise.race([file, failed])
}

test.skipIf(!chrome)(
  "actual App separates interaction from feedback and downloads artifact exports",
  async () => {
    const repo = await tmpRepo()
    repo.env.QUALITYLAYER_CHROME = chrome as string
    const made = await repo.run(["task", "start", "Export and feedback browser proof"])
    expect(made.code).toBe(0)
    const dir = await seedPlanWithArtifact(repo, String(made.json.task))
    const folder = join(dir, "artifacts", "export-fixture")
    await mkdir(folder, { recursive: true })
    await Bun.write(join(folder, "index.html"), board)
    await Bun.write(join(folder, "confirmation.html"), board.replaceAll("Checkout", "Confirmation"))
    const cockpit = await startCockpit(repo)
    const tasks = (await cockpit.json("/api/tasks")).tasks as { id: string }[]
    const id = tasks[0]?.id
    expect(id).toBeTruthy()
    const browser = await chromium.launch({ executablePath: chrome as string, headless: true })
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 },
    })
    const page = await context.newPage()
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript(() => {
      const state = window as Window & { inputProof?: unknown[] }
      const events: unknown[] = []
      state.inputProof = events
      const keep = (value: unknown) => {
        if (events.length < 100) events.push(value)
      }
      for (const name of ["pointerdown", "pointermove", "pointerup"])
        addEventListener(
          name,
          (event) => {
            const e = event as PointerEvent
            keep({
              type: name,
              x: e.clientX,
              y: e.clientY,
              primary: e.isPrimary,
              trusted: e.isTrusted,
            })
          },
          true,
        )
      addEventListener("message", (event) => {
        const data = event.data
        if (data?.type === "ql:artifact" && data.kind !== "layout")
          keep({
            type: "message",
            kind: data.kind,
            armed: data.armed,
            mark: data.mark,
            x: data.x,
            y: data.y,
          })
      })
    })
    const proof = process.env.QUALITYLAYER_EXPORT_PROOF_DIR
    if (proof) await mkdir(proof, { recursive: true })
    try {
      await page.goto(
        await pairedUrl(
          `${cockpit.base}/?token=${cockpit.token}&in=app#/task/${encodeURIComponent(id as string)}/${encodeURIComponent("artifacts/export-fixture/index.html")}`,
        ),
      )
      await entered(page)
      const frame = page.frameLocator(
        '[data-testid="artifact-page"] iframe[data-testid="artifact-page-frame"]',
      )
      await frame.locator("#normal").click()
      await webExpect(frame.locator("#normal")).toHaveText("Native control 1")
      await frame.locator("#custom").click()
      await webExpect(frame.locator("#custom")).toHaveText("Custom control 1")
      expect(await page.locator('[data-testid="quick-ask"]').count()).toBe(0)
      await page.getByRole("button", { name: "Feedback", exact: true }).click()
      await frame.locator("#custom").click()
      await webExpect(frame.locator("#custom")).toHaveText("Custom control 1")
      await webExpect(page.locator('[data-testid="quick-ask"]')).toBeVisible()
      await page.keyboard.press("Escape")
      await webExpect(page.locator('[data-testid="quick-ask"]')).toBeHidden()
      await frame.locator("#custom").click()
      await webExpect(frame.locator("#custom")).toHaveText("Custom control 2")
      await page.getByRole("button", { name: "Feedback", exact: true }).click()
      await frame.locator("#normal").press("Escape")
      await webExpect(page.getByRole("button", { name: "Feedback", exact: true })).toBeFocused()
      await webExpect(page.getByRole("button", { name: "Feedback", exact: true })).toHaveAttribute(
        "aria-pressed",
        "false",
      )
      const drag = await frame.locator("#drag").boundingBox()
      if (!drag) throw new Error("The actual draggable control has no box")
      await page.mouse.move(drag.x + 10, drag.y + 10)
      await page.mouse.down()
      await page.mouse.move(drag.x + 55, drag.y + 25, { steps: 5 })
      await page.mouse.up()
      await webExpect(frame.locator("#drag")).not.toHaveText("Drag 0")
      const dragged = await frame.locator("#drag").textContent()
      await page.getByRole("button", { name: "Feedback", exact: true }).click()
      await webExpect(frame.locator("html")).toHaveCSS("cursor", "crosshair")
      await page.mouse.move(drag.x + 10, drag.y + 10)
      await page.mouse.down()
      await page.mouse.move(drag.x + 60, drag.y + 30, { steps: 5 })
      await page.mouse.up()
      await webExpect(page.locator('[data-testid="quick-ask"]')).toBeVisible()
      await webExpect(frame.locator("#drag")).toHaveText(dragged as string)
      await page.keyboard.press("Escape")
      await page.getByRole("button", { name: "Feedback", exact: true }).click()
      await webExpect(frame.locator("html")).toHaveCSS("cursor", "crosshair")
      await frame.locator("#normal").press("Enter")
      await webExpect(frame.locator("#normal")).toHaveText("Native control 1")
      await webExpect(page.locator('[data-testid="quick-ask"]')).toBeVisible()
      await page.keyboard.press("Escape")
      await frame.locator("#normal").press("Enter")
      await webExpect(frame.locator("#normal")).toHaveText("Native control 2")
      expect(await page.locator('[data-testid="quick-ask"]').count()).toBe(0)
      await frame.locator("#words").click({ clickCount: 3 })
      await webExpect(page.locator('[data-testid="artifact-feedback-chip"]')).toBeVisible()
      expect(await page.locator('[data-testid="quick-ask"]').count()).toBe(0)
      await page.locator('[data-testid="artifact-feedback-chip"]').click()
      await webExpect(page.locator('[data-testid="quick-ask"]')).toBeVisible()
      await page.keyboard.press("Escape")
      await frame.locator("#blank").click()
      await webExpect(page.locator('[data-testid="artifact-feedback-chip"]')).toBeHidden()
      expect(await page.locator('[data-testid="quick-ask"]').count()).toBe(0)

      for (const format of ["PDF Document", "Images PNG per page", "Web page Opens offline"]) {
        await page.getByRole("button", { name: "Export", exact: true }).click()
        await page.getByRole("radio", { name: format, exact: true }).check()
        if (await page.getByRole("radio", { name: "This page", exact: true }).count())
          await page.getByRole("radio", { name: "This page", exact: true }).check()
        const waiting = exportDownload(page)
        await page.locator(".q-export-go").click()
        const download = await waiting
        expect(await download.failure()).toBeNull()
        const path = await download.path()
        const data = new Uint8Array(await Bun.file(path as string).arrayBuffer())
        if (format.startsWith("PDF"))
          expect(new TextDecoder().decode(data.slice(0, 5))).toBe("%PDF-")
        if (format.startsWith("Images"))
          expect(Buffer.from(data.slice(0, 8)).toString("hex")).toBe("89504e470d0a1a0a")
        if (format.startsWith("Web")) {
          const html = new TextDecoder().decode(data)
          expect(html).toContain("data:image/png;base64,")
          expect(html).not.toMatch(/<script[\s>]/i)
        }
        if (proof) await download.saveAs(join(proof, download.suggestedFilename()))
        await webExpect(page.getByText("Download started", { exact: true })).toBeVisible()
        await page.getByRole("button", { name: "Close export" }).click()
      }
      for (const width of [1440, 1024, 480]) {
        await page.setViewportSize({ width, height: 950 })
        await page.getByRole("button", { name: "Export", exact: true }).click()
        await webExpect(page.locator(".q-export")).toBeVisible()
        await webExpect(page.locator(".q-export")).toHaveAttribute("data-open", "")
        await webExpect(page.locator(".q-export")).toHaveCSS("opacity", "1")
        const box = await page.locator(".q-export").boundingBox()
        expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true)
        if (proof) await page.screenshot({ path: join(proof, `artifact-export-${width}.png`) })
        await page.keyboard.press("Escape")
      }
      expect(errors).toEqual([])
    } catch (cause) {
      if (proof) {
        await page.screenshot({ path: join(proof, "artifact-failure.png") })
        const traces = await Promise.all(
          page
            .frames()
            .filter((frame) => frame.url() === "about:srcdoc")
            .map((frame) =>
              frame
                .evaluate(() => (window as Window & { inputProof?: unknown[] }).inputProof)
                .catch(() => null),
            ),
        )
        await Bun.write(
          join(proof, "artifact-failure.json"),
          JSON.stringify({ errors, traces }, null, 2),
        )
      }
      throw cause
    } finally {
      await browser.close()
      await cockpit.kill()
      repo.cleanup()
    }
  },
  120_000,
)

test.skipIf(!chrome)(
  "actual Plan and Review export readable files without changing the task decision",
  async () => {
    const repo = await tmpRepo()
    repo.env.QUALITYLAYER_CHROME = chrome as string
    const task = await walkTaskTo(repo, "Document export proof", "final")
    const taskFolder = join(repo.repo, "docs", "plans", task.slug)
    await Bun.write(join(taskFolder, "artifacts", "one.html"), board)
    await Bun.write(
      join(taskFolder, "artifacts", "two.html"),
      board.replaceAll("Checkout", "Confirmation"),
    )
    const planPath = join(taskFolder, "01-plan.md")
    await Bun.write(
      planPath,
      `${await Bun.file(planPath).text()}\n\n## Interface\n\n\`\`\`artifact\nartifacts/one.html\n\`\`\`\n\n\`\`\`artifact\nartifacts/two.html\n\`\`\`\n`,
    )
    const reviewPath = join(taskFolder, "03-verify.md")
    await Bun.write(join(taskFolder, "evidence", "export-proof.png"), PNG)
    await Bun.write(
      reviewPath,
      `${await Bun.file(reviewPath).text()}\n\n![Proof](evidence/export-proof.png)\n`,
    )
    const cockpit = await startCockpit(repo)
    const summaries = (await cockpit.json("/api/tasks")).tasks as { id: string }[]
    const id = summaries[0]?.id as string
    const browser = await chromium.launch({ executablePath: chrome as string, headless: true })
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 },
    })
    const page = await context.newPage()
    const proof = process.env.QUALITYLAYER_EXPORT_PROOF_DIR
    if (proof) await mkdir(proof, { recursive: true })
    try {
      const before = await cockpit.json(`/api/tasks/${encodeURIComponent(id)}`)
      for (const file of ["01-plan.md", "03-verify.md"]) {
        const view = file === "03-verify.md" ? "verify" : file
        await page.goto(
          await pairedUrl(
            `${cockpit.base}/?token=${cockpit.token}&in=app#/task/${encodeURIComponent(id)}/${encodeURIComponent(view)}`,
          ),
        )
        await entered(page, ".sp-page")
        for (const format of ["PDF Document", "Markdown With pictures", "Web page Opens offline"]) {
          await page.getByRole("button", { name: "Export", exact: true }).click()
          await page.getByRole("radio", { name: format, exact: true }).check()
          const waiting = exportDownload(page)
          await page.locator(".q-export-go").click()
          const download = await waiting
          expect(await download.failure()).toBeNull()
          const data = new Uint8Array(
            await Bun.file((await download.path()) as string).arrayBuffer(),
          )
          if (format.startsWith("PDF"))
            expect(new TextDecoder().decode(data.slice(0, 5))).toBe("%PDF-")
          if (format.startsWith("Markdown"))
            expect(Buffer.from(data.slice(0, 4)).toString("hex")).toBe("504b0304")
          if (format.startsWith("Web")) {
            const html = new TextDecoder().decode(data)
            expect(html).toContain("Snapshot ")
            expect(html).not.toMatch(/<script[\s>]/i)
          }
          if (proof) await download.saveAs(join(proof, download.suggestedFilename()))
          await page.getByRole("button", { name: "Close export" }).click()
        }
        if (proof) await page.screenshot({ path: join(proof, `${file}-exports.png`) })
      }
      const after = await cockpit.json(`/api/tasks/${encodeURIComponent(id)}`)
      expect((after.task as { gate: unknown }).gate).toEqual(
        (before.task as { gate: unknown }).gate,
      )
      expect(task.slug).toBeTruthy()
    } catch (cause) {
      if (proof) {
        await page.screenshot({ path: join(proof, "document-failure.png") })
        await Bun.write(join(proof, "document-failure.txt"), String(cause))
      }
      throw cause
    } finally {
      await browser.close()
      await cockpit.kill()
      repo.cleanup()
    }
  },
  150_000,
)
