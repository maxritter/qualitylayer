import { afterAll, afterEach, expect, mock, test } from "bun:test"
import { useState } from "react"
import { type Config, DEFAULT_CONFIG } from "../../src/core/config-values.ts"
import type { RunAdapter, RunWindow } from "../../src/ui/run-context.tsx"
import { mountDom, unmountDom } from "../helpers/dom.ts"
import { chooseOption } from "../helpers/select.ts"
import { detail } from "../helpers/uiFixtures.ts"

const rtl = await mountDom()
const { RunProvider } = await import("../../src/ui/run-context.tsx")
const { AgentSwitchDialog, StoppedAgentSwitch } = await import("../../src/ui/run/AgentSwitch.tsx")
const { canSwitchTaskAgent, continueInAnotherAgent } = await import(
  "../../src/ui/run/agent-switch.ts"
)
const { taskAgentDefaults, taskAgentRequest } = await import("../../src/ui/run/task-launch.ts")

afterEach(() => {
  rtl.cleanup()
  localStorage.clear()
  sessionStorage.clear()
})
afterAll(() => unmountDom(rtl))

const task = () =>
  detail({ id: "project~task", type: "feature", stage: "implement", checkout: "/fixture/project" })
const run = (patch: Partial<RunWindow> = {}): RunWindow => ({
  id: "previous",
  agent: "claude-code",
  task: "project~task",
  purpose: { kind: "task", task: "project~task" },
  cwd: "/fixture/project",
  nativeSession: "previous-native",
  generation: 3,
  status: "running",
  startPhase: "ready",
  startedAt: "2026-11-16T10:00:00Z",
  updatedAt: "2026-11-16T10:00:00Z",
  idempotencyKey: "previous-start",
  title: "Existing task",
  resumeLine: "fixture resume",
  ...patch,
})
const ended = (previous: RunWindow) => ({
  ...previous,
  status: "stopped" as const,
  cleanup: {
    complete: true,
    remaining: [],
    unverified: [],
    errors: [],
    at: "2026-11-16T10:05:00Z",
  },
})
const request = () => ({
  ...taskAgentRequest(task(), { agent: "codex", model: "", effort: "high", runWhere: "app" }),
  idempotencyKey: "deliberate-new-conversation",
})
function pending<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("switching waits for confirmed old exit and starts one fresh conversation on the same task", async () => {
  const previous = run(),
    stopped = pending<RunWindow>()
  const start = mock(async (_request: Parameters<RunAdapter["start"]>[0]) =>
    run({ id: "replacement", agent: "codex", nativeSession: "new-native" }),
  )
  const control = mock(async () => stopped.promise)
  const starting = mock(() => {})
  const before = JSON.stringify(previous)
  const result = continueInAnotherAgent({
    previous,
    request: request(),
    control,
    start,
    cancelled: () => false,
    onStarting: starting,
  })
  expect(control).toHaveBeenCalledWith(previous.id, { action: "stop", generation: 3 })
  expect(start).not.toHaveBeenCalled()
  stopped.resolve(ended(previous))
  const next = await result
  expect(start).toHaveBeenCalledTimes(1)
  expect(start.mock.calls[0]?.[0]).toMatchObject({
    agent: "codex",
    cwd: previous.cwd,
    purpose: { kind: "task", task: previous.task },
    works: "checkout",
  })
  expect(next?.nativeSession).not.toBe(previous.nativeSession)
  expect(JSON.stringify(previous)).toBe(before)
  expect(starting).toHaveBeenCalledTimes(1)
})

test("a cancelled stop never starts its replacement after the old process eventually ends", async () => {
  const previous = run(),
    stopped = pending<RunWindow>()
  let cancelled = false
  const start = mock(async () => run({ id: "replacement" }))
  const result = continueInAnotherAgent({
    previous,
    request: request(),
    control: async () => stopped.promise,
    start,
    cancelled: () => cancelled,
    onStarting: () => {},
  })
  cancelled = true
  stopped.resolve(ended(previous))
  expect(await result).toBeUndefined()
  expect(start).not.toHaveBeenCalled()
})

test("unconfirmed stop and changed old identity cannot create a replacement", async () => {
  const previous = run()
  for (const stopped of [
    undefined,
    run(),
    run({ status: "stopping" }),
    ended(run({ generation: 4 })),
    ended(run({ nativeSession: "other-native" })),
  ]) {
    const start = mock(async () => run({ id: "replacement" }))
    await expect(
      continueInAnotherAgent({
        previous,
        request: request(),
        control: async () => stopped,
        start,
        cancelled: () => false,
        onStarting: () => {},
      }),
    ).rejects.toThrow()
    expect(start).not.toHaveBeenCalled()
  }
})

test("wrong task, changed checkout and same-agent choices are refused before stopping anything", async () => {
  for (const patch of [
    { agent: "claude-code" as const },
    { cwd: "/another/project" },
    { purpose: { kind: "task" as const, task: "project~other" } },
  ]) {
    const control = mock(async () => ended(run()))
    await expect(
      continueInAnotherAgent({
        previous: run(),
        request: { ...request(), ...patch },
        control,
        start: async () => run(),
        cancelled: () => false,
        onStarting: () => {},
      }),
    ).rejects.toThrow()
    expect(control).not.toHaveBeenCalled()
  }
})

test("unsupported and historical tasks retain their existing continuation boundaries", () => {
  expect(canSwitchTaskAgent(task(), run())).toBe(true)
  for (const patch of [
    { archived: true },
    { earlier: true as const },
    { type: "chat" as const },
    { stage: "abandoned" as const },
  ])
    expect(canSwitchTaskAgent(detail({ ...task(), ...patch }), run())).toBe(false)
  expect(canSwitchTaskAgent(task(), run({ task: "project~other" }))).toBe(false)
  expect(canSwitchTaskAgent(task(), run({ purpose: { kind: "terminal" } }))).toBe(false)
  expect(
    canSwitchTaskAgent(
      task(),
      run({ purpose: { kind: "task", task: task().id, phase: "planning" } }),
    ),
  ).toBe(false)
  const planning = detail({ ...task(), stage: "plan", gate: null })
  expect(
    canSwitchTaskAgent(
      planning,
      run({ purpose: { kind: "task", task: task().id, phase: "planning" } }),
    ),
  ).toBe(true)
})

const installed = (["claude-code", "codex"] as const).map((agent) => ({
  agent,
  label: agent,
  file: "fixture settings",
  models: [],
  current: null,
  recommended: "",
  effort: null,
  efforts: [],
  runnable: true,
}))

function mountChooser(
  control: RunAdapter["control"],
  start: RunAdapter["start"],
  options: { canConfigure?: boolean; config?: Config } = {},
) {
  const previous = run()
  const config = options.config ?? structuredClone(DEFAULT_CONFIG)
  const configBefore = JSON.stringify(config)
  const started = mock(() => {})
  const adapter: RunAdapter = {
    list: async () => [previous],
    control,
    start,
    attach: () => {
      throw new Error("The switch chooser must not attach a terminal")
    },
    support: () => ({
      supported: true,
      canStart: true,
      canConfigure: options.canConfigure ?? true,
    }),
  }
  function Harness() {
    const [open, setOpen] = useState(true)
    return (
      <RunProvider adapter={adapter}>
        {open ? (
          <AgentSwitchDialog
            task={task()}
            previous={previous}
            config={config}
            installed={installed}
            onClose={() => setOpen(false)}
            onStarted={started}
          />
        ) : (
          <p>Chooser closed</p>
        )}
      </RunProvider>
    )
  }
  return { view: rtl.render(<Harness />), config, configBefore, started }
}

test("Cancel during the real chooser's pending Stop closes it without launching", async () => {
  const stop = pending<RunWindow>()
  const start = mock(async () => run({ id: "replacement", agent: "codex" }))
  const f = mountChooser(async () => stop.promise, start)
  const button = f.view.getByRole("button", { name: "Stop & continue with Codex" })
  await rtl.waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  rtl.fireEvent.click(button)
  await f.view.findByRole("status")
  rtl.fireEvent.click(f.view.getByRole("button", { name: "Cancel" }))
  await f.view.findByText("Chooser closed")
  await rtl.act(async () => {
    stop.resolve(ended(run()))
    await stop.promise
  })
  expect(start).not.toHaveBeenCalled()
  expect(JSON.stringify(f.config)).toBe(f.configBefore)
})

test("a rejected Start keeps the selected agent and error, without fallback or settings mutation", async () => {
  const start = mock(async () => {
    throw new Error("Codex could not start")
  })
  const f = mountChooser(async () => ended(run()), start)
  const button = f.view.getByRole("button", { name: "Stop & continue with Codex" })
  await rtl.waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  rtl.fireEvent.click(button)
  await f.view.findByRole("alert")
  expect(f.view.getByRole("alert").textContent).toContain("Codex could not start")
  expect(f.view.getByRole("combobox", { name: "Continue task: agent" }).textContent).toContain(
    "Codex",
  )
  expect(start).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(f.config)).toBe(f.configBefore)
})

test("a window without configure authority cannot change new-conversation permissions", async () => {
  const control = mock(async () => ended(run()))
  const start = mock(async () => run({ id: "replacement", agent: "codex" }))
  const f = mountChooser(control, start, { canConfigure: false })
  const permission = f.view.getByRole("combobox", {
    name: "New conversation permissions",
  }) as HTMLButtonElement
  expect(permission.disabled).toBe(true)
  rtl.fireEvent.keyDown(permission, { key: "ArrowDown" })
  expect(rtl.within(document.body).queryByRole("listbox")).toBeNull()
  expect(control).not.toHaveBeenCalled()
  expect(start).not.toHaveBeenCalled()
})

test("the configured inherited model is marked Default instead of the static catalog recommendation", async () => {
  const config = structuredClone(DEFAULT_CONFIG)
  config.implement.defaults.codex.orchestrator = ""
  const f = mountChooser(
    async () => ended(run()),
    async () => run(),
    { config },
  )
  const model = f.view.getByRole("combobox", { name: "Continue task: model" })
  await rtl.waitFor(() => expect((model as HTMLButtonElement).disabled).toBe(false))
  rtl.fireEvent.keyDown(model, { key: "ArrowDown" })
  const list = await rtl.within(document.body).findByRole("listbox")
  const own = rtl.within(list).getByRole("option", { name: "Agent’s settings" })
  expect(rtl.within(own).getByText("Default")).toBeTruthy()
  expect(rtl.within(list).getAllByText("Default")).toHaveLength(1)
  expect(JSON.stringify(f.config)).toBe(f.configBefore)
})

test("Bypass requires explicit per-conversation confirmation before any Stop or Start", async () => {
  const control = mock(async () => ended(run()))
  const start = mock(async (_request: Parameters<RunAdapter["start"]>[0]) =>
    run({ id: "replacement", agent: "codex", nativeSession: "new-native" }),
  )
  const f = mountChooser(control, start)
  const pick = f.view.getByRole("combobox", { name: "New conversation permissions" })
  await rtl.waitFor(() => expect((pick as HTMLButtonElement).disabled).toBe(false))
  rtl.fireEvent.keyDown(pick, { key: "ArrowDown" })
  await rtl.within(document.body).findByRole("listbox")
  const option = rtl.within(document.body).getByRole("option", { name: /Full access/ })
  chooseOption(rtl, option)
  const button = f.view.getByRole("button", { name: "Stop & continue with Codex" })
  expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(control).not.toHaveBeenCalled()
  rtl.fireEvent.click(f.view.getByRole("button", { name: "Use for this conversation" }))
  await rtl.waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  rtl.fireEvent.click(button)
  await f.view.findByText("Chooser closed")
  expect(start).toHaveBeenCalledTimes(1)
  expect(start.mock.calls[0]?.[0]).toMatchObject({
    confirmBypass: true,
    settings: { permMode: "full-access" },
  })
  expect(JSON.stringify(f.config)).toBe(f.configBefore)
})

test("a quota-stopped entry keeps the reported error and opens history without resuming", async () => {
  const control = mock(async () => ended(run()))
  const history = mock(() => {})
  const previous = run({
    status: "stopped",
    error: "Your reported usage limit was reached",
    canResume: true,
  })
  const adapter: RunAdapter = {
    list: async () => [previous],
    start: async () => run(),
    control,
    attach: () => {
      throw new Error("No terminal requested")
    },
  }
  const view = rtl.render(
    <RunProvider adapter={adapter}>
      <StoppedAgentSwitch run={previous} onSwitch={() => {}} onHistory={history} />
    </RunProvider>,
  )
  expect(view.getByRole("alert").textContent).toContain("reported usage limit")
  rtl.fireEvent.click(view.getByRole("button", { name: "Read previous conversation" }))
  expect(history).toHaveBeenCalledTimes(1)
  expect(control).not.toHaveBeenCalled()
})

test("launch selection is request-local and never creates a new task or resumes old native history", () => {
  const current = task(),
    config = structuredClone(DEFAULT_CONFIG),
    before = JSON.stringify({ current, config })
  const values = {
    agent: "codex" as const,
    ...taskAgentDefaults(current, config, "codex"),
    runWhere: "app" as const,
  }
  const next = taskAgentRequest(current, values)
  expect(next).toMatchObject({
    purpose: { kind: "task", task: current.id },
    cwd: current.checkout,
    works: "checkout",
    mode: "plain",
  })
  expect(next).not.toHaveProperty("allocateTask")
  expect(next).not.toHaveProperty("nativeSession")
  expect(JSON.stringify({ current, config })).toBe(before)
})
