/**
 * Computers on this network that offer ssh, as Bonjour announces them (`_ssh._tcp`: a Mac with Remote
 * Login does; Linux with Avahi). A shortcut for the Add field, never a requirement: no Bonjour gives
 * an empty list. Each browse is bounded in time and read only; nothing is connected.
 */

import { hostname, userInfo } from "node:os"
import { isLineText, skipWhitespace } from "../../core/text-boundaries.ts"
import type { LocalRun } from "./local.ts"

export type Nearby = { host: string; user: string }

const BROWSE_MS = 1500

/** The instance names `dns-sd -B` printed. */
export function instancesIn(out: string): string[] {
  const names = out.split("\n").flatMap((line) => {
    const end = line.trimEnd().length
    const lastBreak = Math.max(
      line.lastIndexOf("\r", end - 1),
      line.lastIndexOf("\n", end - 1),
      line.lastIndexOf("\u2028", end - 1),
      line.lastIndexOf("\u2029", end - 1),
    )
    const prefixes = line.matchAll(/\sAdd\s+\d+\s+\d+\s+local\.\s+_ssh\._tcp\./g)
    for (const prefix of prefixes) {
      const after = prefix.index + prefix[0].length
      const start = skipWhitespace(line, after)
      if (start === after) continue
      if (start < end && start > lastBreak) return [line.slice(start, end)]
      if (start === line.length)
        for (let at = line.length - 1; at > after; at--)
          if (isLineText(line.charAt(at))) return [line.charAt(at)]
    }
    return []
  })
  return [...new Set(names)]
}

/** The host `dns-sd -L` resolved an instance to: "mac-mini.local". */
export function reachedAt(out: string): string | null {
  const found = /can be reached at\s+(\S+?)\.?:(\d+)/.exec(out)
  return found === null ? null : (found[1] as string).replace(/\.$/, "")
}

/** `avahi-browse -tpr _ssh._tcp` lines: `=;eth0;IPv4;name;_ssh._tcp;local;host.local;10.0.0.7;22;`. */
export function avahiHostsIn(out: string): string[] {
  const hosts = out.split("\n").flatMap((line) => {
    const parts = line.split(";")
    return parts[0] === "=" && parts[6] ? [parts[6]] : []
  })
  return [...new Set(hosts)]
}

const bare = (host: string): string =>
  host.toLowerCase().replace(/\.(local|fritz\.box|lan|home)$/, "")

export async function nearby(local: LocalRun, platform = process.platform): Promise<Nearby[]> {
  const user = userInfo().username
  // This computer announces itself too; macOS names it on the network by its LocalHostName.
  const mine = new Set([bare(hostname())])
  let hosts: string[] = []
  if (platform === "darwin") {
    const named = (
      await local(["scutil", "--get", "LocalHostName"], { timeoutMs: 3000 })
    ).out.trim()
    if (named !== "") mine.add(bare(named))
    const browsed = await local(["dns-sd", "-B", "_ssh._tcp", "local."], { timeoutMs: BROWSE_MS })
    const names = instancesIn(browsed.out).slice(0, 12)
    const resolved = await Promise.all(
      names.map(async (name) =>
        reachedAt(
          (await local(["dns-sd", "-L", name, "_ssh._tcp", "local."], { timeoutMs: BROWSE_MS }))
            .out,
        ),
      ),
    )
    hosts = resolved.filter((host): host is string => host !== null)
  } else if (platform === "linux") {
    hosts = avahiHostsIn(
      (await local(["avahi-browse", "-tpr", "_ssh._tcp"], { timeoutMs: BROWSE_MS * 2 })).out,
    )
  }
  return [...new Set(hosts)]
    .filter((host) => /^[A-Za-z0-9.-]{1,120}$/.test(host) && !mine.has(bare(host)))
    .map((host) => ({ host, user }))
}
