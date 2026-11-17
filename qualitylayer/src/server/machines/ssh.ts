/**
 * The one place that starts the system's `ssh` for a machine. Every start is an argument array
 * (never a shell string), without a terminal: `BatchMode=yes` so ssh never asks, a connect timeout
 * so it never hangs, and no host-key override, so an unknown host stays the person's decision.
 */

import { createHash } from "node:crypto"
import { chmodSync, existsSync, lstatSync, mkdirSync, rmSync } from "node:fs"
import { connect } from "node:net"
import { join } from "node:path"
import type { Failure } from "./connection.ts"
import type { LocalEnd } from "./pass-headers.ts"
import { isMachineId, isTarget, splitTarget } from "./store.ts"

/** A started ssh, as much of it as the runner uses. */
export interface Child {
  exited: Promise<number>
  out: Promise<string>
  err: Promise<string>
  kill(): void
}

/** Starts a program from an argument array; `stdin` is what it reads, or null for nothing. */
export type Spawn = (argv: string[], stdin: string | null) => Child

export interface SshDeps {
  spawn: Spawn
  /** QualityLayer's home on this computer; the forwards' socket files live under it. */
  home: string
  platform: NodeJS.Platform
  log(line: string): void
  /** Whether a forward's local end takes a connection. */
  reachable(end: LocalEnd): Promise<boolean>
  /** The program to start; `ssh` from the PATH when not named. */
  program?: string
  /** Options before all others, for a run with its own ssh config (`-F <file>`). */
  options?: string[]
  /** How long a forward may take to come up. */
  upWithinMs?: number
}

export type Failed = { ok: false; failure: Failure; reason: string }
export type Ran = { ok: true; code: number; out: string; err: string }
export type Forward = {
  ok: true
  end: LocalEnd
  /** Settles when the forward's ssh has ended, by itself or through `close`. */
  ended: Promise<Failed>
  close(): void
}

export type RunOptions = {
  stdin?: string
  timeoutMs?: number
  asIs?: boolean
  /** ssh options of QualityLayer's own (`-o …`, `-i <key>`), before the target; never a caller's words. */
  sshOptions?: string[]
}

export interface Ssh {
  /** Runs a command on the machine. A command that fails there is an answer, not a failure. */
  run(target: string, command: string[], options?: RunOptions): Promise<Ran | Failed>
  /** The ssh config file this runner reads (`-F`), when it was given one; ssh's default otherwise. */
  readonly configFile?: string
  /** The program it starts; `ssh` when not named. */
  readonly program?: string
  /** Holds a forward to a port of the machine's own loopback until it ends or is closed. */
  forward(target: string, id: string, port: number): Promise<Forward | Failed>
}

const CONNECT_SECONDS = 10
const RUN_MS = 60_000
const UP_MS = (CONNECT_SECONDS + 5) * 1000
/** ssh's own exit code for "no connection"; every other code is the remote command's. */
const NO_CONNECTION = 255
const NOT_FOUND = "ssh was not found"
/** What a socket file's path may measure on macOS (the smaller limit of the two systems), less its end. */
const SOCKET_PATH_BYTES = 103

/** A word the machine's shell reads as exactly itself (`~` only as the home at its start). */
const WORD = /^~?[A-Za-z0-9_@%+=:,./-]+$/

/**
 * What every command on a machine runs after. An ssh login on Ubuntu has umask 002, so the folders
 * the installer, the server and the agents it starts make there would be group-writable, and
 * QualityLayer refuses to work in such a folder ("Unsafe directory ownership"). QualityLayer sets
 * this umask itself when it starts, but `mkdir` and the installer script run before it does. Fixed
 * words of this file, never a caller's: the caller's words are checked before they follow it.
 */
const PRIVATE_FILES = ["umask", "022", "&&"]

const failed = (failure: Failure, reason: string): Failed => ({ ok: false, failure, reason })

const base = (deps: SshDeps): string[] => [
  deps.program ?? "ssh",
  ...(deps.options ?? []),
  "-o",
  "BatchMode=yes",
  "-o",
  `ConnectTimeout=${CONNECT_SECONDS}`,
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "ServerAliveCountMax=3",
]

/** QualityLayer on a machine, by its path: a non-interactive shell there has no PATH entry for it. */
export function qualitylayer(args: string[]): string[] {
  const words = ["~/.qualitylayer/bin/qualitylayer", ...args]
  const odd = words.find((word) => !WORD.test(word))
  if (odd !== undefined) throw new Error("a command word for a machine must be a plain word")
  return words
}

/** Which failure ssh's own words name, for an exit without a connection. */
export function failureOf(said: string): Failed {
  const first = said.trim().split("\n").at(-1)?.trim() ?? ""
  if (/host key verification failed|host identification has changed/i.test(said))
    return failed("unknown-host", first)
  if (/permission denied|too many authentication failures|passphrase/i.test(said))
    return failed("needs-you", first)
  return failed("offline", first === "" ? "ssh could not connect" : first)
}

/** `127.x.y.z` for a machine: fixed by its id, never `127.0.0.1`, whose cookies a browser sends. */
function loopbackOf(id: string): string {
  const hash = createHash("sha256").update(id).digest()
  const [x, y, z] = [hash[0] ?? 0, hash[1] ?? 0, 2 + ((hash[2] ?? 0) % 253)]
  return `127.${x}.${y}.${z}`
}

const fits = (folder: string, file: string): boolean =>
  Buffer.byteLength(join(folder, file)) <= SOCKET_PATH_BYTES

/** An existing folder that is this user's own, no link, and closed to everyone else. */
function ownedAndClosed(folder: string): boolean {
  try {
    const found = lstatSync(folder)
    const mine = process.getuid === undefined || found.uid === process.getuid()
    return found.isDirectory() && mine && (found.mode & 0o077) === 0
  } catch {
    return false
  }
}

/**
 * The owner-only folder a forward's socket file lies in: `machines` under the home, or, when the
 * home's path is too deep for a socket file, a folder of this user under /tmp. Null when neither
 * is short enough or the one under /tmp is not this user's own closed folder.
 */
function socketFolder(home: string, file: string): string | null {
  const own = join(home, "machines")
  if (fits(own, file)) {
    mkdirSync(own, { recursive: true, mode: 0o700 })
    chmodSync(own, 0o700)
    return own
  }
  const shared = join("/tmp", `qualitylayer-${process.getuid?.() ?? "user"}`)
  if (!fits(shared, file)) return null
  try {
    mkdirSync(shared, { mode: 0o700 })
  } catch {
    // It exists: accepted only when it is this user's own closed folder.
  }
  return ownedAndClosed(shared) ? shared : null
}

const tcpReachable = (end: LocalEnd): Promise<boolean> =>
  new Promise((done) => {
    const socket = connect("socket" in end ? { path: end.socket } : end)
    const over = (ok: boolean) => {
      socket.destroy()
      done(ok)
    }
    socket.setTimeout(1000, () => over(false))
    socket.once("connect", () => over(true))
    socket.once("error", () => over(false))
  })

const bunSpawn: Spawn = (argv, stdin) => {
  const child = Bun.spawn(argv, {
    stdin: stdin === null ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  })
  return {
    exited: child.exited,
    out: new Response(child.stdout).text(),
    err: new Response(child.stderr).text(),
    kill: () => child.kill(),
  }
}

/**
 * Windows' own ssh, by its path: another `ssh.exe` earlier on the PATH (Git's) reads paths and
 * addresses differently, and the forward's other loopback address is proven with this one.
 */
export function systemSshProgram(platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return "ssh"
  const own = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "OpenSSH", "ssh.exe")
  return existsSync(own) ? own : "ssh"
}

/** The runner over the real `ssh` of this computer. */
export const systemSsh = (home: string, log: (line: string) => void, options?: string[]): Ssh =>
  createSsh({
    spawn: bunSpawn,
    home,
    platform: process.platform,
    log,
    reachable: tcpReachable,
    program: systemSshProgram(),
    options,
  })

const after = (ms: number): Promise<"late"> =>
  new Promise((done) => setTimeout(() => done("late"), ms))

/**
 * What the promise gives, or "late" after the time. The timer goes with the answer: a command that
 * came back at once must not hold this process open for the rest of its timeout.
 */
async function within<T>(answer: Promise<T>, ms: number): Promise<T | "late"> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<"late">((done) => {
    timer = setTimeout(() => done("late"), ms)
  })
  try {
    return await Promise.race([answer, late])
  } finally {
    clearTimeout(timer)
  }
}

class Runner implements Ssh {
  private missingSaid = false

  constructor(private readonly deps: SshDeps) {}

  get program(): string {
    return this.deps.program ?? "ssh"
  }

  get configFile(): string | undefined {
    const options = this.deps.options ?? []
    const at = options.indexOf("-F")
    return at === -1 ? undefined : options[at + 1]
  }

  private start(argv: string[], stdin: string | null): Child | Failed {
    try {
      return this.deps.spawn(argv, stdin)
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT")
        return failed("offline", "ssh could not be started")
      if (!this.missingSaid) this.deps.log(NOT_FOUND)
      this.missingSaid = true
      return failed("offline", NOT_FOUND)
    }
  }

  async run(target: string, command: string[], options: RunOptions = {}): Promise<Ran | Failed> {
    if (!isTarget(target)) return failed("offline", "this is not a name ssh can connect to")
    const native = splitTarget(target)
    if (command.some((word) => !WORD.test(word)))
      return failed("offline", "a command word for a machine must be a plain word")
    // `asIs`: a question for a shell that may not be a unix one (Windows' `cmd /c ver`).
    const remote = options.asIs === true ? command : [...PRIVATE_FILES, ...command]
    const child = this.start(
      [
        ...base(this.deps),
        ...(native.port === undefined ? [] : ["-p", String(native.port)]),
        ...(options.sshOptions ?? []),
        "-T",
        native.target,
        ...remote,
      ],
      options.stdin ?? null,
    )
    if ("ok" in child) return child
    const timeoutMs = options.timeoutMs ?? RUN_MS
    const code = await within(child.exited, timeoutMs)
    if (code === "late") {
      child.kill()
      await child.exited
      return failed("offline", `the machine gave no answer within ${Math.ceil(timeoutMs / 1000)} s`)
    }
    const [out, err] = await Promise.all([child.out, child.err])
    return code === NO_CONNECTION ? failureOf(err) : { ok: true, code, out, err }
  }

  /** Where a machine's forward ends on this computer, and the ssh options that kind of end needs. */
  private localEnd(
    id: string,
    port: number,
  ): { end: LocalEnd; spec: string; more: string[] } | Failed {
    if (this.deps.platform === "win32") {
      // Windows' own ssh takes no socket file as a forward's local end.
      const host = loopbackOf(id)
      return { end: { host, port }, spec: `${host}:${port}`, more: [] }
    }
    // A short name: a socket file's whole path has a small limit, and an id can be long. The home
    // is part of it, so two homes never share a file in the folder under /tmp.
    const name = createHash("sha256").update(`${this.deps.home}\n${id}`).digest("hex").slice(0, 12)
    const folder = socketFolder(this.deps.home, `${name}.sock`)
    if (folder === null)
      return failed("offline", "no folder of this computer is safe and short enough for ssh")
    const socket = join(folder, `${name}.sock`)
    return { end: { socket }, spec: socket, more: ["-o", "StreamLocalBindUnlink=yes"] }
  }

  private async up(child: Child, end: LocalEnd): Promise<boolean> {
    const until = Date.now() + (this.deps.upWithinMs ?? UP_MS)
    let exited = false
    void child.exited.then(() => {
      exited = true
    })
    while (!exited && Date.now() < until) {
      if (await this.deps.reachable(end)) return true
      await after(100)
    }
    return false
  }

  /** A forward that did not come up: what ssh said if it ended, else it is ended here. */
  private async neverUp(child: Child, ended: Promise<Failed>): Promise<Failed> {
    const gone = await Promise.race([ended, after(0)])
    child.kill()
    return gone === "late" ? failed("offline", "the forward to the machine never came up") : gone
  }

  async forward(target: string, id: string, port: number): Promise<Forward | Failed> {
    // The id only names the socket file (hashed) and the Windows address: any id the store can hold.
    if (!isTarget(target) || !isMachineId(id))
      return failed("offline", "this is not a name ssh can connect to")
    const native = splitTarget(target)
    const local = this.localEnd(id, port)
    if ("ok" in local) return local
    const { end, spec, more } = local
    const child = this.start(
      [
        ...base(this.deps),
        ...(native.port === undefined ? [] : ["-p", String(native.port)]),
        "-o",
        "ExitOnForwardFailure=yes",
        ...more,
        "-N",
        "-L",
        `${spec}:127.0.0.1:${port}`,
        native.target,
      ],
      null,
    )
    if ("ok" in child) return child
    const tidy = () => {
      if ("socket" in end && existsSync(end.socket)) rmSync(end.socket, { force: true })
    }
    const ended = child.exited.then(async () => {
      tidy()
      return failureOf(await child.err)
    })
    return (await this.up(child, end))
      ? { ok: true, end, ended, close: () => child.kill() }
      : this.neverUp(child, ended)
  }
}

export const createSsh = (deps: SshDeps): Ssh => new Runner(deps)
