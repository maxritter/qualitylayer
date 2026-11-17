// machines list · add · containers · snippet · nearby · status · pair · retry · trust · rename · remove:
// the App's Machines, by command, so an agent or a script pairs a machine the same way the App does.
// Every command asks this computer's server (started when it is not running) over its key-guarded
// routes, so a pairing started here shows in the App and one started there can be read here. A
// password is never an argument: in a terminal it is asked with the input hidden, and a script
// passes it on standard input (`--password-stdin`).

import { closeSync, openSync, readSync, writeSync } from "node:fs"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { ensureCockpit, type Lock } from "../../server/lock.ts"
import { snippetOf } from "../../server/machines/containers.ts"
import type { MachineView } from "../../server/machines/manager.ts"
import type { PairingView, StepView } from "../../server/machines/pairing.ts"

export const MACHINES_USAGE =
  "usage: qualitylayer machines list · add <user@host> [--name <name>] [--password-stdin] [--trust SHA256:…] · add --container <name> · containers · snippet [--port <n>] · nearby · status <name> · pair <name> · retry <name> · trust <name> [--fingerprint SHA256:…] · rename <name> <new name> · remove <name> [--release] [--keep-key]"

const bad = (message: string): Result<unknown> => err({ code: "bad_args", message })

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : args[at + 1]
}

type Asked = { ok: true; body: Record<string, unknown> } | { ok: false; message: string }

/** One request to this computer's server, with its key. */
async function ask(
  ctx: Ctx,
  lock: Lock,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 120_000,
): Promise<Asked> {
  try {
    const response = await ctx.http.fetch(`http://127.0.0.1:${lock.port}${path}`, {
      method,
      headers: {
        "x-qualitylayer-token": lock.token,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const said = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok || said.ok !== true)
      return {
        ok: false,
        message:
          typeof said.error === "string" ? said.error : `the server answered ${response.status}`,
      }
    return { ok: true, body: said }
  } catch (cause) {
    return {
      ok: false,
      message: `the server did not answer: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }
}

const STEP_WORDS: Record<StepView["key"], string> = {
  find: "Container",
  reach: "Reachable",
  key: "Key",
  config: "ssh config",
  system: "System",
  install: "QualityLayer",
  licence: "Licence",
  connect: "Connect",
}

const stateWords = (machine: MachineView): string =>
  machine.state === "connected"
    ? "connected"
    : machine.state === "needs-you"
      ? `key refused · machines pair ${machine.name}`
      : machine.state === "unknown-host"
        ? `host key changed · machines trust ${machine.name}`
        : machine.state === "connecting"
          ? "connecting"
          : `offline${machine.reason ? ` · ${machine.reason}` : ""}`

const say = (line: string) => process.stderr.write(`${line}\n`)

/** One line a terminal reads, the input hidden for a password. */
function prompt(question: string, hidden: boolean): string | null {
  let tty: number
  try {
    tty = openSync("/dev/tty", "r+")
  } catch {
    return null
  }
  try {
    if (hidden) Bun.spawnSync(["stty", "-echo"], { stdin: tty })
    writeSync(tty, question)
    const bytes: number[] = []
    const one = Buffer.alloc(1)
    while (readSync(tty, one, 0, 1, null) === 1) {
      const byte = one.readUInt8(0)
      if (byte === 10 || byte === 13) break
      bytes.push(byte)
    }
    return Buffer.from(bytes).toString("utf8")
  } finally {
    try {
      if (hidden) {
        Bun.spawnSync(["stty", "echo"], { stdin: tty })
        writeSync(tty, "\n")
      }
    } finally {
      closeSync(tty)
    }
  }
}

const interactive = (): boolean => process.stdin.isTTY === true || process.stderr.isTTY === true

/** Follow a pairing to its end, answering what it waits for; the stored machine, or why it stopped. */
async function follow(
  ctx: Ctx,
  lock: Lock,
  started: PairingView,
  args: string[],
): Promise<Result<unknown>> {
  let view = started
  const printed = new Map<string, string>()
  let piped: string | null | undefined = args.includes("--password-stdin") ? undefined : null
  const trust = flag(args, "trust")
  for (;;) {
    for (const step of view.steps) {
      const line =
        step.state === "done"
          ? `✓ ${STEP_WORDS[step.key].padEnd(13)}${step.detail}${step.warn ? "  (!)" : ""}`
          : step.state === "fail"
            ? `✗ ${STEP_WORDS[step.key].padEnd(13)}${step.fail?.cause ?? ""}\n  ${step.fail?.fix ?? ""}${step.fail?.said?.length ? `\n  ${step.fail.said.join("\n  ")}` : ""}`
            : null
      if (line !== null && printed.get(step.key) !== line) {
        printed.set(step.key, line)
        say(line)
      }
    }
    if (view.state === "done")
      return ok({
        paired: true,
        machine: view.machine,
        printed: `${view.name} is paired. Open it in the App's machine switcher.`,
      })
    if (view.state === "failed") {
      const failed = view.steps.find((step) => step.state === "fail")
      return err({
        code: "bad_args",
        message: `${view.name} was not paired: ${failed?.fail?.cause ?? "it stopped"}. ${failed?.fail?.fix ?? ""}${failed?.fail?.again ? ` (run the same command again to try again)` : ""}`,
      })
    }
    if (view.state === "waiting" && view.waiting !== undefined) {
      const waiting = view.waiting
      let reply: string | null = null
      if (waiting.for === "password") {
        if (
          trust !== undefined &&
          waiting.hostKey !== null &&
          !waiting.hostKey.endsWith(trust.replace(/^\S+\s/, ""))
        ) {
          await ask(ctx, lock, "POST", `/api/machines/pairings/${view.id}/cancel`)
          return bad(
            `${view.name} shows the host key ${waiting.hostKey}, not ${trust}. Nothing was changed.`,
          )
        }
        if (piped === undefined) piped = (await Bun.stdin.text()).split("\n")[0] ?? ""
        if (piped !== null) {
          if (waiting.wrong) {
            await ask(ctx, lock, "POST", `/api/machines/pairings/${view.id}/cancel`)
            return bad(`The password for ${waiting.target} was not accepted. Nothing was changed.`)
          }
          reply = piped
        } else if (interactive()) {
          if (!waiting.wrong) {
            say(`  ${"Host key".padEnd(13)}${waiting.hostKey ?? "(read through your ssh config)"}`)
            say(`  ${"Key".padEnd(13)}${waiting.key} · copied once, the password is never stored`)
          } else say("  Not accepted · try again")
          reply = prompt(`  Password for ${waiting.target}: `, true)
        }
        if (reply === null) {
          await ask(ctx, lock, "POST", `/api/machines/pairings/${view.id}/cancel`)
          return bad(
            `${waiting.target} needs its password once. Run this in a terminal, or pass it with --password-stdin.`,
          )
        }
      } else if (waiting.for === "code") {
        reply = interactive() ? prompt(`  ${waiting.prompt} `, true) : null
        if (reply === null) {
          await ask(ctx, lock, "POST", `/api/machines/pairings/${view.id}/cancel`)
          return bad(
            `${waiting.target} asks "${waiting.prompt}". Run this in a terminal to answer it.`,
          )
        }
      } else {
        say(`  ${waiting.target} takes keys only. Copy the key in a terminal once:`)
        say(`    ${waiting.command}`)
        if (!interactive()) {
          await ask(ctx, lock, "POST", `/api/machines/pairings/${view.id}/cancel`)
          return bad(`Run \`${waiting.command}\` once, then the same command again.`)
        }
        reply = prompt("  Press Enter once it is copied (or type stop): ", false)
        if (reply === null || reply.trim() === "stop") {
          await ask(ctx, lock, "POST", `/api/machines/pairings/${view.id}/cancel`)
          return bad("Stopped. Nothing else was changed.")
        }
        reply = ""
      }
      const answered = await ask(ctx, lock, "POST", `/api/machines/pairings/${view.id}/answer`, {
        text: reply,
      })
      reply = null
      if (!answered.ok) return bad(answered.message)
    }
    await Bun.sleep(500)
    const read = await ask(ctx, lock, "GET", `/api/machines/pairings/${view.id}`)
    if (!read.ok) return bad(read.message)
    view = read.body.pairing as PairingView
  }
}

async function machineNamed(
  ctx: Ctx,
  lock: Lock,
  name: string | undefined,
): Promise<MachineView | Result<unknown>> {
  if (name === undefined || name === "") return bad(MACHINES_USAGE)
  const listed = await ask(ctx, lock, "GET", "/api/machines")
  if (!listed.ok) return bad(listed.message)
  const machines = (listed.body.machines ?? []) as MachineView[]
  const found = machines.find((one) => one.id === name || one.name === name || one.target === name)
  return found ?? bad(`No machine is called ${name}. \`qualitylayer machines list\` shows them.`)
}

export async function machinesCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub, ...rest] = args
  if (sub === undefined || sub === "help" || sub === "--help") return bad(MACHINES_USAGE)
  // The snippet needs no server: it is the same lines the App shows.
  if (sub === "snippet") {
    const port = Number(flag(rest, "port") ?? 2222)
    if (!Number.isInteger(port) || port < 1024 || port > 65_535)
      return bad("--port takes a port from 1024 to 65535")
    const text = snippetOf(port)
    return ok({
      port,
      snippet: text,
      printed: `${text}\n\nPut these lines in .devcontainer/devcontainer.json, rebuild the container, then: qualitylayer machines add --container <name>`,
    })
  }
  const lock = await ensureCockpit(ctx, { explicit: false })
  if (lock === null) return bad("This computer's QualityLayer server could not be started.")

  if (sub === "list") {
    const listed = await ask(ctx, lock, "GET", "/api/machines")
    if (!listed.ok) return bad(listed.message)
    const machines = (listed.body.machines ?? []) as MachineView[]
    return ok({
      machines,
      printed:
        machines.length === 0
          ? "No machines yet. Add one: qualitylayer machines add <user@host>"
          : machines.map((one) => `${one.name}  ${one.target}  ${stateWords(one)}`).join("\n"),
    })
  }
  if (sub === "containers") {
    const listed = await ask(ctx, lock, "GET", "/api/machines/containers")
    if (!listed.ok) return bad(listed.message)
    if (listed.body.docker !== true)
      return ok({
        docker: false,
        message: `${listed.body.reason ?? "No Docker found"}. Start Docker or OrbStack.`,
      })
    const found = (listed.body.containers ?? []) as {
      name: string
      folder: string
      port: number | null
      added: boolean
    }[]
    return ok({
      ...listed.body,
      printed:
        found.length === 0
          ? `No running dev containers (${listed.body.engine}).`
          : found
              .map(
                (one) =>
                  `${one.name}  ${one.folder}  ${one.added ? "added" : one.port === null ? "needs ssh · qualitylayer machines snippet" : `ssh on ${one.port} · qualitylayer machines add --container ${one.name}`}`,
              )
              .join("\n"),
    })
  }
  if (sub === "nearby") {
    const listed = await ask(ctx, lock, "GET", "/api/machines/nearby")
    if (!listed.ok) return bad(listed.message)
    const found = (listed.body.nearby ?? []) as { host: string; user: string }[]
    return ok({
      nearby: found,
      printed:
        found.length === 0
          ? "No computers nearby announce ssh."
          : found.map((one) => `${one.user}@${one.host}`).join("\n"),
    })
  }
  if (sub === "add") {
    const container = flag(rest, "container")
    const target = rest.find(
      (arg, at) =>
        !arg.startsWith("--") && !["--name", "--trust", "--container"].includes(rest[at - 1] ?? ""),
    )
    if (container === undefined && target === undefined) return bad(MACHINES_USAGE)
    const started = await ask(
      ctx,
      lock,
      "POST",
      "/api/machines/pairings",
      container !== undefined ? { container } : { target, name: flag(rest, "name") ?? "" },
    )
    if (!started.ok) return bad(started.message)
    return follow(ctx, lock, started.body.pairing as PairingView, rest)
  }

  const named = await machineNamed(ctx, lock, rest[0])
  if ("ok" in named) return named
  const machine = named
  const path = `/api/machines/${encodeURIComponent(machine.id)}`
  if (sub === "status")
    return ok({ machine, printed: `${machine.name}  ${machine.target}  ${stateWords(machine)}` })
  if (sub === "pair") {
    const started = await ask(ctx, lock, "POST", "/api/machines/pairings", { machine: machine.id })
    if (!started.ok) return bad(started.message)
    return follow(ctx, lock, started.body.pairing as PairingView, rest.slice(1))
  }
  if (sub === "retry") {
    const done = await ask(ctx, lock, "POST", `${path}/retry`)
    return done.ok ? ok({ message: `Trying ${machine.name} now.` }) : bad(done.message)
  }
  if (sub === "trust") {
    const look = await ask(ctx, lock, "GET", `${path}/host-key`)
    if (!look.ok) return bad(look.message)
    const shown = String(look.body.fingerprint)
    const given = flag(rest, "fingerprint")
    if (given === undefined) {
      if (look.body.changed !== true)
        return ok({
          fingerprint: shown,
          message: `${machine.name} shows ${shown}, the key ssh knows.`,
        })
      if (!interactive())
        return bad(
          `${machine.name}'s host key changed; it shows ${shown}. If it was reinstalled, run: qualitylayer machines trust ${machine.name} --fingerprint ${shown.split(" ").pop()}`,
        )
      const sure = prompt(
        `  ${machine.name} now shows ${shown}. Reinstalled? Trust it [y/N]: `,
        false,
      )
      if (sure?.trim().toLowerCase() !== "y") return bad("Not trusted. Nothing was changed.")
    } else if (!shown.endsWith(given.replace(/^\S+\s/, "")))
      return bad(`${machine.name} shows ${shown}, not ${given}. Nothing was changed.`)
    const done = await ask(ctx, lock, "POST", `${path}/host-key`, { fingerprint: shown })
    return done.ok
      ? ok({ message: `Trusted ${shown} for ${machine.name}; connecting.` })
      : bad(done.message)
  }
  if (sub === "rename") {
    const name = rest.slice(1).join(" ").trim()
    if (name === "") return bad(MACHINES_USAGE)
    const done = await ask(ctx, lock, "PATCH", path, { name })
    return done.ok ? ok({ message: `${machine.name} is now called ${name}.` }) : bad(done.message)
  }
  if (sub === "remove") {
    const release = rest.includes("--release")
    const done = await ask(
      ctx,
      lock,
      "DELETE",
      path,
      { release, keepKey: rest.includes("--keep-key") },
      240_000,
    )
    return done.ok
      ? ok({
          ...done.body,
          printed: `${machine.name} removed${release ? "; its activation is released" : ""}${done.body.keyRemoved ? "; QualityLayer's key is off it" : ""}.`,
        })
      : bad(done.message)
  }
  return bad(MACHINES_USAGE)
}
