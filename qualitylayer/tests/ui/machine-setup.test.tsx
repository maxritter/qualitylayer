import { afterAll, afterEach, expect, mock, test } from "bun:test"
import type { AgentHealth } from "../../src/core/agents/health-types.ts"
import type { NativeAgent } from "../../src/core/agents/ids.ts"
import { agentSetupCapabilities } from "../../src/core/agents/setup.ts"
import type { ViewerState } from "../../src/core/run/protocol.ts"
import type { TerminalOptions } from "../../src/ui/agent-window/view.ts"
import type { RunAdapter, RunStart, RunWindow } from "../../src/ui/run-context.tsx"
import type { SetupPageApi } from "../../src/ui/Setup.tsx"
import { mountDom, unmountDom } from "../helpers/dom.ts"

const rtl = await mountDom()
const { Setup } = await import("../../src/ui/Setup.tsx")
const { RunProvider } = await import("../../src/ui/run-context.tsx")
const { MachineSetupTerminal } = await import("../../src/ui/machines/MachineSetupTerminal.tsx")
afterEach(() => rtl.cleanup())
afterAll(() => unmountDom(rtl))

const nativeHealth = (available: boolean, signedIn: boolean): AgentHealth => ({
  agent: "claude-code",
  status: available ? "available" : "not-found",
  path: available ? "/target/bin/claude" : null,
  version: available ? "2.1.304 (Claude Code)" : null,
  checkedAt: 1,
  detail: null,
  ...(available
    ? {
        accountCheck: {
          state: signedIn ? ("signed-in" as const) : ("signed-out" as const),
          checkedAt: 1,
          source: "claude auth status --json",
        },
        account: signedIn ? "Signed in" : "Not signed in",
      }
    : {}),
})
const runFor = (request: RunStart, id: string): RunWindow => ({
  ...request,
  id,
  cwd: "/target/home",
  generation: 1,
  startPhase: "ready",
  status: "running",
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  title: "Agent setup",
  resumeLine: "Synthetic setup terminal",
  settings: { perm: "own", typeFrom: "keyPaired", onQuit: "keep", windowMode: "open" },
})
const controller: ViewerState = {
  type: "viewer-state",
  generation: 1,
  controller: true,
  canType: true,
  canStop: true,
  canResize: true,
  canTakeControl: false,
}

test("install, native sign-in, cancellation and one-ready-agent continue through the selected machine's APIs", async () => {
  let available = false
  let signedIn = false
  let listed: RunWindow[] = []
  let notify = () => {}
  const health = mock(async (_agent?: NativeAgent) => [nativeHealth(available, signedIn)])
  const start = mock(async (request: RunStart) => {
    const run = runFor(request, `setup-${listed.length + 1}`)
    listed = [...listed, run]
    return run
  })
  const control = mock(async (id: string, _request: { action: string; generation: number }) => {
    listed = listed.map((run) => (run.id === id ? { ...run, status: "stopped" as const } : run))
    notify()
    return listed.find((run) => run.id === id)
  })
  const adapter: RunAdapter = {
    list: async () => listed,
    start,
    control,
    support: () => ({ supported: true, canStart: true }),
    subscribe: (changed) => {
      notify = changed
      return () => {
        notify = () => {}
      }
    },
    attach: (_run, options) => ({
      mount: async (root) => {
        root.textContent = "Native setup output"
        options.onViewer?.(controller)
      },
      focus: () => {},
      write: () => {},
      resize: () => {},
      setTheme: () => {},
      dispose: () => {},
      onInput: () => () => {},
    }),
  }
  const project = { id: "target-repo", name: "billing", paths: ["/srv/billing"], lastSeen: 1 }
  const choose = mock(async (path: string) => ({ project, path }))
  const folder = mock(async (path?: string) => ({
    path: path ?? "",
    checkout: path === "/srv/billing" ? path : null,
    parent: "/srv",
    directories: [],
    truncated: false,
    canInitialize: false,
  }))
  const api: SetupPageApi = {
    state: async () => ({
      licence: {
        state: "active",
        tier: "team",
        email: "person@example.test",
        expires: null,
        daysLeft: null,
        portal: "",
        buy: "",
      },
      agents: [],
      app: { folder: null, installed: false, cliOnly: true },
      entry: "/target/qualitylayer",
    }),
    licence: async () => {},
    finish: async () => {
      throw new Error("An existing CLI is not reinstalled")
    },
    agentSetup: async () => ({
      machine: "target-server",
      platform: "linux",
      agents: agentSetupCapabilities("linux", (agent) => agent === "claude-code"),
    }),
    agentHealth: health,
    checkAgents: health,
    agentSignIns: health,
    foundProjects: async () => [
      { path: "/srv/billing", sessions: 1, lastAt: 1, agents: [], recent: true },
    ],
    projectFolder: folder,
    chooseProjectFolder: choose,
  }
  const proceed = mock(() => {})
  const view = rtl.render(
    <RunProvider adapter={adapter}>
      <Setup api={api} onStartTask={proceed} />
    </RunProvider>,
  )
  const field = await view.findByLabelText("Project folder on target-server")
  rtl.fireEvent.change(field, { target: { value: "/srv/billing" } })
  const next = view.getByRole("button", { name: "Start a task" }) as HTMLButtonElement
  expect(next.disabled).toBe(true)
  rtl.fireEvent.click(await view.findByRole("button", { name: "Install" }))
  await view.findByText("Native setup output")
  expect(start.mock.calls[0]?.[0]).toMatchObject({
    agent: "other",
    purpose: {
      kind: "terminal",
      shell: true,
      context: { kind: "agent-setup", agent: "claude-code", operation: "install" },
    },
    settings: { perm: "own", answers: "terminal" },
  })
  expect(start.mock.calls[0]?.[0].cwd).toBeUndefined()
  available = true
  listed = listed.map((run) => ({ ...run, status: "stopped" }))
  rtl.act(notify)
  rtl.fireEvent.click(await view.findByRole("button", { name: "Sign in" }))
  await view.findByRole("button", { name: "Cancel sign-in" })
  rtl.fireEvent.click(view.getByRole("button", { name: "Cancel sign-in" }))
  await rtl.waitFor(() =>
    expect(control).toHaveBeenCalledWith("setup-2", { action: "stop", generation: 1 }),
  )
  expect(next.disabled).toBe(true)
  expect(proceed).not.toHaveBeenCalled()
  rtl.fireEvent.click(await view.findByRole("button", { name: "Sign in" }))
  await rtl.waitFor(() => expect(start).toHaveBeenCalledTimes(3))
  signedIn = true
  listed = listed.map((run) => ({ ...run, status: "stopped" }))
  rtl.act(notify)
  await rtl.waitFor(() => expect(next.disabled).toBe(false))
  rtl.fireEvent.change(field, { target: { value: "/srv/missing" } })
  rtl.fireEvent.click(next)
  await view.findByRole("alert")
  expect(proceed).not.toHaveBeenCalled()
  expect(choose).not.toHaveBeenCalled()
  rtl.fireEvent.change(field, { target: { value: "/srv/billing" } })
  rtl.fireEvent.click(next)
  await rtl.waitFor(() =>
    expect(proceed).toHaveBeenCalledWith({ project, path: "/srv/billing" }, "claude-code"),
  )
  expect(folder).toHaveBeenCalledWith("/srv/billing")
  expect(choose).toHaveBeenCalledWith("/srv/billing")
  expect(health.mock.calls.some(([agent]) => agent === "claude-code")).toBe(true)
  expect(view.container.querySelector(".msu-demo-controls")).toBeNull()
})

test("a watching setup terminal cannot type or Stop, and control is taken only by its explicit action", async () => {
  let options: TerminalOptions | undefined
  const focus = mock(() => {})
  const takeControl = mock(() => true)
  const stop = mock(async () => {})
  const adapter: RunAdapter = {
    list: async () => [],
    start: async () => {
      throw new Error("unused")
    },
    control: async () => undefined,
    attach: (_run, next) => {
      options = next
      return {
        mount: async () => {
          next.onControl?.(takeControl)
          next.onViewer?.({
            ...controller,
            controller: false,
            canType: false,
            canStop: false,
            canTakeControl: true,
          })
        },
        focus,
        write: () => {},
        resize: () => {},
        setTheme: () => {},
        dispose: () => {},
        onInput: () => () => {},
      }
    },
  }
  const run = runFor(
    {
      agent: "other",
      purpose: {
        kind: "terminal",
        shell: true,
        context: { kind: "agent-setup", agent: "codex", operation: "sign-in" },
      },
      idempotencyKey: "view",
    },
    "view",
  )
  const view = rtl.render(
    <MachineSetupTerminal
      run={run}
      adapter={adapter}
      machine="target"
      onClose={() => {}}
      onStop={stop}
    />,
  )
  const take = await view.findByRole("button", { name: "Type here instead" })
  expect(focus).not.toHaveBeenCalled()
  expect((view.getByRole("button", { name: "Cancel sign-in" }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  rtl.fireEvent.click(take)
  expect(takeControl).toHaveBeenCalledWith("take-control")
  rtl.act(() => options?.onViewer?.(controller))
  await rtl.waitFor(() => expect(focus).toHaveBeenCalledTimes(1))
  rtl.fireEvent.click(view.getByRole("button", { name: "Cancel sign-in" }))
  await rtl.waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
})
