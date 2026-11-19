import { expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { chromium, type Page, expect as webExpect } from "@playwright/test"
import { recordCall, recordHook } from "../../src/core/live/record.ts"
import { err, realCtx } from "../../src/ctx.ts"
import { findChrome, pairedUrl } from "../helpers/chrome.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import { runAgent } from "../helpers/scriptedAgent.ts"
import { tmpRepo } from "../helpers/tmpRepo.ts"

const chrome = findChrome()

async function statusPanel(page: Page) {
  await page.getByRole("button", { name: /Agent status/ }).click()
  return page.getByTestId("interaction-status-panel")
}

test.skipIf(chrome === null && process.env.QUALITYLAYER_REQUIRE_RENDER !== "1")(
  "Verify shows a real failed project check, checkout and recorded activity without adding a verdict",
  async () => {
    const repo = await tmpRepo()
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
    let server: Awaited<ReturnType<typeof startCockpit>> | undefined
    const session = randomUUID()
    const env = {
      CLAUDE_CODE_SESSION_ID: session,
      QUALITYLAYER_SESSION: session,
      QUALITYLAYER_AGENT: "claude-code",
    }
    try {
      await repo.git(["checkout", "-b", "feature/verify-activity"])
      const trace = await runAgent(repo, "add a --version flag", {
        build: true,
        stopAt: "verify",
        env,
      })
      const generated = await Array.fromAsync(
        new Bun.Glob("built-*.test.ts").scan({ cwd: join(repo.repo, "tests") }),
      )
      expect(generated.length).toBeGreaterThan(0)
      const testFile = join(repo.repo, "tests", generated[0] as string)
      await Bun.write(
        testFile,
        `${await Bun.file(testFile).text()}\ntest("fixture project regression", () => { throw new Error("fixture regression") })\n`,
      )
      const failed = await repo.run(["check", "all"], { env })
      expect(failed.json).toMatchObject({ ok: true, passed: false })
      const checked = (await repo.git(["rev-parse", "HEAD"])).trim()
      await repo.git(["checkout", "-b", "develop"])
      await repo.git(["commit", "--allow-empty", "-m", "Current fixture checkout"])
      const current = (await repo.git(["rev-parse", "HEAD"])).trim()
      expect(current).not.toBe(checked)
      const stopped = await repo.run(["hook", "stop"], {
        env,
        input: JSON.stringify({ session_id: session, hook_event_name: "Stop", cwd: repo.repo }),
      })
      expect(stopped.code).toBe(0)

      server = await startCockpit(repo)
      const { tasks } = await server.json("/api/tasks")
      const id = (tasks as { id: string; slug: string }[]).find(
        (task) => task.slug === trace.taskSlug,
      )?.id
      if (!id) throw new Error("Fixture task not read back")
      const taskUrl = `/api/tasks/${encodeURIComponent(id)}`
      const detail = (await server.json(taskUrl)).task
      expect(detail).toMatchObject({
        verifyActivity: {
          projectChecks: {
            checked: { head: checked, branch: "feature/verify-activity" },
            checkout: { head: current, branch: "develop" },
            commands: [{ command: "bun test", outcome: "failed" }],
          },
        },
      })

      browser = await chromium.launch({ executablePath: chrome ?? undefined, headless: true })
      const shotPath = process.env.QUALITYLAYER_VERIFY_ACTIVITY_SHOTS
      if (shotPath) await mkdir(shotPath, { recursive: true })
      for (const [width, height] of [
        [1440, 900],
        [1024, 720],
        [390, 844],
      ] as const) {
        for (const theme of ["light", "dark"] as const) {
          await server.json("/api/config", { method: "PUT", body: JSON.stringify({ theme }) })
          const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme })
          await page.addLocatorHandler(page.locator('[data-testid="tour"] button.skip'), (button) =>
            button.click(),
          )
          const welcome = page
            .getByTestId("blocked")
            .filter({ has: page.getByRole("heading", { name: "QualityLayer in this browser" }) })
          await page.addLocatorHandler(welcome.locator(".foot button").first(), (button) =>
            button.click(),
          )
          const errors: string[] = []
          page.on("pageerror", (error) => errors.push(error.message))
          await page.goto(
            await pairedUrl(
              `${server.base}/?token=${server.token}#/task/${encodeURIComponent(id)}/verify`,
            ),
          )
          await webExpect(page.getByTestId("fact-row")).toContainText(/0 of \d+/)
          await webExpect(page.getByTestId("fact-row").locator(".bd-fbar")).toBeVisible()
          const evidence = page.getByTestId("verify-check-evidence")
          await webExpect(evidence).toContainText("Current checkout develop")
          await webExpect(evidence).toContainText(checked.slice(0, 7))
          await evidence.locator("summary").focus()
          await page.keyboard.press("Enter")
          await webExpect(evidence.getByText("Failed (exit 1)")).toBeVisible()
          await webExpect(page.getByTestId("verify-board")).toContainText(
            "1 of 1 project check failed",
          )
          if (width === 1440) {
            const outside = page.getByTestId("outside-lead")
            await webExpect(outside).toContainText("Verifying in Claude Code outside the App")
            await webExpect(
              outside.getByRole("region", { name: "Recorded activity" }),
            ).toContainText("Verify started")
          }
          if (shotPath)
            await page.screenshot({
              path: join(shotPath, `verify-${width}-${theme}.png`),
              animations: "disabled",
            })
          const panel = await statusPanel(page)
          await webExpect(panel).toContainText("Lead · Verify")
          const activity = panel.getByRole("region", { name: "Recorded activity" })
          await webExpect(activity).toContainText("Verify started")
          await webExpect(activity).toContainText("1 of 1 project check failed")
          await webExpect(panel.getByTestId("agent-now")).toContainText("No active turn")
          await webExpect(panel.locator('[data-who="you"]')).toHaveCount(0)
          if (shotPath)
            await page.screenshot({
              path: join(shotPath, `activity-${width}-${theme}.png`),
              animations: "disabled",
            })
          await panel.getByRole("button", { name: "Close agent activity" }).click()
          await webExpect(panel).not.toBeVisible()
          if (width === 390 && theme === "dark") {
            const context = realCtx({ env: { ...repo.env, ...env }, cwd: repo.repo })
            await recordHook(
              context,
              { session_id: session, hook_event_name: "UserPromptSubmit" },
              "",
              () => process.pid,
            )
            const requests = join(context.home, "peers", "requests")
            await mkdir(requests, { recursive: true })
            const requestId = randomUUID()
            const peerSession = randomUUID()
            await Bun.write(
              join(requests, `${requestId}.request.json`),
              JSON.stringify({
                request_id: requestId,
                requester_kind: "cc",
                requester_session_id: session,
                target_kind: "cc",
                target_session_id: peerSession,
                target_session_name: "Riley",
                workflow_repo: id.split("~")[0],
                workflow_task: trace.taskSlug,
                created_at: new Date().toISOString(),
                expires_at: Date.now() / 1000 + 120,
              }),
            )
            const correlated = (await server.json(taskUrl)).task
            expect(correlated).toMatchObject({
              verifyActivity: { peer: { name: "Riley" } },
              live: { signals: { hook: { event: "UserPromptSubmit" }, sessionId: session } },
            })
            await page.reload()
            const peerPanel = await statusPanel(page)
            await webExpect(peerPanel.getByTestId("agent-now")).toContainText(
              "Waiting for a peer agent",
            )
            await webExpect(peerPanel.locator('[data-who="you"]')).toHaveCount(0)
            await webExpect(
              peerPanel.getByRole("region", { name: "Recorded activity" }),
            ).toContainText("Asked peer agent Riley")
            if (shotPath)
              await page.screenshot({
                path: join(shotPath, "activity-peer-390.png"),
                animations: "disabled",
              })
            await recordHook(
              context,
              { session_id: session, hook_event_name: "UserPromptSubmit" },
              "",
              () => process.pid,
            )
            await page.reload()
            const activePanel = await statusPanel(page)
            await webExpect(activePanel.getByTestId("agent-now")).toContainText("you wrote to it")
            await webExpect(
              activePanel.getByRole("region", { name: "Recorded activity" }),
            ).toContainText("Asked peer agent Riley")

            await Bun.write(
              join(requests, `${requestId}.reply.json`),
              JSON.stringify({
                request_id: requestId,
                session_id: peerSession,
                target_kind: "cc",
                replied_at: new Date().toISOString(),
                message: "Fixture completed",
              }),
            )
            const replied = (await server.json(taskUrl)).task as {
              verifyActivity?: { peer?: unknown }
            }
            expect(replied.verifyActivity?.peer).toBeUndefined()
            await recordHook(
              context,
              { session_id: session, hook_event_name: "Stop" },
              "",
              () => process.pid,
            )
            await page.reload()
            await webExpect((await statusPanel(page)).getByTestId("agent-now")).toContainText(
              "No active turn",
            )

            const cause = err({
              code: "state_mismatch",
              stored: "verify",
              found: "project history changed",
              message: "The checkout cannot prove the recorded branch history.",
              fix: "Run qualitylayer doctor.",
            })
            for (let call = 0; call < 2; call++) {
              await recordCall(context, "verify", ["judge"], cause, () => process.pid)
            }
            await recordHook(
              context,
              { session_id: session, hook_event_name: "Stop" },
              "",
              () => process.pid,
            )
            await page.reload()
            await webExpect(page.getByTestId("verify-board")).toContainText("Could not start")
            const refusedPanel = await statusPanel(page)
            await webExpect(refusedPanel.locator('[data-who="you"]')).toHaveCount(0)
            await webExpect(
              refusedPanel.getByRole("region", { name: "Recorded activity" }),
            ).toContainText("Independent review could not start")
            if (shotPath)
              await page.screenshot({
                path: join(shotPath, "activity-refused-390.png"),
                animations: "disabled",
              })

            await recordHook(
              context,
              { session_id: session, hook_event_name: "PermissionRequest", tool_name: "Bash" },
              "",
              () => process.pid,
            )
            await page.reload()
            const permissionPanel = await statusPanel(page)
            await webExpect(permissionPanel.getByTestId("agent-now")).toContainText(
              "Permission needed",
            )
            await webExpect(permissionPanel.locator('[data-who="you"]')).toHaveCount(1)
            await webExpect(
              permissionPanel.getByRole("region", { name: "Recorded activity" }),
            ).toContainText("Agent requested permission")
            if (shotPath)
              await page.screenshot({
                path: join(shotPath, "activity-permission-390.png"),
                animations: "disabled",
              })
          }
          expect(errors).toEqual([])
          await page.close()
        }
      }
    } finally {
      await browser?.close()
      await server?.kill()
      repo.cleanup()
    }
  },
  150_000,
)
