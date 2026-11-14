/**
 * What pairing writes on this computer for ssh: QualityLayer's own key (`qualitylayer_ed25519`, made
 * once, no passphrase, 0600), the host keys it trusts in known_hosts, and one marked `Host` block per
 * machine in the ssh config. Other lines of those files are never rewritten. When the runner reads a
 * config of its own (`-F`, a test or the proof), every file lies beside that config instead of ~/.ssh.
 */

import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir, hostname } from "node:os"
import { dirname, join } from "node:path"
import { trimEdgeCharacters } from "../../core/text-boundaries.ts"
import { hostsOf } from "./hosts.ts"
import type { LocalRun } from "./local.ts"

export const KEY_NAME = "qualitylayer_ed25519"

/** What the files need of the environment: where the home is. */
export type HomeEnv = { get(name: string): string | undefined }

export type SshFiles = {
  dir: string
  config: string
  knownHosts: string
  key: string
  /** The person's home, for showing paths as `~/…`. */
  home: string
}

/** The files pairing reads and writes, beside the runner's own config when it has one. */
export function sshFilesOf(env: HomeEnv, configFile?: string): SshFiles {
  const home = env.get("HOME") ?? env.get("USERPROFILE") ?? homedir()
  const own = configFile !== undefined && configFile !== ""
  const dir = own ? dirname(configFile) : join(home, ".ssh")
  return {
    dir,
    config: own ? configFile : join(dir, "config"),
    knownHosts: join(dir, "known_hosts"),
    key: join(dir, KEY_NAME),
    home,
  }
}

/** How a path is shown: `~/.ssh/qualitylayer_ed25519` inside the person's home. */
export const shownPath = (files: SshFiles, path: string): string =>
  path.startsWith(`${files.home}/`) ? `~${path.slice(files.home.length)}` : path

const readOr = async (path: string, otherwise: string): Promise<string> => {
  try {
    return await readFile(path, "utf8")
  } catch {
    return otherwise
  }
}

/** QualityLayer's public key, made first when there is none; null when ssh-keygen could not make it. */
export async function ensureKey(files: SshFiles, local: LocalRun): Promise<string | null> {
  const existing = (await readOr(`${files.key}.pub`, "")).trim()
  if (existing !== "") return existing
  await mkdir(files.dir, { recursive: true, mode: 0o700 })
  const made = await local(
    [
      "ssh-keygen",
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      `qualitylayer@${hostname().split(".")[0] ?? "computer"}`,
      "-f",
      files.key,
    ],
    { timeoutMs: 20_000 },
  )
  if (made.code !== 0) return null
  await chmod(files.key, 0o600).catch(() => {})
  return (await readOr(`${files.key}.pub`, "")).trim() || null
}

export const publicKeyOf = async (files: SshFiles): Promise<string | null> =>
  (await readOr(`${files.key}.pub`, "")).trim() || null

/** What `ssh -G <target>` resolves: the address, port and user ssh would use, and whether a proxy carries it. */
export type Resolved = { host: string; port: number; user: string; proxied: boolean }

export async function resolveTarget(
  local: LocalRun,
  program: string,
  configFile: string | undefined,
  target: string,
  typedPort?: number,
): Promise<Resolved | null> {
  const ran = await local(
    [
      program,
      ...(configFile ? ["-F", configFile] : []),
      "-G",
      ...(typedPort === undefined ? [] : ["-p", String(typedPort)]),
      target,
    ],
    { timeoutMs: 10_000 },
  )
  if (ran.code !== 0) return null
  const value = (key: string): string =>
    new RegExp(`^${key} (.+)$`, "m").exec(ran.out)?.[1]?.trim() ?? ""
  const port = Number(value("port"))
  const proxy = (key: string) => {
    const said = value(key)
    return said !== "" && said !== "none"
  }
  return {
    host: value("hostname"),
    port: Number.isInteger(port) && port > 0 ? port : 22,
    user: value("user"),
    proxied: proxy("proxycommand") || proxy("proxyjump"),
  }
}

/** How known_hosts names a host: `host`, or `[host]:port` off port 22. */
export const knownName = (host: string, port: number): string =>
  port === 22 ? host : `[${host}]:${port}`

/** A host key line as known_hosts holds it after the name: `ssh-ed25519 AAAA…`. */
export type HostKey = { type: string; key: string }

/** The keys `ssh-keyscan` printed, best first (ed25519, then ecdsa, then rsa). */
export function hostKeysIn(out: string): HostKey[] {
  const order = ["ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ssh-rsa"]
  const keys = out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 3 && /^[A-Za-z0-9+/=]+$/.test(parts[2] ?? ""))
    .map((parts) => ({ type: parts[1] as string, key: parts[2] as string }))
    .filter((key) => order.includes(key.type))
  return keys.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
}

/** The host's keys, asked of the host itself (first-use trust, as ssh does). */
export async function scanHostKeys(
  local: LocalRun,
  host: string,
  port: number,
): Promise<HostKey[]> {
  const ran = await local(["ssh-keyscan", "-T", "8", "-p", String(port), host], {
    timeoutMs: 15_000,
  })
  return hostKeysIn(ran.out)
}

/** `ED25519 SHA256:q3Lk…`: what the person sees of a host key. */
export async function fingerprintOf(local: LocalRun, key: HostKey): Promise<string | null> {
  const ran = await local(["ssh-keygen", "-l", "-f", "-"], {
    stdin: `${key.type} ${key.key}\n`,
    timeoutMs: 10_000,
  })
  const found = /^\d+\s+(SHA256:\S+)\s.*\((\w+)\)\s*$/m.exec(ran.out.trim())
  return found === null ? null : `${found[2]} ${found[1]}`
}

/** The keys known_hosts holds for the name; empty when it has none. */
export async function knownKeys(
  local: LocalRun,
  files: SshFiles,
  name: string,
): Promise<HostKey[]> {
  const ran = await local(["ssh-keygen", "-F", name, "-f", files.knownHosts], {
    timeoutMs: 10_000,
  })
  return ran.code === 0 ? hostKeysIn(ran.out) : []
}

/** Trust these keys for the name: its earlier lines go, these are appended. */
export async function trustKeys(
  local: LocalRun,
  files: SshFiles,
  name: string,
  keys: HostKey[],
): Promise<void> {
  await mkdir(files.dir, { recursive: true, mode: 0o700 })
  if ((await knownKeys(local, files, name)).length > 0)
    await local(["ssh-keygen", "-R", name, "-f", files.knownHosts], { timeoutMs: 10_000 })
  const lines = keys.map((key) => `${name} ${key.type} ${key.key}\n`).join("")
  await appendFile(files.knownHosts, lines, { mode: 0o600 })
}

/** A known_hosts file of these keys alone, for one ssh run that must trust exactly them. */
export const knownHostsText = (name: string, keys: HostKey[]): string =>
  keys.map((key) => `${name} ${key.type} ${key.key}\n`).join("")

const begin = (alias: string) => `# QualityLayer machine ${alias} (begin)`
const end = (alias: string) => `# QualityLayer machine ${alias} (end)`

export type HostEntry = {
  alias: string
  host: string
  port: number
  user: string
  /** False when the person's own key reaches it: the block then names no key. */
  ownKey?: boolean
}

/** The block pairing appends for one machine. */
export function hostBlock(files: SshFiles, entry: HostEntry): string {
  return [
    begin(entry.alias),
    `Host ${entry.alias}`,
    `  HostName ${entry.host}`,
    ...(entry.user !== "" ? [`  User ${entry.user}`] : []),
    `  Port ${entry.port}`,
    ...(entry.ownKey === false ? [] : [`  IdentityFile ${files.key}`, "  IdentitiesOnly yes"]),
    `  UserKnownHostsFile ${files.knownHosts}`,
    end(entry.alias),
    "",
  ].join("\n")
}

/** A name for the machine's `Host` that the config does not use yet. */
export async function freeAlias(files: SshFiles, wanted: string): Promise<string> {
  const taken = new Set(hostsOf(await readOr(files.config, "")).map((name) => name.toLowerCase()))
  const base =
    trimEdgeCharacters(wanted.toLowerCase().replace(/[^a-z0-9._-]+/g, "-"), "-.") || "machine"
  let alias = base
  for (let n = 2; taken.has(alias); n++) alias = `${base}-${n}`
  return alias
}

/** Whether the config has a `Host` of this name already (the person's own, or ours). */
export async function hasHost(files: SshFiles, name: string): Promise<boolean> {
  return hostsOf(await readOr(files.config, "")).some((one) => one === name)
}

/** Append (or replace) the machine's marked block; the rest of the config stays as it is. */
export async function writeHostBlock(files: SshFiles, entry: HostEntry): Promise<void> {
  await mkdir(dirname(files.config), { recursive: true, mode: 0o700 })
  const without = removeBlock(await readOr(files.config, ""), entry.alias)
  const joined = without === "" || without.endsWith("\n") ? without : `${without}\n`
  await writeFile(files.config, `${joined}${hostBlock(files, entry)}`, { mode: 0o600 })
}

/** The config without the machine's marked block. */
export function removeBlock(config: string, alias: string): string {
  const lines = config.split("\n")
  const from = lines.indexOf(begin(alias))
  const to = lines.indexOf(end(alias))
  if (from === -1 || to < from) return config
  lines.splice(from, to - from + 1 + (lines[to + 1] === "" && to + 1 < lines.length - 1 ? 1 : 0))
  return lines.join("\n")
}

/** Take the machine's marked block out of the config; true when there was one. */
export async function removeHostBlock(files: SshFiles, alias: string): Promise<boolean> {
  const config = await readOr(files.config, "")
  const without = removeBlock(config, alias)
  if (without === config) return false
  await writeFile(files.config, without, { mode: 0o600 })
  return true
}

/** A public key line that can stand inside single quotes of a shell script as it is. */
export const isPublicKey = (line: string): boolean =>
  /^(ssh-ed25519|ecdsa-sha2-nistp\d+|ssh-rsa) [A-Za-z0-9+/=]+( [A-Za-z0-9@._+-]{0,80})?$/.test(line)

/**
 * The script (for `sh -s` on the machine's standard input) that takes a public key into its
 * authorized_keys, once, with the folder and file closed to others as sshd wants.
 */
export function takeKeyScript(publicKey: string): string {
  if (!isPublicKey(publicKey)) throw new Error("not a public key line")
  return [
    `k='${publicKey}'`,
    "umask 077",
    'mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"',
    'f="$HOME/.ssh/authorized_keys"',
    'touch "$f"',
    'grep -qxF "$k" "$f" || printf "%s\\n" "$k" >> "$f"',
    'chmod 600 "$f"',
    "",
  ].join("\n")
}

/** The script that takes the key out of authorized_keys again; every other line stays. */
export function dropKeyScript(publicKey: string): string {
  if (!isPublicKey(publicKey)) throw new Error("not a public key line")
  return [
    `k='${publicKey}'`,
    'f="$HOME/.ssh/authorized_keys"',
    '[ -f "$f" ] || exit 0',
    'grep -vxF "$k" "$f" > "$f.ql"',
    'cat "$f.ql" > "$f" && rm -f "$f.ql"',
    "",
  ].join("\n")
}
