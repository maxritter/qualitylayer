import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { chromium, expect as webExpect } from "@playwright/test"
import type { ReviewCandidateState } from "../../src/core/review-candidate.ts"
import { findChrome, pairedUrl } from "../helpers/chrome.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import { runAgent } from "../helpers/scriptedAgent.ts"
import { tmpRepo } from "../helpers/tmpRepo.ts"

const chrome = findChrome()

test.skipIf(chrome === null && process.env.QUALITYLAYER_REQUIRE_RENDER !== "1")(
  "the paired App pins an explicitly selected shared checkout after a rebase",
  async () => {
    const repo = await tmpRepo()
    let app: Awaited<ReturnType<typeof startCockpit>> | undefined
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
    try {
      await repo.git(["checkout", "-b", "feature/original"])
      const trace = await runAgent(repo, "add a --version flag", { build: true, stopAt: "verify" })
      expect(trace.phases).toContain("verify")
      await repo.git(["checkout", "-b", "rewritten"])
      await repo.git([
        "commit",
        "--amend",
        "-m",
        "Include the version flag in the shared candidate",
      ])
      const head = (await repo.git(["rev-parse", "HEAD"])).trim()
      const linked = join(repo.root, "linked-review")
      await repo.git(["worktree", "add", "-b", "shared-candidate", linked, head])
      const wrongTest = join(repo.repo, "tests", "wrong-checkout.test.ts")
      await Bun.write(
        wrongTest,
        'import { test } from "bun:test"\ntest("only the original checkout fails",()=>{throw Error("Wrong checkout")})\n',
      )
      await repo.git(["add", "--", wrongTest])
      await repo.git(["commit", "-m", "Original checkout has independent failing work"])
      app = await startCockpit(repo)
      const tasks = (await app.json("/api/tasks")).tasks as { slug: string; id: string }[]
      const id = tasks.find((t) => t.slug === trace.taskSlug)?.id
      if (!id) throw Error("Fixture did not reach the task list")
      const route = "/api/tasks/" + encodeURIComponent(id) + "/review-candidate"
      const state = (await app.json(route)) as unknown as ReviewCandidateState
      expect(state.eligible).toBe(true)
      const shared = state.choices.find((c) => c.branch === "shared-candidate")
      expect(shared?.shared).toBe(true)
      const rejected = await app.api(route, {
        method: "POST",
        body: JSON.stringify({
          version: state.version,
          checkout: shared?.checkout,
          branch: "shared-candidate",
          head,
          acknowledgeShared: false,
        }),
      })
      expect(rejected.ok).toBe(false)
      browser = await chromium.launch({ executablePath: chrome ?? undefined, headless: true })
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
      })
      await page.addLocatorHandler(page.locator('[data-testid="tour"] button.skip'), (button) =>
        button.click(),
      )
      await page.goto(
        await pairedUrl(
          app.base +
            "/?token=" +
            app.token +
            "&in=browser#/task/" +
            encodeURIComponent(id) +
            "/verify",
        ),
      )
      const open = page.getByRole("button", { name: "Choose review commit…" })
      await open.click()
      const dialog = page.getByRole("dialog", { name: "Choose review commit" })
      await webExpect(dialog).toBeVisible()
      const shots = process.env.QUALITYLAYER_REVIEW_CANDIDATE_SHOTS
      if (shots) await mkdir(shots, { recursive: true })
      for (const [width, height, theme] of [
        [1440, 900, "light"],
        [1440, 900, "dark"],
        [390, 844, "light"],
        [390, 844, "dark"],
      ] as const) {
        await app.json("/api/config", { method: "PUT", body: JSON.stringify({ theme }) })
        await page.setViewportSize({ width, height })
        await page.emulateMedia({ colorScheme: theme })
        await webExpect
          .poll(async () => {
            const box = await dialog.boundingBox()
            return box
              ? Math.max(
                  Math.abs(box.x + box.width / 2 - width / 2),
                  Math.abs(box.y + box.height / 2 - height / 2),
                )
              : Infinity
          })
          .toBeLessThan(2)
        if (shots)
          await page.screenshot({
            path: join(shots, `actual-modal-${width}-${theme}.png`),
            animations: "disabled",
          })
      }
      await page.keyboard.press("Escape")
      await webExpect(open).toBeFocused()
      await open.click()
      await dialog.locator("label.rc-row").filter({ hasText: "shared-candidate" }).click()
      const confirm = dialog.getByRole("button", { name: "Start fresh review" })
      await webExpect(confirm).toBeDisabled()
      await dialog.getByRole("checkbox").check()
      await dialog.getByText("Review details", { exact: true }).click()
      await webExpect(dialog.getByText(head, { exact: true })).toBeVisible()
      await confirm.click()
      await webExpect(page.getByText("Fresh review requested", { exact: true })).toBeVisible()
      const reread = (await app.json(route)) as unknown as ReviewCandidateState
      expect(reread.selected).toMatchObject({ head, branch: "shared-candidate", state: "pending" })
      const flags = ["--task", trace.taskSlug]
      const beforeChecks = await repo.run(["verify", "judge", ...flags])
      expect(beforeChecks.json.ok).toBe(true)
      const checked = await repo.run(["check", "all", ...flags])
      expect(checked.json).toMatchObject({ ok: true, passed: true })
      const fresh = await repo.run(["verify", "judge", ...flags])
      if (!fresh.json.ok) throw Error(fresh.stdout)
      const judge = fresh.json.helper as { brief_file?: string } | undefined
      expect(judge?.brief_file).toBeTruthy()
      const brief = await Bun.file(judge?.brief_file ?? "").text()
      expect(brief).toContain(`Selected review commit: \`${head}\``)
      expect(brief).not.toContain("Working-tree HEAD at assignment:")
      const assigned = (await app.json(route)) as unknown as ReviewCandidateState
      expect(assigned.selected).toMatchObject({
        head,
        branch: "shared-candidate",
        state: "assigned",
      })
      await repo.git(["commit", "--allow-empty", "-m", "Head moved after fresh assignment"], linked)
      const changed = (await app.json(route)) as unknown as ReviewCandidateState
      expect(changed.selected?.state).toBe("stale")
    } finally {
      await browser?.close()
      await app?.stop()
      repo.cleanup()
    }
  },
  65_000,
)
