import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { chromium, type Page, expect as webExpect } from "@playwright/test"
import type { LaneRow } from "../../src/core/pages/lanes.ts"
import type { TaskDetail } from "../../src/ui/api.ts"
import { findChrome, pairedUrl } from "../helpers/chrome.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import { runAgent } from "../helpers/scriptedAgent.ts"
import { TASK_CARDS } from "../helpers/taskDocs.ts"
import { tmpRepo } from "../helpers/tmpRepo.ts"

const chrome = findChrome()
const output = process.env.QUALITYLAYER_CALM_PROOF_DIR
const scaffold = "# Implement\n\n## Slice 1: **1**\n\n- [ ] T1: `T1`\n"
const namedTask = "The binary prints its version"
const namedCards = TASK_CARDS.replace(
  namedTask,
  `${namedTask} from the selected checkout while preserving the saved launch choice and existing command behavior`,
)
let previousFailure = false

async function dismissWelcome(page: Page) {
  const welcome = page.locator('[data-testid="blocked"] .foot button')
  const tour = page.locator('[data-testid="tour"] button.skip')
  await webExpect
    .poll(
      async () =>
        (await welcome.isVisible()) ||
        (await tour.isVisible()) ||
        (await page.getByTestId("task-scroll").isVisible()),
    )
    .toBe(true)
  if (await welcome.isVisible()) await welcome.click()
  if (await tour.isVisible()) await tour.click()
}

async function geometry(page: Page) {
  const clipped = await page.locator('[data-testid="task-scroll"]').evaluate((root) => {
    const bounds = root.getBoundingClientRect()
    return [...root.querySelectorAll("h1, .sq p, .sq button, .ib-title, .tc-title")]
      .filter((node) => (node as HTMLElement).offsetHeight > 0)
      .filter((node) => {
        const box = node.getBoundingClientRect()
        return box.left < bounds.left - 1 || box.right > bounds.right + 1
      })
      .map((node) => node.textContent)
  })
  expect(clipped).toEqual([])
}

for (const theme of ["light", "dark"] as const)
  for (const width of [1440, 1024])
    test.skipIf(chrome === null && process.env.QUALITYLAYER_REQUIRE_RENDER !== "1")(
      `compiled calm transitions ${theme} ${width}: approved Plan, initialization, readable board and Verify`,
      async () => {
        if (previousFailure)
          throw new Error(
            "Not run after the first failed transition; inspect its retained evidence",
          )
        const repo = await tmpRepo()
        const trace = await runAgent(repo, "A calm build with a long selected checkout label")
        expect(trace.final.json.stop).toBe("implement")
        const server = await startCockpit(repo)
        const browser = await chromium.launch({ executablePath: chrome as string, headless: true })
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme: theme,
          permissions: ["clipboard-read", "clipboard-write"],
        })
        const page = await context.newPage()
        page.setDefaultTimeout(5000)
        const errors: string[] = []
        const captures: string[] = []
        const seen: Record<string, unknown>[] = []
        let active = false
        let stopped = false
        let verification: LaneRow[] | undefined
        let screen: { file: string; label: string } | undefined
        let screenReads = 0
        let responseCount = 0
        let starts = 0
        const proof = output ? join(output, `${theme}-${width}`) : undefined
        if (proof) await mkdir(proof, { recursive: true })
        page.on("pageerror", (error) => errors.push(error.message))
        page.on("request", (request) => {
          if (request.method() === "POST" && /\/api\/runs(?:\?|$)/.test(request.url())) starts++
        })
        try {
          await server.json("/api/config", { method: "PUT", body: JSON.stringify({ theme }) })
          const tasks = (await server.json("/api/tasks")).tasks as TaskDetail[]
          const task = tasks.find((item) => item.slug === trace.taskSlug)
          if (!task) throw new Error("Missing owned ordinary Plan")
          const path = `/api/tasks/${encodeURIComponent(task.id)}`
          const folder = join(repo.repo, "docs", "plans", trace.taskSlug)
          const cards = join(folder, "agents", "02-implement.md")
          const person = join(folder, "02-implement.md")
          const verifyFile = join(folder, "03-verify.md")
          await page.route(`**${path}/screens`, async (route) => {
            screenReads++
            await route.fulfill({
              json: {
                ok: true,
                screens: [],
                runs: screen
                  ? [
                      {
                        run: "it1",
                        mode: "scripted",
                        at: 1,
                        passed: true,
                        files: [{ file: screen.file, kind: "picture", cites: screen.label, at: 1 }],
                      },
                    ]
                  : [],
              },
            })
          })
          await page.route(`**${path}`, async (route) => {
            const response = await route.fetch()
            const body = await response.json()
            const current = body.task as TaskDetail
            if (active) {
              current.live = {
                progress: null,
                needs: [],
                refusal: null,
                question: null,
                ...current.live,
                signals: {
                  agent: "claude-code",
                  process: stopped ? "gone" : "alive",
                  hook: { at: Date.now(), event: "PreToolUse", words: "Synthetic fixture work" },
                  tool: null,
                  transcript: null,
                  cli: null,
                  question: null,
                  end: null,
                  agents: [],
                },
              }
            }
            if (verification !== undefined) {
              current.verifyLanes = verification
              current.checkProgress = []
              current.helpers = []
            }
            responseCount++
            seen.push({
              stage: current.stage,
              action: current.action,
              outside: current.outside,
              markers: current.pages?.map((entry) => ({
                step: entry.step,
                problems: entry.problems,
              })),
              slices: current.timeline?.slices.map((slice) => ({
                title: slice.title,
                tasks: slice.tasks.map((card) => card.title),
              })),
              verification: current.verifyLanes,
            })
            await route.fulfill({ response, json: body })
          })
          const capture = async (name: string) => {
            await geometry(page)
            if (proof) {
              const image = `${name}.png`
              await page.screenshot({ path: join(proof, image) })
              captures.push(image)
            }
          }
          const update = async (write: () => Promise<unknown>) => {
            const before = responseCount
            await write()
            await webExpect.poll(() => responseCount).toBeGreaterThan(before)
            await page.evaluate(
              () =>
                new Promise<void>((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                ),
            )
          }
          await page.goto(
            await pairedUrl(
              `${server.base}/?token=${server.token}#/task/${encodeURIComponent(task.id)}`,
            ),
          )
          await dismissWelcome(page)
          await page
            .locator('nav[aria-label="The task’s steps"] button[data-step="implement"]')
            .click()
          const quiet = page.getByTestId("step-quiet")
          await webExpect(quiet).toContainText("Implementation hasn’t started")
          await webExpect(
            page.getByRole("heading", { name: "Implementation hasn’t started", exact: true }),
          ).toHaveCount(1)
          await webExpect(
            page
              .locator('[data-testid="task-scroll"]')
              .getByRole("heading", { name: "Start the build", exact: true }),
          ).toHaveCount(0)
          expect(((await server.json(path)).task as TaskDetail).gate?.decision).toBe("approved")
          await capture("approved-unstarted")
          const cta = quiet.getByRole("button", { name: "Start the build on the Plan" })
          await cta.focus()
          await page.keyboard.press("Enter")
          await webExpect
            .poll(() => new URL(page.url()).hash)
            .toBe(`#/task/${encodeURIComponent(task.id)}/01-plan.md`)
          await webExpect(
            page
              .getByTestId("doc-reader")
              .getByRole("heading", { name: /^Plan: a root-level --version flag/ }),
          ).toBeVisible()
          await webExpect(
            page.getByRole("button", { name: "Back to Plan", exact: true }),
          ).toBeVisible()
          expect(starts).toBe(0)
          await page
            .locator('nav[aria-label="The task’s steps"] button[data-step="implement"]')
            .click()
          active = true
          expect((await repo.run(["build", "start", "--task", trace.taskSlug])).json.ok).toBe(true)
          await update(() => Bun.write(cards, scaffold))
          await webExpect(quiet).toContainText("Generating slices and tasks")
          await webExpect(page.getByTestId("board")).toHaveCount(0)
          await capture("initial-scaffold")
          await update(() => Bun.write(cards, namedCards))
          const board = page.getByTestId("board")
          await webExpect(board).toContainText(namedTask)
          await capture("named-board")
          await page.getByRole("tab", { name: "Files", exact: true }).click()
          await page
            .getByTestId("files-tab")
            .getByRole("button", { name: "Implement 02-implement.md", exact: true })
            .click()
          await webExpect(page.getByTestId("document-workspace")).toHaveAttribute(
            "data-full-size",
            "true",
          )
          await webExpect(page.getByTestId("doc-reader")).toBeVisible()
          await capture("started-full-document")
          await page
            .locator('nav[aria-label="The task’s steps"] button[data-step="implement"]')
            .click()
          await webExpect(board).toContainText(namedTask)
          for (const row of await board.locator(".sp-task-row").all()) await row.click()
          for (const toggle of await board
            .getByRole("button", { name: /^(Files|Done when)/ })
            .all())
            await toggle.click()
          await capture("named-board-expanded")
          const workingDocument = await Bun.file(person).text()
          const limitsBlock = /<!-- ql:limits -->[\s\S]*?<!-- \/ql:limits -->/
          const withLimit = (text: string) => {
            const block = `<!-- ql:limits -->\n${text}\n<!-- /ql:limits -->`
            return limitsBlock.test(workingDocument)
              ? workingDocument.replace(limitsBlock, block)
              : `${workingDocument}\n\n## Known limits\n\n${block}\n`
          }
          await update(() =>
            Bun.write(person, withLimit("- T12 · Fixture limit from the build record.")),
          )
          const knownLimits = page.locator("details[data-fold='Known limits']")
          await webExpect(knownLimits.locator("summary")).toBeVisible()
          await webExpect(
            knownLimits.getByText("Fixture limit from the build record."),
          ).toBeHidden()
          await knownLimits.scrollIntoViewIfNeeded()
          await capture("known-limits-closed")
          await knownLimits.locator("summary").press("Enter")
          await webExpect(
            knownLimits.getByText("Fixture limit from the build record."),
          ).toBeVisible()
          await capture("known-limits-open")
          await knownLimits.locator("summary").press("Enter")
          await webExpect(
            knownLimits.getByText("Fixture limit from the build record."),
          ).toBeHidden()
          await update(() => Bun.write(person, withLimit("None left.")))
          await webExpect(page.getByTestId("known-limits")).toHaveText("Known limits: none left.")
          await webExpect(knownLimits).toHaveCount(0)
          await page.getByTestId("known-limits").scrollIntoViewIfNeeded()
          await capture("known-limits-quiet")
          await update(() => Bun.write(person, workingDocument))
          await page.getByTestId("task-scroll").evaluate((root) => {
            root.scrollTop = 120
          })
          const scroll = await page.getByTestId("task-scroll").evaluate((root) => root.scrollTop)
          expect(scroll).toBeGreaterThan(0)
          stopped = true
          await update(async () => {
            await Bun.write(person, "# Implement\n\n<!-- ql:slices -->\n")
            await Bun.write(cards, scaffold)
          })
          await webExpect(board).toContainText(namedTask)
          await webExpect(board.locator(".ib-segs .r")).toHaveCount(0)
          await webExpect(page.getByTestId("interaction-agent-turn")).not.toContainText(
            /\d+ of \d+ tasks done/,
          )
          expect(await page.getByTestId("task-scroll").evaluate((root) => root.scrollTop)).toBe(
            scroll,
          )
          await capture("retained-board-stopped")
          stopped = false
          await Bun.write(cards, namedCards)
          await Bun.write(person, workingDocument)
          // The live App can receive the stage change before runAgent returns.
          verification = []
          const built = await runAgent(repo, "", { build: true, stopAt: "verify" })
          expect(built.final.json.ok).toBe(true)
          expect(((await server.json(path)).task as TaskDetail).stage).toBe("verify")
          await page.goto(`${server.base}/#/task/${encodeURIComponent(task.id)}/verify`)
          await dismissWelcome(page)
          await webExpect(quiet).toContainText("Preparing verification")
          await capture("verify-initial")
          verification = [
            { id: "checks", who: "QualityLayer", state: "done", result: "Fixture checks pass" },
          ]
          await update(() => Bun.write(verifyFile, "# Verify\n\n## Checks\n\nRecorded checks.\n"))
          await webExpect(page.getByTestId("verify-board")).toContainText("Fixture checks pass")
          await capture("verify-board")
          verification = [
            {
              id: "checks",
              who: "Partial replacement runner",
              state: "done",
              result: "Partial replacement",
            },
          ]
          await update(() =>
            Bun.write(verifyFile, "# Verify\n\n<!-- ql:checks -->\nPartial replacement\n"),
          )
          await webExpect(page.getByTestId("verify-board")).toContainText("Fixture checks pass")
          await webExpect(page.getByTestId("verify-board")).not.toContainText(
            "Partial replacement runner",
          )
          await capture("verify-retained")
          const picture = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=",
            "base64",
          )
          const firstPicture = "evidence/screen-aaaaaaaaaaaaaaaaaaaaaaaa.png"
          screen = {
            file: firstPicture,
            label: "Fixture first capture",
          }
          await update(() => Bun.write(join(folder, firstPicture), picture))
          await page.getByRole("button", { name: "Open picture: Fixture first capture" }).click()
          const viewer = page.getByTestId("picture-dialog")
          await webExpect(viewer).toBeVisible()
          await webExpect
            .poll(() =>
              viewer
                .locator(".pv-view img")
                .evaluate((node) => (node as HTMLImageElement).naturalWidth),
            )
            .toBe(1)
          await capture("verify-recorded-picture")
          await page.keyboard.press("Escape")
          await webExpect(viewer).toHaveCount(0)
          const replacementPicture = "evidence/screen-bbbbbbbbbbbbbbbbbbbbbbbb.png"
          screen = {
            file: replacementPicture,
            label: "Fixture replacement capture",
          }
          await update(() => Bun.write(join(folder, replacementPicture), picture))
          const replacement = page.getByRole("button", {
            name: "Open picture: Fixture replacement capture",
          })
          await webExpect(replacement).toBeVisible()
          await webExpect(
            page.getByRole("button", { name: "Open picture: Fixture first capture" }),
          ).toHaveCount(0)
          await replacement.focus()
          await page.keyboard.press("Enter")
          await webExpect(viewer).toContainText("Fixture replacement capture")
          await page.keyboard.press("Escape")
          expect(screenReads).toBeGreaterThanOrEqual(3)
          await capture("verify-replacement-picture")
          verification = [
            {
              id: "checks",
              who: "QualityLayer",
              state: "running",
              result: "Fixture check running",
            },
          ]
          await update(() => Bun.write(verifyFile, "# Verify\n\n## Checks\n\nRunning check.\n"))
          await webExpect(
            page.locator('[data-testid="board-check"][data-state="running"]'),
          ).toHaveCount(1)
          stopped = true
          await update(() =>
            Bun.write(verifyFile, "# Verify\n\n<!-- ql:checks -->\nPartial stopped refresh\n"),
          )
          await webExpect(
            page.locator('[data-testid="board-check"][data-state="running"]'),
          ).toHaveCount(0)
          await webExpect(
            page.locator('[data-testid="board-stage"][data-state="running"]'),
          ).toHaveCount(0)
          await webExpect(page.locator(".vb-segs .w")).toHaveCount(0)
          await webExpect(page.getByTestId("verify-board")).toContainText("Fixture check running")
          await capture("verify-stopped-retained")
          expect(errors).toEqual([])
          expect(starts).toBe(0)
          if (proof)
            await Bun.write(
              join(proof, "result.json"),
              JSON.stringify(
                {
                  theme,
                  width,
                  errors,
                  starts,
                  captures,
                  scroll,
                  screenReads,
                  seen,
                  mode: "Actual compiled App with real CLI-approved Plan, build start and files; synthetic live signals and Verify lane API fixture; no native provider ran",
                },
                null,
                2,
              ),
            )
        } catch (error) {
          previousFailure = true
          if (proof) {
            await Bun.write(
              join(proof, "failure.json"),
              JSON.stringify(
                {
                  error: String(error),
                  errors,
                  starts,
                  seen,
                  url: page.url(),
                  buttons: await page
                    .getByRole("button")
                    .allTextContents()
                    .catch(() => []),
                },
                null,
                2,
              ),
            )
            await Bun.write(
              join(proof, "failure.html"),
              await page.content().catch(() => "Page closed"),
            )
            await page.screenshot({ path: join(proof, "failure.png") }).catch(() => {})
          }
          throw error
        } finally {
          await browser.close()
          await server.kill()
          repo.cleanup()
        }
      },
      120_000,
    )
