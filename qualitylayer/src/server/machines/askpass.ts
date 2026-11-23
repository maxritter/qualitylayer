/**
 * Copy QualityLayer's public key to a machine with the person's password, once. ssh asks for the
 * password through SSH_ASKPASS (`SSH_ASKPASS_REQUIRE=force`): a small script in an owner-only folder
 * writes ssh's own prompt to a file and reads the answer from a named pipe, which this server fills
 * from memory. The password is never written to a file, a log, an argument or the environment; it
 * goes through the pipe to ssh and is dropped. A further prompt (a code) is handed to `ask` with
 * ssh's own words. Only the public key travels, on standard input, into authorized_keys there.
 */

import { randomBytes } from "node:crypto"
import {
  chmodSync,
  constants,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { open } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LocalRun } from "./local.ts"

export type Copied =
  | { ok: true }
  /** `wrong`: the password was not accepted; `keys-only`: the machine asked for none. */
  | { ok: false; why: "wrong" | "keys-only" | "failed"; said: string }

export type CopyRequest = {
  program: string
  configFile?: string
  /** `user@host`, as ssh is given it. */
  target: string
  port: number
  /** The shown host keys, or native known_hosts rules when the destination already has config. */
  knownHosts?: string
  /** The script the machine runs with `sh -s`. */
  script: string
  password: string
  /** A prompt after the password (a code): the person's answer, or null to stop. */
  ask(prompt: string): Promise<string | null>
  /** Where the pipe's folder may lie (short: macOS limits a socket path, and this keeps it near). */
  under?: string
}

const ESC = String.fromCharCode(27)
const plain = (text: string): string =>
  Array.from(text.replace(new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, "g"), ""))
    .filter((char) => (char.codePointAt(0) ?? 0) >= 32 || char === "\n")
    .join("")
    .trim()
    .slice(0, 200)

/** Fill the pipe once; a reader that already gave up never holds this open. */
async function answer(pipe: string, text: string): Promise<void> {
  const handle = await open(pipe, constants.O_RDWR | constants.O_NONBLOCK)
  try {
    await handle.write(`${text}\n`)
  } finally {
    // The reader has the line in the pipe's buffer; closing our end leaves it the end of input.
    // A second later: the script opens the pipe right after it wrote its prompt.
    setTimeout(() => void handle.close(), 1500)
  }
}

type PromptWatchState = {
  asked: number
  ended: boolean
  stopped: boolean
  wrongAgain: boolean
}

function buildSshArgs(request: CopyRequest, known: string): string[] {
  return [
    request.program,
    ...(request.configFile ? ["-F", request.configFile] : []),
    "-o",
    "BatchMode=no",
    "-o",
    "StrictHostKeyChecking=yes",
    ...(request.knownHosts === undefined
      ? []
      : ["-o", `UserKnownHostsFile=${known}`, "-o", "GlobalKnownHostsFile=/dev/null"]),
    "-o",
    "PubkeyAuthentication=no",
    "-o",
    "PreferredAuthentications=keyboard-interactive,password",
    "-o",
    "NumberOfPasswordPrompts=1",
    "-o",
    "ConnectTimeout=10",
    "-p",
    String(request.port),
    "-T",
    request.target,
    "sh",
    "-s",
  ]
}

type PromptWatchContext = {
  folder: string
  pipe: string
  child: { kill(): void }
  request: CopyRequest
  state: PromptWatchState
}

async function handlePromptFile(watch: PromptWatchContext, name: string): Promise<boolean> {
  let prompt = ""
  try {
    prompt = plain(readFileSync(join(watch.folder, name), "utf8"))
  } catch {
    return true
  }
  watch.state.asked += 1
  // A second password prompt is ssh trying its next way after a refused password
  // (keyboard-interactive, then password): the password was wrong.
  if (watch.state.asked > 1 && /password/i.test(prompt)) {
    watch.state.wrongAgain = true
    watch.child.kill()
    return false
  }
  const reply =
    watch.state.asked === 1 && /pass/i.test(prompt)
      ? watch.request.password
      : await watch.request.ask(prompt)
  if (reply === null) {
    watch.state.stopped = true
    watch.child.kill()
    return false
  }
  await answer(watch.pipe, reply)
  return true
}

async function watchAskpassPrompts(watch: PromptWatchContext): Promise<void> {
  const seen = new Set<string>()
  while (!watch.state.ended) {
    const names = readdirSync(watch.folder).filter(
      (one) => one.startsWith("prompt.") && !seen.has(one),
    )
    for (const name of names) {
      seen.add(name)
      const keepGoing = await handlePromptFile(watch, name)
      if (!keepGoing) return
    }
    await Bun.sleep(80)
  }
}

function classifyCopyOutcome(code: number, state: PromptWatchState, said: string): Copied {
  if (code === 0) return { ok: true }
  if (state.wrongAgain) return { ok: false, why: "wrong", said: "Permission denied" }
  if (state.stopped) return { ok: false, why: "failed", said: "Stopped" }
  if (/permission denied/i.test(said))
    return { ok: false, why: state.asked === 0 ? "keys-only" : "wrong", said }
  return { ok: false, why: "failed", said: said.split("\n").at(-1) ?? said }
}

export async function copyKeyWithPassword(
  local: LocalRun,
  request: CopyRequest,
  spawn: typeof Bun.spawn = Bun.spawn,
): Promise<Copied> {
  const folder = join(request.under ?? tmpdir(), `ql-pw-${randomBytes(6).toString("hex")}`)
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  chmodSync(folder, 0o700)
  const pipe = join(folder, "answer")
  const known = join(folder, "known_hosts")
  const script = join(folder, "askpass")
  try {
    const made = await local(["mkfifo", "-m", "600", pipe], { timeoutMs: 5000 })
    if (made.code !== 0) return { ok: false, why: "failed", said: "mkfifo is missing here" }
    if (request.knownHosts !== undefined) writeFileSync(known, request.knownHosts, { mode: 0o600 })
    writeFileSync(
      script,
      `#!/bin/sh\nprintf '%s' "$1" > "${folder}/prompt.$$"\nexec cat "${pipe}"\n`,
      { mode: 0o700 },
    )
    const child = spawn(buildSshArgs(request, known), {
      stdin: new TextEncoder().encode(request.script),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        SSH_ASKPASS: script,
        SSH_ASKPASS_REQUIRE: "force",
        DISPLAY: process.env.DISPLAY ?? ":0",
      },
    })
    const state: PromptWatchState = { asked: 0, ended: false, stopped: false, wrongAgain: false }
    const exited = child.exited.then((code) => {
      state.ended = true
      return code
    })
    // ssh's prompts, one file each, answered in turn: the first password one with the password.
    const watch = watchAskpassPrompts({ folder, pipe, child, request, state })
    const timer = setTimeout(() => child.kill(), 5 * 60_000)
    const code = await exited
    clearTimeout(timer)
    await watch
    // An askpass still waiting on the pipe holds ssh's error output open: it ends first.
    await answer(pipe, "").catch(() => {})
    const said = plain(
      await Promise.race([
        new Response(child.stderr as ReadableStream).text(),
        Bun.sleep(3000).then(() => ""),
      ]),
    )
    return classifyCopyOutcome(code, state, said)
  } finally {
    // A reader still waiting on the pipe gets its end of input, then the folder goes.
    await answer(pipe, "").catch(() => {})
    rmSync(folder, { recursive: true, force: true })
  }
}
