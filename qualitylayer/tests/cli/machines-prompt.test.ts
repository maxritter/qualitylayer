import { afterAll, afterEach, expect, mock, test } from "bun:test"
import * as nativeFs from "node:fs"
import type { Ctx } from "../../src/ctx.ts"

const originalFs = { ...nativeFs }
const terminal = 1234567
let input = Buffer.alloc(0)
let offset = 0
let readFailure = false
let newlineFailure = false
let shownWhileEchoing = false
const closed: number[] = []
const echo: string[] = []
const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")

mock.module("node:fs", () => ({
  ...originalFs,
  openSync: (...args: Parameters<typeof nativeFs.openSync>) =>
    args[0] === "/dev/tty" ? terminal : originalFs.openSync(...args),
  readSync: (fd: number, buffer: Buffer) => {
    if (fd !== terminal) throw new Error("Unexpected fixture descriptor")
    if (readFailure) throw new Error("Fixture terminal read failed")
    if (offset === input.length) return 0
    buffer[0] = input[offset++] as number
    return 1
  },
  writeSync: (fd: number, text: string) => {
    if (fd !== terminal) throw new Error("Unexpected fixture descriptor")
    if (text !== "\n" && echo.at(-1) !== "-echo") shownWhileEchoing = true
    if (newlineFailure && text === "\n") throw new Error("Fixture terminal write failed")
    return Buffer.byteLength(text)
  },
  closeSync: (fd: number) => {
    if (fd !== terminal) throw new Error("Unexpected fixture descriptor")
    closed.push(fd)
  },
}))
mock.module("../../src/server/lock.ts", () => ({
  ensureCockpit: async () => ({ port: 41200, token: "fixture-machine-token" }),
}))
const { machinesCmd } = await import("../../src/cli/commands/machines.ts")
const spawnSync = Bun.spawnSync
Bun.spawnSync = ((args: string[]) => {
  if (args[0] !== "stty") throw new Error("Only fixture echo control is allowed")
  echo.push(args[1] as string)
  return { exitCode: 0 }
}) as typeof Bun.spawnSync
Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true })

afterEach(() => {
  input = Buffer.alloc(0)
  offset = 0
  readFailure = false
  newlineFailure = false
  shownWhileEchoing = false
  closed.length = 0
  echo.length = 0
})
afterAll(() => {
  Bun.spawnSync = spawnSync
  if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty)
  else Reflect.deleteProperty(process.stdin, "isTTY")
})

function fixture(kind: "password" | "code" = "password") {
  const received: string[] = []
  const waiting = {
    id: "fixture-pairing",
    name: "fixture-machine",
    state: "waiting",
    steps: [],
    waiting:
      kind === "password"
        ? { for: "password", target: "user@fixture", hostKey: null, key: "fixture-key" }
        : { for: "code", target: "user@fixture", prompt: "Verification code:" },
  }
  const ctx = {
    http: {
      fetch: async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname
        if (path.endsWith("/answer")) {
          received.push((JSON.parse(String(init.body)) as { text: string }).text)
          return Response.json({ ok: true })
        }
        if (init.method === "POST" && path === "/api/machines/pairings")
          return Response.json({ ok: true, pairing: waiting })
        if (init.method === "GET" && path === "/api/machines/pairings/fixture-pairing")
          return Response.json({ ok: true, pairing: { ...waiting, state: "done", machine: {} } })
        throw new Error(`Unexpected fixture request: ${path}`)
      },
    },
  } as unknown as Ctx
  return { received, run: () => machinesCmd(ctx, ["add", "user@fixture"]) }
}

for (const kind of ["password", "code"] as const)
  test(`${kind} preserves UTF-8 and closes only its prompt-owned terminal`, async () => {
    input = Buffer.from("pässwörd 東京\n")
    const world = fixture(kind)
    expect((await world.run()).ok).toBe(true)
    expect(world.received).toEqual(["pässwörd 東京"])
    expect(shownWhileEchoing).toBe(false)
    expect(echo).toEqual(["-echo", "echo"])
    expect(closed).toEqual([terminal])
  })

test("a terminal read failure restores echo and closes its descriptor", async () => {
  readFailure = true
  await expect(fixture().run()).rejects.toThrow("Fixture terminal read failed")
  expect(echo).toEqual(["-echo", "echo"])
  expect(closed).toEqual([terminal])
})

test("the terminal closes even when the echo-restoration newline cannot be written", async () => {
  input = Buffer.from("ascii\n")
  newlineFailure = true
  await expect(fixture().run()).rejects.toThrow("Fixture terminal write failed")
  expect(echo).toEqual(["-echo", "echo"])
  expect(closed).toEqual([terminal])
})
