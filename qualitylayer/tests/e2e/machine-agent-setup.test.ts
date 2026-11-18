import { expect, test } from "bun:test"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { delimiter, join } from "node:path"
import { BINARY_VARIABLES } from "../../src/core/agents/binary.ts"
import { BINARIES, NATIVE_AGENTS } from "../../src/core/agents/ids.ts"
import { writeConfig } from "../../src/core/config.ts"
import { singleQuoted } from "../../src/core/run/launch-spec.ts"
import { realCtx } from "../../src/ctx.ts"
import { findChrome, launchChrome } from "../helpers/chrome.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import { fakeExecutable } from "../helpers/fakeExecutable.ts"
import { tmpRepo } from "../helpers/tmpRepo.ts"

test.skipIf(process.platform === "win32")(
  "the real Machine Setup installs, signs in, cancels and opens New task through managed terminals",
  async () => {
    const chrome = findChrome()
    if (!chrome) throw new Error("A managed Chrome is required for Machine Setup")
    const repo = await tmpRepo()
    let server: Awaited<ReturnType<typeof startCockpit>> | undefined
    let browser: Awaited<ReturnType<typeof launchChrome>> | undefined
    try {
      const tools = join(repo.root, "setup-tools")
      const installTo = join(repo.home, ".local/bin/claude")
      await mkdir(tools)
      const native = fakeExecutable(
        tools,
        "fixture-claude",
        `
    const fs = require("node:fs"), path = require("node:path");
    const home = process.env.HOME, args = process.argv.slice(2);
    const authenticated = path.join(home, "fixture-authenticated");
    if (args[0] === "--version") console.log("2.1.304 (Claude Code)");
    else if (args.join(" ") === "auth status --json") {
      const loggedIn = fs.existsSync(authenticated);
      console.log(JSON.stringify({ loggedIn, subscriptionType: loggedIn ? "max" : null }));
      process.exitCode = loggedIn ? 0 : 1;
    } else if (args.join(" ") === "auth login") {
      fs.writeFileSync(path.join(home, ".claude.json"), "{}");
      fs.appendFileSync(path.join(home, "fixture-operations.jsonl"), JSON.stringify({ operation: "sign-in", home, cwd: process.cwd() }) + "\\n");
      console.log("Fixture sign-in: enter finish to complete.");
      process.stdin.setEncoding("utf8");
      let text = "";
      process.stdin.on("data", chunk => {
        text += chunk;
        if (!text.includes("\\n")) return;
        if (text.trim() !== "finish") process.exit(2);
        fs.writeFileSync(authenticated, "fixture account only");
        console.log("Fixture sign-in complete.");
        process.exit(0);
      });
      process.stdin.resume();
    } else { console.error("No model or other native operation is permitted"); process.exit(91); }
  `,
      )
      const installer = join(repo.home, "fixture-installer.sh")
      await writeFile(
        installer,
        `set -eu
if [ -f "$HOME/fixture-install-fails" ]; then echo 'Fixture download failed' >&2; exit 1; fi
mkdir -p "$HOME/.local/bin"
cp ${singleQuoted(native)} "$HOME/.local/bin/claude"
chmod 755 "$HOME/.local/bin/claude"
printf 'Fixture installer completed on %s\\n' "$HOME"
`,
      )
      fakeExecutable(
        tools,
        "curl",
        `
    const fs = require("node:fs"), path = require("node:path");
    if (!process.argv.slice(2).includes("https://claude.ai/install.sh")) process.exit(92);
    fs.appendFileSync(path.join(process.env.HOME, "fixture-downloads"), "official Claude installer request\\n");
    process.stdout.write(fs.readFileSync(path.join(process.env.HOME, "fixture-installer.sh")));
  `,
      )
      repo.env.PATH = tools + delimiter + repo.env.PATH
      // The fixture's login shell returns its controlled PATH; no real profile or download can win.
      repo.env.SHELL = fakeExecutable(tools, "fixture-login-shell", "console.log(process.env.PATH)")
      repo.env.QUALITYLAYER_SYSTEM_ROOT = join(repo.root, "no-system-agents")
      for (const agent of NATIVE_AGENTS)
        repo.env[BINARY_VARIABLES[agent]] =
          agent === "claude-code" ? installTo : join(repo.root, "stubs", BINARIES[agent])
      const ctx = realCtx({ cwd: repo.repo, env: repo.env })
      await writeConfig(ctx, {
        agents: Object.fromEntries(
          NATIVE_AGENTS.map((agent) => [
            agent,
            {
              enabled: agent === "claude-code",
              ...(agent === "claude-code" ? { command: installTo } : {}),
            },
          ]),
        ),
      })
      server = await startCockpit(repo)
      browser = await launchChrome(chrome)
      const page = await browser.open(`${server.base}/?token=${server.token}&in=app#/setup`)
      await page.viewport(1024, 900)
      const agent = '.q-machine-agent[data-agent="claude-code"]'
      await page.waitFor(
        `document.querySelector(${JSON.stringify(agent)})?.textContent.includes('Not installed')`,
      )
      await page.type('[data-testid="machine-project"] input', repo.repo)
      const startDisabled = () =>
        page.evaluate<boolean>(
          "[...document.querySelectorAll('button')].find(button => button.textContent.trim()==='Start a task').disabled",
        )
      expect(await startDisabled()).toBe(true)
      await writeFile(join(repo.home, "fixture-install-fails"), "one failed download")
      await page.click(`${agent} .q-btn`)
      await page.waitFor(
        `document.querySelector(${JSON.stringify(agent)})?.textContent.includes('Retry install')`,
      )
      expect(await startDisabled()).toBe(true)
      await rm(join(repo.home, "fixture-install-fails"))
      await page.click(`${agent} .q-btn`)
      await page.waitFor(
        `[...document.querySelectorAll(${JSON.stringify(`${agent} button`)})].some(button=>button.textContent.trim()==='Sign in')`,
      )
      await page.click(`${agent} .q-btn`)
      await page.waitFor(
        "document.querySelector('.q-machine-terminal-view .xterm-screen') && [...document.querySelectorAll('.q-machine-terminal button')].some(button => button.textContent.trim()==='Cancel sign-in'&&!button.disabled)",
      )
      await page.click('[aria-label="Close setup terminal"]')
      expect(
        ((await server.json("/api/agent-runs")).runs as { status: string }[]).some(
          (run) => run.status === "running",
        ),
      ).toBe(true)
      await page.click(`${agent} .q-btn`)
      await page.waitFor("document.activeElement?.classList.contains('xterm-helper-textarea')")
      await page.evaluate(
        "[...document.querySelectorAll('.q-machine-terminal button')].find(button=>button.textContent.trim()==='Cancel sign-in').setAttribute('data-cancel-sign-in','true')",
      )
      await page.click('[data-cancel-sign-in="true"]')
      await page.waitFor(
        `document.querySelector(${JSON.stringify(agent)})?.textContent.includes('Not signed in') && !document.querySelector('[data-cancel-sign-in="true"]')`,
      )
      expect(await startDisabled()).toBe(true)
      expect(await Bun.file(join(repo.home, "fixture-authenticated")).exists()).toBe(false)
      // Hold only this explicit refresh's responses. An earlier signed-out row remains visible
      // until the version check returns, then the Sign in action waits for the new account check.
      await page.evaluate(`(() => {
        const fetch = window.fetch.bind(window)
        let rechecking = false
        const version = new Promise(resolve => { window.releaseAgentVersions = resolve })
        const signIn = new Promise(resolve => { window.releaseAgentSignIn = resolve })
        window.fetch = async (input, init) => {
          const path = new URL(typeof input === "string" ? input : input.url, location.href).pathname
          const isRefresh = path === "/api/agents/check" && init?.body === "{}"
          if (isRefresh) rechecking = true
          const response = await fetch(input, init)
          if (isRefresh) await version
          if (rechecking && path === "/api/agents/sign-in") {
            await signIn
            window.fetch = fetch
          }
          return response
        }
      })()`)
      await page.click('[data-testid="agents-step"] .r .q-link')
      const row = `document.querySelector(${JSON.stringify(agent)})`
      await page.waitFor(`${row}?.textContent.includes('Not signed in')`)
      await page.evaluate("window.releaseAgentVersions()")
      await page.waitFor(`${row}?.textContent.includes('Checking sign-in…')`)
      expect(await page.evaluate<boolean>(`!!${row}?.querySelector('.q-btn')`)).toBe(false)
      await page.evaluate("window.releaseAgentSignIn()")
      await page.waitFor(
        `[...${row}.querySelectorAll('button')].some(button => button.textContent.trim() === 'Sign in' && !button.disabled)`,
      )
      await page.click(`${agent} .q-btn`)
      await page.waitFor("document.activeElement?.classList.contains('xterm-helper-textarea')")
      await page.type(".q-machine-terminal .xterm-screen", "finish")
      await page.press("Enter")
      await page.waitFor(
        `document.querySelector(${JSON.stringify(agent)})?.textContent.includes('Claude Max')`,
      )
      expect(await startDisabled()).toBe(false)
      const observations = (await readFile(join(repo.home, "fixture-operations.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { home: string; cwd: string })
      expect(observations).toHaveLength(2)
      expect(observations.every((row) => row.home === repo.home && row.cwd === repo.home)).toBe(
        true,
      )
      expect(
        (await readFile(join(repo.home, "fixture-downloads"), "utf8")).trim().split("\n"),
      ).toHaveLength(2)
      for (const width of [1440, 1024, 390])
        for (const theme of ["light", "dark"]) {
          await page.viewport(width, 900)
          await page.evaluate(
            `document.documentElement.dataset.theme='${theme}';document.documentElement.classList.toggle('dark', ${theme === "dark"}); Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))`,
          )
          const fits = await page.evaluate<boolean>(
            "document.documentElement.scrollWidth<=document.documentElement.clientWidth && [...document.querySelectorAll('.q-onb-card,.q-machine-terminal')].every(element=>{const box=element.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth})",
          )
          expect(fits).toBe(true)
          if (process.env.QUALITYLAYER_EVIDENCE_DIR)
            await Bun.write(
              join(process.env.QUALITYLAYER_EVIDENCE_DIR, `machine-ready-${width}-${theme}.png`),
              await page.screenshot(),
            )
        }
      await page.click('[aria-label="Close setup terminal"]')
      await page.evaluate(
        "[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Start a task').setAttribute('data-start-first-task','true')",
      )
      await page.click('[data-start-first-task="true"]')
      await page.waitFor("document.querySelector('[data-testid=new-task]')")
      expect(
        await page.evaluate<boolean>(
          `document.querySelector('[data-testid=new-task]')?.dataset.agent==='claude-code'`,
        ),
      ).toBe(true)
      const records = await server.json("/api/agent-runs")
      expect(
        (records.runs as { purpose: { kind: string } }[]).every(
          (run) => run.purpose.kind === "terminal",
        ),
      ).toBe(true)
    } finally {
      try {
        await browser?.close()
      } finally {
        try {
          await server?.kill()
        } finally {
          repo.cleanup()
        }
      }
    }
  },
  60_000,
)
