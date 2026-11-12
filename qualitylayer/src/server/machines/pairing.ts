/**
 * Pairing a machine: one job per machine being added, run by this computer's server so it goes on
 * while the dialog is hidden, and read the same way by the App and by `qualitylayer machines add`.
 * The steps run in order (Reachable, Key, ssh config, System, QualityLayer, Licence, Connect; a dev
 * container finds its Container first); each says what it did in a few words, and a failed one says
 * its cause and its fix in one line each and stops the rest. Try again resumes at that step.
 *
 * Add plus the password is the consent: nothing is asked before the steps start. The password goes
 * to ssh once (askpass.ts) and is never kept; the host key the person was shown is the one trusted.
 */

import { randomBytes } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { VERSION } from "../../core/version.ts"
import type { Ctx } from "../../ctx.ts"
import { copyKeyWithPassword } from "./askpass.ts"
import { type Looked, lookAt } from "./check.ts"
import { type Container, containerHostKeys, listContainers, putKeyIn } from "./containers.ts"
import { installOn, installPlan } from "./install.ts"
import {
  activateOn,
  type Computers,
  computersOf,
  type LicencePlan,
  planOf,
  type ThisLicence,
  thisLicence,
} from "./licence.ts"
import { type LocalRun, runLocal } from "./local.ts"
import type { Machines } from "./manager.ts"
import { isWindowsGreeting, type Probe, probe, softwareOf } from "./reach.ts"
import type { Ssh } from "./ssh.ts"
import {
  ensureKey,
  fingerprintOf,
  freeAlias,
  type HostKey,
  hasHost,
  knownHostsText,
  knownKeys,
  knownName,
  publicKeyOf,
  resolveTarget,
  type SshFiles,
  scanHostKeys,
  shownPath,
  sshFilesOf,
  takeKeyScript,
  trustKeys,
  writeHostBlock,
} from "./ssh-files.ts"
import {
  addMachine,
  isTarget,
  type PairedBy,
  readMachines,
  repairedMachine,
  type StoredMachine,
} from "./store.ts"

export type StepKey =
  | "find"
  | "reach"
  | "key"
  | "config"
  | "system"
  | "install"
  | "licence"
  | "connect"

/** A step that stopped: why, and what fixes it, in one line each. */
export type StepFail = {
  cause: string
  fix: string
  /** What the machine printed last, when that is the evidence. */
  said?: string[]
  /** Try again resumes here; false where trying again cannot help (Windows). */
  again: boolean
}

export type StepView = {
  key: StepKey
  state: "wait" | "now" | "done" | "fail"
  detail: string
  /** Done, with something worth a look (the licence full: the machine's own trial). */
  warn?: true
  fail?: StepFail
}

export type Waiting =
  /** The password sheet: the host key pairing trusts and the key it copies. */
  | { for: "password"; target: string; hostKey: string | null; key: string; wrong?: true }
  /** The machine takes no password: the person copies the key once, then tries again. */
  | { for: "keys-only"; target: string; command: string }
  /** ssh asked something after the password (a code), in its own words. */
  | { for: "code"; target: string; prompt: string }

export type PairingView = {
  id: string
  kind: "computer" | "container"
  name: string
  /** How it is reached, as the person reads it: `max@mac-mini.local`, `vscode@127.0.0.1:2223`. */
  target: string
  state: "running" | "waiting" | "failed" | "done"
  steps: StepView[]
  waiting?: Waiting
  /** The machine in the list, once it is stored. */
  machine?: { id: string; name: string }
  started: number
}

export type PairingInput =
  | { target: string; name?: string }
  | { container: string }
  /** Pair a stored machine again (its key was refused): the same steps, the same entry. */
  | { machine: string }

export class Stop extends Error {
  constructor(readonly fail: StepFail) {
    super(fail.cause)
  }
}

function stop(cause: string, fix: string, more: Partial<StepFail> = {}): never {
  throw new Stop({ cause, fix, again: true, ...more })
}

export type PairingDeps = {
  ctx: Ctx
  ssh: Ssh
  machines: Machines
  local?: LocalRun
  probe?: Probe
  thisLicence?: (ctx: Ctx) => Promise<ThisLicence>
  copy?: typeof copyKeyWithPassword
  /** How long Connect waits for the machine to answer. */
  connectMs?: number
}

const COMPUTER: StepKey[] = ["reach", "key", "config", "system", "install", "licence", "connect"]
const CONTAINER: StepKey[] = ["find", "key", "config", "system", "install", "licence", "connect"]

/** What a job knows besides what it shows. */
type Job = {
  view: PairingView
  /** The stored machine this job pairs again, if any. */
  existing?: StoredMachine
  /** What the person typed, as ssh is given it before a config entry exists. */
  sshTarget: string
  typedPort?: number
  host?: string
  port?: number
  user?: string
  proxied?: boolean
  hostKeys: HostKey[]
  known?: string
  /** The person's own setup reaches it (a key in their agent, their config): nothing of ours is written. */
  usesOwn?: boolean
  ownKey?: boolean
  alias?: string
  /** What the stored machine's target becomes. */
  finalTarget?: string
  container?: Container
  engine?: string
  looked?: Extract<Looked, { reach: "ok" }>
  plan?: { plan: LicencePlan; computers: Computers; mine: ThisLicence }
  activated?: boolean
  /** The answer the job waits for; resolved with null when it is cancelled. */
  answer?: (text: string | null) => void
  cancelled?: boolean
}

/** `user@host:2223` → `user@host` and 2223; the rest as it is. */
export function splitTarget(typed: string): { target: string; port?: number } {
  const found = /^(.+@[^:@[\]]+):(\d{1,5})$/.exec(typed) ?? /^([^:@[\]]+):(\d{1,5})$/.exec(typed)
  if (found === null) return { target: typed }
  const port = Number(found[2])
  return port > 0 && port < 65_536 ? { target: found[1] as string, port } : { target: typed }
}

/** The name a machine gets from how it is reached: `mac-mini` for `max@mac-mini.local`. */
export function nameFrom(target: string): string {
  const host = target.split("@").pop() ?? target
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host
  return (host.replace(/\.(local|lan|home)$/i, "").split(".")[0] ?? host).slice(0, 60) || host
}

const isMac = (host: string | undefined) => host?.toLowerCase().endsWith(".local") === true

/** What ssh's refusal lists as the ways it would take: "publickey,password". */
export function methodsIn(said: string): string[] {
  const found = /permission denied \(([^)]*)\)/i.exec(said)
  return found === null ? [] : (found[1] ?? "").split(",").map((one) => one.trim())
}

/** "macOS 15.6 · arm64", "Ubuntu 24.04 · x64": the system as a person names it. */
async function systemWords(ssh: Ssh, target: string, uname: string): Promise<string> {
  const [kernel, machine] = uname.split(/\s+/)
  const arch =
    machine === "aarch64" || machine === "arm64"
      ? "arm64"
      : machine === "x86_64"
        ? "x64"
        : (machine ?? "")
  let name = kernel === "Darwin" ? "macOS" : (kernel ?? "")
  if (kernel === "Darwin") {
    const said = await ssh.run(target, ["sw_vers", "-productVersion"], { timeoutMs: 15_000 })
    if (said.ok && said.code === 0 && /^[\d.]{2,12}$/.test(said.out.trim()))
      name = `macOS ${said.out.trim()}`
  } else {
    const said = await ssh.run(target, ["cat", "/etc/os-release"], { timeoutMs: 15_000 })
    const pretty = said.ok ? /^PRETTY_NAME="?([^"\n]+)"?/m.exec(said.out)?.[1] : undefined
    if (pretty !== undefined)
      name = pretty
        .replace(/\s+LTS$/, "")
        .replace(/(\d+\.\d+)\.\d+/, "$1")
        .slice(0, 40)
  }
  return arch === "" ? name : `${name} · ${arch}`
}

export class Pairings {
  private jobs = new Map<string, Job>()
  private local: LocalRun
  private probe: Probe
  private files: SshFiles

  constructor(private deps: PairingDeps) {
    this.local = deps.local ?? runLocal
    this.probe = deps.probe ?? probe
    this.files = sshFilesOf(deps.ctx.env, deps.ssh.configFile)
  }

  list = (): PairingView[] => [...this.jobs.values()].map((job) => job.view)

  get = (id: string): PairingView | null => this.jobs.get(id)?.view ?? null

  /** Start pairing; a refusal (a bad target, an added one) comes back as words, nothing started. */
  async start(input: PairingInput): Promise<PairingView | { refused: string }> {
    this.tidy()
    const stored = await readMachines(this.deps.ctx)
    let job: Job
    if ("machine" in input) {
      const existing = stored.find((one) => one.id === input.machine)
      if (existing === undefined) return { refused: "No such machine." }
      const container = existing.container !== undefined
      job = this.made(container ? "container" : "computer", existing.name, existing.target, {
        existing,
        sshTarget: existing.target,
      })
      if (container)
        job.container = {
          id: "",
          name: existing.name,
          folder: existing.container?.folder ?? "",
          user: "",
          port: null,
        }
    } else if ("container" in input) {
      const name = input.container.trim()
      if (!/^[A-Za-z0-9_.-]{1,80}$/.test(name))
        return { refused: "This is not a container's name." }
      if (stored.some((one) => one.name === name && one.container !== undefined))
        return { refused: `${name} is added already.` }
      job = this.made("container", name, name, { sshTarget: name })
    } else {
      const typed = input.target.trim()
      const { target, port } = splitTarget(typed)
      if (!isTarget(target)) return { refused: "This is not a name ssh can connect to." }
      if (
        stored.some((one) => one.target === target || one.target === typed || one.typed === typed)
      )
        return { refused: `${typed} is added already.` }
      const name = (input.name ?? "").trim() || nameFrom(target)
      job = this.made("computer", name, typed, { sshTarget: target, typedPort: port })
    }
    const running = [...this.jobs.values()].find(
      (one) =>
        one.view.target === job.view.target &&
        one.view.state !== "done" &&
        one.view.state !== "failed",
    )
    if (running !== undefined) return running.view
    this.jobs.set(job.view.id, job)
    void this.run(job, 0)
    return job.view
  }

  /** The person's answer to what the job waits for: a password, a code, or "" for Done · try again. */
  answer(id: string, text: string): boolean {
    const job = this.jobs.get(id)
    if (job?.answer === undefined) return false
    const reply = job.answer
    job.answer = undefined
    reply(text)
    return true
  }

  /** Try again: the job resumes at its failed step. */
  again(id: string): boolean {
    const job = this.jobs.get(id)
    if (job === undefined || job.view.state !== "failed") return false
    const at = job.view.steps.findIndex((step) => step.state === "fail")
    if (at === -1 || job.view.steps[at]?.fail?.again === false) return false
    job.cancelled = false
    void this.run(job, at)
    return true
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id)
    if (job === undefined) return false
    job.cancelled = true
    job.answer?.(null)
    if (job.view.state !== "done") this.jobs.delete(id)
    return true
  }

  private made(kind: PairingView["kind"], name: string, target: string, more: Partial<Job>): Job {
    return {
      view: {
        id: randomBytes(6).toString("hex"),
        kind,
        name,
        target,
        state: "running",
        steps: (kind === "container" ? CONTAINER : COMPUTER).map((key) => ({
          key,
          state: "wait",
          detail: "",
        })),
        started: this.deps.ctx.clock.now(),
      },
      sshTarget: target,
      hostKeys: [],
      ...more,
    }
  }

  /** Done and failed jobs are kept a while for the page that comes back to them, then dropped. */
  private tidy(): void {
    const now = this.deps.ctx.clock.now()
    for (const [id, job] of this.jobs)
      if (
        (job.view.state === "done" || job.view.state === "failed") &&
        now - job.view.started > 30 * 60_000
      )
        this.jobs.delete(id)
  }

  private step(job: Job, key: StepKey): StepView {
    return job.view.steps.find((one) => one.key === key) as StepView
  }

  /** What the step shows while it works. */
  private say(job: Job, key: StepKey, detail: string): void {
    this.step(job, key).detail = detail
  }

  private async run(job: Job, from: number): Promise<void> {
    const steps = job.view.steps
    job.view.state = "running"
    job.view.waiting = undefined
    for (let at = from; at < steps.length; at++) {
      const step = steps[at] as StepView
      step.state = "now"
      step.fail = undefined
      step.warn = undefined
      step.detail = ""
      try {
        const done = await this.do(job, step.key)
        if (job.cancelled) return
        step.detail = done.detail
        if (done.warn) step.warn = true
        step.state = "done"
      } catch (error) {
        if (job.cancelled) return
        step.state = "fail"
        step.detail = ""
        step.fail =
          error instanceof Stop
            ? error.fail
            : {
                cause: error instanceof Error ? error.message.slice(0, 200) : "It stopped",
                fix: "Try again",
                again: true,
              }
        job.view.state = "failed"
        job.view.waiting = undefined
        return
      }
    }
    job.view.state = "done"
  }

  private do(job: Job, key: StepKey): Promise<{ detail: string; warn?: boolean }> {
    switch (key) {
      case "find":
        return this.find(job)
      case "reach":
        return this.reach(job)
      case "key":
        return job.view.kind === "container" ? this.containerKey(job) : this.key(job)
      case "config":
        return this.config(job)
      case "system":
        return this.system(job)
      case "install":
        return this.install(job)
      case "licence":
        return this.licence(job)
      case "connect":
        return this.connect(job)
    }
  }

  /** Wait for the person: the sheet the job shows, and their answer (null when cancelled). */
  private wait(job: Job, waiting: Waiting): Promise<string | null> {
    job.view.waiting = waiting
    job.view.state = "waiting"
    return new Promise((done) => {
      job.answer = (text) => {
        job.view.waiting = undefined
        job.view.state = "running"
        done(text)
      }
    })
  }

  /* ── The steps ── */

  private async find(job: Job): Promise<{ detail: string }> {
    const listed = await listContainers(this.local)
    if (!listed.docker) stop("No Docker found", "Start Docker or OrbStack")
    const wanted = job.container?.folder
    const container = listed.containers.find((one) =>
      wanted !== undefined && wanted !== ""
        ? one.folder === wanted
        : one.id === job.view.name || one.name === job.view.name,
    )
    if (container === undefined)
      stop(`${job.view.name} is not running`, "Start it in VS Code, then try again")
    const port = container.port
    if (port === null)
      stop(
        `${container.name} has no ssh server`,
        "Add the ssh lines to its devcontainer.json, then rebuild it",
      )
    job.container = container
    job.engine = listed.engine
    job.host = "127.0.0.1"
    job.port = port
    job.user = container.user
    job.known = knownName("127.0.0.1", port)
    job.view.target = `${container.user}@127.0.0.1:${port}`
    return { detail: `${container.name} · ${listed.engine}` }
  }

  private async reach(job: Job): Promise<{ detail: string }> {
    const { ssh } = this.deps
    const resolved = await resolveTarget(
      this.local,
      ssh.program ?? "ssh",
      ssh.configFile,
      job.sshTarget,
      job.typedPort,
    )
    if (resolved === null || resolved.host === "")
      stop("ssh cannot read this name", "Type it as user@host")
    const where = resolved
    Object.assign(job, {
      host: where.host,
      port: where.port,
      user: where.user,
      proxied: where.proxied,
    })
    await this.notAddedYet(job, where)
    // A machine paired again under its Host name shows how it is reached, as when it was added.
    if (job.existing !== undefined && !where.proxied && !job.view.target.includes("@"))
      job.view.target = `${where.user ? `${where.user}@` : ""}${where.host}${where.port === 22 ? "" : `:${where.port}`}`
    if (where.proxied) return { detail: "through your ssh config" }
    const reached = await this.probe(where.host, where.port)
    if (!reached.ok) {
      if (reached.why === "closed")
        stop(
          `Port ${where.port} is closed`,
          isMac(where.host)
            ? "On the Mac: System Settings › Sharing › Remote Login"
            : "Turn on its ssh server, or Remote Login on a Mac",
        )
      if (reached.why === "unknown")
        stop(`${where.host} is not known here`, "Check the name, or type its address")
      stop(`No answer from ${where.host}`, "Wake it, or join the same network")
    }
    if (isWindowsGreeting(reached.greeting))
      stop("Windows isn’t supported yet", "Add a Mac or Linux machine, or WSL on it", {
        again: false,
      })
    job.known = knownName(where.host, where.port)
    job.hostKeys = await scanHostKeys(this.local, where.host, where.port)
    return { detail: `${softwareOf(reached.greeting)} · port ${where.port}` }
  }

  /** The same address, port and user as a machine in the list, under another name, is that machine. */
  private async notAddedYet(
    job: Job,
    where: { host: string; port: number; user: string; proxied: boolean },
  ): Promise<void> {
    if (job.existing !== undefined || where.proxied) return
    const { ssh } = this.deps
    for (const one of await readMachines(this.deps.ctx)) {
      const known = await resolveTarget(
        this.local,
        ssh.program ?? "ssh",
        ssh.configFile,
        one.target,
      )
      if (known?.host === where.host && known.port === where.port && known.user === where.user)
        stop(`${one.name} is this machine, added already`, "Choose it in the machine switcher", {
          again: false,
        })
    }
  }

  /** A known_hosts of the shown keys, for the checks before they are trusted; removed by `done`. */
  private trialKnown(job: Job): { options: string[]; done: () => void } {
    if (job.proxied || job.hostKeys.length === 0 || job.known === undefined)
      return { options: [], done: () => {} }
    const folder = join(this.deps.ctx.home, "machines", `known-${randomBytes(4).toString("hex")}`)
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    const file = join(folder, "known_hosts")
    writeFileSync(file, knownHostsText(job.known, job.hostKeys), { mode: 0o600 })
    return {
      options: ["-o", `UserKnownHostsFile=${file}`, "-o", "GlobalKnownHostsFile=/dev/null"],
      done: () => rmSync(folder, { recursive: true, force: true }),
    }
  }

  /** One `true` over ssh with these options; the failure's words when it did not sign in. */
  private async tries(
    job: Job,
    options: string[],
  ): Promise<{ ok: true } | { ok: false; failure: string; said: string }> {
    const ran = await this.deps.ssh.run(job.sshTarget, ["true"], {
      timeoutMs: 25_000,
      sshOptions: [
        ...(job.typedPort === undefined ? [] : ["-p", String(job.typedPort)]),
        ...options,
      ],
    })
    if (ran.ok)
      return ran.code === 0 ? { ok: true } : { ok: false, failure: "offline", said: ran.err.trim() }
    return { ok: false, failure: ran.failure, said: ran.reason }
  }

  private async key(job: Job): Promise<{ detail: string }> {
    const files = this.files
    // A changed host key is never taken silently on a real machine.
    if (job.known !== undefined && job.hostKeys.length > 0) {
      const known = await knownKeys(this.local, files, job.known)
      const same = known.some((one) =>
        job.hostKeys.some((key) => key.type === one.type && key.key === one.key),
      )
      if (known.length > 0 && !same)
        stop(
          `${job.host} shows another host key than before`,
          `Reinstalled? Run ssh-keygen -R ${job.known}, then try again`,
        )
    }
    const trial = this.trialKnown(job)
    try {
      for (;;) {
        // The person's own setup (their key, their agent, their config) already signs in.
        const own = await this.tries(job, trial.options)
        if (own.ok) {
          job.usesOwn = true
          return { detail: "your key works" }
        }
        if (own.failure !== "needs-you") stop(own.said || "ssh could not sign in", "Try again")
        // QualityLayer's key is there from an earlier pairing.
        if ((await publicKeyOf(files)) !== null) {
          const ours = await this.tries(job, [
            ...trial.options,
            "-i",
            files.key,
            "-o",
            "IdentitiesOnly=yes",
          ])
          if (ours.ok) {
            job.ownKey = true
            return { detail: "qualitylayer_ed25519 works" }
          }
        }
        this.say(job, "key", "Making qualitylayer_ed25519")
        const made = await ensureKey(files, this.local)
        if (made === null)
          stop("ssh-keygen could not make a key", "Check that ~/.ssh can be written")
        const publicKey = made as string
        const shownTarget = job.view.target.includes("@")
          ? job.view.target
          : `${job.user ? `${job.user}@` : ""}${job.host ?? job.sshTarget}${job.port !== undefined && job.port !== 22 ? `:${job.port}` : ""}`
        const methods = methodsIn(own.said)
        if (
          methods.length > 0 &&
          !methods.includes("password") &&
          !methods.includes("keyboard-interactive")
        ) {
          this.say(job, "key", "Waiting for the key")
          const answered = await this.wait(job, {
            for: "keys-only",
            target: shownTarget,
            command: `ssh-copy-id -i ${shownPath(files, files.key)} ${job.typedPort === undefined ? "" : `-p ${job.typedPort} `}${job.sshTarget}`,
          })
          if (answered === null) stop("Stopped", "Add it again")
          continue
        }
        const copied = await this.withPassword(job, publicKey, shownTarget)
        if (copied === "again") continue
        const ours = await this.tries(job, [
          ...trial.options,
          "-i",
          files.key,
          "-o",
          "IdentitiesOnly=yes",
        ])
        if (!ours.ok)
          stop(
            "The key was copied, but it does not sign in",
            "Check sshd's AuthorizedKeysFile there",
          )
        job.ownKey = true
        return { detail: "qualitylayer_ed25519 copied" }
      }
    } finally {
      trial.done()
    }
  }

  /** The password sheet until ssh takes the key, or the person stops. */
  private async withPassword(
    job: Job,
    publicKey: string,
    shownTarget: string,
  ): Promise<"copied" | "again"> {
    const fingerprint =
      job.hostKeys[0] === undefined ? null : await fingerprintOf(this.local, job.hostKeys[0])
    let wrong = false
    for (;;) {
      this.say(job, "key", "Waiting for the password")
      const password = await this.wait(job, {
        for: "password",
        target: shownTarget,
        hostKey: fingerprint,
        key: shownPath(this.files, this.files.key),
        ...(wrong ? { wrong: true as const } : {}),
      })
      if (password === null) stop("Stopped", "Add it again")
      this.say(job, "key", "Copying qualitylayer_ed25519")
      const copied = await (this.deps.copy ?? copyKeyWithPassword)(this.local, {
        program: this.deps.ssh.program ?? "ssh",
        configFile: this.deps.ssh.configFile,
        target: job.sshTarget,
        port: job.port ?? 22,
        knownHosts: job.known === undefined ? "" : knownHostsText(job.known, job.hostKeys),
        script: takeKeyScript(publicKey),
        password: password as string,
        ask: async (prompt) => {
          const code = await this.wait(job, { for: "code", target: shownTarget, prompt })
          this.say(job, "key", "Copying qualitylayer_ed25519")
          return code
        },
        under: join(this.deps.ctx.home, "machines"),
      })
      if (copied.ok) return "copied"
      if (job.cancelled) stop("Stopped", "Add it again")
      if (copied.why === "wrong") {
        wrong = true
        continue
      }
      if (copied.why === "keys-only") return "again"
      stop(copied.said || "ssh could not copy the key", "Try again")
    }
  }

  private async containerKey(job: Job): Promise<{ detail: string }> {
    const container = job.container as Container
    const made = await ensureKey(this.files, this.local)
    if (made === null) stop("ssh-keygen could not make a key", "Check that ~/.ssh can be written")
    const put = await putKeyIn(this.local, container, made as string)
    if (!put.ok) stop(`The key did not go into ${container.name}`, put.said || "Try again")
    job.hostKeys = await containerHostKeys(this.local, container)
    if (job.hostKeys.length === 0)
      job.hostKeys = await scanHostKeys(this.local, "127.0.0.1", job.port ?? 22)
    job.ownKey = true
    return { detail: "put in with docker exec" }
  }

  private async config(job: Job): Promise<{ detail: string }> {
    const files = this.files
    const container = job.view.kind === "container"
    // What the person typed reaches it with their own setup, on ssh's own port: nothing is written
    // besides the host key that was shown.
    if (job.usesOwn && job.typedPort === undefined) {
      if (
        job.known !== undefined &&
        job.hostKeys.length > 0 &&
        (await knownKeys(this.local, files, job.known)).length === 0
      )
        await trustKeys(this.local, files, job.known, job.hostKeys)
      job.finalTarget = job.sshTarget
      return {
        detail: (await hasHost(files, job.sshTarget))
          ? `Host ${job.sshTarget} · yours`
          : "as it is",
      }
    }
    // A Host entry named like an address would change every other ssh to that address: it gets a
    // name of its own.
    const plainName = /^[\d.:]+$/.test(job.view.name) || job.view.name === job.host
    const alias =
      job.existing?.alias ??
      (await freeAlias(
        files,
        plainName ? `ql-${job.view.name}${job.port === 22 ? "" : `-${job.port}`}` : job.view.name,
      ))
    if (job.known !== undefined && job.hostKeys.length > 0)
      await trustKeys(this.local, files, job.known, job.hostKeys)
    await writeHostBlock(files, {
      alias,
      host: job.host ?? "127.0.0.1",
      port: job.port ?? 22,
      user: job.user ?? "",
      ownKey: job.usesOwn !== true,
    })
    job.alias = alias
    job.finalTarget = alias
    const checked = await this.deps.ssh.run(alias, ["true"], { timeoutMs: 25_000 })
    if (!checked.ok) stop(checked.reason || "ssh could not sign in with the new entry", "Try again")
    return { detail: container ? `Host ${alias} · port ${job.port}` : `Host ${alias}` }
  }

  private async system(job: Job): Promise<{ detail: string }> {
    const target = job.finalTarget as string
    const looked = await lookAt(this.deps.ssh, target)
    if (looked.reach !== "ok") stop(looked.reason || "The machine stopped answering", "Try again")
    if (looked.verdict === "unsupported")
      stop(`${looked.system} isn’t supported yet`, "Add a Mac or Linux machine", { again: false })
    job.looked = looked
    // A machine typed as an address is named by the name it gives itself.
    if (job.existing === undefined && /^[\d.:[\]]+$/.test(job.view.name)) {
      const named = await this.deps.ssh.run(target, ["uname", "-n"], { timeoutMs: 15_000 })
      const own = named.ok && named.code === 0 ? (named.out.trim().split(".")[0] ?? "") : ""
      if (/^[A-Za-z0-9][A-Za-z0-9-]{0,59}$/.test(own)) job.view.name = own
    }
    return { detail: await systemWords(this.deps.ssh, target, looked.system) }
  }

  private async licensing(job: Job): Promise<NonNullable<Job["plan"]>> {
    if (job.plan !== undefined) return job.plan
    const { ctx } = this.deps
    const mine = await (this.deps.thisLicence ?? thisLicence)(ctx)
    const others = (await readMachines(ctx)).filter((one) => one.id !== job.existing?.id)
    const computers = computersOf(others)
    const plan: LicencePlan =
      job.existing !== undefined
        ? "kept"
        : planOf(mine.kind, job.looked?.licence ?? null, computers)
    job.plan = { plan, computers, mine }
    return job.plan
  }

  private async install(job: Job): Promise<{ detail: string }> {
    const looked = job.looked as NonNullable<Job["looked"]>
    if (looked.verdict === "ready")
      return { detail: `${looked.version ?? VERSION} · there already` }
    const { plan } = await this.licensing(job)
    this.say(job, "install", `Installing ${VERSION}…`)
    const installed = await installOn(
      this.deps.ssh,
      job.finalTarget as string,
      await installPlan(this.deps.ctx),
      plan === "activate",
    )
    if (installed.ok) return { detail: installed.version }
    const said = installed.lines
    if (said.some((line) => /no space left/i.test(line)))
      stop(`No space left on ${job.view.name}`, "Free 400 MB there", { said })
    stop(installed.reason, "Try again", said.length > 0 ? { said } : {})
  }

  private async licence(job: Job): Promise<{ detail: string; warn?: boolean }> {
    const { plan, computers, mine } = await this.licensing(job)
    const fullWords = `${computers.of} of ${computers.of} in use · own 7-day trial`
    if (plan === "kept")
      return { detail: job.existing !== undefined ? "as before" : "already licensed" }
    if (plan === "trial") return { detail: "own 7-day trial" }
    if (plan === "full" || mine.kind !== "paid") return { detail: fullWords, warn: true }
    if (job.activated) return { detail: `${computers.after} of ${computers.of}` }
    const activated = await activateOn(this.deps.ssh, job.finalTarget as string, mine.key)
    if (activated.ok) {
      job.activated = true
      return { detail: `${computers.after} of ${computers.of}` }
    }
    if (activated.reason === "full") return { detail: fullWords, warn: true }
    stop(activated.message, "Try again")
  }

  private paired(job: Job): PairedBy {
    return {
      ...(job.alias !== undefined ? { alias: job.alias } : {}),
      ...(job.ownKey ? { ownKey: true as const } : {}),
      ...(job.view.target.includes("@") ? { typed: job.view.target } : {}),
      ...(job.view.kind === "container" && job.container
        ? { container: { folder: job.container.folder } }
        : {}),
    }
  }

  private async connect(job: Job): Promise<{ detail: string }> {
    const { ctx, machines } = this.deps
    let id = job.view.machine?.id ?? job.existing?.id
    if (id === undefined) {
      const added = await addMachine(
        ctx,
        { name: job.view.name, target: job.finalTarget as string },
        { avoid: [machines.ownPort], activated: job.activated === true, paired: this.paired(job) },
      )
      if (typeof added === "string")
        stop(
          added === "duplicate" ? "It is added already" : "No more machines fit on this computer",
          "Open it from the switcher",
          { again: false },
        )
      id = added.id
      job.view.machine = { id: added.id, name: added.name }
      await machines.reload()
    } else {
      if (job.existing !== undefined) {
        await repairedMachine(ctx, id, {
          target: job.finalTarget as string,
          paired: this.paired(job),
        })
        job.view.machine = { id, name: job.existing.name }
        await machines.reload()
      }
      machines.retry(id)
    }
    // An offline miss can be the machine's server still starting: it is tried again by itself
    // until the time is up. A refused key or a changed host key waits for the person: it stops here.
    const until = Date.now() + (this.deps.connectMs ?? 120_000)
    for (;;) {
      const now = machines.list().find((one) => one.id === id)
      if (now?.state === "connected") return { detail: "" }
      if (now?.state === "needs-you" || now?.state === "unknown-host")
        stop(now.reason || "ssh refused the machine", "Pair it again")
      if (Date.now() > until) stop(now?.reason || "The machine did not answer in time", "Try again")
      if (job.cancelled) stop("Stopped", "Add it again")
      await Bun.sleep(400)
    }
  }
}

/** One set of jobs per server (per home): routes are made per request, the jobs outlive them. */
const sets = new Map<string, Pairings>()

export function pairingsOf(deps: PairingDeps): Pairings {
  const known = sets.get(deps.ctx.home)
  if (known !== undefined) return known
  const made = new Pairings(deps)
  sets.set(deps.ctx.home, made)
  return made
}
