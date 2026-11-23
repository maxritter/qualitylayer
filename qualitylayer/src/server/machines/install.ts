/**
 * Installs or updates QualityLayer on a machine by running the signed installer there, the command
 * line alone (`--cli-only`), on this computer's update channel. Every command is an argument array
 * of plain words: the installer is downloaded to a file and that file is run, so no shell pipe is
 * needed. What the machine prints is returned as text, last lines only, and goes to no shell.
 */

import { readConfig } from "../../core/config.ts"
import { KEY_FOLLOWS } from "../../core/install/install.ts"
import { effectiveChannel } from "../../core/update/channel.ts"
import { VERSION } from "../../core/version.ts"
import type { Ctx } from "../../ctx.ts"
import { FIRST_WITH_MACHINES, hasMachines, versionOn } from "./check.ts"
import type { Failure } from "./connection.ts"
import type { Ran, Ssh } from "./ssh.ts"

const INSTALLER_URL = "https://qualitylayer.dev/install.sh"
const FILE = "~/.qualitylayer/install.sh"
/** What a machine's shell reads as exactly itself; the runner refuses any other word. */
const PLAIN = /^[A-Za-z0-9_@%+=:,./-]+$/
/** The installer's own mirror settings, passed on when this server has them (tests, mirrors). */
const MIRROR_VARIABLES = ["QUALITYLAYER_RELEASE_BASE", "QUALITYLAYER_RELEASE_API"]
const LAST_LINES = 5
const LINE_CHARS = 240

export type InstallPlan = {
  channel: "stable" | "beta"
  /** Where the machine downloads the installer from. */
  installerUrl: string
  /** `NAME=value` words for the installer's environment. */
  variables: string[]
}

/**
 * What this computer's server asks of the machine: its update channel, and the installer's address,
 * `QUALITYLAYER_INSTALLER_URL` when this server was started with one (a mirror, a test). A value
 * that is not a plain word is left out, since it could not pass as one word.
 */
export async function installPlan(ctx: Ctx): Promise<InstallPlan> {
  const named = ctx.env.get("QUALITYLAYER_INSTALLER_URL")
  const plain = (value: string | undefined): value is string =>
    value !== undefined && PLAIN.test(value)
  return {
    channel: effectiveChannel((await readConfig(ctx)).updates.channel, VERSION),
    installerUrl: plain(named) && /^https?:\/\//.test(named) ? named : INSTALLER_URL,
    variables: MIRROR_VARIABLES.flatMap((name) => {
      const value = ctx.env.get(name)
      return plain(value) ? [`${name}=${value}`] : []
    }),
  }
}

export type Installed =
  | { ok: true; version: string }
  | { ok: false; reason: string; lines: string[]; failure?: Failure }

const ESC = String.fromCharCode(27)
const COLOURS = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, "g")

const printable = (line: string): string =>
  Array.from(line.replace(COLOURS, ""))
    .filter((char) => (char.codePointAt(0) ?? 0) >= 32 && char !== "\u007f")
    .join("")
    .trim()
    .slice(0, LINE_CHARS)

/** The last lines the machine said, standard output first, as plain text. */
export function lastLines(...said: string[]): string[] {
  return said
    .flatMap((text) => text.split("\n"))
    .map(printable)
    .filter((line) => line !== "")
    .slice(-LAST_LINES)
}

const broke = (reason: string, ran: Ran): Installed => ({
  ok: false,
  reason,
  lines: lastLines(ran.out, ran.err),
})

async function runPreparedStep(
  ssh: Ssh,
  target: string,
  argv: string[],
  failureReason: string,
): Promise<Installed | null> {
  const step = await ssh.run(target, argv, { timeoutMs: 30_000 })
  if (!step.ok) return { ok: false, reason: step.reason, lines: [], failure: step.failure }
  return step.code === 0 ? null : broke(failureReason, step)
}

/** The installer on the machine, as a file; wget is tried where there is no curl. */
async function download(ssh: Ssh, target: string, url: string): Promise<Installed | null> {
  const prepError = "The machine's home could not be prepared for the installer."
  const made = await runPreparedStep(ssh, target, ["mkdir", "-p", "~/.qualitylayer"], prepError)
  if (made !== null) return made
  // An ssh login on Ubuntu runs with umask 002, so the folder just made would be group-writable,
  // and QualityLayer refuses to work in such a folder ("Unsafe directory ownership").
  const closed = await runPreparedStep(ssh, target, ["chmod", "700", "~/.qualitylayer"], prepError)
  if (closed !== null) return closed
  let got = await ssh.run(target, ["curl", "-fsSL", "-o", FILE, url], { timeoutMs: 180_000 })
  if (got.ok && got.code === 127)
    got = await ssh.run(target, ["wget", "-q", "-O", FILE, url], { timeoutMs: 180_000 })
  if (!got.ok) return { ok: false, reason: got.reason, lines: [], failure: got.failure }
  return got.code === 0 ? null : broke("The installer could not be downloaded on the machine.", got)
}

async function verifyInstalledVersion(ssh: Ssh, target: string, ran: Ran): Promise<Installed> {
  const version = await versionOn(ssh, target)
  if (version !== null && typeof version === "object")
    return { ok: false, reason: version.reason, lines: [], failure: version.failure }
  if (version === null)
    return broke("The installer finished, but QualityLayer did not answer there afterwards.", ran)
  if (!hasMachines(version))
    return broke(
      `The installer finished, but QualityLayer there is ${version}; machines need ${FIRST_WITH_MACHINES} or newer.`,
      ran,
    )
  return { ok: true, version }
}

/**
 * Run the installer on the machine and check what it left: QualityLayer there must answer and
 * be a version that can be served. The downloaded file is removed whatever happened. When this
 * computer's key is activated there next (`keyFollows`), the install there starts no trial.
 */
export async function installOn(
  ssh: Ssh,
  target: string,
  plan: InstallPlan,
  keyFollows = false,
): Promise<Installed> {
  const fetched = await download(ssh, target, plan.installerUrl)
  try {
    if (fetched !== null) return fetched
    const ran = await ssh.run(
      target,
      [
        "env",
        `QUALITYLAYER_CHANNEL=${plan.channel}`,
        ...plan.variables,
        ...(keyFollows ? [`${KEY_FOLLOWS}=1`] : []),
        "bash",
        FILE,
        "--cli-only",
        "--non-interactive",
      ],
      { timeoutMs: 600_000 },
    )
    if (!ran.ok) return { ok: false, reason: ran.reason, lines: [], failure: ran.failure }
    if (ran.code !== 0) return broke("The installer stopped before it finished.", ran)
    return await verifyInstalledVersion(ssh, target, ran)
  } finally {
    await ssh.run(target, ["rm", "-f", FILE], { timeoutMs: 30_000 })
  }
}
