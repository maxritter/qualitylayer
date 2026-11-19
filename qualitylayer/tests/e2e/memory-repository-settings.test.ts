import { expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect as browserExpect, chromium } from "@playwright/test"
import type { MemoryRecord } from "../../src/memory-contracts.ts"
import { findChrome } from "../helpers/chrome.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import { type TmpRepo, tmpRepo } from "../helpers/tmpRepo.ts"

async function memory(fixture: TmpRepo, ...args: string[]) {
  const result = await fixture.run(["memory", ...args])
  if (result.code !== 0 || result.json.ok !== true)
    throw new Error(`Memory ${args[0]} failed: ${result.stdout} ${result.stderr}`)
  return result.json
}

async function store(fixture: TmpRepo, content: string, flags: string[] = []) {
  return (await memory(fixture, "store", "--title", "Parser cache", "--content", content, ...flags))
    .record as MemoryRecord
}

test("the compiled App opts in to export, restores only on request and reconciles a tracked conflict", async () => {
  const executablePath = findChrome()
  if (!executablePath) throw new Error("A managed Chrome is required for Repository Settings")
  const source = await tmpRepo()
  let local: TmpRepo | undefined
  let active: Awaited<ReturnType<typeof startCockpit>> | undefined
  let receiving: typeof active
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    const original = await store(source, "Use schema hashes in parser cache keys.")
    await memory(
      source,
      "store",
      "--title",
      "Private answer",
      "--content",
      "My private example",
      "--about",
      "you",
    )
    const path = `docs/memories/${original.origin}/${original.id}.json`
    active = await startCockpit(source)
    const page = await browser.newPage({
      viewport: { width: 1024, height: 850 },
      reducedMotion: "reduce",
    })
    const open = async (server: typeof active) => {
      if (!server) throw new Error("Missing Cockpit fixture")
      const pair = await server.json("/api/pair", {
        method: "POST",
        body: JSON.stringify({ remember: false }),
      })
      expect(typeof pair.code).toBe("string")
      await page.goto(`${server.base}/pair/${pair.code}?in=app#/settings/memory`)
      const skip = page.locator("[data-testid=tour] button.skip")
      if (await skip.isVisible()) await skip.click()
      await browserExpect(page.getByRole("heading", { name: "Project Git storage" })).toBeVisible()
    }
    const dialog = page.getByRole("dialog")
    const btn = (name: string) => page.getByRole("button", { name, exact: true })
    const capture = async (state: string) => {
      const evidence = process.env.QUALITYLAYER_MEMORY_SETTINGS_EVIDENCE
      if (!evidence) return
      for (const width of [1024, 390]) {
        await page.setViewportSize({ width, height: 850 })
        for (const colorScheme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme })
          await browserExpect
            .poll(() =>
              page.locator("html").evaluate((element) => element.classList.contains("dark")),
            )
            .toBe(colorScheme === "dark")
          const box = await dialog.boundingBox()
          expect(box).not.toBeNull()
          expect((box?.x ?? -1) >= 0 && (box?.x ?? width) + (box?.width ?? 0) <= width).toBe(true)
          await page.screenshot({
            path: join(evidence, `${state}-${width}-${colorScheme}.png`),
            animations: "disabled",
          })
        }
      }
      await page.setViewportSize({ width: 1024, height: 850 })
      await page.emulateMedia({ colorScheme: "light" })
    }
    await open(active)
    await btn("Manage projects").click()
    await browserExpect(
      dialog.getByText("1 lesson available to export", { exact: false }),
    ).toBeVisible()
    const exportNow = dialog.getByRole("button", { name: "Export now" })
    await browserExpect(exportNow).toBeDisabled()
    const project = dialog.getByRole("combobox", { name: "Repository project" })
    await browserExpect(project).toHaveText("repo")
    await project.click()
    await browserExpect(page.getByRole("option", { name: "repo" })).toBeVisible()
    await page.keyboard.press("Escape")
    await browserExpect(dialog).toBeVisible()
    await capture("export-disabled")
    expect(await Bun.file(join(source.repo, path)).exists()).toBe(false)
    const consent = dialog.getByRole("switch", { name: /^Store lessons in Git for / })
    await consent.click()
    await browserExpect(exportNow).toBeEnabled()
    await exportNow.click()
    await browserExpect(dialog.getByRole("status")).toContainText("Exported 1 lesson")
    await capture("exported")
    await page.keyboard.press("Escape")
    await browserExpect(dialog).toBeHidden()
    await browserExpect(btn("Manage projects")).toBeFocused()
    expect(await source.git(["diff", "--cached", "--name-only"])).toBe("")
    await source.git(["add", "--", "docs/memories"])
    await source.git(["commit", "-qm", "Portable fixture lessons"])
    local = await tmpRepo({ cloneOf: source.repo })
    await memory(local, "list")
    receiving = await startCockpit(local)
    await open(receiving)
    await btn("Restore from repository").click()
    await browserExpect(
      dialog.getByText("1 lesson available to read", { exact: false }),
    ).toBeVisible()
    expect((await memory(local, "list")).total).toBe(0)
    await capture("restore-before-click")
    await dialog.getByRole("button", { name: "Restore lessons" }).click()
    await browserExpect(dialog.getByRole("status")).toContainText("Restored 1 lesson")
    await dialog.getByRole("button", { name: "Done" }).click()

    const edit = ["--id", original.id, "--revision", String(original.revision)]
    const ours = await store(local, "Keep the local candidate.", edit)
    const theirs = await store(source, "Keep the repository candidate.", edit)
    const incoming = await readFile(join(source.repo, path), "utf8")
    expect(JSON.parse(incoming).content).toBe(theirs.content)
    await writeFile(join(local.repo, path), incoming)
    await local.git(["add", "--", path])
    await btn("Restore from repository").click()
    await dialog.getByRole("button", { name: "Restore lessons" }).click()
    await browserExpect(dialog.getByRole("status")).toContainText("1 lesson needs a version choice")
    const current = await memory(local, "read", original.id)
    expect(current.content).toBe(ours.content)
    await dialog.getByRole("button", { name: "Done" }).click()
    await btn("Compare versions").click()
    await browserExpect(dialog.getByText(ours.content, { exact: true })).toBeVisible()
    await browserExpect(dialog.getByText(theirs.content, { exact: true })).toBeVisible()
    const keep = dialog.getByRole("button", { name: "Keep selected version" })
    await browserExpect(keep).toBeDisabled()
    await capture("conflict-unselected")
    await store(local, "A newer local candidate.", [
      "--id",
      original.id,
      "--revision",
      String(ours.revision),
    ])
    await dialog.getByRole("radio", { name: /Repository version/ }).check()
    await keep.click()
    await browserExpect(dialog.getByRole("alert")).toContainText("The lesson changed")
    await capture("stale-conflict")
    await dialog.getByRole("button", { name: "Refresh versions" }).click()
    await browserExpect(dialog.getByText("A newer local candidate.", { exact: true })).toBeVisible()
    await browserExpect(keep).toBeDisabled()
    await dialog.getByRole("radio", { name: /Repository version/ }).check()
    await keep.click()
    await browserExpect(
      dialog.getByRole("status").filter({ hasText: "Version saved" }),
    ).toContainText("Both histories are kept.")
    await capture("conflict-resolved")
    const saved = (await memory(local, "read", original.id)) as unknown as MemoryRecord
    expect(saved.content).toBe(theirs.content)
    expect(saved.revision).toBeGreaterThan(theirs.revision)
    expect(saved.ancestry?.length).toBeGreaterThanOrEqual(2)
    await dialog.getByRole("button", { name: "Done" }).click()
    await browserExpect(btn("Compare versions")).toBeHidden()
  } finally {
    await browser.close()
    await receiving?.kill()
    await active?.kill()
    local?.cleanup()
    source.cleanup()
  }
}, 90_000)
