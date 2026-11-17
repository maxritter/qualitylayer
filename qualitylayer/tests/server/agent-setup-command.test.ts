import { expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeConfig } from "../../src/core/config.ts"
import { DEFAULT_CONFIG } from "../../src/core/config-values.ts"
import type { StartRequest } from "../../src/core/run/contracts.ts"
import { realCtx } from "../../src/ctx.ts"
import { agentSetupRoute } from "../../src/server/agent-setup.ts"
import { agentSetupProgram, readAgentSetup } from "../../src/server/agent-setup-command.ts"
import { purposeContext } from "../../src/server/run-purpose-context.ts"
import { fakeExecutable } from "../helpers/fakeExecutable.ts"

test("setup metadata is read-only and the command runs in this server's native home before any project exists", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ql-agent-setup-")))
  try {
    const home = join(root, "native-home")
    await mkdir(home)
    const ctx = realCtx({
      cwd: root,
      env: { HOME: home, USERPROFILE: home, QUALITYLAYER_HOME: join(root, "ql-home"), PATH: "" },
    })
    const metadata = await readAgentSetup(ctx)
    expect(metadata.platform).toBe(process.platform)
    expect(metadata.machine.length).toBeGreaterThan(0)
    const input: StartRequest = {
      agent: "other",
      purpose: {
        kind: "terminal",
        shell: true,
        context: { kind: "agent-setup", agent: "codex", operation: "install" },
      },
      works: "checkout",
      idempotencyKey: "setup",
    }
    expect(await purposeContext(ctx, input, DEFAULT_CONFIG)).toEqual({
      cwd: home,
      works: "checkout",
    })
    await expect(purposeContext(ctx, { ...input, cwd: root }, DEFAULT_CONFIG)).rejects.toThrow(
      "native home",
    )
    await expect(purposeContext(ctx, { ...input, agent: "codex" }, DEFAULT_CONFIG)).rejects.toThrow(
      "own native terminal",
    )
    await expect(
      purposeContext(
        ctx,
        {
          ...input,
          purpose: {
            kind: "terminal",
            context: { kind: "agent-setup", agent: "codex", operation: "install" },
          },
        },
        DEFAULT_CONFIG,
      ),
    ).rejects.toThrow("own native terminal")
    await expect(
      purposeContext(
        ctx,
        { ...input, purpose: { kind: "terminal", shell: true }, cwd: home },
        DEFAULT_CONFIG,
      ),
    ).rejects.toThrow("Choose a project")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a setup launch respects disabled agents and checked native command paths without executing a login", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ql-agent-setup-command-")))
  try {
    const ctx = realCtx({
      cwd: root,
      env: {
        HOME: root,
        USERPROFILE: root,
        QUALITYLAYER_HOME: join(root, ".qualitylayer"),
        PATH: root,
        QUALITYLAYER_SYSTEM_ROOT: join(root, "empty"),
      },
    })
    const binary = fakeExecutable(
      root,
      "codex",
      'if(process.argv.at(-1)!=="--version")throw new Error("A test must not log in");console.log("codex-cli 0.169.0")',
    )
    await writeConfig(ctx, { agents: { codex: { command: binary, enabled: true } } })
    expect(await agentSetupProgram(ctx, "codex", "sign-in", { HOME: root, PATH: root })).toEqual({
      program: binary,
      args: ["login", "--device-auth"],
    })
    await writeConfig(ctx, { agents: { codex: { enabled: false } } })
    await expect(agentSetupProgram(ctx, "codex", "sign-in", { PATH: root })).rejects.toThrow(
      "Enable Codex",
    )
    expect((await readAgentSetup(ctx)).agents.find(({ agent }) => agent === "codex")?.enabled).toBe(
      false,
    )
    await expect(agentSetupProgram(ctx, "pi", "sign-in", { PATH: root })).rejects.toThrow(
      "setup guide",
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("targeted health refresh requires the existing App authority and rejects unknown agents before probing", async () => {
  const ctx = realCtx({ env: { QUALITYLAYER_HOME: "/not-used", HOME: "/not-used" } })
  const request = new Request("http://localhost/api/agents/check", { method: "POST" })
  const refused = await agentSetupRoute(
    ctx,
    request,
    "/api/agents/check",
    () => false,
    async () => {
      throw new Error("must not read body")
    },
  )
  expect(refused).toBeInstanceOf(Response)
  expect((refused as Response).status).toBe(403)
  expect(
    await agentSetupRoute(
      ctx,
      request,
      "/api/agents/check",
      () => true,
      async () => ({ agent: "not-a-native-agent" }),
    ),
  ).toMatchObject({ ok: false, error: { code: "bad_args" } })
})
