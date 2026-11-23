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
import { type LocalRun, runLocal } from "./local.ts"
import { configStep, containerKeyStep } from "./pairing-config.ts"
import { connectStep, installStep, licenceStep, systemStep } from "./pairing-finish.ts"
import { keyStep } from "./pairing-key.ts"
import { findContainerStep, reachHostStep } from "./pairing-reach.ts"
import {
  COMPUTER_STEPS,
  CONTAINER_STEPS,
  nameFrom,
  type PairingDeps,
  type PairingInput,
  type PairingJob,
  type PairingRuntime,
  type PairingView,
  type StepKey,
  type StepView,
  Stop,
  type Waiting,
} from "./pairing-types.ts"
import { type Probe, probe } from "./reach.ts"
import { type SshFiles, sshFilesOf } from "./ssh-files.ts"
import { isTarget, readMachines, type StoredMachine, splitTarget } from "./store.ts"

export {
  methodsIn,
  nameFrom,
  type PairingDeps,
  type PairingInput,
  type PairingView,
  type StepKey,
  type StepView,
  type Waiting,
} from "./pairing-types.ts"

type StepRunner = (
  rt: PairingRuntime,
  job: PairingJob,
) => Promise<{ detail: string; warn?: boolean }>

const STEP_RUNNERS: Record<StepKey, StepRunner> = {
  find: findContainerStep,
  reach: reachHostStep,
  key: (rt, job) => (job.view.kind === "container" ? containerKeyStep(rt, job) : keyStep(rt, job)),
  config: configStep,
  system: systemStep,
  install: installStep,
  licence: licenceStep,
  connect: connectStep,
}

type JobFactory = (
  kind: PairingView["kind"],
  name: string,
  target: string,
  more: Partial<PairingJob>,
) => PairingJob

function buildRepairJob(
  stored: StoredMachine[],
  machineId: string,
  make: JobFactory,
): PairingJob | { refused: string } {
  const existing = stored.find((one) => one.id === machineId)
  if (existing === undefined) return { refused: "No such machine." }
  const container = existing.container !== undefined
  const typed = container ? existing.target : (existing.typed ?? existing.target)
  const native = splitTarget(typed)
  const job = make(container ? "container" : "computer", existing.name, typed, {
    existing,
    sshTarget: native.target,
    typedPort: native.port,
    ownKey: existing.ownKey,
    alias: existing.alias,
  })
  if (container) {
    job.container = {
      id: "",
      name: existing.name,
      folder: existing.container?.folder ?? "",
      user: "",
      port: null,
    }
  }
  return job
}

function buildContainerJob(
  stored: StoredMachine[],
  container: string,
  make: JobFactory,
): PairingJob | { refused: string } {
  const name = container.trim()
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(name)) return { refused: "This is not a container's name." }
  if (stored.some((one) => one.name === name && one.container !== undefined))
    return { refused: `${name} is added already.` }
  return make("container", name, name, { sshTarget: name })
}

function buildComputerJob(
  stored: StoredMachine[],
  input: { target: string; name?: string },
  make: JobFactory,
): PairingJob | { refused: string } {
  const typed = input.target.trim()
  const { target, port } = splitTarget(typed)
  if (!isTarget(target)) return { refused: "This is not a name ssh can connect to." }
  if (stored.some((one) => one.target === target || one.target === typed || one.typed === typed))
    return { refused: `${typed} is added already.` }
  const name = (input.name ?? "").trim() || nameFrom(target)
  return make("computer", name, typed, { sshTarget: target, typedPort: port })
}

function buildInputJob(
  stored: StoredMachine[],
  input: PairingInput,
  make: JobFactory,
): PairingJob | { refused: string } {
  if ("machine" in input) return buildRepairJob(stored, input.machine, make)
  if ("container" in input) return buildContainerJob(stored, input.container, make)
  return buildComputerJob(stored, input, make)
}

export class Pairings {
  private jobs = new Map<string, PairingJob>()
  private local: LocalRun
  private probe: Probe
  private files: SshFiles
  private runtime: PairingRuntime

  constructor(private deps: PairingDeps) {
    this.local = deps.local ?? runLocal
    this.probe = deps.probe ?? probe
    this.files = sshFilesOf(deps.ctx.env, deps.ssh.configFile)
    this.runtime = {
      deps,
      local: this.local,
      probe: this.probe,
      files: this.files,
      say: (job, key, detail) => this.say(job, key, detail),
      wait: (job, waiting) => this.wait(job, waiting),
    }
  }

  list = (): PairingView[] => [...this.jobs.values()].map((job) => job.view)

  get = (id: string): PairingView | null => this.jobs.get(id)?.view ?? null

  /** Start pairing; a refusal (a bad target, an added one) comes back as words, nothing started. */
  async start(input: PairingInput): Promise<PairingView | { refused: string }> {
    this.tidy()
    const stored = await readMachines(this.deps.ctx)
    const built = buildInputJob(stored, input, (kind, name, target, more) =>
      this.made(kind, name, target, more),
    )
    if ("refused" in built) return built
    const running = [...this.jobs.values()].find(
      (one) =>
        one.view.target === built.view.target &&
        one.view.state !== "done" &&
        one.view.state !== "failed",
    )
    if (running !== undefined) return running.view
    this.jobs.set(built.view.id, built)
    void this.run(built, 0)
    return built.view
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

  private made(
    kind: PairingView["kind"],
    name: string,
    target: string,
    more: Partial<PairingJob>,
  ): PairingJob {
    return {
      view: {
        id: randomBytes(6).toString("hex"),
        kind,
        name,
        target,
        state: "running",
        steps: (kind === "container" ? CONTAINER_STEPS : COMPUTER_STEPS).map((key) => ({
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

  private step(job: PairingJob, key: StepKey): StepView {
    return job.view.steps.find((one) => one.key === key) as StepView
  }

  /** What the step shows while it works. */
  private say(job: PairingJob, key: StepKey, detail: string): void {
    this.step(job, key).detail = detail
  }

  private async run(job: PairingJob, from: number): Promise<void> {
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
        const done = await STEP_RUNNERS[step.key](this.runtime, job)
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

  /** Wait for the person: the sheet the job shows, and their answer (null when cancelled). */
  private wait(job: PairingJob, waiting: Waiting): Promise<string | null> {
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
